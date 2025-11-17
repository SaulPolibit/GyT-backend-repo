/**
 * Investment API Routes
 * Endpoints for managing investments (EQUITY, DEBT, MIXED)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Investment, Structure } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');

const router = express.Router();

/**
 * @route   POST /api/investments
 * @desc    Create a new investment
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    structureId,
    projectId,
    investmentName,
    investmentType,
    investmentDate,
    // Equity fields
    equityInvested,
    equityOwnershipPercent,
    // Debt fields
    principalProvided,
    interestRate,
    maturityDate,
    // Additional info
    sector,
    geography,
    currency,
    notes
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  validate(investmentName, 'Investment name is required');
  validate(investmentType, 'Investment type is required');
  validate(['EQUITY', 'DEBT', 'MIXED'].includes(investmentType), 'Invalid investment type');

  // Validate structure exists and belongs to user
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.createdBy === userId, 'Structure does not belong to user');

  // Validate type-specific fields
  if (investmentType === 'EQUITY' || investmentType === 'MIXED') {
    validate(equityInvested !== undefined && equityInvested > 0, 'Equity invested amount is required');
  }

  if (investmentType === 'DEBT' || investmentType === 'MIXED') {
    validate(principalProvided !== undefined && principalProvided > 0, 'Principal provided amount is required');
    validate(interestRate !== undefined && interestRate >= 0, 'Interest rate is required');
  }

  // Create investment
  const investmentData = {
    structureId,
    projectId: projectId || null,
    investmentName: investmentName.trim(),
    investmentType,
    investmentDate: investmentDate || new Date().toISOString(),
    status: 'Active',
    // Equity fields
    equityInvested: equityInvested || null,
    equityOwnershipPercent: equityOwnershipPercent || null,
    equityCurrentValue: equityInvested || null,
    equityExitValue: null,
    equityRealizedGain: null,
    // Debt fields
    principalProvided: principalProvided || null,
    interestRate: interestRate || null,
    maturityDate: maturityDate || null,
    principalRepaid: 0,
    interestReceived: 0,
    outstandingPrincipal: principalProvided || null,
    // Performance metrics
    irrPercent: null,
    moic: null,
    totalReturns: 0,
    // Additional info
    sector: sector?.trim() || '',
    geography: geography?.trim() || '',
    currency: currency || 'USD',
    notes: notes?.trim() || '',
    createdBy: userId
  };

  const investment = await Investment.create(investmentData);

  res.status(201).json({
    success: true,
    message: 'Investment created successfully',
    data: investment
  });
}));

/**
 * @route   GET /api/investments
 * @desc    Get all investments (role-based filtering applied)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId, projectId, investmentType, status } = req.query;

  let filter = {};

  // Role-based filtering: Root sees all, Admin sees only their own
  if (userRole === ROLES.ADMIN) {
    filter.createdBy = userId;
  }
  // Root (role 0) sees all investments, so no userId filter

  if (structureId) filter.structureId = structureId;
  if (projectId) filter.projectId = projectId;
  if (investmentType) filter.investmentType = investmentType;
  if (status) filter.status = status;

  const investments = await Investment.find(filter);

  res.status(200).json({
    success: true,
    count: investments.length,
    data: investments
  });
}));

/**
 * @route   GET /api/investments/active
 * @desc    Get all active investments (role-based filtering applied)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/active', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.query;

  const investments = await Investment.findActive(structureId);

  // Role-based filtering: Root sees all, Admin sees only their own
  const userInvestments = userRole === ROLES.ROOT
    ? investments
    : investments.filter(inv => inv.createdBy === userId);

  res.status(200).json({
    success: true,
    count: userInvestments.length,
    data: userInvestments
  });
}));

/**
 * @route   GET /api/investments/:id
 * @desc    Get a single investment by ID
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const investment = await Investment.findById(id);

  validate(investment, 'Investment not found');

  // Root can access any investment, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(investment.createdBy === userId, 'Unauthorized access to investment');
  }

  res.status(200).json({
    success: true,
    data: investment
  });
}));

/**
 * @route   GET /api/investments/:id/with-structure
 * @desc    Get investment with structure details
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/with-structure', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const investment = await Investment.findById(id);
  validate(investment, 'Investment not found');

  // Root can access any investment, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(investment.createdBy === userId, 'Unauthorized access to investment');
  }

  const investmentWithStructure = await Investment.findWithStructure(id);

  res.status(200).json({
    success: true,
    data: investmentWithStructure
  });
}));

/**
 * @route   PUT /api/investments/:id
 * @desc    Update an investment
 * @access  Private (requires authentication, Root/Admin only)
 */
router.put('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const investment = await Investment.findById(id);
  validate(investment, 'Investment not found');

  // Root can edit any investment, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(investment.createdBy === userId, 'Unauthorized access to investment');
  }

  const updateData = {};
  const allowedFields = [
    'investmentName', 'status', 'equityInvested', 'equityOwnershipPercent',
    'equityCurrentValue', 'principalProvided', 'interestRate', 'maturityDate',
    'principalRepaid', 'interestReceived', 'outstandingPrincipal',
    'sector', 'geography', 'currency', 'notes'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedInvestment = await Investment.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Investment updated successfully',
    data: updatedInvestment
  });
}));

/**
 * @route   PATCH /api/investments/:id/performance
 * @desc    Update investment performance metrics
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/performance', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { irrPercent, moic, totalReturns, equityCurrentValue, outstandingPrincipal } = req.body;

  const investment = await Investment.findById(id);
  validate(investment, 'Investment not found');

  // Root can edit any investment, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(investment.createdBy === userId, 'Unauthorized access to investment');
  }

  const metrics = {};
  if (irrPercent !== undefined) metrics.irrPercent = irrPercent;
  if (moic !== undefined) metrics.moic = moic;
  if (totalReturns !== undefined) metrics.totalReturns = totalReturns;
  if (equityCurrentValue !== undefined) metrics.equityCurrentValue = equityCurrentValue;
  if (outstandingPrincipal !== undefined) metrics.outstandingPrincipal = outstandingPrincipal;

  validate(Object.keys(metrics).length > 0, 'No performance metrics provided');

  const updatedInvestment = await Investment.updatePerformanceMetrics(id, metrics);

  res.status(200).json({
    success: true,
    message: 'Performance metrics updated successfully',
    data: updatedInvestment
  });
}));

/**
 * @route   PATCH /api/investments/:id/exit
 * @desc    Mark investment as exited
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/exit', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { exitDate, equityExitValue } = req.body;

  const investment = await Investment.findById(id);
  validate(investment, 'Investment not found');

  // Root can edit any investment, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(investment.createdBy === userId, 'Unauthorized access to investment');
  }

  const exitData = {
    exitDate: exitDate || new Date().toISOString()
  };

  if (equityExitValue !== undefined) {
    exitData.equityExitValue = equityExitValue;
  }

  const updatedInvestment = await Investment.markAsExited(id, exitData);

  res.status(200).json({
    success: true,
    message: 'Investment marked as exited successfully',
    data: updatedInvestment
  });
}));

/**
 * @route   GET /api/investments/structure/:structureId/portfolio
 * @desc    Get portfolio summary for a structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/structure/:structureId/portfolio', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const portfolio = await Investment.getPortfolioSummary(structureId);

  res.status(200).json({
    success: true,
    data: portfolio
  });
}));

/**
 * @route   DELETE /api/investments/:id
 * @desc    Delete an investment
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const investment = await Investment.findById(id);
  validate(investment, 'Investment not found');

  // Root can delete any investment, Admin can only delete their own
  if (userRole === ROLES.ADMIN) {
    validate(investment.createdBy === userId, 'Unauthorized access to investment');
  }

  await Investment.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Investment deleted successfully'
  });
}));

/**
 * @route   GET /api/investments/health
 * @desc    Health check for Investment API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Investment API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
