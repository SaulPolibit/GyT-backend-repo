/**
 * Structure API Routes
 * Endpoints for managing investment structures (Funds, SA/LLC, Fideicomiso, Private Debt)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Structure } = require('../models/supabase');

const router = express.Router();

/**
 * @route   POST /api/structures
 * @desc    Create a new structure
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    name,
    type,
    description,
    parentStructureId,
    totalCommitment,
    managementFee,
    carriedInterest,
    hurdleRate,
    waterfallType,
    inceptionDate,
    termYears,
    extensionYears,
    gp,
    fundAdmin,
    legalCounsel,
    auditor,
    taxAdvisor,
    bankAccounts,
    baseCurrency,
    taxJurisdiction,
    regulatoryStatus,
    investmentStrategy,
    targetReturns,
    riskProfile
  } = req.body;

  // Validate required fields
  validate(name, 'Structure name is required');
  validate(type, 'Structure type is required');
  validate(['Fund', 'SA/LLC', 'Fideicomiso', 'Private Debt'].includes(type), 'Invalid structure type');

  // Validate parent structure if provided
  if (parentStructureId) {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    validate(uuidRegex.test(parentStructureId), 'Invalid parent structure ID format');

    const parentStructure = await Structure.findById(parentStructureId);
    validate(parentStructure, 'Parent structure not found');
    validate(parentStructure.userId === userId, 'Parent structure does not belong to user');
    validate(parentStructure.hierarchyLevel < 5, 'Maximum hierarchy level (5) reached');
  }

  // Create structure
  const structureData = {
    name: name.trim(),
    type,
    description: description?.trim() || '',
    status: 'Active',
    parentStructureId: parentStructureId || null,
    hierarchyLevel: parentStructureId ? null : 1, // Will be calculated by DB trigger
    totalCommitment: totalCommitment || 0,
    totalCalled: 0,
    totalDistributed: 0,
    totalInvested: 0,
    managementFee: managementFee || 2.0,
    carriedInterest: carriedInterest || 20.0,
    hurdleRate: hurdleRate || 8.0,
    waterfallType: waterfallType || 'American',
    inceptionDate: inceptionDate || new Date().toISOString(),
    termYears: termYears || 10,
    extensionYears: extensionYears || 2,
    gp: gp?.trim() || '',
    fundAdmin: fundAdmin?.trim() || '',
    legalCounsel: legalCounsel?.trim() || '',
    auditor: auditor?.trim() || '',
    taxAdvisor: taxAdvisor?.trim() || '',
    bankAccounts: bankAccounts || {},
    baseCurrency: baseCurrency || 'USD',
    taxJurisdiction: taxJurisdiction?.trim() || '',
    regulatoryStatus: regulatoryStatus?.trim() || '',
    investmentStrategy: investmentStrategy?.trim() || '',
    targetReturns: targetReturns?.trim() || '',
    riskProfile: riskProfile?.trim() || '',
    userId
  };

  const structure = await Structure.create(structureData);

  res.status(201).json({
    success: true,
    message: 'Structure created successfully',
    data: structure
  });
}));

/**
 * @route   GET /api/structures
 * @desc    Get all structures for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { type, status, parentId } = req.query;

  let filter = { userId };

  if (type) filter.type = type;
  if (status) filter.status = status;
  if (parentId) filter.parentStructureId = parentId;

  const structures = await Structure.find(filter);

  res.status(200).json({
    success: true,
    count: structures.length,
    data: structures
  });
}));

/**
 * @route   GET /api/structures/root
 * @desc    Get all root structures (no parent) for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/root', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const structures = await Structure.findRootStructures(userId);

  res.status(200).json({
    success: true,
    count: structures.length,
    data: structures
  });
}));

/**
 * @route   GET /api/structures/:id
 * @desc    Get a single structure by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const structure = await Structure.findById(id);

  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  res.status(200).json({
    success: true,
    data: structure
  });
}));

/**
 * @route   GET /api/structures/:id/children
 * @desc    Get child structures
 * @access  Private (requires authentication)
 */
router.get('/:id/children', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const children = await Structure.findChildStructures(id);

  res.status(200).json({
    success: true,
    count: children.length,
    data: children
  });
}));

/**
 * @route   GET /api/structures/:id/with-investors
 * @desc    Get structure with all investors
 * @access  Private (requires authentication)
 */
router.get('/:id/with-investors', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const structureWithInvestors = await Structure.findWithInvestors(id);

  res.status(200).json({
    success: true,
    data: structureWithInvestors
  });
}));

/**
 * @route   PUT /api/structures/:id
 * @desc    Update a structure
 * @access  Private (requires authentication)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const updateData = {};
  const allowedFields = [
    'name', 'description', 'status', 'totalCommitment', 'managementFee',
    'carriedInterest', 'hurdleRate', 'waterfallType', 'termYears',
    'extensionYears', 'finalDate', 'gp', 'fundAdmin', 'legalCounsel',
    'auditor', 'taxAdvisor', 'bankAccounts', 'baseCurrency',
    'taxJurisdiction', 'regulatoryStatus', 'investmentStrategy',
    'targetReturns', 'riskProfile'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedStructure = await Structure.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Structure updated successfully',
    data: updatedStructure
  });
}));

/**
 * @route   PATCH /api/structures/:id/financials
 * @desc    Update structure financial totals
 * @access  Private (requires authentication)
 */
router.patch('/:id/financials', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;
  const { totalCalled, totalDistributed, totalInvested } = req.body;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  const financials = {};
  if (totalCalled !== undefined) financials.totalCalled = totalCalled;
  if (totalDistributed !== undefined) financials.totalDistributed = totalDistributed;
  if (totalInvested !== undefined) financials.totalInvested = totalInvested;

  validate(Object.keys(financials).length > 0, 'No financial data provided');

  const updatedStructure = await Structure.updateFinancials(id, financials);

  res.status(200).json({
    success: true,
    message: 'Structure financials updated successfully',
    data: updatedStructure
  });
}));

/**
 * @route   DELETE /api/structures/:id
 * @desc    Delete a structure
 * @access  Private (requires authentication)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');
  validate(structure.userId === userId, 'Unauthorized access to structure');

  await Structure.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Structure deleted successfully'
  });
}));

/**
 * @route   GET /api/structures/health
 * @desc    Health check for Structure API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Structure API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
