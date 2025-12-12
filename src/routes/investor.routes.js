/**
 * Investor API Routes
 * Endpoints for managing investors (Individual, Institution, Fund of Funds, Family Office)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const User = require('../models/supabase/user');
const { requireInvestmentManagerAccess, ROLES } = require('../middleware/rbac');
const { getSupabase } = require('../config/database');

const router = express.Router();

// Add CORS headers for all investor routes
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

/**
 * @route   POST /api/investors
 * @desc    Create a new investor
 * @access  Private (requires authentication, Root/Admin only)
 */
router.post('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {

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
    // Individual fields
    fullName,
    dateOfBirth,
    nationality,
    passportNumber,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    // Institution fields
    institutionName,
    institutionType,
    registrationNumber,
    legalRepresentative,
    // Fund of Funds fields
    fundName,
    fundManager,
    aum,
    // Family Office fields
    officeName,
    familyName,
    principalContact,
    assetsUnderManagement
  } = req.body;

  // Validate required fields
  validate(investorType, 'Investor type is required');
  validate(['Individual', 'Institution', 'Fund of Funds', 'Family Office'].includes(investorType), 'Invalid investor type');
  validate(email, 'Email is required');

  // Validate email format
  const emailRegex = /^\S+@\S+\.\S+$/;
  validate(emailRegex.test(email), 'Invalid email format');

  // Check if email already exists
  const existingUser = await User.findByEmail(email);
  validate(!existingUser, 'User with this email already exists');

  // Validate type-specific required fields
  if (investorType === 'Individual') {
    validate(fullName, 'Full name is required for individual investors');
  } else if (investorType === 'Institution') {
    validate(institutionName, 'Institution name is required');
  } else if (investorType === 'Fund of Funds') {
    validate(fundName, 'Fund name is required');
  } else if (investorType === 'Family Office') {
    validate(officeName, 'Office name is required');
  }

  // Create investor user
  const investorData = {
    role: ROLES.INVESTOR,
    investorType,
    email: email.toLowerCase(),
    phoneNumber: phoneNumber?.trim() || '',
    country: country?.trim() || '',
    taxId: taxId?.trim() || '',
    kycStatus: kycStatus || 'Pending',
    accreditedInvestor: accreditedInvestor || false,
    riskTolerance: riskTolerance?.trim() || '',
    investmentPreferences: investmentPreferences || {},
    firstName: '', // Required by User model
    isActive: true
  };

  // Add type-specific fields
  if (investorType === 'Individual') {
    investorData.fullName = fullName.trim();
    investorData.dateOfBirth = dateOfBirth || null;
    investorData.nationality = nationality?.trim() || '';
    investorData.passportNumber = passportNumber?.trim() || '';
    investorData.addressLine1 = addressLine1?.trim() || '';
    investorData.addressLine2 = addressLine2?.trim() || '';
    investorData.city = city?.trim() || '';
    investorData.state = state?.trim() || '';
    investorData.postalCode = postalCode?.trim() || '';
  } else if (investorType === 'Institution') {
    investorData.institutionName = institutionName.trim();
    investorData.institutionType = institutionType?.trim() || '';
    investorData.registrationNumber = registrationNumber?.trim() || '';
    investorData.legalRepresentative = legalRepresentative?.trim() || '';
  } else if (investorType === 'Fund of Funds') {
    investorData.fundName = fundName.trim();
    investorData.fundManager = fundManager?.trim() || '';
    investorData.aum = aum || null;
  } else if (investorType === 'Family Office') {
    investorData.officeName = officeName.trim();
    investorData.familyName = familyName?.trim() || '';
    investorData.principalContact = principalContact?.trim() || '';
    investorData.assetsUnderManagement = assetsUnderManagement || null;
  }

  const user = await User.create(investorData);

  res.status(201).json({
    success: true,
    message: 'Investor created successfully',
    data: user
  });
}));

/**
 * @route   GET /api/investors
 * @desc    Get all investors (role-based filtering applied)
 * @access  Private (requires authentication, Root/Admin only)
 */
router.get('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { investorType, kycStatus, accreditedInvestor } = req.query;

  let filter = {
    role: ROLES.INVESTOR
  };

  if (investorType) filter.investorType = investorType;
  if (kycStatus) filter.kycStatus = kycStatus;
  if (accreditedInvestor !== undefined) filter.accreditedInvestor = accreditedInvestor === 'true';

  const investors = await User.find(filter);

  res.status(200).json({
    success: true,
    count: investors.length,
    data: investors
  });
}));

/**
 * @route   GET /api/investors/search
 * @desc    Search investors by name or email (role-based filtering applied)
 * @access  Private (requires authentication, all roles)
 */
router.get('/search', authenticate, catchAsync(async (req, res) => {
  const { q } = req.query;

  validate(q, 'Search query is required');
  validate(q.length >= 2, 'Search query must be at least 2 characters');

  const investors = await User.searchInvestors(q);

  res.status(200).json({
    success: true,
    count: investors.length,
    data: investors
  });
}));

/**
 * @route   GET /api/investors/with-structures
 * @desc    Get all investors with their structures
 * @access  Private (requires authentication, Root/Admin/Support only)
 */
router.get('/with-structures', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  // Get all investors (users with role = 3)
  const investors = await User.find({ role: ROLES.INVESTOR });

  // For each investor, get their structures from investments
  const supabase = getSupabase();
  const investorsWithStructures = await Promise.all(
    investors.map(async (investor) => {
      // Get all investments for this investor with structure details
      const { data: investments, error: invError } = await supabase
        .from('investments')
        .select(`
          structure_id,
          ownership_percentage,
          equity_ownership_percent,
          structures:structure_id (
            id,
            name,
            type,
            status,
            base_currency,
            total_invested
          )
        `)
        .eq('user_id', investor.id);

      if (invError) {
        console.error(`Error fetching investments for investor ${investor.id}:`, invError.message);
        return {
          ...investor,
          structures: []
        };
      }

      // Get unique structures from investments
      const uniqueStructures = new Map();
      investments?.forEach(inv => {
        if (inv.structures && !uniqueStructures.has(inv.structure_id)) {
          const ownershipPercent = inv.ownership_percentage || inv.equity_ownership_percent || 0;
          uniqueStructures.set(inv.structure_id, {
            structure_id: inv.structure_id,
            user_id: investor.id,
            ownership_percent: ownershipPercent,
            structure: inv.structures
          });
        }
      });

      return {
        ...investor,
        structures: Array.from(uniqueStructures.values())
      };
    })
  );

  res.status(200).json({
    success: true,
    count: investorsWithStructures.length,
    data: investorsWithStructures
  });
}));

/**
 * @route   GET /api/investors/:id
 * @desc    Get a single investor by ID
 * @access  Private (requires authentication, Root/Admin/Own investor)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);

  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Check access: Root/Admin can access any, Investors can only access their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === id);

  validate(hasAccess, 'Unauthorized access to investor data');

  res.status(200).json({
    success: true,
    data: user
  });
}));

/**
 * @route   GET /api/investors/:id/with-structures
 * @desc    Get investor with all structures
 * @access  Private (requires authentication, Root/Admin/Own investor)
 */
router.get('/:id/with-structures', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Check access: Root/Admin can access any, Investors can only access their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === id);

  validate(hasAccess, 'Unauthorized access to investor data');

  const userWithStructures = await User.findWithStructures(id);

  res.status(200).json({
    success: true,
    data: userWithStructures
  });
}));

/**
 * @route   GET /api/investors/:id/portfolio
 * @desc    Get investor portfolio summary
 * @access  Private (requires authentication, Root/Admin/Own investor)
 */
router.get('/:id/portfolio', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Check access: Root/Admin can access any, Investors can only access their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === id);

  validate(hasAccess, 'Unauthorized access to investor data');

  const portfolio = await User.getPortfolioSummary(id);

  res.status(200).json({
    success: true,
    data: portfolio
  });
}));

/**
 * @route   GET /api/investors/:id/commitments
 * @desc    Get investor commitments with detailed structure information
 * @access  Private (requires authentication, Root/Admin/Support/Own investor)
 */
router.get('/:id/commitments', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Check access: Root/Admin/Support can access any, Investors can only access their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    requestingUserRole === ROLES.SUPPORT ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === id);

  validate(hasAccess, 'Unauthorized access to investor data');

  const commitments = await User.getCommitmentsSummary(id);

  // Add investor information to the response
  const investorName = User.getDisplayName(user);

  res.status(200).json({
    success: true,
    data: {
      userId: user.id,
      userName: investorName,
      userEmail: user.email,
      ...commitments
    }
  });
}));

/**
 * @route   PUT /api/investors/me
 * @desc    Update authenticated investor's own profile
 * @access  Private (requires authentication, Investor role)
 */
router.put('/me', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth?.userId || req.user?.id;
  const userRole = req.auth?.role ?? req.user?.role;

  // Verify user is an investor
  validate(userRole === ROLES.INVESTOR, 'This endpoint is only accessible to investors');

  const user = await User.findById(userId);
  validate(user, 'Investor not found');

  // Check if email is being updated
  if (req.body.email && req.body.email !== user.email) {
    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    validate(emailRegex.test(req.body.email), 'Invalid email format');

    // Check if email is already used by another user
    const existingUser = await User.findByEmail(req.body.email);
    validate(!existingUser || existingUser.id === userId, 'Email already in use by another user');
  }

  const updateData = {};
  // Investors cannot update admin-only fields
  const allowedFields = [
    'email', 'phoneNumber', 'country', 'taxId',
    'riskTolerance', 'investmentPreferences',
    // Individual fields
    'fullName', 'dateOfBirth', 'nationality', 'passportNumber',
    'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
    // Institution fields
    'institutionName', 'institutionType', 'registrationNumber', 'legalRepresentative',
    // Fund of Funds fields
    'fundName', 'fundManager', 'aum',
    // Family Office fields
    'officeName', 'familyName', 'principalContact', 'assetsUnderManagement'
  ];

  // Define field types for proper handling
  const numberFields = ['aum', 'assetsUnderManagement'];
  const jsonFields = ['investmentPreferences'];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      const value = req.body[field];

      // Convert empty strings to null for number fields
      if (numberFields.includes(field) && value === '') {
        updateData[field] = null;
        continue;
      }

      // Convert empty strings to null for JSON fields
      if (jsonFields.includes(field) && value === '') {
        updateData[field] = null;
        continue;
      }

      // Normalize email to lowercase
      if (field === 'email' && typeof value === 'string') {
        updateData[field] = value.toLowerCase();
        continue;
      }

      // For string fields, keep as-is (including empty strings)
      updateData[field] = value;
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedUser = await User.findByIdAndUpdate(userId, updateData);

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    data: updatedUser
  });
}));

/**
 * @route   GET /api/investors/me/capital-calls-summary
 * @desc    Get authenticated user's capital calls summary (Total Called, Total Paid, Outstanding, Total Calls)
 * @access  Private (requires authentication, Investor role)
 */
router.get('/me/capital-calls-summary', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth?.userId || req.user?.id;
  const userRole = req.auth?.role ?? req.user?.role;

  // Verify user is an investor
  validate(userRole === ROLES.INVESTOR, 'This endpoint is only accessible to investors');

  const capitalCallsData = await User.getCapitalCallsSummary(userId);

  res.status(200).json({
    success: true,
    data: {
      totalCalled: capitalCallsData.summary.totalCalled,
      totalPaid: capitalCallsData.summary.totalPaid,
      outstanding: capitalCallsData.summary.outstanding,
      totalCalls: capitalCallsData.summary.totalCalls
    }
  });
}));

/**
 * @route   GET /api/investors/me/capital-calls
 * @desc    Get authenticated user's capital calls with structures and summary
 * @access  Private (requires authentication, Investor role)
 */
router.get('/me/capital-calls', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth?.userId || req.user?.id;
  const userRole = req.auth?.role ?? req.user?.role;

  // Verify user is an investor
  validate(userRole === ROLES.INVESTOR, 'This endpoint is only accessible to investors');

  const user = await User.findById(userId);
  validate(user, 'User not found');

  const capitalCallsData = await User.getCapitalCallsSummary(userId);

  // Add investor information to the response
  const investorName = User.getDisplayName(user);

  res.status(200).json({
    success: true,
    data: {
      userId: user.id,
      userName: investorName,
      userEmail: user.email,
      ...capitalCallsData
    }
  });
}));

/**
 * @route   GET /api/investors/:id/capital-calls/summary
 * @desc    Get investor capital calls summary (Total Called, Total Paid, Outstanding, Total Calls)
 * @access  Private (requires authentication, Root/Admin/Support/Own investor)
 */
router.get('/:id/capital-calls/summary', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Check access: Root/Admin/Support can access any, Investors can only access their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    requestingUserRole === ROLES.SUPPORT ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === id);

  validate(hasAccess, 'Unauthorized access to investor data');

  const capitalCallsData = await User.getCapitalCallsSummary(id);

  res.status(200).json({
    success: true,
    data: {
      totalCalled: capitalCallsData.summary.totalCalled,
      totalPaid: capitalCallsData.summary.totalPaid,
      outstanding: capitalCallsData.summary.outstanding,
      totalCalls: capitalCallsData.summary.totalCalls
    }
  });
}));

/**
 * @route   GET /api/investors/:id/capital-calls
 * @desc    Get investor capital calls with structures and summary
 * @access  Private (requires authentication, Root/Admin/Support/Own investor)
 */
router.get('/:id/capital-calls', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Check access: Root/Admin/Support can access any, Investors can only access their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    requestingUserRole === ROLES.SUPPORT ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === id);

  validate(hasAccess, 'Unauthorized access to investor data');

  const capitalCallsData = await User.getCapitalCallsSummary(id);

  // Add investor information to the response
  const investorName = User.getDisplayName(user);

  res.status(200).json({
    success: true,
    data: {
      userId: user.id,
      userName: investorName,
      userEmail: user.email,
      ...capitalCallsData
    }
  });
}));

/**
 * @route   PUT /api/investors/:id
 * @desc    Update an investor
 * @access  Private (requires authentication, Root/Admin/Own investor)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Check access: Root/Admin can update any, Investors can only update their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === id);

  validate(hasAccess, 'Unauthorized access to investor data');

  const isAdmin = requestingUserRole === ROLES.ROOT || requestingUserRole === ROLES.ADMIN;

  // Check if email is being updated
  if (req.body.email && req.body.email !== user.email) {
    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    validate(emailRegex.test(req.body.email), 'Invalid email format');

    // Check if email is already used by another user
    const existingUser = await User.findByEmail(req.body.email);
    validate(!existingUser || existingUser.id === id, 'Email already in use by another user');
  }

  // Fields that only admins can update
  const adminOnlyFields = ['kycStatus', 'accreditedInvestor', 'investorType'];

  const updateData = {};
  const allowedFields = [
    'email', 'phoneNumber', 'country', 'taxId', 'kycStatus', 'accreditedInvestor',
    'riskTolerance', 'investmentPreferences', 'investorType',
    // Individual fields
    'fullName', 'dateOfBirth', 'nationality', 'passportNumber',
    'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
    // Institution fields
    'institutionName', 'institutionType', 'registrationNumber', 'legalRepresentative',
    // Fund of Funds fields
    'fundName', 'fundManager', 'aum',
    // Family Office fields
    'officeName', 'familyName', 'principalContact', 'assetsUnderManagement'
  ];

  // Define field types for proper handling
  const booleanFields = ['accreditedInvestor'];
  const numberFields = ['aum', 'assetsUnderManagement'];
  const jsonFields = ['investmentPreferences'];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      // Skip admin-only fields if requester is not admin
      if (!isAdmin && adminOnlyFields.includes(field)) {
        continue;
      }

      const value = req.body[field];

      // Skip empty strings for boolean fields
      if (booleanFields.includes(field) && value === '') {
        continue;
      }

      // Convert empty strings to null for number fields
      if (numberFields.includes(field) && value === '') {
        updateData[field] = null;
        continue;
      }

      // Convert empty strings to null for JSON fields
      if (jsonFields.includes(field) && value === '') {
        updateData[field] = null;
        continue;
      }

      // Normalize email to lowercase
      if (field === 'email' && typeof value === 'string') {
        updateData[field] = value.toLowerCase();
        continue;
      }

      // For string fields, keep as-is (including empty strings)
      updateData[field] = value;
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedUser = await User.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Investor updated successfully',
    data: updatedUser
  });
}));

/**
 * @route   DELETE /api/investors/:id
 * @desc    Delete an investor
 * @access  Private (requires authentication, Root/Admin only)
 */
router.delete('/:id', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  await User.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Investor deleted successfully'
  });
}));

/**
 * @route   GET /api/investors/me/dashboard
 * @desc    Get investor dashboard data with structures, summary, and distributions
 * @access  Private (requires authentication, Investor role)
 *
 * @success {200} Success Response
 * {
 *   "success": true,
 *   "data": {
 *     "investor": {
 *       "id": "investor-uuid",
 *       "firstName": "John",
 *       "lastName": "Doe",
 *       "email": "john@example.com"
 *     },
 *     "structures": [
 *       {
 *         "id": "structure-uuid",
 *         "name": "Real Estate Fund I",
 *         "type": "Fund",
 *         "commitment": 500000,
 *         "calledCapital": 300000,
 *         "currentValue": 350000,
 *         "unrealizedGain": 50000
 *       }
 *     ],
 *     "summary": {
 *       "totalCommitment": 500000,
 *       "totalCalledCapital": 300000,
 *       "totalCurrentValue": 350000,
 *       "totalDistributed": 25000,
 *       "totalReturn": 75000,
 *       "totalReturnPercent": 25.0
 *     },
 *     "distributions": [
 *       {
 *         "id": "dist-uuid",
 *         "structureId": "structure-uuid",
 *         "structureName": "Real Estate Fund I",
 *         "amount": 25000,
 *         "date": "2024-01-15",
 *         "type": "Return of Capital",
 *         "status": "Paid"
 *       }
 *     ]
 *   }
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 *
 * @error {403} Forbidden - Not an investor
 * {
 *   "success": false,
 *   "message": "Access denied. Investor role required."
 * }
 */
router.get('/me/dashboard', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const supabase = getSupabase();

  // Get user details
  const user = await User.findById(userId);
  validate(user, 'User not found');

  // Optional: Validate user is an investor (role 3)
  // validate(user.role === ROLES.INVESTOR, 'Access denied. Investor role required.');

  // Get all structures this user has invested in (from investments table)
  const { data: investments, error: invError } = await supabase
    .from('investments')
    .select(`
      structure_id,
      structures:structure_id (
        id,
        name,
        type,
        status,
        base_currency,
        total_invested
      )
    `)
    .eq('user_id', userId);

  if (invError) {
    throw new Error(`Error fetching structures: ${invError.message}`);
  }

  // Get unique structures from investments
  const uniqueStructures = new Map();
  investments?.forEach(inv => {
    if (inv.structures && !uniqueStructures.has(inv.structure_id)) {
      uniqueStructures.set(inv.structure_id, {
        structure_id: inv.structure_id,
        user_id: userId,
        structure: inv.structures
      });
    }
  });
  const structureInvestors = Array.from(uniqueStructures.values());

  // Get all capital call allocations for this user
  const { data: capitalCallAllocations, error: ccError } = await supabase
    .from('capital_call_allocations')
    .select(`
      *,
      capital_call:capital_calls (
        structure_id
      )
    `)
    .eq('user_id', userId);

  if (ccError) {
    throw new Error(`Error fetching capital calls: ${ccError.message}`);
  }

  // Get all distribution allocations for this user
  const { data: distributionAllocations, error: distError } = await supabase
    .from('distribution_allocations')
    .select(`
      *,
      distribution:distributions (
        id,
        structure_id,
        distribution_date,
        source,
        status
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (distError) {
    throw new Error(`Error fetching distributions: ${distError.message}`);
  }

  // Build structures array with calculations
  const structures = (structureInvestors || [])
    .filter(si => si.structure)
    .map(si => {
      const commitment = parseFloat(si.commitment_amount) || 0;

      // Calculate called capital for this structure
      const structureCalls = (capitalCallAllocations || []).filter(
        alloc => alloc.capital_call?.structure_id === si.structure_id
      );
      const calledCapital = structureCalls.reduce(
        (sum, alloc) => sum + (parseFloat(alloc.allocated_amount) || 0),
        0
      );

      // Use structure's total_invested as current value
      // This represents the total amount invested in the structure
      const currentValue = parseFloat(si.structure.total_invested) || calledCapital;

      // Calculate unrealized gain
      const unrealizedGain = currentValue - calledCapital;

      return {
        id: si.structure.id,
        name: si.structure.name,
        type: si.structure.type,
        status: si.structure.status,
        commitment: commitment,
        calledCapital: calledCapital,
        currentValue: currentValue,
        unrealizedGain: unrealizedGain,
        currency: si.structure.base_currency || 'USD',
        ownershipPercent: parseFloat(si.ownership_percent) || 0
      };
    });

  // Build distributions array
  const distributions = (distributionAllocations || [])
    .filter(alloc => alloc.distribution)
    .map(alloc => {
      // Find the structure name
      const structure = structures.find(s => s.id === alloc.distribution.structure_id);

      return {
        id: alloc.distribution.id,
        structureId: alloc.distribution.structure_id,
        structureName: structure?.name || 'Unknown Structure',
        amount: parseFloat(alloc.allocated_amount) || 0,
        date: alloc.distribution.distribution_date,
        type: alloc.distribution.source || 'Distribution',
        status: alloc.status || alloc.distribution.status
      };
    });

  // Calculate summary metrics
  const totalCommitment = structures.reduce((sum, s) => sum + s.commitment, 0);
  const totalCalledCapital = structures.reduce((sum, s) => sum + s.calledCapital, 0);
  const totalCurrentValue = structures.reduce((sum, s) => sum + s.currentValue, 0);
  const totalDistributed = distributions
    .filter(d => d.status === 'Paid')
    .reduce((sum, d) => sum + d.amount, 0);

  // Total Return = (Distributions + Current Value) - Called Capital
  const totalReturn = (totalDistributed + totalCurrentValue) - totalCalledCapital;
  const totalReturnPercent = totalCalledCapital > 0
    ? (totalReturn / totalCalledCapital) * 100
    : 0;

  res.status(200).json({
    success: true,
    data: {
      investor: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        profileImage: user.profileImage
      },
      structures,
      summary: {
        totalCommitment: parseFloat(totalCommitment.toFixed(2)),
        totalCalledCapital: parseFloat(totalCalledCapital.toFixed(2)),
        totalCurrentValue: parseFloat(totalCurrentValue.toFixed(2)),
        totalDistributed: parseFloat(totalDistributed.toFixed(2)),
        totalReturn: parseFloat(totalReturn.toFixed(2)),
        totalReturnPercent: parseFloat(totalReturnPercent.toFixed(2))
      },
      distributions
    }
  });
}));

/**
 * @route   GET /api/investors/health
 * @desc    Health check for Investor API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Investor API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
