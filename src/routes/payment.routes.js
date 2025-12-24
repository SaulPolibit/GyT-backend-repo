/**
 * Payment API Routes
 * Endpoints for managing structure investment payment data
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { handleDocumentUpload } = require('../middleware/upload');
const { uploadToSupabase } = require('../utils/fileUpload');
const Payment = require('../models/supabase/payment');
const { Structure, User } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext } = require('../middleware/rbac');

const router = express.Router();

/**
 * @route   GET /api/payments/health
 * @desc    Health check for Payment API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Payment API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

/**
 * @route   GET /api/payments/me
 * @desc    Get all payments for the authenticated user with structure details
 * @access  Private (requires authentication)
 */
router.get('/me', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  // Get all payments for the current user
  const payments = await Payment.find({ userId });

  // Attach structure details to each payment
  const paymentsWithStructures = await Promise.all(
    payments.map(async (payment) => {
      let structure = null;

      if (payment.structureId) {
        try {
          structure = await Structure.findById(payment.structureId);
        } catch (error) {
          console.error(`Error fetching structure ${payment.structureId}:`, error.message);
        }
      }

      return {
        ...payment,
        structure: structure ? {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          status: structure.status,
          baseCurrency: structure.baseCurrency,
          description: structure.description,
        } : null
      };
    })
  );

  res.status(200).json({
    success: true,
    count: paymentsWithStructures.length,
    data: paymentsWithStructures
  });
}));

/**
 * @route   POST /api/payments
 * @desc    Create a new payment with optional file upload
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, handleDocumentUpload, catchAsync(async (req, res) => {
  const {
    email,
    submissionId,
    paymentTransactionHash,
    mintTransactionHash,
    amount,
    structureId,
    contractId,
    status,
    tokenId,
    tokens,
    paymentMethod,
    walletAddress
  } = req.body;

  // Validate required fields
  validate(email, 'Email is required');
  validate(submissionId, 'Submission ID is required');
  validate(amount, 'Amount is required');
  validate(structureId, 'Structure ID is required');
  validate(contractId, 'Contract ID is required');

  let paymentImageUrl = null;

  // If file is uploaded, save it to Supabase Storage
  if (req.file) {
    const folder = `payments/${submissionId}`;
    const uploadResult = await uploadToSupabase(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder
    );
    paymentImageUrl = uploadResult.publicUrl;
  }

  // Get authenticated user ID
  const userId = req.auth?.userId || req.user?.id;

  // Create payment data
  const paymentData = {
    email: email.trim().toLowerCase(),
    submissionId: submissionId.trim(),
    paymentImage: paymentImageUrl,
    paymentTransactionHash: paymentTransactionHash?.trim() || null,
    mintTransactionHash: mintTransactionHash?.trim() || null,
    amount: amount.trim(),
    structureId: structureId.trim(),
    contractId: contractId.trim(),
    status: status?.trim() || 'pending',
    tokenId: tokenId?.trim() || null,
    tokens: tokens ? parseInt(tokens, 10) : null,
    paymentMethod: paymentMethod?.trim() || null,
    walletAddress: walletAddress?.trim() || null,
    userId: userId
  };

  const payment = await Payment.create(paymentData);

  res.status(201).json({
    success: true,
    message: 'Payment created successfully',
    data: payment
  });
}));

/**
 * @route   GET /api/payments
 * @desc    Get all payments with optional filters
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const {
    email,
    submissionId,
    structureId,
    contractId,
    status,
    paymentTransactionHash,
    mintTransactionHash
  } = req.query;

  let filter = {};

  if (email) filter.email = email.toLowerCase();
  if (submissionId) filter.submissionId = submissionId;
  if (structureId) filter.structureId = structureId;
  if (contractId) filter.contractId = contractId;
  if (status) filter.status = status;
  if (paymentTransactionHash) filter.paymentTransactionHash = paymentTransactionHash;
  if (mintTransactionHash) filter.mintTransactionHash = mintTransactionHash;

  const payments = await Payment.find(filter);

  // Attach user and structure details to each payment
  const paymentsWithDetails = await Promise.all(
    payments.map(async (payment) => {
      let user = null;
      let structure = null;

      if (payment.userId) {
        try {
          user = await User.findById(payment.userId);
        } catch (error) {
          console.error(`Error fetching user ${payment.userId}:`, error.message);
        }
      }

      if (payment.structureId) {
        try {
          structure = await Structure.findById(payment.structureId);
        } catch (error) {
          console.error(`Error fetching structure ${payment.structureId}:`, error.message);
        }
      }

      return {
        ...payment,
        user: user ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        } : null,
        structure: structure ? {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          status: structure.status,
          baseCurrency: structure.baseCurrency,
          description: structure.description,
        } : null
      };
    })
  );

  res.status(200).json({
    success: true,
    count: paymentsWithDetails.length,
    data: paymentsWithDetails
  });
}));

/**
 * @route   GET /api/payments/email/:email
 * @desc    Get all payments for a specific email
 * @access  Private (requires authentication)
 */
router.get('/email/:email', authenticate, catchAsync(async (req, res) => {
  const { email } = req.params;

  validate(email, 'Email is required');

  const payments = await Payment.findByEmail(email);

  res.status(200).json({
    success: true,
    count: payments.length,
    data: payments
  });
}));

/**
 * @route   GET /api/payments/submission/:submissionId
 * @desc    Get payment by submission ID
 * @access  Private (requires authentication)
 */
router.get('/submission/:submissionId', authenticate, catchAsync(async (req, res) => {
  const { submissionId } = req.params;

  validate(submissionId, 'Submission ID is required');

  const payment = await Payment.findBySubmissionId(submissionId);

  validate(payment, 'Payment not found for this submission ID');

  res.status(200).json({
    success: true,
    data: payment
  });
}));

/**
 * @route   GET /api/payments/transaction/:paymentTransactionHash
 * @desc    Get payment by payment transaction hash
 * @access  Private (requires authentication)
 */
router.get('/transaction/:paymentTransactionHash', authenticate, catchAsync(async (req, res) => {
  const { paymentTransactionHash } = req.params;

  validate(paymentTransactionHash, 'Payment transaction hash is required');

  const payment = await Payment.findByTransactionHash(paymentTransactionHash);

  validate(payment, 'Payment not found for this payment transaction hash');

  res.status(200).json({
    success: true,
    data: payment
  });
}));

/**
 * @route   GET /api/payments/structure/:structureId
 * @desc    Get all payments for a specific structure
 * @access  Private (requires authentication)
 */
router.get('/structure/:structureId', authenticate, catchAsync(async (req, res) => {
  const { structureId } = req.params;

  validate(structureId, 'Structure ID is required');

  const payments = await Payment.findByStructureId(structureId);

  res.status(200).json({
    success: true,
    count: payments.length,
    data: payments
  });
}));

/**
 * @route   GET /api/payments/contract/:contractId
 * @desc    Get all payments for a specific contract
 * @access  Private (requires authentication)
 */
router.get('/contract/:contractId', authenticate, catchAsync(async (req, res) => {
  const { contractId } = req.params;

  validate(contractId, 'Contract ID is required');

  const payments = await Payment.findByContractId(contractId);

  res.status(200).json({
    success: true,
    count: payments.length,
    data: payments
  });
}));

/**
 * @route   GET /api/payments/status/:status
 * @desc    Get all payments by status
 * @access  Private (requires authentication)
 */
router.get('/status/:status', authenticate, catchAsync(async (req, res) => {
  const { status } = req.params;

  validate(status, 'Status is required');

  const validStatuses = ['pending', 'completed', 'failed', 'processing'];
  validate(
    validStatuses.includes(status),
    `Status must be one of: ${validStatuses.join(', ')}`
  );

  const payments = await Payment.findByStatus(status);

  res.status(200).json({
    success: true,
    count: payments.length,
    data: payments
  });
}));

/**
 * @route   GET /api/payments/:id
 * @desc    Get a single payment by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const payment = await Payment.findById(id);

  validate(payment, 'Payment not found');

  res.status(200).json({
    success: true,
    data: payment
  });
}));

/**
 * @route   PUT /api/payments/:id
 * @desc    Update a payment
 * @access  Private (requires authentication)
 */
router.put('/:id', authenticate, handleDocumentUpload, catchAsync(async (req, res) => {
  const { id } = req.params;

  const payment = await Payment.findById(id);
  validate(payment, 'Payment not found');

  const updateData = {};
  const allowedFields = [
    'email',
    'paymentTransactionHash',
    'mintTransactionHash',
    'amount',
    'status',
    'tokenId',
    'tokens',
    'paymentMethod',
    'adminNotes'
  ];

  // Update allowed fields
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (field === 'email') {
        updateData[field] = req.body[field].trim().toLowerCase();
      } else if (field === 'tokens') {
        updateData[field] = req.body[field] ? parseInt(req.body[field], 10) : null;
      } else if (typeof req.body[field] === 'string') {
        updateData[field] = req.body[field].trim();
      } else {
        updateData[field] = req.body[field];
      }
    }
  }

  // If new file is uploaded, save it to Supabase Storage
  if (req.file) {
    const folder = `payments/${payment.submissionId}`;
    const uploadResult = await uploadToSupabase(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder
    );
    updateData.paymentImage = uploadResult.publicUrl;
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  // Validate status if provided
  if (updateData.status) {
    const validStatuses = ['pending', 'completed', 'failed', 'processing', 'approved', 'rejected'];
    validate(
      validStatuses.includes(updateData.status),
      `Status must be one of: ${validStatuses.join(', ')}`
    );
  }

  const updatedPayment = await Payment.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Payment updated successfully',
    data: updatedPayment
  });
}));

/**
 * @route   PATCH /api/payments/:id/status
 * @desc    Update payment status
 * @access  Private (requires authentication)
 */
router.patch('/:id/status', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  validate(status, 'Status is required');

  const validStatuses = ['pending', 'completed', 'failed', 'processing', 'approved', 'rejected'];
  validate(
    validStatuses.includes(status),
    `Status must be one of: ${validStatuses.join(', ')}`
  );

  const payment = await Payment.findById(id);
  validate(payment, 'Payment not found');

  const updatedPayment = await Payment.updateStatus(id, status);

  res.status(200).json({
    success: true,
    message: 'Payment status updated successfully',
    data: updatedPayment
  });
}));

/**
 * @route   PATCH /api/payments/:id/payment-transaction
 * @desc    Update payment transaction hash
 * @access  Private (requires authentication)
 */
router.patch('/:id/payment-transaction', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { paymentTransactionHash } = req.body;

  validate(paymentTransactionHash, 'Payment transaction hash is required');

  const payment = await Payment.findById(id);
  validate(payment, 'Payment not found');

  const updatedPayment = await Payment.updateTransactionHash(id, paymentTransactionHash.trim());

  res.status(200).json({
    success: true,
    message: 'Payment transaction hash updated successfully',
    data: updatedPayment
  });
}));

/**
 * @route   PATCH /api/payments/:id/token-transaction
 * @desc    Update token transaction hash
 * @access  Private (requires authentication)
 */
router.patch('/:id/token-transaction', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { mintTransactionHash } = req.body;

  validate(mintTransactionHash, 'Token transaction hash is required');

  const payment = await Payment.findById(id);
  validate(payment, 'Payment not found');

  const updatedPayment = await Payment.updateTokenTransactionHash(id, mintTransactionHash.trim());

  res.status(200).json({
    success: true,
    message: 'Token transaction hash updated successfully',
    data: updatedPayment
  });
}));

/**
 * @route   DELETE /api/payments/:id
 * @desc    Delete a payment
 * @access  Private (requires authentication)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const payment = await Payment.findById(id);
  validate(payment, 'Payment not found');

  await Payment.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Payment deleted successfully'
  });
}));

/**
 * @route   GET /api/payments/approvals/stats
 * @desc    Get payment statistics for approval workflow
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/approvals/stats', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const stats = await Payment.getStats();

  res.status(200).json({
    success: true,
    data: stats
  });
}));

/**
 * @route   PATCH /api/payments/:id/approve
 * @desc    Approve a payment
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/approve', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId } = getUserContext(req);
  const { id } = req.params;
  const { adminNotes } = req.body;

  const payment = await Payment.findById(id);
  validate(payment, 'Payment not found');
  validate(payment.status === 'pending', 'Payment has already been processed');

  const approvedPayment = await Payment.approve(id, userId, adminNotes);

  res.status(200).json({
    success: true,
    message: 'Payment approved successfully',
    data: approvedPayment
  });
}));

/**
 * @route   PATCH /api/payments/:id/reject
 * @desc    Reject a payment
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/reject', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId } = getUserContext(req);
  const { id } = req.params;
  const { adminNotes } = req.body;

  const payment = await Payment.findById(id);
  validate(payment, 'Payment not found');
  validate(payment.status === 'pending', 'Payment has already been processed');
  validate(adminNotes, 'Admin notes are required when rejecting a payment');

  const rejectedPayment = await Payment.reject(id, userId, adminNotes);

  res.status(200).json({
    success: true,
    message: 'Payment rejected successfully',
    data: rejectedPayment
  });
}));

module.exports = router;
