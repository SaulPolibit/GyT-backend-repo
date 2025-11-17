/**
 * Capital Call API Routes
 * Endpoints for managing capital calls and investor allocations
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { CapitalCall, Structure } = require('../models/supabase');
const { requireInvestmentManagerAccess, getUserContext, ROLES } = require('../middleware/rbac');

const router = express.Router();

/**
 * @route   POST /api/capital-calls
 * @desc    Create a new capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    structureId,
    callNumber,
    callDate,
    dueDate,
    totalCallAmount,
    purpose,
    notes,
    investmentId,
    createAllocations
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  validate(callNumber, 'Call number is required');
  validate(totalCallAmount !== undefined && totalCallAmount > 0, 'Total call amount must be positive');

  // Validate structure exists and belongs to user
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');
  validate(structure.createdBy === userId, 'Structure does not belong to user');

  // Create capital call
  const capitalCallData = {
    structureId,
    callNumber: typeof callNumber === 'string' ? callNumber.trim() : callNumber,
    callDate: callDate || new Date().toISOString(),
    dueDate: dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days default
    totalCallAmount,
    totalPaidAmount: 0,
    totalUnpaidAmount: totalCallAmount,
    status: 'Draft',
    purpose: purpose?.trim() || '',
    notes: notes?.trim() || '',
    investmentId: investmentId || null,
    createdBy: userId
  };

  const capitalCall = await CapitalCall.create(capitalCallData);

  // Optionally create allocations for all investors in structure
  let allocations = null;
  if (createAllocations === true) {
    allocations = await CapitalCall.createAllocationsForStructure(capitalCall.id, structureId);
  }

  res.status(201).json({
    success: true,
    message: 'Capital call created successfully',
    data: {
      capitalCall,
      allocations: allocations || []
    }
  });
}));

/**
 * @route   GET /api/capital-calls
 * @desc    Get all capital calls (role-based filtering applied)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId, status } = req.query;

  let filter = {};

  // Role-based filtering: Root sees all, Admin sees only their own
  if (userRole === ROLES.ADMIN) {
    filter.createdBy = userId;
  }
  // Root (role 0) sees all capital calls, so no userId filter

  if (structureId) filter.structureId = structureId;
  if (status) filter.status = status;

  const capitalCalls = await CapitalCall.find(filter);

  res.status(200).json({
    success: true,
    count: capitalCalls.length,
    data: capitalCalls
  });
}));

/**
 * @route   GET /api/capital-calls/:id
 * @desc    Get a single capital call by ID
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);

  validate(capitalCall, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  res.status(200).json({
    success: true,
    data: capitalCall
  });
}));

/**
 * @route   GET /api/capital-calls/:id/with-allocations
 * @desc    Get capital call with investor allocations
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/with-allocations', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can access any capital call, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const capitalCallWithAllocations = await CapitalCall.findWithAllocations(id);

  res.status(200).json({
    success: true,
    data: capitalCallWithAllocations
  });
}));

/**
 * @route   GET /api/capital-calls/structure/:structureId/summary
 * @desc    Get capital call summary for a structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/structure/:structureId/summary', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { structureId } = req.params;

  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const summary = await CapitalCall.getSummary(structureId);

  res.status(200).json({
    success: true,
    data: summary
  });
}));

/**
 * @route   PUT /api/capital-calls/:id
 * @desc    Update a capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.put('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const updateData = {};
  const allowedFields = [
    'callDate', 'dueDate', 'totalCallAmount', 'purpose', 'notes', 'status'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedCapitalCall = await CapitalCall.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Capital call updated successfully',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/send
 * @desc    Mark capital call as sent
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/send', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }
  validate(capitalCall.status === 'Draft', 'Capital call must be in Draft status to send');

  const updatedCapitalCall = await CapitalCall.markAsSent(id);

  res.status(200).json({
    success: true,
    message: 'Capital call marked as sent',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/mark-paid
 * @desc    Mark capital call as fully paid
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/mark-paid', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const updatedCapitalCall = await CapitalCall.markAsPaid(id);

  res.status(200).json({
    success: true,
    message: 'Capital call marked as paid',
    data: updatedCapitalCall
  });
}));

/**
 * @route   PATCH /api/capital-calls/:id/update-payment
 * @desc    Update payment amounts for capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/update-payment', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { paidAmount } = req.body;

  validate(paidAmount !== undefined && paidAmount > 0, 'Paid amount must be positive');

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const updatedCapitalCall = await CapitalCall.updatePaymentAmounts(id, paidAmount);

  res.status(200).json({
    success: true,
    message: 'Payment amounts updated successfully',
    data: updatedCapitalCall
  });
}));

/**
 * @route   POST /api/capital-calls/:id/create-allocations
 * @desc    Create allocations for all investors in structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/:id/create-allocations', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can edit any capital call, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  const structure = await Structure.findById(capitalCall.structureId);
  validate(structure, 'Structure not found');

  const allocations = await CapitalCall.createAllocationsForStructure(id, capitalCall.structureId);

  res.status(201).json({
    success: true,
    message: 'Allocations created successfully',
    data: allocations
  });
}));

/**
 * @route   DELETE /api/capital-calls/:id
 * @desc    Delete a capital call
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const capitalCall = await CapitalCall.findById(id);
  validate(capitalCall, 'Capital call not found');

  // Root can delete any capital call, Admin can only delete their own
  if (userRole === ROLES.ADMIN) {
    validate(capitalCall.createdBy === userId, 'Unauthorized access to capital call');
  }

  await CapitalCall.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Capital call deleted successfully'
  });
}));

/**
 * @route   GET /api/capital-calls/health
 * @desc    Health check for Capital Call API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Capital Call API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
