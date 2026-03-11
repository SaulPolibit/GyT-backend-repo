/**
 * Investment Subscription API Routes
 * Endpoints for managing investor subscriptions to investments
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const InvestmentSubscription = require('../models/supabase/investmentSubscription');
const { Structure, StructureInvestor } = require('../models/supabase');

const router = express.Router();

/**
 * @route   GET /api/investment-subscriptions/health
 * @desc    Health check
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Investment Subscription API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

/**
 * @route   POST /api/investment-subscriptions
 * @desc    Create a new investment subscription
 * @access  Private
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const {
    investmentId,
    investorId,
    fundId,
    requestedAmount,
    currency,
    adminNotes
  } = req.body;

  validate(investmentId, 'Investment ID is required');
  validate(investorId, 'Investor ID is required');
  validate(fundId, 'Fund ID is required');
  validate(requestedAmount, 'Requested amount is required');
  validate(currency, 'Currency is required');

  // Check max investor restriction before allowing new investors
  if (fundId) {
    const structureForCheck = await Structure.findById(fundId.trim());
    if (structureForCheck && structureForCheck.maxInvestorRestriction) {
      const currentInvestorCount = await Structure.getInvestorCount(fundId.trim());
      if (currentInvestorCount >= structureForCheck.maxInvestorRestriction) {
        // Check if investor is already in this structure
        const existingInvestor = investorId
          ? await StructureInvestor.findByUserAndStructure(investorId.trim(), fundId.trim())
          : null;
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

  const subscriptionData = {
    investmentId: investmentId.trim(),
    investorId: investorId.trim(),
    fundId: fundId.trim(),
    requestedAmount: requestedAmount.toString().trim(),
    currency: currency.trim(),
    status: 'pending',
    adminNotes: adminNotes?.trim() || null,
    linkedFundOwnershipCreated: false
  };

  const subscription = await InvestmentSubscription.create(subscriptionData);

  res.status(201).json({
    success: true,
    message: 'Investment subscription created successfully',
    data: subscription
  });
}));

/**
 * @route   GET /api/investment-subscriptions
 * @desc    Get all investment subscriptions with filters
 * @access  Private
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const { investmentId, investorId, fundId, status } = req.query;

  let filter = {};
  if (investmentId) filter.investmentId = investmentId;
  if (investorId) filter.investorId = investorId;
  if (fundId) filter.fundId = fundId;
  if (status) filter.status = status;

  const subscriptions = await InvestmentSubscription.find(filter);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/investment-subscriptions/:id
 * @desc    Get a single investment subscription by ID
 * @access  Private
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await InvestmentSubscription.findById(id);
  validate(subscription, 'Investment subscription not found');

  res.status(200).json({
    success: true,
    data: subscription
  });
}));

/**
 * @route   GET /api/investment-subscriptions/investment/:investmentId
 * @desc    Get all subscriptions for an investment
 * @access  Private
 */
router.get('/investment/:investmentId', authenticate, catchAsync(async (req, res) => {
  const { investmentId } = req.params;

  const subscriptions = await InvestmentSubscription.findByInvestmentId(investmentId);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/investment-subscriptions/investor/:investorId
 * @desc    Get all subscriptions for an investor
 * @access  Private
 */
router.get('/investor/:investorId', authenticate, catchAsync(async (req, res) => {
  const { investorId } = req.params;

  const subscriptions = await InvestmentSubscription.findByInvestorId(investorId);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/investment-subscriptions/fund/:fundId
 * @desc    Get all subscriptions for a fund
 * @access  Private
 */
router.get('/fund/:fundId', authenticate, catchAsync(async (req, res) => {
  const { fundId } = req.params;

  const subscriptions = await InvestmentSubscription.findByFundId(fundId);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/investment-subscriptions/status/:status
 * @desc    Get subscriptions by status
 * @access  Private
 */
router.get('/status/:status', authenticate, catchAsync(async (req, res) => {
  const { status } = req.params;

  const validStatuses = ['pending', 'submitted', 'approved', 'rejected', 'cancelled'];
  validate(
    validStatuses.includes(status),
    `Status must be one of: ${validStatuses.join(', ')}`
  );

  const subscriptions = await InvestmentSubscription.findByStatus(status);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   PUT /api/investment-subscriptions/:id
 * @desc    Update an investment subscription
 * @access  Private
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await InvestmentSubscription.findById(id);
  validate(subscription, 'Investment subscription not found');

  const updateData = {};
  const allowedFields = [
    'requestedAmount',
    'currency',
    'status',
    'approvalReason',
    'adminNotes',
    'linkedFundOwnershipCreated'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (typeof req.body[field] === 'string') {
        updateData[field] = req.body[field].trim();
      } else {
        updateData[field] = req.body[field];
      }
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedSubscription = await InvestmentSubscription.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Investment subscription updated successfully',
    data: updatedSubscription
  });
}));

/**
 * @route   PATCH /api/investment-subscriptions/:id/submit
 * @desc    Submit a subscription
 * @access  Private
 */
router.patch('/:id/submit', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await InvestmentSubscription.findById(id);
  validate(subscription, 'Investment subscription not found');

  const updatedSubscription = await InvestmentSubscription.submit(id);

  res.status(200).json({
    success: true,
    message: 'Subscription submitted successfully',
    data: updatedSubscription
  });
}));

/**
 * @route   PATCH /api/investment-subscriptions/:id/approve
 * @desc    Approve a subscription
 * @access  Private
 */
router.patch('/:id/approve', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { approvalReason } = req.body;

  const subscription = await InvestmentSubscription.findById(id);
  validate(subscription, 'Investment subscription not found');

  const updatedSubscription = await InvestmentSubscription.approve(id, approvalReason);

  res.status(200).json({
    success: true,
    message: 'Subscription approved successfully',
    data: updatedSubscription
  });
}));

/**
 * @route   PATCH /api/investment-subscriptions/:id/reject
 * @desc    Reject a subscription
 * @access  Private
 */
router.patch('/:id/reject', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { approvalReason } = req.body;

  validate(approvalReason, 'Approval reason is required for rejection');

  const subscription = await InvestmentSubscription.findById(id);
  validate(subscription, 'Investment subscription not found');

  const updatedSubscription = await InvestmentSubscription.reject(id, approvalReason);

  res.status(200).json({
    success: true,
    message: 'Subscription rejected successfully',
    data: updatedSubscription
  });
}));

/**
 * @route   DELETE /api/investment-subscriptions/:id
 * @desc    Delete an investment subscription
 * @access  Private
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await InvestmentSubscription.findById(id);
  validate(subscription, 'Investment subscription not found');

  await InvestmentSubscription.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Investment subscription deleted successfully'
  });
}));

module.exports = router;
