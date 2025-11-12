/**
 * Waterfall Tier API Routes
 * Endpoints for managing waterfall distribution tier configurations
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { WaterfallTier, Structure } = require('../models/supabase');

const router = express.Router();

/**
 * @route   POST /api/waterfall-tiers
 * @desc    Create a new waterfall tier
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    structureId,
    tierNumber,
    tierName,
    lpSharePercent,
    gpSharePercent,
    thresholdAmount,
    thresholdIrr,
    description,
    isActive
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  validate(tierNumber !== undefined, 'Tier number is required');
  validate(tierNumber >= 1 && tierNumber <= 4, 'Tier number must be between 1 and 4');
  validate(lpSharePercent !== undefined, 'LP share percent is required');
  validate(gpSharePercent !== undefined, 'GP share percent is required');

  // Validate structure exists and belongs to user
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Structure does not belong to user');

  // Validate percentages
  validate(lpSharePercent + gpSharePercent === 100, 'LP and GP shares must sum to 100%');
  validate(lpSharePercent >= 0 && lpSharePercent <= 100, 'LP share must be between 0 and 100');
  validate(gpSharePercent >= 0 && gpSharePercent <= 100, 'GP share must be between 0 and 100');

  // Create waterfall tier
  const tierData = {
    structureId,
    tierNumber,
    tierName: tierName?.trim() || `Tier ${tierNumber}`,
    lpSharePercent,
    gpSharePercent,
    thresholdAmount: thresholdAmount || null,
    thresholdIrr: thresholdIrr || null,
    description: description?.trim() || '',
    isActive: isActive !== undefined ? isActive : true,
    userId
  };

  // Validate tier configuration
  const validation = WaterfallTier.validateTier(tierData);
  validate(validation.isValid, validation.errors.join(', '));

  const tier = await WaterfallTier.create(tierData);

  res.status(201).json({
    success: true,
    message: 'Waterfall tier created successfully',
    data: tier
  });
}));

/**
 * @route   POST /api/waterfall-tiers/structure/:structureId/create-default
 * @desc    Create default waterfall tiers for a structure
 * @access  Private (requires authentication)
 */
router.post('/structure/:structureId/create-default', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;
  const { hurdleRate, carriedInterest, replace } = req.body;

  // Validate structure exists and belongs to user
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Structure does not belong to user');

  // If replace is true, delete existing tiers first
  if (replace === true) {
    const existingTiers = await WaterfallTier.findByStructureId(structureId);
    for (const tier of existingTiers) {
      await WaterfallTier.findByIdAndDelete(tier.id);
    }
  }

  const tiers = await WaterfallTier.createDefaultTiers(
    structureId,
    hurdleRate || structure.hurdleRate || 8,
    carriedInterest || structure.carriedInterest || 20,
    userId
  );

  res.status(201).json({
    success: true,
    message: replace ? 'Default waterfall tiers replaced successfully' : 'Default waterfall tiers created successfully',
    data: tiers
  });
}));

/**
 * @route   GET /api/waterfall-tiers
 * @desc    Get all waterfall tiers for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId, isActive } = req.query;

  let filter = { userId };

  if (structureId) filter.structureId = structureId;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const tiers = await WaterfallTier.find(filter);

  res.status(200).json({
    success: true,
    count: tiers.length,
    data: tiers
  });
}));

/**
 * @route   GET /api/waterfall-tiers/structure/:structureId
 * @desc    Get all tiers for a structure
 * @access  Private (requires authentication)
 */
router.get('/structure/:structureId', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const tiers = await WaterfallTier.findByStructureId(structureId);

  res.status(200).json({
    success: true,
    count: tiers.length,
    data: tiers
  });
}));

/**
 * @route   GET /api/waterfall-tiers/structure/:structureId/active
 * @desc    Get active tiers for a structure
 * @access  Private (requires authentication)
 */
router.get('/structure/:structureId/active', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const tiers = await WaterfallTier.findActiveByStructureId(structureId);

  res.status(200).json({
    success: true,
    count: tiers.length,
    data: tiers
  });
}));

/**
 * @route   GET /api/waterfall-tiers/structure/:structureId/summary
 * @desc    Get waterfall configuration summary for a structure
 * @access  Private (requires authentication)
 */
router.get('/structure/:structureId/summary', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const summary = await WaterfallTier.getWaterfallSummary(structureId);

  res.status(200).json({
    success: true,
    data: summary
  });
}));

/**
 * @route   GET /api/waterfall-tiers/:id
 * @desc    Get a single waterfall tier by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const tier = await WaterfallTier.findById(id);

  validate(tier, 'Waterfall tier not found');
  validate(tier.userId === userId, 'Unauthorized access to waterfall tier');

  res.status(200).json({
    success: true,
    data: tier
  });
}));

/**
 * @route   PUT /api/waterfall-tiers/:id
 * @desc    Update a waterfall tier
 * @access  Private (requires authentication)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const tier = await WaterfallTier.findById(id);
  validate(tier, 'Waterfall tier not found');
  validate(tier.userId === userId, 'Unauthorized access to waterfall tier');

  const updateData = {};
  const allowedFields = [
    'tierName', 'lpSharePercent', 'gpSharePercent', 'thresholdAmount',
    'thresholdIrr', 'description', 'isActive'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  // Validate if percentages are being updated
  if (updateData.lpSharePercent !== undefined || updateData.gpSharePercent !== undefined) {
    const lpShare = updateData.lpSharePercent !== undefined ? updateData.lpSharePercent : tier.lpSharePercent;
    const gpShare = updateData.gpSharePercent !== undefined ? updateData.gpSharePercent : tier.gpSharePercent;
    validate(lpShare + gpShare === 100, 'LP and GP shares must sum to 100%');
  }

  const updatedTier = await WaterfallTier.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Waterfall tier updated successfully',
    data: updatedTier
  });
}));

/**
 * @route   PUT /api/waterfall-tiers/structure/:structureId/bulk-update
 * @desc    Bulk update tiers for a structure
 * @access  Private (requires authentication)
 */
router.put('/structure/:structureId/bulk-update', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;
  const { tiers } = req.body;

  validate(Array.isArray(tiers), 'Tiers must be an array');
  validate(tiers.length > 0, 'At least one tier must be provided');

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const updatedTiers = await WaterfallTier.bulkUpdateTiers(structureId, tiers, userId);

  res.status(200).json({
    success: true,
    message: 'Waterfall tiers updated successfully',
    data: updatedTiers
  });
}));

/**
 * @route   PATCH /api/waterfall-tiers/structure/:structureId/deactivate-all
 * @desc    Deactivate all tiers for a structure
 * @access  Private (requires authentication)
 */
router.patch('/structure/:structureId/deactivate-all', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const deactivatedTiers = await WaterfallTier.deactivateAllTiers(structureId);

  res.status(200).json({
    success: true,
    message: 'All waterfall tiers deactivated successfully',
    data: deactivatedTiers
  });
}));

/**
 * @route   DELETE /api/waterfall-tiers/:id
 * @desc    Delete a waterfall tier
 * @access  Private (requires authentication)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const tier = await WaterfallTier.findById(id);
  validate(tier, 'Waterfall tier not found');
  validate(tier.userId === userId, 'Unauthorized access to waterfall tier');

  await WaterfallTier.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Waterfall tier deleted successfully'
  });
}));

/**
 * @route   GET /api/waterfall-tiers/health
 * @desc    Health check for Waterfall Tier API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Waterfall Tier API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
