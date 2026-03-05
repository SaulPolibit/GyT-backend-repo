/**
 * Investor API Routes
 * Endpoints for managing investors (Individual, Institution, Fund of Funds, Family Office)
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const User = require('../models/supabase/user');
const Investor = require('../models/supabase/investor');
const Structure = require('../models/supabase/structure');
const DocusealSubmission = require('../models/supabase/docusealSubmission');
const Payment = require('../models/supabase/payment');
const { requireInvestmentManagerAccess, ROLES, getUserContext } = require('../middleware/rbac');
const { getSupabase } = require('../config/database');
const { validateInvestorCreation } = require('../services/subscriptionLimits.service');

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
 * @desc    Create investor profile for a user-structure combination
 * @access  Private (requires authentication, Root/Admin only)
 * @error   409 - Returns error if investor profile already exists for the user-structure combination
 */
router.post('/', authenticate, requireInvestmentManagerAccess, catchAsync(async (req, res) => {
  const { userId: requestingUserId, userRole: requestingUserRole } = req.auth || req.user || {};

  const {
    // User creation fields (when createUser is true)
    createUser,
    firstName,
    lastName,
    password,
    sendWelcomeEmail,
    // Existing fields
    userId: providedUserId,
    structureId,
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
    assetsUnderManagement,
    // Structure Allocation
    commitment,
    ownershipPercent,
    // ILPA Fee Settings
    feeDiscount,
    vatExempt,
    // Custom terms (per-investor overrides)
    customTerms
  } = req.body;

  // Validate required fields
  validate(structureId, 'Structure ID is required');
  // investorType is required only when creating a new user (existing users already have it)
  if (createUser) {
    validate(investorType, 'Investor type is required');
    validate(['Individual', 'Institution', 'Fund of Funds', 'Family Office'].includes(investorType), 'Invalid investor type');
  }

  // Validate UUID format for structureId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(structureId), 'Invalid structure ID format');

  // Validate subscription limits before creating investor
  const subscriptionValidation = await validateInvestorCreation(requestingUserId);
  if (!subscriptionValidation.allowed) {
    return res.status(403).json({
      success: false,
      error: 'Subscription Limit Exceeded',
      message: subscriptionValidation.reason,
      currentCount: subscriptionValidation.currentCount,
      limit: subscriptionValidation.limit,
      upgradeOption: subscriptionValidation.upgradeOption
    });
  }

  let userId;
  let existingUser;
  let newUserCreated = false;
  let plainPassword = null;

  if (createUser) {
    // --- Create new user inline with role 3 (INVESTOR) ---
    validate(email, 'Email is required when creating a new user');
    validate(password, 'Password is required when creating a new user');
    validate(firstName, 'First name is required when creating a new user');

    // Check if user already exists
    const existingByEmail = await User.findByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({
        success: false,
        message: 'A user with this email already exists. Use "Select Existing User" instead.'
      });
    }

    // Create user in Supabase Auth
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName,
        last_name: lastName || ''
      }
    });

    if (authError) {
      console.error('[Investor Route] Supabase Auth error:', authError);
      return res.status(400).json({
        success: false,
        message: 'Failed to create user account',
        error: authError.message
      });
    }

    if (!authData?.user) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create user account - no user returned'
      });
    }

    // Create user in users table with role 3 (INVESTOR) and all profile data
    try {
      const userCreateData = {
        id: authData.user.id,
        email,
        password,
        firstName,
        lastName: lastName || '',
        role: ROLES.INVESTOR, // role 3
        // Profile data stored on users table
        investorType,
        phoneNumber: phoneNumber?.trim() || null,
        country: country?.trim() || null,
        taxId: taxId?.trim() || null,
        kycStatus: kycStatus || 'Not Started',
        accreditedInvestor: accreditedInvestor || false,
        riskTolerance: riskTolerance?.trim() || null,
        investmentPreferences: investmentPreferences || null,
      };

      // Add type-specific fields to user record
      if (investorType === 'Individual') {
        userCreateData.fullName = fullName?.trim() || `${firstName} ${lastName || ''}`.trim();
        userCreateData.dateOfBirth = dateOfBirth || null;
        userCreateData.nationality = nationality?.trim() || null;
        userCreateData.passportNumber = passportNumber?.trim() || null;
        userCreateData.addressLine1 = addressLine1?.trim() || null;
        userCreateData.addressLine2 = addressLine2?.trim() || null;
        userCreateData.city = city?.trim() || null;
        userCreateData.state = state?.trim() || null;
        userCreateData.postalCode = postalCode?.trim() || null;
      } else if (investorType === 'Institution') {
        userCreateData.institutionName = institutionName?.trim() || null;
        userCreateData.institutionType = institutionType?.trim() || null;
        userCreateData.registrationNumber = registrationNumber?.trim() || null;
        userCreateData.legalRepresentative = legalRepresentative?.trim() || null;
      } else if (investorType === 'Fund of Funds') {
        userCreateData.fundName = fundName?.trim() || null;
        userCreateData.fundManager = fundManager?.trim() || null;
        userCreateData.aum = aum || null;
      } else if (investorType === 'Family Office') {
        userCreateData.officeName = officeName?.trim() || null;
        userCreateData.familyName = familyName?.trim() || null;
        userCreateData.principalContact = principalContact?.trim() || null;
        userCreateData.assetsUnderManagement = assetsUnderManagement || null;
      }

      existingUser = await User.create(userCreateData);
      userId = existingUser.id;
      newUserCreated = true;
      plainPassword = password;
      console.log('[Investor Route] New investor user created with full profile:', userId);
    } catch (createError) {
      console.error('[Investor Route] Error creating user in users table:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create user profile',
        error: createError.message
      });
    }
  } else {
    // --- Select existing user ---
    userId = providedUserId;
    validate(userId, 'User ID is required');
    validate(uuidRegex.test(userId), 'Invalid user ID format');

    existingUser = await User.findById(userId);
    validate(existingUser, 'User not found');
  }

  // Validate type-specific required fields (only for new user creation)
  if (createUser) {
    if (investorType === 'Individual') {
      validate(fullName || firstName, 'Full name or first name is required for individual investors');
    } else if (investorType === 'Institution') {
      validate(institutionName, 'Institution name is required');
    } else if (investorType === 'Fund of Funds') {
      validate(fundName, 'Fund name is required');
    } else if (investorType === 'Family Office') {
      validate(officeName, 'Office name is required');
    }
  }

  // Check if investor profile already exists for this user-structure combination
  const existingInvestors = await Investor.find({ userId, structureId });
  if (existingInvestors && existingInvestors.length > 0) {
    return res.status(409).json({
      success: false,
      message: 'Investor profile already exists for this user-structure combination'
    });
  }

  // Prepare investor data (junction: user-structure relationship + per-structure settings)
  // Personal/profile data is stored on the users table, not here
  const investorData = {
    userId,
    structureId,
    investorType: investorType || existingUser.investorType || 'Individual',
    email: email?.toLowerCase() || existingUser.email,
    // Structure allocation
    commitment: commitment || null,
    ownershipPercent: ownershipPercent || null,
    // ILPA Fee Settings (per-structure)
    feeDiscount: feeDiscount !== undefined ? feeDiscount : 0,
    vatExempt: vatExempt !== undefined ? vatExempt : false,
    // Custom terms (per-investor overrides)
    customTerms: customTerms || null,
    createdBy: requestingUserId
  };

  // Create new investor profile (junction record in legacy investors table)
  const investor = await Investor.create(investorData);

  // Send welcome email if a new user was created and sendWelcomeEmail is true
  let emailSent = false;
  if (newUserCreated && sendWelcomeEmail !== false) {
    try {
      // Get structure name
      const structure = await Structure.findById(structureId);
      const structureName = structure?.name || 'a fund structure';

      const loginUrl = process.env.LP_PORTAL_URL || process.env.FRONTEND_URL || 'https://app.polibit.com';

      const { sendEmail } = require('../services/email');
      await sendEmail(requestingUserId, {
        to: [investorData.email],
        subject: `Welcome - Your Investor Account`,
        bodyHtml: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome</h2>
            <p>Your investor account has been created. You have been assigned to <strong>${structureName}</strong>.</p>
            <p>You can access the LP Portal using the following credentials:</p>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 4px 0;"><strong>Email:</strong> ${investorData.email}</p>
              <p style="margin: 4px 0;"><strong>Password:</strong> ${plainPassword}</p>
            </div>
            <p><a href="${loginUrl}/lp-portal/login" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Login to LP Portal</a></p>
            <p style="color: #666; font-size: 12px; margin-top: 24px;">For security, we recommend changing your password after your first login.</p>
          </div>
        `,
        bodyText: `Welcome\n\nYour investor account has been created. You have been assigned to ${structureName}.\n\nEmail: ${investorData.email}\nPassword: ${plainPassword}\n\nLogin at: ${loginUrl}/lp-portal/login\n\nFor security, we recommend changing your password after your first login.`
      });
      emailSent = true;
      console.log('[Investor Route] Welcome email sent to:', investorData.email);
    } catch (emailError) {
      console.error('[Investor Route] Failed to send welcome email:', emailError.message);
      // Don't fail the request if email fails - investor was still created
    }
  }

  res.status(201).json({
    success: true,
    message: newUserCreated
      ? `Investor profile and user account created successfully${emailSent ? '. Welcome email sent.' : '.'}`
      : 'Investor profile created successfully',
    data: investor,
    userCreated: newUserCreated,
    emailSent
  });
}));

/**
 * @route   GET /api/investors
 * @desc    Get all investors from Investor model with associated user, structure, and payment data
 * @desc    Includes hasFreeDocusealSubmission field indicating if investor has any DocusealSubmission not in Payments
 * @desc    Includes payments array with all payment records for the investor's userId
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

  const { investorType, kycStatus, accreditedInvestor, userId, structureId } = req.query;

  // Build filter for Investor model
  let filter = {};

  if (investorType) filter.investorType = investorType;
  if (kycStatus) filter.kycStatus = kycStatus;
  if (accreditedInvestor !== undefined) filter.accreditedInvestor = accreditedInvestor === 'true';
  if (userId) filter.userId = userId;
  if (structureId) filter.structureId = structureId;

  // Get investors from Investor model
  const investors = await Investor.find(filter);

  // Get all payment submission IDs once for efficiency
  const payments = await Payment.find({});
  const paymentSubmissionIds = new Set(
    payments.map(p => p.submissionId).filter(id => id !== null && id !== undefined)
  );

  // Fetch associated user and structure data for each investor
  const investorsWithData = await Promise.all(
    investors.map(async (investor) => {
      const user = investor.userId ? await User.findById(investor.userId) : null;
      const structure = investor.structureId ? await Structure.findById(investor.structureId) : null;

      // Get user payments
      let userPayments = [];
      if (investor.userId) {
        userPayments = await Payment.find({ userId: investor.userId });
      }

      // Check for free DocusealSubmissions (submissions not in payments)
      let hasFreeDocusealSubmission = false;
      if (investor.userId && user) {
        // Get all DocusealSubmissions by user email
        const docusealSubmissions = await DocusealSubmission.findByEmail(user.email);

        if (docusealSubmissions && docusealSubmissions.length > 0) {
          // Check if any DocusealSubmission is not in payments
          // Note: payment.submissionId stores the Supabase UUID (docuseal_submissions.id)
          hasFreeDocusealSubmission = docusealSubmissions.some(
            submission => !paymentSubmissionIds.has(submission.id) // Use submission.id, not submission.submissionId
          );
        }
      }

      return {
        ...investor,
        user: user ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          isActive: user.isActive
        } : null,
        structure: structure ? {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          status: structure.status,
          baseCurrency: structure.baseCurrency,
          currentInvestors: structure.currentInvestors,
          currentInvestments: structure.currentInvestments
        } : null,
        payments: userPayments,
        hasFreeDocusealSubmission
      };
    })
  );

  res.status(200).json({
    success: true,
    count: investorsWithData.length,
    data: investorsWithData
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

  const investors = await Investor.search(q);

  res.status(200).json({
    success: true,
    count: investors.length,
    data: investors
  });
}));

/**
 * @route   GET /api/investors/with-structures
 * @desc    Get all investors from Investor model with their user and structure data
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/with-structures', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

  // Get all investors from Investor model
  const investors = await Investor.find({});

  // For each investor, get user and structure data
  const investorsWithData = await Promise.all(
    investors.map(async (investor) => {
      // Fetch user data from userId
      const user = investor.userId ? await User.findById(investor.userId) : null;

      // Fetch structure data from structureId
      const structure = investor.structureId ? await Structure.findById(investor.structureId) : null;

      return {
        ...investor,
        user: user ? {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          isActive: user.isActive
        } : null,
        structure: structure ? {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          status: structure.status,
          baseCurrency: structure.baseCurrency,
          totalInvested: structure.totalInvested,
          currentInvestors: structure.currentInvestors,
          currentInvestments: structure.currentInvestments
        } : null
      };
    })
  );

  res.status(200).json({
    success: true,
    count: investorsWithData.length,
    data: investorsWithData
  });
}));

/**
 * @route   GET /api/investors/me/with-structures
 * @desc    Get authenticated investor's profile(s) with associated structures
 * @access  Private (requires authentication, Investor role only)
 */
router.get('/me/with-structures', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth?.userId || req.user?.id;
  const userRole = req.auth?.role ?? req.user?.role;

  // Verify user is an investor (role 3)
  validate(userRole === ROLES.INVESTOR, 'Access denied. This endpoint is only accessible to investors (role 3)');

  const user = await User.findById(userId);
  validate(user, 'User not found');

  // Find all investor records for this user
  const investors = await Investor.find({ userId });

  // If no investors found, return empty array
  if (!investors || investors.length === 0) {
    return res.status(200).json({
      success: true,
      count: 0,
      data: []
    });
  }

  // Fetch associated structure data for each investor
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const investorsWithStructures = await Promise.all(
    investors.map(async (investor) => {
      // Only fetch structure if structureId exists and is a valid UUID
      let structure = null;
      if (investor.structureId && uuidRegex.test(investor.structureId)) {
        try {
          structure = await Structure.findById(investor.structureId);
        } catch (error) {
          console.error(`Error fetching structure ${investor.structureId}:`, error.message);
          structure = null;
        }
      }

      return {
        ...investor,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          isActive: user.isActive
        },
        structure: structure ? {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          status: structure.status,
          baseCurrency: structure.baseCurrency,
          totalInvested: structure.totalInvested,
          description: structure.description,
          currentInvestors: structure.currentInvestors,
          currentInvestments: structure.currentInvestments
        } : null
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
 * @desc    Get a single investor record by ID with user data
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  // Find investor record by ID
  const investor = await Investor.findById(id);
  validate(investor, 'Investor not found');

  // Fetch associated user data
  const user = investor.userId ? await User.findById(investor.userId) : null;
  validate(user, 'Associated user not found');

  // Build response with investor and user data
  const investorWithUser = {
    ...investor,
    user: user ? {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive
    } : null
  };

  res.status(200).json({
    success: true,
    data: investorWithUser
  });
}));

/**
 * @route   GET /api/investors/:id/with-structures
 * @desc    Get investor record with user and structure data
 * @access  Private (requires authentication, Root/Admin/Support/Guest can access any, Investor can access own only)
 */
router.get('/:id/with-structures', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { userId, userRole } = getUserContext(req);

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  // First, find the investor record by ID
  const investor = await Investor.findById(id);
  validate(investor, 'Investor not found');

  // INVESTOR role can only access their own investor record
  if (userRole === ROLES.INVESTOR) {
    validate(investor.userId === userId, 'Access denied. Investor role can only access their own data.');
  }

  // Then find the associated user
  const user = investor.userId ? await User.findById(investor.userId) : null;
  validate(user, 'Associated user not found');

  // Fetch associated structure data
  const structure = investor.structureId ? await Structure.findById(investor.structureId) : null;

  // Build response with investor, user, and structure data
  const investorWithData = {
    ...investor,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive
    },
    structure: structure ? {
      id: structure.id,
      name: structure.name,
      type: structure.type,
      status: structure.status,
      baseCurrency: structure.baseCurrency,
      totalInvested: structure.totalInvested,
      description: structure.description,
      currentInvestors: structure.currentInvestors,
      currentInvestments: structure.currentInvestments
    } : null
  };

  res.status(200).json({
    success: true,
    data: investorWithData
  });
}));

/**
 * @route   GET /api/investors/:id/portfolio
 * @desc    Get investor portfolio summary
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/:id/portfolio', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  const portfolio = await User.getPortfolioSummary(id);

  res.status(200).json({
    success: true,
    data: portfolio
  });
}));

/**
 * @route   GET /api/investors/:id/commitments
 * @desc    Get investor commitments with detailed structure information
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/:id/commitments', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

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
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/me/capital-calls-summary', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth?.userId || req.user?.id;
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

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
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/me/capital-calls', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth?.userId || req.user?.id;
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

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
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 */
router.get('/:id/capital-calls/summary', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  const user = await User.findById(id);
  validate(user, 'Investor not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

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
 * @access  Private (requires authentication, Investor role only)
 */
router.get('/:id/capital-calls', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const { userRole, userId: currentUserId } = getUserContext(req);

  // Allow only INVESTOR role to access this endpoint
  validate(userRole === ROLES.INVESTOR, 'Access denied. This endpoint is only accessible to investors (role 3)');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  // Investors can only access their own data
  validate(id === currentUserId, 'Access denied. Investors can only access their own data.');

  const user = await User.findById(id);
  validate(user, 'User not found');
  validate(user.role === ROLES.INVESTOR, 'User is not an investor');

  // Get all investor records for this user
  const investors = await Investor.find({ userId: id });

  // If no investors found, return empty result
  if (!investors || investors.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        userId: user.id,
        userName: User.getDisplayName(user),
        userEmail: user.email,
        investors: [],
        summary: {
          totalCalled: 0,
          totalPaid: 0,
          outstanding: 0,
          totalCalls: 0
        },
        capitalCalls: []
      }
    });
  }

  // Fetch structures for all investor records
  const investorsWithStructures = await Promise.all(
    investors.map(async (investor) => {
      let structure = null;
      if (investor.structureId && uuidRegex.test(investor.structureId)) {
        try {
          structure = await Structure.findById(investor.structureId);
        } catch (error) {
          console.error(`Error fetching structure ${investor.structureId}:`, error.message);
        }
      }

      return {
        ...investor,
        structure: structure ? {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          status: structure.status,
          baseCurrency: structure.baseCurrency,
          totalInvested: structure.totalInvested
        } : null
      };
    })
  );

  // Get capital calls data
  const capitalCallsData = await User.getCapitalCallsSummary(id);

  res.status(200).json({
    success: true,
    data: {
      userId: user.id,
      userName: User.getDisplayName(user),
      userEmail: user.email,
      investors: investorsWithStructures,
      summary: capitalCallsData.summary || {
        totalCalled: 0,
        totalPaid: 0,
        outstanding: 0,
        totalCalls: 0
      },
      capitalCalls: capitalCallsData.capitalCalls || []
    }
  });
}));

/**
 * @route   PUT /api/investors/:id
 * @desc    Update an investor record
 * @access  Private (requires authentication, Root/Admin/Own investor)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const { id } = req.params;
  const requestingUserId = req.auth?.userId || req.user?.id;
  const requestingUserRole = req.auth?.role ?? req.user?.role;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid investor ID format');

  // Find investor record by ID
  const investor = await Investor.findById(id);
  validate(investor, 'Investor not found');

  // Fetch associated user for access control
  const user = investor.userId ? await User.findById(investor.userId) : null;
  validate(user, 'Associated user not found');

  // Check access: Root/Admin can update any, Investors can only update their own
  const hasAccess =
    requestingUserRole === ROLES.ROOT ||
    requestingUserRole === ROLES.ADMIN ||
    (requestingUserRole === ROLES.INVESTOR && requestingUserId === investor.userId);

  validate(hasAccess, 'Unauthorized access to investor data');

  const isAdmin = requestingUserRole === ROLES.ROOT || requestingUserRole === ROLES.ADMIN;

  // Check if email is being updated (investor's email in investor table)
  if (req.body.email && req.body.email !== investor.email) {
    // Validate email format
    const emailRegex = /^\S+@\S+\.\S+$/;
    validate(emailRegex.test(req.body.email), 'Invalid email format');
  }

  // Fields that only admins can update
  const adminOnlyFields = ['kycStatus', 'accreditedInvestor', 'investorType', 'structureId'];

  const updateData = {};
  const allowedFields = [
    'email', 'phoneNumber', 'country', 'taxId', 'kycStatus', 'accreditedInvestor',
    'riskTolerance', 'investmentPreferences', 'investorType', 'structureId',
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

  // Update investor record
  const updatedInvestor = await Investor.findByIdAndUpdate(id, updateData);

  // Build response with investor and user data
  const investorWithUser = {
    ...updatedInvestor,
    user: user ? {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isActive: user.isActive
    } : null
  };

  res.status(200).json({
    success: true,
    message: 'Investor updated successfully',
    data: investorWithUser
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
 * @access  Private (requires authentication, Investor role only)
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
  const userId = req.auth?.userId || req.user?.id;
  const { userRole } = getUserContext(req);
  const supabase = getSupabase();

  // Allow only INVESTOR role to access this endpoint
  validate(userRole === ROLES.INVESTOR, 'Access denied. This endpoint is only accessible to investors (role 3)');

  // Get user details
  const user = await User.findById(userId);
  validate(user, 'User not found');

  // Get all investor records for this user
  const investors = await Investor.find({ userId });

  // If no investors found, return empty dashboard
  if (!investors || investors.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        investor: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          profileImage: user.profileImage
        },
        structures: [],
        summary: {
          totalCommitment: 0,
          totalCalledCapital: 0,
          totalCurrentValue: 0,
          totalDistributed: 0,
          totalReturn: 0,
          totalReturnPercent: 0
        },
        distributions: []
      }
    });
  }

  // Fetch structures for all investor records
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const structureInvestors = await Promise.all(
    investors.map(async (investor) => {
      let structure = null;
      if (investor.structureId && uuidRegex.test(investor.structureId)) {
        try {
          structure = await Structure.findById(investor.structureId);
        } catch (error) {
          console.error(`Error fetching structure ${investor.structureId}:`, error.message);
        }
      }

      return {
        structure_id: investor.structureId,
        user_id: userId,
        structure: structure ? {
          id: structure.id,
          name: structure.name,
          type: structure.type,
          status: structure.status,
          base_currency: structure.baseCurrency,
          total_invested: structure.totalInvested
        } : null
      };
    })
  ).then(results => results.filter(r => r.structure !== null));

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
