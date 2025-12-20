/**
 * Role-Based Access Control (RBAC) Middleware
 * Handles role-based filtering and access control for API endpoints
 *
 * Permission Model:
 * - ROOT (0): Full access to everything
 * - ADMIN (1): Can create, edit, delete items belonging to structures assigned in structure_admins table
 * - SUPPORT (2): Can edit items belonging to structures assigned in structure_admins table (NOT structures themselves)
 * - INVESTOR (3): Can only create, edit, and read their own investments
 * - GUEST (4): Read-only access - can only view data, cannot modify anything
 */

// Role constants
const ROLES = {
  ROOT: 0,
  ADMIN: 1,
  SUPPORT: 2,
  INVESTOR: 3,
  GUEST: 4
};

/**
 * Middleware to restrict access to investment manager endpoints
 * Blocks investors (role = 3) and guests (role = 4) from accessing admin-only endpoints
 * Allows Root (0), Admin (1), and Support (2)
 */
const requireInvestmentManagerAccess = (req, res, next) => {
  // Skip for OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  const userRole = req.user?.role ?? req.auth?.role;

  // Block investors and guests from accessing investment manager endpoints
  if (userRole === ROLES.INVESTOR || userRole === ROLES.GUEST) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is only available to Root, Admin, and Support users.'
    });
  }

  next();
};

/**
 * Middleware to require root access only
 */
const requireRootAccess = (req, res, next) => {
  // Skip for OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  const userRole = req.user?.role ?? req.auth?.role;

  if (userRole !== ROLES.ROOT) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is only available to Root users.'
    });
  }

  next();
};

/**
 * Apply role-based filtering to query criteria
 * Root (0): Returns criteria unchanged (sees everything)
 * Admin (1): Adds creator filter to criteria
 * Support (2): Returns criteria unchanged (sees everything, read-only)
 * Investor (3): Returns null (should be blocked by middleware)
 * Guest (4): Returns criteria unchanged (sees everything, read-only)
 *
 * @param {Object} criteria - Base query criteria
 * @param {number} userRole - User's role (0, 1, 2, 3, or 4)
 * @param {string} userId - User's ID
 * @param {string} creatorField - Field name to filter by (default: 'createdBy')
 * @returns {Object|null} Modified criteria or null if access denied
 */
const applyRoleFilter = (criteria = {}, userRole, userId, creatorField = 'createdBy') => {
  // Root sees everything
  if (userRole === ROLES.ROOT) {
    return criteria;
  }

  // Support sees everything (read-only access)
  if (userRole === ROLES.SUPPORT) {
    return criteria;
  }

  // Guest sees everything (read-only access)
  if (userRole === ROLES.GUEST) {
    return criteria;
  }

  // Admin sees only their own items
  if (userRole === ROLES.ADMIN) {
    return {
      ...criteria,
      [creatorField]: userId
    };
  }

  // Investor should not access investment manager data
  if (userRole === ROLES.INVESTOR) {
    return null;
  }

  // Unknown role
  return null;
};

/**
 * Filter array of items based on user role
 * Root (0): Returns all items
 * Admin (1): Returns only items created by the user
 * Support (2): Returns all items (read-only access)
 * Investor (3): Returns empty array
 * Guest (4): Returns all items (read-only access)
 *
 * @param {Array} items - Array of items to filter
 * @param {number} userRole - User's role (0, 1, 2, 3, or 4)
 * @param {string} userId - User's ID
 * @returns {Array} Filtered array
 */
const filterByRole = (items, userRole, userId) => {
  if (!Array.isArray(items)) {
    return items;
  }

  // Root sees everything
  if (userRole === ROLES.ROOT) {
    return items;
  }

  // Support sees everything (read-only access)
  if (userRole === ROLES.SUPPORT) {
    return items;
  }

  // Guest sees everything (read-only access)
  if (userRole === ROLES.GUEST) {
    return items;
  }

  // Admin sees only their own items
  if (userRole === ROLES.ADMIN) {
    return items.filter(item => {
      // Check different possible field names for creator
      const creatorId = item.createdBy || item.created_by ||
                       item.userId || item.user_id ||
                       item.uploadedBy || item.uploaded_by;
      return creatorId === userId;
    });
  }

  // Investor should not see investment manager data
  if (userRole === ROLES.INVESTOR) {
    return [];
  }

  return [];
};

/**
 * Check if user can edit an item
 * Root can edit anything
 * Admin can edit only their own items
 * Support cannot edit (read-only)
 * Investor cannot edit
 * Guest cannot edit (read-only)
 */
const canEdit = (item, userRole, userId) => {
  if (userRole === ROLES.ROOT) return true;

  if (userRole === ROLES.ADMIN) {
    const creatorId = item.createdBy || item.created_by ||
                     item.userId || item.user_id;
    return creatorId === userId;
  }

  // Support, Investor, and Guest cannot edit
  return false;
};

/**
 * Check if user can delete an item
 * Root can delete anything
 * Admin can delete only their own items
 * Support cannot delete (read-only)
 * Investor cannot delete
 */
const canDelete = (item, userRole, userId) => {
  return canEdit(item, userRole, userId);
};

/**
 * Check if user can create items
 * Root and Admin can create
 * Support cannot create (read-only)
 * Investor cannot create
 * Guest cannot create (read-only)
 */
const canCreate = (userRole) => {
  return userRole === ROLES.ROOT || userRole === ROLES.ADMIN;
};

/**
 * Get user context from request
 * Extracts userId and userRole from authenticated request
 */
const getUserContext = (req) => {
  const userId = req.auth?.userId || req.user?.id;
  const userRole = req.user?.role ?? req.auth?.role;

  return { userId, userRole };
};

/**
 * Check if user can access a structure
 * - ROOT: Can access any structure
 * - ADMIN: Can access structures they created OR structures assigned to them in structure_admins
 * - SUPPORT: Can access structures assigned to them in structure_admins
 * - INVESTOR: Cannot access structures
 *
 * @param {Object} structure - Structure object with createdBy field
 * @param {number} userRole - User's role
 * @param {string} userId - User's ID
 * @param {Function} StructureAdmin - StructureAdmin model (injected to avoid circular dependency)
 * @returns {Promise<boolean>}
 */
const canAccessStructure = async (structure, userRole, userId, StructureAdmin) => {
  // Root can access everything
  if (userRole === ROLES.ROOT) return true;

  // Guest can view all structures (read-only)
  if (userRole === ROLES.GUEST) return true;

  // Investors cannot access structures
  if (userRole === ROLES.INVESTOR) return false;

  // Admin can access structures they created
  if (userRole === ROLES.ADMIN && structure.createdBy === userId) {
    return true;
  }

  // Admin and Support can access structures assigned to them
  if (userRole === ROLES.ADMIN || userRole === ROLES.SUPPORT) {
    const hasAccess = await StructureAdmin.hasAccess(structure.id, userId);
    return hasAccess;
  }

  return false;
};

/**
 * Check if user can edit a structure
 * - ROOT: Can edit any structure
 * - ADMIN: Can edit structures they created OR structures assigned to them in structure_admins
 * - SUPPORT: Cannot edit structures (can only edit related items)
 * - INVESTOR: Cannot edit structures
 *
 * @param {Object} structure - Structure object with createdBy field
 * @param {number} userRole - User's role
 * @param {string} userId - User's ID
 * @param {Function} StructureAdmin - StructureAdmin model
 * @returns {Promise<boolean>}
 */
const canEditStructure = async (structure, userRole, userId, StructureAdmin) => {
  // Root can edit everything
  if (userRole === ROLES.ROOT) return true;

  // Support, Investor, and Guest cannot edit structures
  if (userRole === ROLES.SUPPORT || userRole === ROLES.INVESTOR || userRole === ROLES.GUEST) return false;

  // Admin can edit structures they created
  if (userRole === ROLES.ADMIN && structure.createdBy === userId) {
    return true;
  }

  // Admin can edit structures assigned to them
  if (userRole === ROLES.ADMIN) {
    const hasAccess = await StructureAdmin.hasAccess(structure.id, userId);
    return hasAccess;
  }

  return false;
};

/**
 * Check if user can access items belonging to a structure
 * - ROOT: Can access any items
 * - ADMIN: Can access items from structures they have access to
 * - SUPPORT: Can access items from structures they have access to
 * - INVESTOR: Can only access their own investments
 *
 * @param {string} structureId - Structure ID
 * @param {number} userRole - User's role
 * @param {string} userId - User's ID
 * @param {Function} StructureAdmin - StructureAdmin model
 * @returns {Promise<boolean>}
 */
const canAccessStructureItems = async (structureId, userRole, userId, StructureAdmin) => {
  // Root can access everything
  if (userRole === ROLES.ROOT) return true;

  // Investor needs special handling (only their investments)
  if (userRole === ROLES.INVESTOR) return false; // Will be handled separately

  // Admin and Support can access items from assigned structures
  if (userRole === ROLES.ADMIN || userRole === ROLES.SUPPORT) {
    // Check if user created the structure
    const { Structure } = require('../models/supabase');
    const structure = await Structure.findById(structureId);

    if (structure && structure.createdBy === userId) {
      return true;
    }

    // Check if user is assigned to the structure
    const hasAccess = await StructureAdmin.hasAccess(structureId, userId);
    return hasAccess;
  }

  return false;
};

/**
 * Get list of structure IDs user has access to
 * Used for filtering queries
 *
 * @param {number} userRole - User's role
 * @param {string} userId - User's ID
 * @param {Function} StructureAdmin - StructureAdmin model
 * @returns {Promise<string[]|null>} Array of structure IDs or null for ROOT (all access)
 */
const getUserStructureIds = async (userRole, userId, StructureAdmin) => {
  // Root sees everything
  if (userRole === ROLES.ROOT) return null;

  // Guest sees everything (read-only)
  if (userRole === ROLES.GUEST) return null;

  // Investor doesn't access structures
  if (userRole === ROLES.INVESTOR) return [];

  // Get structures created by user
  const { Structure } = require('../models/supabase');
  const createdStructures = await Structure.findByUserId(userId);
  const createdIds = createdStructures.map(s => s.id);

  // Get structures assigned to user
  const assignedStructures = await StructureAdmin.findByUserId(userId);
  const assignedIds = assignedStructures.map(sa => sa.structureId);

  // Combine and deduplicate
  const allIds = [...new Set([...createdIds, ...assignedIds])];
  return allIds;
};

module.exports = {
  ROLES,
  requireInvestmentManagerAccess,
  requireRootAccess,
  applyRoleFilter,
  filterByRole,
  canEdit,
  canDelete,
  canCreate,
  getUserContext,
  canAccessStructure,
  canEditStructure,
  canAccessStructureItems,
  getUserStructureIds
};
