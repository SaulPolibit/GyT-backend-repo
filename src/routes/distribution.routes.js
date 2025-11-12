/**
 * Distribution API Routes
 * Endpoints for managing distributions with waterfall calculations
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Distribution, Structure } = require('../models/supabase');

const router = express.Router();

/**
 * @route   POST /api/distributions
 * @desc    Create a new distribution
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    structureId,
    distributionNumber,
    distributionDate,
    totalAmount,
    source,
    notes,
    investmentId,
    sourceEquityGain,
    sourceDebtInterest,
    sourceDebtPrincipal,
    sourceOther,
    waterfallApplied,
    createAllocations
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  validate(distributionNumber, 'Distribution number is required');
  validate(totalAmount !== undefined && totalAmount > 0, 'Total amount must be positive');

  // Validate structure exists and belongs to user
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Structure does not belong to user');

  // Create distribution
  const distributionData = {
    structureId,
    distributionNumber: typeof distributionNumber === 'string' ? distributionNumber.trim() : distributionNumber,
    distributionDate: distributionDate || new Date().toISOString(),
    totalAmount,
    status: 'Draft',
    source: source?.trim() || '',
    notes: notes?.trim() || '',
    investmentId: investmentId || null,
    // Source breakdown
    sourceEquityGain: sourceEquityGain || 0,
    sourceDebtInterest: sourceDebtInterest || 0,
    sourceDebtPrincipal: sourceDebtPrincipal || 0,
    sourceOther: sourceOther || 0,
    // Waterfall
    waterfallApplied: waterfallApplied || false,
    tier1Amount: 0,
    tier2Amount: 0,
    tier3Amount: 0,
    tier4Amount: 0,
    // LP/GP splits
    lpTotalAmount: 0,
    gpTotalAmount: 0,
    managementFeeAmount: 0,
    userId
  };

  const distribution = await Distribution.create(distributionData);

  // Optionally create allocations for all investors in structure
  let allocations = null;
  if (createAllocations === true) {
    allocations = await Distribution.createAllocationsForStructure(distribution.id, structureId);
  }

  res.status(201).json({
    success: true,
    message: 'Distribution created successfully',
    data: {
      distribution,
      allocations: allocations || []
    }
  });
}));

/**
 * @route   GET /api/distributions
 * @desc    Get all distributions for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId, status } = req.query;

  let filter = { userId };

  if (structureId) filter.structureId = structureId;
  if (status) filter.status = status;

  const distributions = await Distribution.find(filter);

  res.status(200).json({
    success: true,
    count: distributions.length,
    data: distributions
  });
}));

/**
 * @route   GET /api/distributions/:id
 * @desc    Get a single distribution by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const distribution = await Distribution.findById(id);

  validate(distribution, 'Distribution not found');
  validate(distribution.userId === userId, 'Unauthorized access to distribution');

  res.status(200).json({
    success: true,
    data: distribution
  });
}));

/**
 * @route   GET /api/distributions/:id/with-allocations
 * @desc    Get distribution with investor allocations
 * @access  Private (requires authentication)
 */
router.get('/:id/with-allocations', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const distribution = await Distribution.findById(id);
  validate(distribution, 'Distribution not found');
  validate(distribution.userId === userId, 'Unauthorized access to distribution');

  const distributionWithAllocations = await Distribution.findWithAllocations(id);

  res.status(200).json({
    success: true,
    data: distributionWithAllocations
  });
}));

/**
 * @route   GET /api/distributions/structure/:structureId/summary
 * @desc    Get distribution summary for a structure
 * @access  Private (requires authentication)
 */
router.get('/structure/:structureId/summary', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const summary = await Distribution.getSummary(structureId);

  res.status(200).json({
    success: true,
    data: summary
  });
}));

/**
 * @route   PUT /api/distributions/:id
 * @desc    Update a distribution
 * @access  Private (requires authentication)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const distribution = await Distribution.findById(id);
  validate(distribution, 'Distribution not found');
  validate(distribution.userId === userId, 'Unauthorized access to distribution');

  const updateData = {};
  const allowedFields = [
    'distributionDate', 'totalAmount', 'source', 'notes', 'status',
    'sourceEquityGain', 'sourceDebtInterest', 'sourceDebtPrincipal', 'sourceOther',
    'waterfallApplied', 'tier1Amount', 'tier2Amount', 'tier3Amount', 'tier4Amount',
    'lpTotalAmount', 'gpTotalAmount', 'managementFeeAmount'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedDistribution = await Distribution.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Distribution updated successfully',
    data: updatedDistribution
  });
}));

/**
 * @route   POST /api/distributions/:id/apply-waterfall
 * @desc    Apply waterfall calculation to distribution
 * @access  Private (requires authentication)
 */
router.post('/:id/apply-waterfall', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const distribution = await Distribution.findById(id);
  validate(distribution, 'Distribution not found');
  validate(distribution.userId === userId, 'Unauthorized access to distribution');
  validate(!distribution.waterfallApplied, 'Waterfall already applied to this distribution');

  const structure = await Structure.findById(distribution.structureId);
  validate(structure, 'Structure not found');

  const waterfallResult = await Distribution.applyWaterfall(id);

  res.status(200).json({
    success: true,
    message: 'Waterfall calculation applied successfully',
    data: waterfallResult
  });
}));

/**
 * @route   PATCH /api/distributions/:id/mark-paid
 * @desc    Mark distribution as paid
 * @access  Private (requires authentication)
 */
router.patch('/:id/mark-paid', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const distribution = await Distribution.findById(id);
  validate(distribution, 'Distribution not found');
  validate(distribution.userId === userId, 'Unauthorized access to distribution');

  const updatedDistribution = await Distribution.markAsPaid(id);

  res.status(200).json({
    success: true,
    message: 'Distribution marked as paid',
    data: updatedDistribution
  });
}));

/**
 * @route   POST /api/distributions/:id/create-allocations
 * @desc    Create allocations for all investors in structure
 * @access  Private (requires authentication)
 */
router.post('/:id/create-allocations', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const distribution = await Distribution.findById(id);
  validate(distribution, 'Distribution not found');
  validate(distribution.userId === userId, 'Unauthorized access to distribution');

  const structure = await Structure.findById(distribution.structureId);
  validate(structure, 'Structure not found');

  const allocations = await Distribution.createAllocationsForStructure(id, distribution.structureId);

  res.status(201).json({
    success: true,
    message: 'Allocations created successfully',
    data: allocations
  });
}));

/**
 * @route   GET /api/distributions/investor/:investorId/total
 * @desc    Get total distributions for an investor in a structure
 * @access  Private (requires authentication)
 */
router.get('/investor/:investorId/total', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { investorId } = req.params;
  const { structureId } = req.query;

  validate(structureId, 'Structure ID is required');

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const total = await Distribution.getInvestorDistributionTotal(investorId, structureId);

  res.status(200).json({
    success: true,
    data: total
  });
}));

/**
 * @route   DELETE /api/distributions/:id
 * @desc    Delete a distribution
 * @access  Private (requires authentication)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const distribution = await Distribution.findById(id);
  validate(distribution, 'Distribution not found');
  validate(distribution.userId === userId, 'Unauthorized access to distribution');

  await Distribution.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Distribution deleted successfully'
  });
}));

/**
 * @route   GET /api/distributions/health
 * @desc    Health check for Distribution API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Distribution API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
