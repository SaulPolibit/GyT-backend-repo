/**
 * Investment API Routes
 * Endpoints for managing investments (EQUITY, DEBT, MIXED)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Investment, Structure, Investor } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');

const router = express.Router();

/**
 * @route   POST /api/investments
 * @desc    Create a new investment
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);

  const {
    structureId,
    projectId,
    name,
    investmentName,
    description,
    investmentType,
    type,
    investmentDate,
    originationDate,
    fundId,
    fundCommitment,
    // Equity fields
    equityInvested,
    ownershipPercentage,
    equityOwnershipPercent,
    currentEquityValue,
    unrealizedGain,
    // Debt fields
    principalProvided,
    interestRate,
    maturityDate,
    accruedInterest,
    currentDebtValue,
    // Performance metrics
    irr,
    multiple,
    currentValue,
    totalInvested,
    totalInvestmentSize,
    lastValuationDate,
    // Property specific
    totalPropertyValue,
    // Additional info
    sector,
    geography,
    currency,
    notes,
    // Investor fields
    investorType,
    email,
    phoneNumber,
    country,
    taxId,
    kycStatus,
    accreditedInvestor,
    riskTolerance,
    investmentPreferences,
    fundName,
    fundManager,
    aum
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  validate(investmentName, 'Investment name is required');
  validate(investmentType, 'Investment type is required');
  validate(['EQUITY', 'DEBT', 'MIXED'].includes(investmentType), 'Invalid investment type');

  // Validate structure exists and belongs to user
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can create investments for any structure, Admin can only create for their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Structure does not belong to user');
  }

  // Validate type-specific fields
  if (investmentType === 'EQUITY' || investmentType === 'MIXED') {
    validate(equityInvested !== undefined && equityInvested > 0, 'Equity invested amount is required');

    // Validate ownership percentage (if provided)
    const ownershipPct = ownershipPercentage || equityOwnershipPercent;
    if (ownershipPct !== undefined && ownershipPct !== null) {
      validate(ownershipPct >= 0 && ownershipPct <= 100, 'Ownership percentage must be between 0 and 100');
    }
  }

  if (investmentType === 'DEBT' || investmentType === 'MIXED') {
    validate(principalProvided !== undefined && principalProvided > 0, 'Principal provided amount is required');
    validate(interestRate !== undefined && interestRate >= 0, 'Interest rate is required');
    validate(interestRate <= 100, 'Interest rate must be between 0 and 100 (percentage)');
  }

  // Handle investor data - create or update investor record for this user-structure combination
  if (investorType) {
    // Check if investor record exists for this user-structure combination
    const existingInvestors = await Investor.find({
      userId: userId,
      structureId: structureId
    });

    if (existingInvestors && existingInvestors.length > 0) {
      // Update existing investor record
      const investorUpdateData = {
        investorType,
        email: email || existingInvestors[0].email,
        phoneNumber: phoneNumber || existingInvestors[0].phoneNumber,
        country: country || existingInvestors[0].country,
        taxId: taxId || existingInvestors[0].taxId,
        kycStatus: kycStatus || existingInvestors[0].kycStatus,
        accreditedInvestor: accreditedInvestor !== undefined ? accreditedInvestor : existingInvestors[0].accreditedInvestor,
        riskTolerance: riskTolerance || existingInvestors[0].riskTolerance,
        investmentPreferences: investmentPreferences || existingInvestors[0].investmentPreferences,
        fundName: fundName || existingInvestors[0].fundName,
        fundManager: fundManager || existingInvestors[0].fundManager,
        aum: aum || existingInvestors[0].aum
      };

      await Investor.findByIdAndUpdate(existingInvestors[0].id, investorUpdateData);
    } else {
      // Create new investor record
      const investorData = {
        userId,
        structureId,
        investorType,
        email: email || '',
        phoneNumber: phoneNumber || '',
        country: country || '',
        taxId: taxId || '',
        kycStatus: kycStatus || 'Not Started',
        accreditedInvestor: accreditedInvestor || false,
        riskTolerance: riskTolerance || '',
        investmentPreferences: investmentPreferences || '',
        fundName: fundName || '',
        fundManager: fundManager || '',
        aum: aum || null,
        createdBy: userId
      };

      await Investor.create(investorData);
    }
  }

  // Helper to safely round decimal values to 4 places (prevents overflow)
  const roundDecimal = (value, decimals = 4) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return isNaN(num) ? null : Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
  };

  // Create investment
  const investmentData = {
    structureId,
    projectId: projectId || null,
    name: name?.trim() || investmentName?.trim() || '',
    investmentName: investmentName?.trim() || name?.trim() || '',
    description: description?.trim() || '',
    investmentType,
    type: type?.trim() || '',
    investmentDate: investmentDate || new Date().toISOString(),
    originationDate: originationDate || investmentDate || new Date().toISOString(),
    status: 'Active',
    fundId: fundId || null,
    fundCommitment: roundDecimal(fundCommitment, 2) || 0,
    // Equity fields
    equityInvested: roundDecimal(equityInvested, 2),
    ownershipPercentage: roundDecimal(ownershipPercentage || equityOwnershipPercent, 4),
    equityOwnershipPercent: roundDecimal(equityOwnershipPercent || ownershipPercentage, 4),
    currentEquityValue: roundDecimal(currentEquityValue || equityInvested, 2),
    equityCurrentValue: roundDecimal(equityInvested || currentEquityValue, 2),
    equityExitValue: null,
    equityRealizedGain: null,
    unrealizedGain: roundDecimal(unrealizedGain, 2) || 0,
    // Debt fields
    principalProvided: roundDecimal(principalProvided, 2),
    interestRate: roundDecimal(interestRate, 4),
    maturityDate: maturityDate || null,
    principalRepaid: 0,
    interestReceived: 0,
    outstandingPrincipal: roundDecimal(principalProvided, 2),
    accruedInterest: roundDecimal(accruedInterest, 2) || 0,
    currentDebtValue: roundDecimal(currentDebtValue, 2) || 0,
    // Performance metrics
    irr: roundDecimal(irr, 4) || 0,
    irrPercent: roundDecimal(irr, 4) || 0,
    multiple: roundDecimal(multiple, 4) || 0,
    moic: roundDecimal(multiple, 4) || 0,
    totalReturns: 0,
    currentValue: roundDecimal(currentValue, 2) || 0,
    totalInvested: roundDecimal(totalInvested, 2) || 0,
    totalInvestmentSize: roundDecimal(totalInvestmentSize, 2) || 0,
    lastValuationDate: lastValuationDate || null,
    // Property specific
    totalPropertyValue: roundDecimal(totalPropertyValue, 2) || 0,
    // Additional info
    sector: sector?.trim() || '',
    geography: geography?.trim() || '',
    currency: currency || 'USD',
    notes: notes?.trim() || '',
    userId: userId
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
    filter.userId = userId;
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
    : investments.filter(inv => inv.userId === userId);

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
    validate(investment.userId === userId, 'Unauthorized access to investment');
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
    validate(investment.userId === userId, 'Unauthorized access to investment');
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
    validate(investment.userId === userId, 'Unauthorized access to investment');
  }

  const updateData = {};
  const allowedFields = [
    'name', 'investmentName', 'description', 'investmentType', 'type', 'investmentDate',
    'originationDate', 'status', 'fundId', 'fundCommitment',
    // Equity fields
    'equityInvested', 'ownershipPercentage', 'equityOwnershipPercent',
    'currentEquityValue', 'equityCurrentValue', 'unrealizedGain',
    // Debt fields
    'principalProvided', 'interestRate', 'maturityDate', 'principalRepaid',
    'interestReceived', 'outstandingPrincipal', 'accruedInterest', 'currentDebtValue',
    // Performance metrics
    'irr', 'irrPercent', 'multiple', 'moic', 'totalReturns', 'currentValue',
    'totalInvested', 'totalInvestmentSize', 'lastValuationDate',
    // Property specific
    'totalPropertyValue',
    // Additional info
    'sector', 'geography', 'currency', 'notes'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  // Validate interest rate if being updated
  if (updateData.interestRate !== undefined) {
    validate(updateData.interestRate >= 0 && updateData.interestRate <= 100, 'Interest rate must be between 0 and 100 (percentage)');
  }

  // Validate ownership percentages if being updated
  if (updateData.ownershipPercentage !== undefined) {
    validate(updateData.ownershipPercentage >= 0 && updateData.ownershipPercentage <= 100, 'Ownership percentage must be between 0 and 100');
  }
  if (updateData.equityOwnershipPercent !== undefined) {
    validate(updateData.equityOwnershipPercent >= 0 && updateData.equityOwnershipPercent <= 100, 'Equity ownership percent must be between 0 and 100');
  }

  // Handle investor data update if provided
  const {
    investorType,
    email,
    phoneNumber,
    country,
    taxId,
    kycStatus,
    accreditedInvestor,
    riskTolerance,
    investmentPreferences,
    fundName,
    fundManager,
    aum
  } = req.body;

  if (investorType) {
    // Check if investor record exists for this user-structure combination
    const existingInvestors = await Investor.find({
      userId: investment.userId,
      structureId: investment.structureId
    });

    if (existingInvestors && existingInvestors.length > 0) {
      // Update existing investor record
      const investorUpdateData = {
        investorType,
        email: email || existingInvestors[0].email,
        phoneNumber: phoneNumber || existingInvestors[0].phoneNumber,
        country: country || existingInvestors[0].country,
        taxId: taxId || existingInvestors[0].taxId,
        kycStatus: kycStatus || existingInvestors[0].kycStatus,
        accreditedInvestor: accreditedInvestor !== undefined ? accreditedInvestor : existingInvestors[0].accreditedInvestor,
        riskTolerance: riskTolerance || existingInvestors[0].riskTolerance,
        investmentPreferences: investmentPreferences || existingInvestors[0].investmentPreferences,
        fundName: fundName || existingInvestors[0].fundName,
        fundManager: fundManager || existingInvestors[0].fundManager,
        aum: aum || existingInvestors[0].aum
      };

      await Investor.findByIdAndUpdate(existingInvestors[0].id, investorUpdateData);
    } else {
      // Create new investor record
      const investorData = {
        userId: investment.userId,
        structureId: investment.structureId,
        investorType,
        email: email || '',
        phoneNumber: phoneNumber || '',
        country: country || '',
        taxId: taxId || '',
        kycStatus: kycStatus || 'Not Started',
        accreditedInvestor: accreditedInvestor || false,
        riskTolerance: riskTolerance || '',
        investmentPreferences: investmentPreferences || '',
        fundName: fundName || '',
        fundManager: fundManager || '',
        aum: aum || null,
        createdBy: investment.userId
      };

      await Investor.create(investorData);
    }
  }

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
    validate(investment.userId === userId, 'Unauthorized access to investment');
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
    validate(investment.userId === userId, 'Unauthorized access to investment');
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
    validate(investment.userId === userId, 'Unauthorized access to investment');
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
