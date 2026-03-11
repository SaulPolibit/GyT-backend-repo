/**
 * Payment API Routes
 * Endpoints for managing structure investment payment data
 */
const express = require('express');
const crypto = require('crypto');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { handleDocumentUpload } = require('../middleware/upload');
const { uploadToSupabase } = require('../utils/fileUpload');
const Payment = require('../models/supabase/payment');
const { Structure, User, StructureInvestor, CapitalCall, Notification, NotificationSettings } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');

const router = express.Router();

/**
 * Helper function to get or create structure investor record for a user+structure combination
 * Used when capital commitments are made through the marketplace
 */
async function getOrCreateStructureInvestor(userId, structureId, commitment) {
  try {
    // Check if structure investor record already exists for this user+structure
    const existingRecord = await StructureInvestor.findByUserAndStructure(userId, structureId);

    if (existingRecord) {
      // Update existing record's commitment (add to existing)
      const newCommitment = (existingRecord.commitment || 0) + commitment;

      const updatedRecord = await StructureInvestor.findByIdAndUpdate(existingRecord.id, {
        commitment: newCommitment
      });

      console.log(`[Payment] Updated structure investor ${existingRecord.id} commitment to ${newCommitment}`);

      // Recalculate ownership percentages for all investors in this structure
      await StructureInvestor.recalculateOwnership(structureId);

      return updatedRecord;
    }

    // Create new structure investor record
    const newRecord = await StructureInvestor.create({
      userId,
      structureId,
      commitment,
      ownershipPercent: 0, // Will be recalculated
      status: 'active'
    });

    console.log(`[Payment] Created structure investor ${newRecord.id} for user ${userId} in structure ${structureId}`);

    // Recalculate ownership percentages for all investors in this structure
    await StructureInvestor.recalculateOwnership(structureId);

    return newRecord;
  } catch (error) {
    console.error('[Payment] Error in getOrCreateStructureInvestor:', error.message);
    // Don't throw - structure investor creation is supplementary to payment
    return null;
  }
}

/**
 * Helper function to get structure investor data for a user+structure combination
 */
async function getStructureInvestorForUser(userId, structureId) {
  try {
    return await StructureInvestor.findByUserAndStructure(userId, structureId);
  } catch (error) {
    console.error('[Payment] Error fetching structure investor:', error.message);
    return null;
  }
}

/**
 * Helper function to get capital call data for a user in a structure
 * Note: Capital call allocations use user_id (not investor_id) after the migration
 */
async function getCapitalCallDataForInvestor(userId, structureId) {
  try {
    const capitalCalls = await CapitalCall.findByStructureId(structureId);

    let totalCalled = 0;
    let totalPaid = 0;

    for (const call of capitalCalls) {
      if (call.status === 'Draft' || call.status === 'Cancelled') continue;

      // Look for allocation by userId (new) or investorId (legacy)
      const allocation = call.investorAllocations?.find(
        alloc => alloc.userId === userId || alloc.investorId === userId
      );

      if (allocation) {
        totalCalled += allocation.allocatedAmount || 0;
        totalPaid += allocation.amountPaid || 0;
      }
    }

    return {
      totalCalled,
      totalPaid,
      totalUnpaid: totalCalled - totalPaid,
      callCount: capitalCalls.filter(cc => cc.status !== 'Draft' && cc.status !== 'Cancelled').length
    };
  } catch (error) {
    console.error('[Payment] Error fetching capital call data:', error.message);
    return { totalCalled: 0, totalPaid: 0, totalUnpaid: 0, callCount: 0 };
  }
}

/**
 * Helper function to create payment confirmation notification
 * @param {Object} payment - Payment object
 * @param {string} status - Payment status (approved/completed)
 */
async function createPaymentConfirmationNotification(payment, status) {
  try {
    if (!payment.userId) {
      console.log('[Payment] No userId on payment, skipping notification');
      return;
    }

    // Check if user has payment confirmations enabled
    const settings = await NotificationSettings.findByUserId(payment.userId);
    // Default to sending if no settings found or paymentConfirmations is not explicitly false
    const shouldNotify = !settings || settings.paymentConfirmations !== false;

    if (!shouldNotify) {
      console.log(`[Payment] User ${payment.userId} has payment confirmations disabled, skipping notification`);
      return;
    }

    // Get structure name for notification
    let structureName = 'your investment';
    if (payment.structureId) {
      try {
        const structure = await Structure.findById(payment.structureId);
        if (structure) {
          structureName = structure.name || 'your investment';
        }
      } catch (err) {
        console.log('[Payment] Could not fetch structure name:', err.message);
      }
    }

    const formattedAmount = payment.amount ? `$${parseFloat(payment.amount).toLocaleString()}` : 'your payment';

    await Notification.create({
      userId: payment.userId,
      notificationType: 'payment_confirmation',
      channel: 'portal',
      title: 'Payment Confirmed',
      message: `Your payment of ${formattedAmount} for ${structureName} has been ${status}.`,
      priority: 'normal',
      relatedEntityType: 'payment',
      relatedEntityId: payment.id,
      actionUrl: '/lp-portal/portfolio',
      metadata: {
        paymentId: payment.id,
        amount: payment.amount,
        structureId: payment.structureId,
        status: status
      }
    });

    console.log(`[Payment] Notification created for user ${payment.userId} - payment ${status}`);
  } catch (error) {
    // Log error but don't fail the payment operation
    console.error('[Payment] Error creating notification:', error.message);
  }
}

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
 * @desc    Get all payments for the authenticated user with structure and investor details
 * @access  Private (requires authentication)
 */
router.get('/me', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  // Get all payments for the current user
  const payments = await Payment.find({ userId });

  // Attach structure, investor, and capital call details to each payment
  const paymentsWithDetails = await Promise.all(
    payments.map(async (payment) => {
      let structure = null;
      let investor = null;
      let capitalCallData = null;

      if (payment.structureId) {
        try {
          structure = await Structure.findById(payment.structureId);
        } catch (error) {
          console.error(`Error fetching structure ${payment.structureId}:`, error.message);
        }

        // Get structure investor record for this user+structure
        investor = await getStructureInvestorForUser(userId, payment.structureId);

        // If structure investor exists, get capital call data
        if (investor) {
          capitalCallData = await getCapitalCallDataForInvestor(investor.userId, payment.structureId);
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
          bannerImage: structure.bannerImage,
          totalCommitment: structure.totalCommitment,
          enableCapitalCalls: structure.enableCapitalCalls,
        } : null,
        investor: investor ? {
          id: investor.id,
          commitment: investor.commitment,
          ownershipPercent: investor.ownershipPercent,
          kycStatus: investor.kycStatus,
          investorType: investor.investorType,
        } : null,
        capitalCallData: capitalCallData
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
 * @route   GET /api/payments/check-commitment/:structureId
 * @desc    Check if the authenticated user has an existing capital commitment for a structure
 * @access  Private (requires authentication)
 */
router.get('/check-commitment/:structureId', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;

  if (!structureId) {
    return res.status(400).json({
      success: false,
      message: 'Structure ID is required'
    });
  }

  // Check if structure exists and has capital calls enabled
  const structure = await Structure.findById(structureId);

  if (!structure) {
    return res.status(404).json({
      success: false,
      message: 'Structure not found'
    });
  }

  // If structure doesn't have capital calls enabled, no restriction applies
  if (!structure.enableCapitalCalls) {
    return res.status(200).json({
      success: true,
      hasExistingCommitment: false,
      capitalCallsEnabled: false,
      message: 'This structure does not use capital calls'
    });
  }

  // Check for existing capital commitment (pending or approved)
  const existingCommitments = await Payment.find({
    userId: userId,
    structureId: structureId,
    paymentMethod: 'capital-commitment'
  });

  // Filter to only non-rejected commitments
  const activeCommitment = existingCommitments.find(c => c.status !== 'rejected');

  if (activeCommitment) {
    return res.status(200).json({
      success: true,
      hasExistingCommitment: true,
      capitalCallsEnabled: true,
      commitment: {
        id: activeCommitment.id,
        amount: activeCommitment.amount,
        tokens: activeCommitment.tokens,
        status: activeCommitment.status,
        createdAt: activeCommitment.createdAt
      },
      message: 'You already have a capital commitment for this structure'
    });
  }

  return res.status(200).json({
    success: true,
    hasExistingCommitment: false,
    capitalCallsEnabled: true,
    message: 'No existing commitment found'
  });
}));

/**
 * @route   POST /api/payments
 * @desc    Create a new payment with optional file upload
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, handleDocumentUpload, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
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

  // Guest and Investor roles cannot create payments
  if (userRole === ROLES.GUEST) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Guest users cannot create payments'
    });
  }

  // Validate required fields
  validate(email, 'Email is required');
  validate(amount, 'Amount is required');
  validate(structureId, 'Structure ID is required');

  // contractId is required except for capital commitments
  const isCapitalCommitment = paymentMethod === 'capital-commitment';
  if (!isCapitalCommitment) {
    validate(contractId, 'Contract ID is required');
  }

  // Get authenticated user ID
  const userId = req.auth?.userId || req.user?.id;

  // For capital commitments, check if user already has a commitment for this structure
  if (isCapitalCommitment && userId && structureId) {
    // Check if structure has capital calls enabled
    const structure = await Structure.findById(structureId.trim());

    if (structure && structure.enableCapitalCalls) {
      // Check for existing capital commitment (pending or approved)
      const existingCommitments = await Payment.find({
        userId: userId,
        structureId: structureId.trim(),
        paymentMethod: 'capital-commitment'
      });

      // Filter to only non-rejected commitments
      const activeCommitment = existingCommitments.find(c => c.status !== 'rejected');

      if (activeCommitment) {
        return res.status(400).json({
          success: false,
          message: 'You have already made a capital commitment to this fund. Only one commitment per investor is allowed.',
          existingCommitment: {
            id: activeCommitment.id,
            amount: activeCommitment.amount,
            status: activeCommitment.status,
            createdAt: activeCommitment.createdAt
          }
        });
      }
    }
  }

  // Check max investor restriction before allowing new investors
  if (userId && structureId) {
    const structureForCheck = await Structure.findById(structureId.trim());
    if (structureForCheck && structureForCheck.maxInvestorRestriction) {
      const currentInvestorCount = await Structure.getInvestorCount(structureId.trim());
      if (currentInvestorCount >= structureForCheck.maxInvestorRestriction) {
        // Check if user is already an investor in this structure
        const existingInvestor = await StructureInvestor.findByUserAndStructure(userId, structureId.trim());
        if (!existingInvestor) {
          return res.status(403).json({
            success: false,
            message: 'This structure has reached its maximum number of investors allowed by regulation.',
            maxInvestorRestriction: structureForCheck.maxInvestorRestriction,
            currentInvestors: currentInvestorCount
          });
        }
      }
    }
  }

  // Generate submission ID if not provided
  const finalSubmissionId = submissionId?.trim() || `PAY-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  let paymentImageUrl = null;

  // If file is uploaded, save it to Supabase Storage
  if (req.file) {
    const folder = `payments/${finalSubmissionId}`;
    const uploadResult = await uploadToSupabase(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder
    );
    paymentImageUrl = uploadResult.publicUrl;
  }

  // Create payment data
  const paymentData = {
    email: email.trim().toLowerCase(),
    submissionId: finalSubmissionId,
    paymentImage: paymentImageUrl,
    paymentTransactionHash: paymentTransactionHash?.trim() || null,
    mintTransactionHash: mintTransactionHash?.trim() || null,
    amount: amount.trim(),
    structureId: structureId.trim(),
    contractId: contractId?.trim() || null, // Optional for capital commitments
    status: status?.trim() || 'pending',
    tokenId: tokenId?.trim() || null,
    tokens: tokens ? parseInt(tokens, 10) : null,
    paymentMethod: paymentMethod?.trim() || null,
    walletAddress: walletAddress?.trim() || null,
    userId: userId
  };

  const payment = await Payment.create(paymentData);

  // Create or update structure investor record for capital commitment tracking
  let structureInvestor = null;
  if (userId && structureId && amount) {
    const commitmentAmount = parseFloat(amount) || 0;
    if (commitmentAmount > 0) {
      structureInvestor = await getOrCreateStructureInvestor(
        userId,
        structureId.trim(),
        commitmentAmount
      );
    }
  }

  res.status(201).json({
    success: true,
    message: 'Payment created successfully',
    data: {
      ...payment,
      investor: structureInvestor ? {
        id: structureInvestor.id,
        commitment: structureInvestor.commitment,
        ownershipPercent: structureInvestor.ownershipPercent,
      } : null
    }
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
          bannerImage: structure.bannerImage,
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
 * @desc    Get a single payment by ID with investor and capital call details
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const userId = req.auth.userId || req.user.id;

  const payment = await Payment.findById(id);

  validate(payment, 'Payment not found');

  let structure = null;
  let investor = null;
  let capitalCallData = null;

  if (payment.structureId) {
    try {
      structure = await Structure.findById(payment.structureId);
    } catch (error) {
      console.error(`Error fetching structure ${payment.structureId}:`, error.message);
    }

    // Get structure investor record for this user+structure
    investor = await getStructureInvestorForUser(userId, payment.structureId);

    // If structure investor exists, get capital call data
    if (investor) {
      capitalCallData = await getCapitalCallDataForInvestor(investor.userId, payment.structureId);
    }
  }

  res.status(200).json({
    success: true,
    data: {
      ...payment,
      structure: structure ? {
        id: structure.id,
        name: structure.name,
        type: structure.type,
        status: structure.status,
        baseCurrency: structure.baseCurrency,
        description: structure.description,
        bannerImage: structure.bannerImage,
        totalCommitment: structure.totalCommitment,
        enableCapitalCalls: structure.enableCapitalCalls,
      } : null,
      investor: investor ? {
        id: investor.id,
        commitment: investor.commitment,
        ownershipPercent: investor.ownershipPercent,
        status: investor.status,
      } : null,
      capitalCallData: capitalCallData
    }
  });
}));

/**
 * @route   PUT /api/payments/:id
 * @desc    Update a payment
 * @access  Private (requires authentication, Root/Admin only)
 */
router.put('/:id', authenticate, handleDocumentUpload, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  // Only ROOT, ADMIN, and STAFF roles can update payments
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN && userRole !== ROLES.STAFF) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root, Admin, and Staff users can update payments'
    });
  }

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
  const { userRole } = getUserContext(req);
  const { id } = req.params;
  const { status } = req.body;

  // Guest and Investor roles cannot update payment status
  if (userRole === ROLES.GUEST || userRole === ROLES.INVESTOR) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Guest and Investor users cannot update payment status'
    });
  }

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
  const { userRole } = getUserContext(req);
  const { id } = req.params;
  const { paymentTransactionHash } = req.body;

  // Guest and Investor roles cannot update payment transaction
  if (userRole === ROLES.GUEST || userRole === ROLES.INVESTOR) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Guest and Investor users cannot update payment transactions'
    });
  }

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
  const { userRole } = getUserContext(req);
  const { id } = req.params;
  const { mintTransactionHash } = req.body;

  // Guest and Investor roles cannot update token transaction
  if (userRole === ROLES.GUEST || userRole === ROLES.INVESTOR) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Guest and Investor users cannot update token transactions'
    });
  }

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
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  // Guest and Investor roles cannot delete payments
  if (userRole === ROLES.GUEST || userRole === ROLES.INVESTOR) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Guest and Investor users cannot delete payments'
    });
  }

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

  // Send payment confirmation notification
  await createPaymentConfirmationNotification(approvedPayment, 'approved');

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
