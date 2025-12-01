/**
 * Subscription API Routes
 * Endpoints for managing structure investment subscriptions
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const Subscription = require('../models/supabase/subscription');

const router = express.Router();

/**
 * @route   GET /api/subscriptions/health
 * @desc    Health check for Subscription API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Subscription API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

/**
 * @route   POST /api/subscriptions
 * @desc    Create a new subscription
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const {
    structureId,
    userId,
    fundId,
    requestedAmount,
    currency,
    status,
    paymentId
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  validate(userId, 'User ID is required');
  validate(fundId, 'Fund ID is required');
  validate(requestedAmount, 'Requested amount is required');
  validate(currency, 'Currency is required');

  // Create subscription data
  const subscriptionData = {
    structureId: structureId.trim(),
    userId: userId.trim(),
    fundId: fundId.trim(),
    requestedAmount: requestedAmount.trim(),
    currency: currency.trim(),
    status: status?.trim() || 'pending',
    paymentId: paymentId?.trim() || null
  };

  const subscription = await Subscription.create(subscriptionData);

  res.status(201).json({
    success: true,
    message: 'Subscription created successfully',
    data: subscription
  });
}));

/**
 * @route   GET /api/subscriptions
 * @desc    Get all subscriptions with optional filters
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const {
    structureId,
    userId,
    fundId,
    status,
    paymentId
  } = req.query;

  let filter = {};

  if (structureId) filter.structureId = structureId;
  if (userId) filter.userId = userId;
  if (fundId) filter.fundId = fundId;
  if (status) filter.status = status;
  if (paymentId) filter.paymentId = paymentId;

  const subscriptions = await Subscription.find(filter);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/subscriptions/user/:userId
 * @desc    Get all subscriptions for a specific user
 * @access  Private (requires authentication)
 */
router.get('/user/:userId', authenticate, catchAsync(async (req, res) => {
  const { userId } = req.params;

  validate(userId, 'User ID is required');

  const subscriptions = await Subscription.findByUserId(userId);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/subscriptions/structure/:structureId
 * @desc    Get all subscriptions for a specific structure
 * @access  Private (requires authentication)
 */
router.get('/structure/:structureId', authenticate, catchAsync(async (req, res) => {
  const { structureId } = req.params;

  validate(structureId, 'Structure ID is required');

  const subscriptions = await Subscription.findByStructureId(structureId);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/subscriptions/fund/:fundId
 * @desc    Get all subscriptions for a specific fund
 * @access  Private (requires authentication)
 */
router.get('/fund/:fundId', authenticate, catchAsync(async (req, res) => {
  const { fundId } = req.params;

  validate(fundId, 'Fund ID is required');

  const subscriptions = await Subscription.findByFundId(fundId);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/subscriptions/payment/:paymentId
 * @desc    Get subscription by payment ID
 * @access  Private (requires authentication)
 */
router.get('/payment/:paymentId', authenticate, catchAsync(async (req, res) => {
  const { paymentId } = req.params;

  validate(paymentId, 'Payment ID is required');

  const subscription = await Subscription.findByPaymentId(paymentId);

  validate(subscription, 'Subscription not found for this payment ID');

  res.status(200).json({
    success: true,
    data: subscription
  });
}));

/**
 * @route   GET /api/subscriptions/status/:status
 * @desc    Get all subscriptions by status
 * @access  Private (requires authentication)
 */
router.get('/status/:status', authenticate, catchAsync(async (req, res) => {
  const { status } = req.params;

  validate(status, 'Status is required');

  const validStatuses = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];
  validate(
    validStatuses.includes(status),
    `Status must be one of: ${validStatuses.join(', ')}`
  );

  const subscriptions = await Subscription.findByStatus(status);

  res.status(200).json({
    success: true,
    count: subscriptions.length,
    data: subscriptions
  });
}));

/**
 * @route   GET /api/subscriptions/:id
 * @desc    Get a single subscription by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await Subscription.findById(id);

  validate(subscription, 'Subscription not found');

  res.status(200).json({
    success: true,
    data: subscription
  });
}));

/**
 * @route   PUT /api/subscriptions/:id
 * @desc    Update a subscription
 * @access  Private (requires authentication)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await Subscription.findById(id);
  validate(subscription, 'Subscription not found');

  const updateData = {};
  const allowedFields = [
    'structureId',
    'userId',
    'fundId',
    'requestedAmount',
    'currency',
    'status',
    'paymentId'
  ];

  // Update allowed fields
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

  // Validate status if provided
  if (updateData.status) {
    const validStatuses = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];
    validate(
      validStatuses.includes(updateData.status),
      `Status must be one of: ${validStatuses.join(', ')}`
    );
  }

  const updatedSubscription = await Subscription.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Subscription updated successfully',
    data: updatedSubscription
  });
}));

/**
 * @route   PATCH /api/subscriptions/:id/status
 * @desc    Update subscription status
 * @access  Private (requires authentication)
 */
router.patch('/:id/status', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  validate(status, 'Status is required');

  const validStatuses = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];
  validate(
    validStatuses.includes(status),
    `Status must be one of: ${validStatuses.join(', ')}`
  );

  const subscription = await Subscription.findById(id);
  validate(subscription, 'Subscription not found');

  const updatedSubscription = await Subscription.updateStatus(id, status);

  res.status(200).json({
    success: true,
    message: 'Subscription status updated successfully',
    data: updatedSubscription
  });
}));

/**
 * @route   PATCH /api/subscriptions/:id/payment
 * @desc    Update subscription payment ID
 * @access  Private (requires authentication)
 */
router.patch('/:id/payment', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { paymentId } = req.body;

  validate(paymentId, 'Payment ID is required');

  const subscription = await Subscription.findById(id);
  validate(subscription, 'Subscription not found');

  const updatedSubscription = await Subscription.updatePaymentId(id, paymentId.trim());

  res.status(200).json({
    success: true,
    message: 'Payment ID updated successfully',
    data: updatedSubscription
  });
}));

/**
 * @route   DELETE /api/subscriptions/:id
 * @desc    Delete a subscription
 * @access  Private (requires authentication)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;

  const subscription = await Subscription.findById(id);
  validate(subscription, 'Subscription not found');

  await Subscription.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Subscription deleted successfully'
  });
}));

module.exports = router;
