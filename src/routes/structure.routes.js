/**
 * Structure API Routes
 * Endpoints for managing investment structures (Funds, SA/LLC, Fideicomiso, Private Debt)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { Structure, StructureAdmin, User } = require('../models/supabase');
const {
  requireInvestmentManagerAccess,
  getUserContext,
  ROLES,
  canAccessStructure,
  canEditStructure,
  getUserStructureIds
} = require('../middleware/rbac');

const router = express.Router();

/**
 * @route   POST /api/structures
 * @desc    Create a new structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const {
    name,
    type,
    subtype,
    status,
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
    riskProfile,
    stage
  } = req.body;

  // Validate required fields
  validate(name, 'Structure name is required');
  validate(type, 'Structure type is required');
  // validate(['Fund', 'SA/LLC', 'Fideicomiso', 'Private Debt'].includes(type), 'Invalid structure type');

  // Validate parent structure if provided
  if (parentStructureId) {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    validate(uuidRegex.test(parentStructureId), 'Invalid parent structure ID format');

    const parentStructure = await Structure.findById(parentStructureId);
    validate(parentStructure, 'Parent structure not found');
    validate(parentStructure.createdBy === userId, 'Parent structure does not belong to user');
    validate(parentStructure.hierarchyLevel < 5, 'Maximum hierarchy level (5) reached');
  }

  // Create structure
  const structureData = {
    name: name.trim(),
    type,
    subtype: subtype?.trim() || '',
    description: description?.trim() || '',
    status: status || 'Active',
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
    stage: stage?.trim() || '',
    createdBy: userId
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
 * @desc    Get all structures with optional filters
 * @access  Private (requires authentication)
 * @query   createdBy?: string - Filter by creator user ID
 * @query   type?: string - Filter by structure type
 * @query   status?: string - Filter by status
 * @query   parentId?: string - Filter by parent structure ID
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const { createdBy, type, status, parentId } = req.query;

  // Build filter object based on query parameters
  const filter = {};
  if (createdBy) filter.createdBy = createdBy;
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (parentId) filter.parentStructureId = parentId;

  // Get structures with filters
  const structures = await Structure.find(filter);

  res.status(200).json({
    success: true,
    count: structures.length,
    data: structures
  });
}));

/**
 * @route   GET /api/structures/root
 * @desc    Get all root structures (no parent) with role-based filtering
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/root', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);

  let structures;

  if (userRole === ROLES.ROOT) {
    // Root sees all root structures
    const allStructures = await Structure.find({ parentStructureId: null });
    structures = allStructures;
  } else {
    // Admin sees only their root structures
    structures = await Structure.findRootStructures(userId);
  }

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
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  res.status(200).json({
    success: true,
    data: structure
  });
}));

/**
 * @route   GET /api/structures/:id/children
 * @desc    Get child structures
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/children', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

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
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/with-investors', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const structureWithInvestors = await Structure.findWithInvestors(id);

  res.status(200).json({
    success: true,
    data: structureWithInvestors
  });
}));

/**
 * @route   PUT /api/structures/:id
 * @desc    Update a structure
 * @access  Private (Root/Admin only - Support cannot edit structures)
 */
router.put('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Check if user can edit this structure (Admin/Root only, Support cannot)
  const canEdit = await canEditStructure(structure, userRole, userId, StructureAdmin);
  validate(canEdit, 'Unauthorized: Only admins can edit structures');


  const updateData = {};
  const allowedFields = [
    'name', 'description', 'status', 'subtype', 'totalCommitment', 'managementFee',
    'carriedInterest', 'hurdleRate', 'waterfallType', 'termYears',
    'extensionYears', 'finalDate', 'gp', 'fundAdmin', 'legalCounsel',
    'auditor', 'taxAdvisor', 'bankAccounts', 'baseCurrency',
    'taxJurisdiction', 'regulatoryStatus', 'investmentStrategy',
    'targetReturns', 'riskProfile', 'stage'
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
 * @access  Private (requires authentication, Root/Admin only)
 */
router.patch('/:id/financials', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { totalCalled, totalDistributed, totalInvested } = req.body;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can edit any structure, Admin can only edit their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

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
 * @route   POST /api/structures/:id/admins
 * @desc    Add admin or support user to structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/:id/admins', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;
  const { userId: targetUserId, role: targetRole, canEdit, canDelete, canManageInvestors, canManageDocuments } = req.body;

  // Validate required fields
  validate(targetUserId, 'User ID is required');
  validate(targetRole !== undefined, 'Role is required');
  validate([ROLES.ADMIN, ROLES.SUPPORT].includes(targetRole), 'Role must be 1 (admin) or 2 (support)');

  // Check if structure exists
  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can add to any structure, Admin can only add to their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  // Check if target user exists and has valid role
  const targetUser = await User.findById(targetUserId);
  validate(targetUser, 'Target user not found');
  validate(
    targetUser.role === ROLES.ADMIN || targetUser.role === ROLES.SUPPORT,
    'Target user must be an admin or support user'
  );

  // Check if user is already added to structure
  const existing = await StructureAdmin.hasAccess(id, targetUserId);
  validate(!existing, 'User is already assigned to this structure');

  // Create the relationship
  const structureAdmin = await StructureAdmin.create({
    structureId: id,
    userId: targetUserId,
    role: targetRole,
    canEdit: canEdit !== undefined ? canEdit : true,
    canDelete: canDelete !== undefined ? canDelete : false,
    canManageInvestors: canManageInvestors !== undefined ? canManageInvestors : true,
    canManageDocuments: canManageDocuments !== undefined ? canManageDocuments : true,
    addedBy: userId
  });

  res.status(201).json({
    success: true,
    message: 'User added to structure successfully',
    data: structureAdmin
  });
}));

/**
 * @route   GET /api/structures/:id/admins
 * @desc    Get all admins and support users for a structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/:id/admins', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  // Check if structure exists
  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can view any structure, Admin can only view their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  // Get all admins/support for this structure
  const admins = await StructureAdmin.findByStructureId(id);

  res.status(200).json({
    success: true,
    count: admins.length,
    data: admins
  });
}));

/**
 * @route   DELETE /api/structures/:id/admins/:targetUserId
 * @desc    Remove admin or support user from structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id/admins/:targetUserId', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id, targetUserId } = req.params;

  // Check if structure exists
  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can remove from any structure, Admin can only remove from their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  // Check if relationship exists
  const hasAccess = await StructureAdmin.hasAccess(id, targetUserId);
  validate(hasAccess, 'User is not assigned to this structure');

  // Remove the relationship
  await StructureAdmin.delete(id, targetUserId);

  res.status(200).json({
    success: true,
    message: 'User removed from structure successfully'
  });
}));

/**
 * @route   DELETE /api/structures/:id
 * @desc    Delete a structure
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { id } = req.params;

  const structure = await Structure.findById(id);
  validate(structure, 'Structure not found');

  // Root can delete any structure, Admin can only delete their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

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
