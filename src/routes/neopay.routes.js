/**
 * NeoPay Routes
 * Payment processing endpoints for NeoPay gateway
 */
const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const neoPayService = require('../services/neopay.service');
const { NeoPay } = require('../models/supabase');

// ============================================
// HEALTH CHECK
// ============================================

/**
 * @route   GET /api/neopay/health
 * @desc    Check NeoPay service status
 * @access  Public
 */
router.get('/health', (_req, res) => {
  const neopayConfig = require('../config/neopay');
  res.json({
    service: 'NeoPay',
    status: 'operational',
    environment: neopayConfig.environment,
    configured: neopayConfig.isValid(),
  });
});

// ============================================
// SALE OPERATIONS
// ============================================

/**
 * @route   POST /api/neopay/charge
 * @desc    Process a simple sale (without 3D Secure)
 * @access  Private
 */
router.post('/charge', authenticate, catchAsync(async (req, res) => {
  const {
    amount,
    cardNumber,
    cardExpiration,
    cvv,
    cardHolderName,
    structureId,
    investmentId,
    orderInfo,
    additionalData,
  } = req.body;

  // Validation
  validate(amount, 'Amount is required');
  validate(cardNumber, 'Card number is required');
  validate(cardExpiration, 'Card expiration is required');
  validate(cvv, 'CVV is required');
  validate(cardHolderName, 'Card holder name is required');

  // Validate amount
  const numAmount = parseFloat(amount);
  validate(!isNaN(numAmount) && numAmount > 0, 'Amount must be a positive number');

  // Validate card number (basic)
  validate(cardNumber.length >= 13 && cardNumber.length <= 19, 'Invalid card number');

  // Validate expiration format (YYMM)
  validate(/^\d{4}$/.test(cardExpiration), 'Expiration must be in YYMM format');

  // Validate CVV
  validate(/^\d{3,4}$/.test(cvv), 'CVV must be 3 or 4 digits');

  const result = await neoPayService.processSale({
    userId: req.user.id,
    structureId,
    investmentId,
    amount: numAmount,
    cardNumber,
    cardExpiration,
    cvv,
    cardHolderName,
    orderInfo,
    additionalData,
    shopperIP: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
  });

  if (result.success) {
    res.status(200).json({
      success: true,
      message: result.isPartialApproval
        ? 'Payment partially approved'
        : 'Payment approved',
      data: {
        transactionId: result.transaction.id,
        authorizationCode: result.response.authorizationCode,
        referenceNumber: result.response.referenceNumber,
        amountApproved: result.transaction.amountApproved,
        isPartialApproval: result.isPartialApproval,
      },
    });
  } else {
    res.status(400).json({
      success: false,
      message: 'Payment declined',
      error: result.error,
      data: {
        transactionId: result.transaction.id,
        responseCode: result.response?.responseCode,
      },
    });
  }
}));

// ============================================
// 3D SECURE OPERATIONS
// ============================================

/**
 * @route   POST /api/neopay/charge-3ds
 * @desc    Start 3D Secure payment (Step 1)
 * @access  Private
 */
router.post('/charge-3ds', authenticate, catchAsync(async (req, res) => {
  const {
    amount,
    cardNumber,
    cardExpiration,
    cvv,
    cardHolderName,
    billingInfo,
    urlCommerce,
    structureId,
    investmentId,
    orderInfo,
    additionalData,
  } = req.body;

  // Validation
  validate(amount, 'Amount is required');
  validate(cardNumber, 'Card number is required');
  validate(cardExpiration, 'Card expiration is required');
  validate(cvv, 'CVV is required');
  validate(cardHolderName, 'Card holder name is required');
  validate(billingInfo, 'Billing information is required');
  validate(urlCommerce, 'Commerce URL is required');

  // Validate billing info
  validate(billingInfo.firstName, 'Billing first name is required');
  validate(billingInfo.lastName, 'Billing last name is required');
  validate(billingInfo.addressOne, 'Billing address is required');
  validate(billingInfo.locality, 'Billing city is required');
  validate(billingInfo.administrativeArea, 'Billing state/department is required');
  validate(billingInfo.postalCode, 'Billing postal code is required');
  validate(billingInfo.country, 'Billing country is required');
  validate(billingInfo.email, 'Billing email is required');
  validate(billingInfo.phoneNumber, 'Billing phone is required');

  const result = await neoPayService.processSale3DS_Step1({
    userId: req.user.id,
    structureId,
    investmentId,
    amount: parseFloat(amount),
    cardNumber,
    cardExpiration,
    cvv,
    cardHolderName,
    billingInfo,
    urlCommerce,
    orderInfo,
    additionalData,
    shopperIP: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
  });

  if (result.success) {
    res.status(200).json({
      success: true,
      message: '3D Secure Step 1 completed',
      data: {
        transactionId: result.transaction.id,
        nextStep: result.nextStep,
        secure3d: result.secure3d,
      },
    });
  } else {
    res.status(400).json({
      success: false,
      message: '3D Secure authentication failed',
      error: result.error,
      data: {
        transactionId: result.transaction?.id,
      },
    });
  }
}));

/**
 * @route   POST /api/neopay/charge-3ds/step3
 * @desc    Continue 3D Secure payment (Step 3 - after iFrame)
 * @access  Private
 */
router.post('/charge-3ds/step3', authenticate, catchAsync(async (req, res) => {
  const { transactionId, referenceId } = req.body;

  validate(transactionId, 'Transaction ID is required');
  validate(referenceId, 'Reference ID is required');

  const result = await neoPayService.processSale3DS_Step3({
    transactionId,
    referenceId,
    shopperIP: req.ip || req.connection.remoteAddress,
  });

  if (result.success) {
    if (result.needsAdditionalAuth) {
      // Needs Step 4 and 5
      res.status(200).json({
        success: true,
        message: 'Additional authentication required',
        data: {
          transactionId: result.transaction.id,
          nextStep: result.nextStep,
          secure3d: result.secure3d,
        },
      });
    } else {
      // Approved at Step 3
      res.status(200).json({
        success: true,
        message: result.isPartialApproval
          ? 'Payment partially approved'
          : 'Payment approved',
        data: {
          transactionId: result.transaction.id,
          authorizationCode: result.response.authorizationCode,
          referenceNumber: result.response.referenceNumber,
          amountApproved: result.transaction.amountApproved,
          isPartialApproval: result.isPartialApproval,
        },
      });
    }
  } else {
    res.status(400).json({
      success: false,
      message: 'Payment declined',
      error: result.error,
      data: {
        transactionId: result.transaction?.id,
      },
    });
  }
}));

/**
 * @route   POST /api/neopay/charge-3ds/step5
 * @desc    Finalize 3D Secure payment (Step 5 - after PIN)
 * @access  Private
 */
router.post('/charge-3ds/step5', authenticate, catchAsync(async (req, res) => {
  const { transactionId, referenceId } = req.body;

  validate(transactionId, 'Transaction ID is required');
  validate(referenceId, 'Reference ID is required');

  const result = await neoPayService.processSale3DS_Step5({
    transactionId,
    referenceId,
    shopperIP: req.ip || req.connection.remoteAddress,
  });

  if (result.success) {
    res.status(200).json({
      success: true,
      message: result.isPartialApproval
        ? 'Payment partially approved'
        : 'Payment approved',
      data: {
        transactionId: result.transaction.id,
        authorizationCode: result.response.authorizationCode,
        referenceNumber: result.response.referenceNumber,
        amountApproved: result.transaction.amountApproved,
        isPartialApproval: result.isPartialApproval,
      },
    });
  } else {
    res.status(400).json({
      success: false,
      message: 'Payment declined',
      error: result.error,
      data: {
        transactionId: result.transaction?.id,
      },
    });
  }
}));

// ============================================
// VOID OPERATIONS
// ============================================

/**
 * @route   POST /api/neopay/void
 * @desc    Void/cancel a transaction
 * @access  Private
 */
router.post('/void', authenticate, catchAsync(async (req, res) => {
  const { transactionId, reason } = req.body;

  validate(transactionId, 'Transaction ID is required');

  const result = await neoPayService.processVoid({
    originalTransactionId: transactionId,
    userId: req.user.id,
    reason: reason || 'Customer requested',
    shopperIP: req.ip || req.connection.remoteAddress,
  });

  if (result.success) {
    res.status(200).json({
      success: true,
      message: 'Transaction voided successfully',
      data: {
        voidTransactionId: result.voidTransaction.id,
        authorizationCode: result.response.authorizationCode,
        referenceNumber: result.response.referenceNumber,
      },
    });
  } else {
    res.status(400).json({
      success: false,
      message: 'Void failed',
      error: result.error,
    });
  }
}));

// ============================================
// TRANSACTION QUERIES
// ============================================

/**
 * @route   GET /api/neopay/transactions
 * @desc    Get user's transactions
 * @access  Private
 */
router.get('/transactions', authenticate, catchAsync(async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;

  const transactions = await NeoPay.findByUserId(req.user.id, {
    status,
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  res.status(200).json({
    success: true,
    count: transactions.length,
    data: transactions,
  });
}));

/**
 * @route   GET /api/neopay/transactions/:id
 * @desc    Get transaction by ID
 * @access  Private
 */
router.get('/transactions/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const transaction = await NeoPay.findById(id);
  validate(transaction, 'Transaction not found');

  // Verify ownership
  validate(
    transaction.userId === req.user.id,
    'You do not have permission to view this transaction'
  );

  res.status(200).json({
    success: true,
    data: transaction,
  });
}));

/**
 * @route   GET /api/neopay/transactions/:id/voucher
 * @desc    Get voucher/receipt for transaction
 * @access  Private
 */
router.get('/transactions/:id/voucher', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const transaction = await NeoPay.findById(id);
  validate(transaction, 'Transaction not found');

  // Verify ownership
  validate(
    transaction.userId === req.user.id,
    'You do not have permission to view this voucher'
  );

  // Only approved or voided transactions have vouchers
  validate(
    ['approved', 'voided'].includes(transaction.status),
    'Voucher only available for approved or voided transactions'
  );

  const voucher = await neoPayService.generateVoucher(id);

  res.status(200).json({
    success: true,
    data: voucher,
  });
}));

/**
 * @route   GET /api/neopay/stats
 * @desc    Get transaction statistics
 * @access  Private
 */
router.get('/stats', authenticate, catchAsync(async (req, res) => {
  const { dateFrom, dateTo } = req.query;

  const stats = await NeoPay.getStats({
    userId: req.user.id,
    dateFrom,
    dateTo,
  });

  res.status(200).json({
    success: true,
    data: stats,
  });
}));

module.exports = router;
