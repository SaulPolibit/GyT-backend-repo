/**
 * Custom API Routes
 * PoliBit, DiDit KYC, and Smart Contract Deployment endpoints
 */
const express = require('express');
const apiManager = require('../services/apiManager');
const { authenticate, createToken } = require('../middleware/auth');
const {
  catchAsync,
  validate,
  NotFoundError
} = require('../middleware/errorHandler');
const { User, MFAFactor } = require('../models/supabase');
const { uploadProfileImage, deleteOldProfileImage } = require('../middleware/upload');
const { getFullImageUrl } = require('../utils/helpers');
const { getSupabase } = require('../config/database');

const router = express.Router();


// ===== LOGIN API ENDPOINTS =====

router.post('/login', catchAsync(async (req, res) => {
  const { email, password } = req.body;

  // Validate required fields
  validate({email, password}, 'email and password are required to login');

  // Authenticate with Supabase Auth
  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (authError || !authData.user) {
    console.error('Supabase Auth Error:', authError);
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password',
      debug: process.env.NODE_ENV === 'development' ? authError?.message : undefined
    });
  }

  // Check if MFA is required (user exists but no session)
  if (authData.user && !authData.session) {
    return res.status(200).json({
      success: true,
      mfaRequired: true,
      message: 'MFA verification required',
      userId: authData.user.id
    });
  }

  // Check if user exists in users table
  const user = await User.findById(authData.user.id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found in system. Please contact administrator.'
    });
  }

  // Check if user is active
  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      message: 'Account has been deactivated'
    });
  }

  // Update last login
  const updatedUser = await User.findByIdAndUpdate(user.id, {
    lastLogin: new Date()
  });

  // Create JWT token with user data
  const token = createToken({
    id: user.id,
    email: user.email,
    role: user.role
  });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
    expiresIn: '24h',
    // Include Supabase session for MFA and other Supabase features
    supabase: {
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      expiresIn: authData.session.expires_in,
      expiresAt: authData.session.expires_at
    },
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      appLanguage: user.appLanguage,
      profileImage: getFullImageUrl(user.profileImage, req),
      role: user.role,
      lastLogin: updatedUser.lastLogin,
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      address: user.address,
      country: user.country
    }
  });
}));


// ===== MFA ENDPOINTS =====

/**
 * @route   POST /api/custom/mfa/enroll
 * @desc    Enroll user in MFA (generate QR code)
 * @access  Private
 * @body    {
 *            supabaseAccessToken: string - Supabase access token from login
 *            supabaseRefreshToken: string - Supabase refresh token from login
 *            factorType?: 'totp' (default) - Type of MFA (totp for authenticator apps)
 *            friendlyName?: string - Name for this MFA factor
 *          }
 */
router.post('/mfa/enroll', authenticate, catchAsync(async (req, res) => {
  const { id: userId } = req.user;
  const {
    factorType = 'totp',
    friendlyName,
    supabaseAccessToken: bodyAccessToken,
    supabaseRefreshToken: bodyRefreshToken
  } = req.body || {};

  // Get Supabase tokens from body or headers
  const supabaseAccessToken = bodyAccessToken || req.headers['x-supabase-access-token'];
  const supabaseRefreshToken = bodyRefreshToken || req.headers['x-supabase-refresh-token'];

  // Validate required Supabase tokens
  if (!supabaseAccessToken || !supabaseRefreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Supabase access and refresh tokens are required for MFA enrollment',
      hint: 'Send both supabaseAccessToken and supabaseRefreshToken in request body. Get them from login response: supabase.accessToken and supabase.refreshToken',
      note: 'These are different from your JWT Bearer token',
      missing: {
        accessToken: !supabaseAccessToken,
        refreshToken: !supabaseRefreshToken
      }
    });
  }

  // Validate factorType if provided
  const validFactorTypes = ['totp'];
  const wasFactorTypeProvided = req.body && req.body.factorType !== undefined;

  if (wasFactorTypeProvided && !validFactorTypes.includes(factorType)) {
    return res.status(400).json({
      success: false,
      message: `Invalid factorType. Supported types: ${validFactorTypes.join(', ')}. Defaults to 'totp' if not specified.`
    });
  }

  const supabase = getSupabase();

  // Set the Supabase session for MFA operations
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: supabaseAccessToken,
    refresh_token: supabaseRefreshToken
  });

  if (sessionError || !sessionData.session) {
    console.error('Session error:', sessionError);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired Supabase session',
      hint: 'Please login again to get fresh tokens',
      error: sessionError?.message || 'Session not established',
      debug: process.env.NODE_ENV === 'development' ? {
        hasAccessToken: !!supabaseAccessToken,
        hasRefreshToken: !!supabaseRefreshToken,
        sessionError: sessionError?.message
      } : undefined
    });
  }

  // Enroll in MFA with Supabase Auth
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType,
    friendlyName: friendlyName || 'Authenticator App'
  });

  if (error) {
    console.error('MFA enrollment error:', error);

    // Provide user-friendly error messages
    let userMessage = 'Failed to enroll in MFA';
    if (error.message.includes('missing sub claim')) {
      userMessage = 'Authentication session expired. Please login again to enroll in MFA.';
    } else if (error.message.includes('already enrolled')) {
      userMessage = 'You are already enrolled in MFA. Please unenroll first to re-enroll.';
    }

    return res.status(400).json({
      success: false,
      message: userMessage,
      error: error.message
    });
  }

  // Save MFA factor to database
  await MFAFactor.upsert({
    userId,
    factorId: data.id,
    factorType,
    friendlyName: friendlyName || 'Authenticator App',
    isActive: true,
    enrolledAt: new Date().toISOString()
  });

  res.status(200).json({
    success: true,
    message: `MFA enrollment initiated using ${factorType.toUpperCase()}. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.).`,
    info: !wasFactorTypeProvided ? 'Using default factorType: totp' : undefined,
    data: {
      factorId: data.id,
      factorType: factorType,
      qrCode: data.totp.qr_code, // QR code as SVG or URL
      secret: data.totp.secret, // Secret key for manual entry
      uri: data.totp.uri // otpauth:// URI
    }
  });
}));

/**
 * @route   POST /api/custom/mfa/verify
 * @desc    Verify MFA code and complete enrollment or login
 * @access  Public (for login)
 * @body    {
 *            userId: string - User ID (from login response when mfaRequired: true)
 *            code: string - 6-digit verification code from authenticator app
 *            factorType?: 'totp' - Type of MFA factor (default: 'totp')
 *          }
 */
router.post('/mfa/verify', catchAsync(async (req, res) => {
  const { userId, code, factorType = 'totp' } = req.body || {};

  // Validate required fields
  if (!userId || !code) {
    return res.status(400).json({
      success: false,
      message: 'User ID and verification code are required',
      hint: 'Get userId from login response when mfaRequired is true'
    });
  }

  // Get the user's active MFA factor from database
  const factors = await MFAFactor.findByUserId(userId, true);
  const factor = factors.find(f => f.factorType === factorType);

  if (!factor) {
    return res.status(404).json({
      success: false,
      message: 'No active MFA factor found for this user',
      hint: 'User needs to enroll in MFA first'
    });
  }

  const factorId = factor.factorId;
  const supabase = getSupabase();

  // Verify the MFA code
  const { data, error } = await supabase.auth.mfa.challenge({
    factorId
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Failed to create MFA challenge',
      error: error.message
    });
  }

  // Verify the challenge with the code
  const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: data.id,
    code
  });

  if (verifyError) {
    return res.status(400).json({
      success: false,
      message: 'Invalid verification code',
      error: verifyError.message
    });
  }

  // Update last used timestamp in our database
  try {
    await MFAFactor.updateLastUsed(factorId);
  } catch (updateError) {
    console.error('Failed to update MFA last used:', updateError);
    // Don't fail the request if this fails
  }

  // Get user details for response
  const user = await User.findById(userId);

  // Create JWT token
  const token = createToken({
    id: user.id,
    email: user.email,
    role: user.role
  });

  res.status(200).json({
    success: true,
    message: 'MFA verification successful',
    token,
    expiresIn: '24h',
    supabase: {
      accessToken: verifyData.access_token,
      refreshToken: verifyData.refresh_token,
      expiresIn: verifyData.expires_in,
      expiresAt: verifyData.expires_at
    },
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      address: user.address,
      country: user.country
    }
  });
}));

/**
 * @route   POST /api/custom/mfa/unenroll
 * @desc    Remove MFA from user account
 * @access  Private
 * @body    {
 *            supabaseAccessToken: string - Supabase access token from login
 *            supabaseRefreshToken: string - Supabase refresh token from login
 *            factorId?: string - Optional, will auto-retrieve if not provided
 *            factorType?: 'totp' - Type of MFA to remove (default: 'totp')
 *          }
 */
router.post('/mfa/unenroll', authenticate, catchAsync(async (req, res) => {
  const { id: userId } = req.user;
  const {
    factorId,
    factorType = 'totp',
    supabaseAccessToken: bodyAccessToken,
    supabaseRefreshToken: bodyRefreshToken
  } = req.body || {};

  // Get Supabase tokens from body or headers
  const supabaseAccessToken = bodyAccessToken || req.headers['x-supabase-access-token'];
  const supabaseRefreshToken = bodyRefreshToken || req.headers['x-supabase-refresh-token'];

  // Validate required Supabase tokens
  if (!supabaseAccessToken || !supabaseRefreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Supabase access and refresh tokens are required for MFA unenrollment',
      hint: 'Send both supabaseAccessToken and supabaseRefreshToken in request body',
      missing: {
        accessToken: !supabaseAccessToken,
        refreshToken: !supabaseRefreshToken
      }
    });
  }

  let factorIdToRemove = factorId;

  // If factorId not provided, get it from database based on user and type
  if (!factorIdToRemove) {
    const factors = await MFAFactor.findByUserId(userId, true); // active only
    const factor = factors.find(f => f.factorType === factorType);

    if (!factor) {
      return res.status(404).json({
        success: false,
        message: 'No active MFA factor found for this user'
      });
    }

    factorIdToRemove = factor.factorId;
  }

  const supabase = getSupabase();

  // Set the Supabase session for MFA operations
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: supabaseAccessToken,
    refresh_token: supabaseRefreshToken
  });

  if (sessionError || !sessionData.session) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired Supabase session',
      hint: 'Please login again to get fresh tokens',
      error: sessionError?.message || 'Session not established'
    });
  }

  // Unenroll from Supabase Auth
  const { data, error } = await supabase.auth.mfa.unenroll({
    factorId: factorIdToRemove
  });

  if (error) {
    console.error('MFA unenrollment error:', error);
    return res.status(400).json({
      success: false,
      message: 'Failed to unenroll from MFA',
      error: error.message
    });
  }

  // Remove from our database
  await MFAFactor.delete(factorIdToRemove);

  res.status(200).json({
    success: true,
    message: 'MFA removed successfully',
    data
  });
}));

/**
 * @route   GET /api/custom/mfa/status
 * @desc    Get user's MFA enrollment status
 * @access  Private
 */
router.get('/mfa/status', authenticate, catchAsync(async (req, res) => {
  const { id: userId } = req.user;

  // Check if user has active MFA
  const hasActiveMFA = await MFAFactor.hasActiveMFA(userId);

  // Get all active factors
  const activeFactors = await MFAFactor.findByUserId(userId, true);

  res.status(200).json({
    success: true,
    data: {
      mfaEnabled: hasActiveMFA,
      factorCount: activeFactors.length,
      factors: activeFactors.map(factor => ({
        id: factor.id,
        factorType: factor.factorType,
        friendlyName: factor.friendlyName,
        enrolledAt: factor.enrolledAt,
        lastUsedAt: factor.lastUsedAt
      }))
    }
  });
}));

/**
 * @route   GET /api/custom/mfa/factors
 * @desc    Get list of enrolled MFA factors for user
 * @access  Private
 */
router.get('/mfa/factors', authenticate, catchAsync(async (req, res) => {
  const { id: userId } = req.user;
  const { activeOnly = true } = req.query;

  // Get factors from our database
  const factors = await MFAFactor.findByUserId(userId, activeOnly === 'true');

  res.status(200).json({
    success: true,
    count: factors.length,
    data: factors
  });
}));

// Add this REGISTER route
router.post('/register', authenticate, catchAsync(async (req, res) => {
  const { email, password, firstName, lastName, role } = req.body;

  // Validate input
  if (!email || !password || !firstName) {
    return res.status(400).json({
      success: false,
      message: 'Email, password, and firstName are required'
    });
  }

  // Validate role is required
  if (role === undefined || role === null) {
    return res.status(400).json({
      success: false,
      message: 'Role is required. Must be 0 (root), 1 (admin), 2 (support), or 3 (investor)'
    });
  }

  // Validate role value
  if (role !== 0 && role !== 1 && role !== 2 && role !== 3) {
    return res.status(400).json({
      success: false,
      message: 'Invalid role. Must be 0 (root), 1 (admin), 2 (support), or 3 (investor)'
    });
  }

  // Check if user already exists in users table
  const existingUser = await User.findByEmail(email);
  if (existingUser) {
    return res.status(409).json({
      success: false,
      message: 'User with this email already exists'
    });
  }

  // Create user in Supabase Auth first
  const supabase = getSupabase();
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName || ''
      }
    }
  });

  console.log('Supabase Auth signUp response:', {
    user: authData?.user ? { id: authData.user.id, email: authData.user.email } : null,
    session: authData?.session ? 'Session created' : 'No session',
    error: authError
  });

  if (authError || !authData.user) {
    console.error('Supabase Auth registration error:', authError);
    return res.status(400).json({
      success: false,
      message: 'Failed to create user account',
      error: authError?.message
    });
  }

  // Create user in users table with the same ID from Supabase Auth
  console.log('Creating user in users table with ID:', authData.user.id);

  let user;
  try {
    user = await User.create({
      id: authData.user.id, // Use Supabase Auth user ID
      email,
      password, // This will be hashed by the User model
      firstName,
      lastName: lastName || '',
      role
    });
    console.log('User created successfully in users table:', user.id);
  } catch (createError) {
    console.error('Error creating user in users table:', createError);
    // If user creation fails, we should clean up the Supabase Auth user
    // For now, just return an error
    return res.status(500).json({
      success: false,
      message: 'Failed to create user profile',
      error: createError.message
    });
  }

  // Create token
  const token = createToken({
    id: user.id,
    email: user.email,
    role: user.role
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    token,
    expiresIn: '24h',
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      appLanguage: user.appLanguage,
      profileImage: getFullImageUrl(user.profileImage, req),
      role: user.role,
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      address: user.address,
      country: user.country
    }
  });
}));

// ===== USER PROFILE ENDPOINTS =====

/**
 * @route   GET /api/custom/user/profile
 * @desc    Get user profile information for update profile page
 * @access  Private (requires authentication)
 *
 * @success {200} Success Response
 * {
 *   "success": true,
 *   "user": {
 *     "id": "user-uuid",
 *     "profileImage": "https://storage.url/profile.jpg",
 *     "firstName": "John",
 *     "lastName": "Doe",
 *     "email": "john@example.com",
 *     "phoneNumber": "+1234567890",
 *     "appLanguage": "en"
 *   }
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 *
 * @error {404} Not Found - User not found
 * {
 *   "success": false,
 *   "message": "User not found"
 * }
 */
router.get('/user/profile', authenticate, catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Find the user
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.status(200).json({
    success: true,
    user: {
      id: user.id,
      profileImage: getFullImageUrl(user.profileImage, req),
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phoneNumber: user.phoneNumber || '',
      appLanguage: user.appLanguage || 'en'
    }
  });
}));

/**
 * @route   PUT /api/custom/user/profile
 * @desc    Update user profile information
 * @access  Private (requires authentication)
 * @body    {
 *            firstName?: string,
 *            lastName?: string,
 *            email?: string,
 *            appLanguage?: string,
 *            role?: number (0: root, 1: admin, 2: investor),
 *            newPassword?: string,
 *            oldPassword?: string (required if newPassword is provided),
 *            kycId?: string,
 *            kycStatus?: string,
 *            kycUrl?: string,
 *            address?: string,
 *            country?: string
 *          }
 */
router.put('/user/profile', authenticate, catchAsync(async (req, res) => {
  const { firstName, lastName, email, appLanguage, newPassword, oldPassword, role, kycId, kycStatus, kycUrl, address, country } = req.body;

  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Find the user
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Build update object
  const updateData = {};

  // If newPassword is provided, validate oldPassword
  if (newPassword) {
    validate(oldPassword, 'oldPassword is required when updating password');

    // Verify old password
    const isPasswordValid = await User.comparePassword(userId, oldPassword);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }

    // Add password to update (will be hashed by the model)
    updateData.password = newPassword;
  }

  // Update other fields if provided and not empty
  if (firstName !== undefined && firstName !== null && firstName.trim().length > 0) {
    updateData.firstName = firstName.trim();
  }

  if (lastName !== undefined && lastName !== null && lastName.trim().length > 0) {
    updateData.lastName = lastName.trim();
  }

  if (email !== undefined && email !== null && email.trim().length > 0) {
    const emailRegex = /^\S+@\S+\.\S+$/;
    validate(emailRegex.test(email), 'Please provide a valid email');

    // Check if email is already taken by another user
    const existingUser = await User.findByEmail(email);
    if (existingUser && existingUser.id !== userId) {
      return res.status(409).json({
        success: false,
        message: 'Email is already taken by another user'
      });
    }

    updateData.email = email.toLowerCase().trim();
  }

  // Validate role if being updated
  if (role !== undefined && role !== null) {
    // Validate role value
    if (role !== 0 && role !== 1 && role !== 2 && role !== 3) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be 0 (root), 1 (admin), 2 (support), or 3 (investor)'
      });
    }
    updateData.role = role;
  }

  if (appLanguage !== undefined) {
    const validLanguages = ['en', 'es', 'fr', 'de', 'pt', 'it'];
    validate(validLanguages.includes(appLanguage), `appLanguage must be one of: ${validLanguages.join(', ')}`);
    updateData.appLanguage = appLanguage;
  }

  // Update KYC and location fields if provided (all optional, skip empty strings)
  if (kycId !== undefined && kycId !== null && kycId !== '') {
    updateData.kycId = kycId;
  }

  if (kycStatus !== undefined && kycStatus !== null && kycStatus !== '') {
    updateData.kycStatus = kycStatus;
  }

  if (kycUrl !== undefined && kycUrl !== null && kycUrl !== '') {
    updateData.kycUrl = kycUrl;
  }

  if (address !== undefined && address !== null && address !== '') {
    updateData.address = address;
  }

  if (country !== undefined && country !== null && country !== '') {
    updateData.country = country;
  }

  // Update user in database
  const updatedUser = await User.findByIdAndUpdate(userId, updateData);

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      appLanguage: updatedUser.appLanguage,
      profileImage: getFullImageUrl(updatedUser.profileImage, req),
      role: updatedUser.role,
      kycId: updatedUser.kycId,
      kycStatus: updatedUser.kycStatus,
      kycUrl: updatedUser.kycUrl,
      address: updatedUser.address,
      country: updatedUser.country
    }
  });
}));

// ===== PROFILE IMAGE UPLOAD ENDPOINT =====

/**
 * @route   POST /api/custom/user/profile-image
 * @desc    Upload user profile image
 * @access  Private (requires authentication)
 * @body    FormData with 'profileImage' file field
 */
router.post('/user/profile-image', authenticate, uploadProfileImage.single('profileImage'), catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Check if file was uploaded
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded. Please provide an image file.'
    });
  }

  // Find the user
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Delete old profile image if exists
  if (user.profileImage) {
    deleteOldProfileImage(user.profileImage);
  }

  // Save new profile image path (relative path)
  const imagePath = `/uploads/profiles/${req.file.filename}`;

  const updatedUser = await User.findByIdAndUpdate(userId, {
    profileImage: imagePath
  });

  res.status(200).json({
    success: true,
    message: 'Profile image uploaded successfully',
    data: {
      profileImage: getFullImageUrl(updatedUser.profileImage, req),
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    }
  });
}));

/**
 * @route   DELETE /api/custom/user/profile-image
 * @desc    Delete user profile image
 * @access  Private (requires authentication)
 */
router.delete('/user/profile-image', authenticate, catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Find the user
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  if (!user.profileImage) {
    return res.status(404).json({
      success: false,
      message: 'No profile image to delete'
    });
  }

  // Delete the image file
  deleteOldProfileImage(user.profileImage);

  // Remove from database
  await User.findByIdAndUpdate(userId, {
    profileImage: null
  });

  res.status(200).json({
    success: true,
    message: 'Profile image deleted successfully'
  });
}));

// ===== POLIBIT API ENDPOINTS =====

/**
 * @route   POST /api/custom/polibit/entities
 * @desc    Get sell side entities from PoliBit
 * @access  Public
 * @body    {
 *            totalInvestment?: number,
 *            aPITokenDS?: string (optional, uses env if not provided)
 *          }
 */
router.post('/polibit/entities', authenticate, catchAsync(async (req, res) => {
  const context = { auth: req.auth };
  const result = await apiManager.getPoliBitSellSideEntities(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch PoliBit entities',
      details: result.body,
    });
  }

  // Parse GraphQL response
  const entities = result.body?.data?.getSellSideEntities || [];

  res.status(result.statusCode || 200).json({
    success: true,
    count: entities.length,
    data: entities,
  });
}));

/**
 * @route   GET /api/custom/polibit/entities
 * @desc    Get sell side entities (GET method)
 * @access  Public
 * @query   aPITokenDS?: string
 */
router.get('/polibit/entities', authenticate, catchAsync(async (req, res) => {
  const context = { auth: req.auth };
  const result = await apiManager.getPoliBitSellSideEntities(context, req.query);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch PoliBit entities',
      details: result.body,
    });
  }

  const entities = result.body?.data?.getSellSideEntities || [];

  res.status(result.statusCode || 200).json({
    success: true,
    count: entities.length,
    data: entities,
  });
}));

/**
 * @route   GET /api/custom/polibit/entities/:entityId
 * @desc    Get specific PoliBit entity (placeholder - filter from list)
 * @access  Public
 * @params  entityId - The entity ID
 */
router.get('/polibit/entities/:entityId', authenticate, catchAsync(async (req, res) => {
  const { entityId } = req.params;

  validate(entityId, 'entityId is required');

  const context = { auth: req.auth };
  const result = await apiManager.getPoliBitSellSideEntities(context, req.query);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch PoliBit entity',
    });
  }

  const entities = result.body?.data?.getSellSideEntities || [];
  const entity = entities.find(e => e.ID === parseInt(entityId));

  if (!entity) {
    throw new NotFoundError(`Entity with ID ${entityId} not found`);
  }

  res.status(200).json({
    success: true,
    data: entity,
  });
}));

// ===== DIDIT KYC API =====

/**
 * @route   POST /api/custom/didit/token
 * @desc    Get DiDit authentication token
 * @access  Public
 * @body    {} (uses env credentials)
 */
router.post('/didit/token', authenticate, catchAsync(async (req, res) => {
  const context = { auth: req.auth };
  const result = await apiManager.getDiditToken(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to get DiDit token',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    message: 'Token generated successfully',
    data: result.body,
  });
}));

/**
 * @route   POST /api/custom/didit/session
 * @desc    Create a new DiDit KYC verification session or retrieve existing one
 * @access  Private (requires authentication)
 * @body    {
 *            callback?: string (optional, default: from env or https://cdmxhomes.polibit.io/marketplace),
 *            features?: string (optional, default: from env or "OCR + FACE"),
 *            vendorData?: string (optional, default: from env or "CDMXHomes")
 *          }
 */
router.post('/didit/session', authenticate, catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Find the user to check if they already have a KYC session
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  const context = { auth: req.auth };

  // Get DiDit authentication token
  const tokenResult = await apiManager.getDiditToken(context, {});

  if (tokenResult.error) {
    return res.status(tokenResult.statusCode || 500).json({
      error: 'Failed to get DiDit authentication token',
      details: tokenResult.error,
    });
  }

  const token = tokenResult.body.access_token;

  // If user already has a kyc_id, retrieve the existing session
  if (user.kycId) {
    const variables = {
      sessionID: user.kycId,
      token
    };

    const result = await apiManager.getDiditSession(context, variables);

    if (result.error) {
      return res.status(result.statusCode || 500).json({
        error: result.error,
        message: 'Failed to retrieve existing DiDit session',
        details: result.body,
      });
    }

    // Update user's kycStatus with the latest status from DiDit
    const sessionData = result.body;
    if (sessionData.status) {
      await User.findByIdAndUpdate(userId, {
        kycStatus: sessionData.status
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Existing KYC session retrieved',
      existingSession: true,
      data: sessionData,
    });
  }

  // No existing session, create a new one
  const result = await apiManager.createDiditSession(context, {
    token,
    ...req.body
  });

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to create DiDit session',
      details: result.body,
    });
  }

  // Save session data to user profile
  const sessionData = result.body;
  await User.findByIdAndUpdate(userId, {
    kycId: sessionData.session_id,
    kycStatus: sessionData.status,
    kycUrl: sessionData.url
  });

  res.status(result.statusCode || 201).json({
    success: true,
    message: 'KYC session created successfully',
    existingSession: false,
    data: sessionData,
  });
}));

/**
 * @route   GET /api/custom/didit/session/:sessionId
 * @desc    Get DiDit session decision/status
 * @access  Private (requires authentication)
 * @params  sessionId - The DiDit session ID
 */
router.get('/didit/session/:sessionId', authenticate, catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;
  const { sessionId } = req.params;

  validate(sessionId, 'sessionId is required');

  const context = { auth: req.auth };

  // Get DiDit authentication token
  const tokenResult = await apiManager.getDiditToken(context, {});

  if (tokenResult.error) {
    return res.status(tokenResult.statusCode || 500).json({
      error: 'Failed to get DiDit authentication token',
      details: tokenResult.error,
    });
  }

  const token = tokenResult.body.access_token;

  const variables = {
    sessionID: sessionId,
    token
  };

  const result = await apiManager.getDiditSession(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`DiDit session with ID ${sessionId} not found`);
    }

    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch DiDit session',
      details: result.body,
    });
  }

  // Update user's kycStatus with the latest status from DiDit
  const sessionData = result.body;
  if (sessionData.status) {
    await User.findByIdAndUpdate(userId, {
      kycStatus: sessionData.status
    });
  }

  return res.status(200).json({
    success: true,
    message: 'Existing KYC session retrieved',
    sessionId,
    data: sessionData,
  });
}));

/**
 * @route   GET /api/custom/didit/session/:sessionId/pdf
 * @desc    Get DiDit session PDF report
 * @access  Public
 * @params  sessionId - The DiDit session ID
 * @query   token: string (required - DiDit auth token)
 */
router.get('/didit/session/:sessionId/pdf', authenticate, catchAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { token } = req.query;

  validate(sessionId, 'sessionId is required');
  validate(token, 'DiDit token is required');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query, 
    sessionID: sessionId,
    token 
  };

  const result = await apiManager.getDiditPDF(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`PDF for session ${sessionId} not found`);
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch DiDit PDF',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    sessionId,
    data: result.body,
  });
}));

/**
 * @route   POST /api/custom/didit/verify
 * @desc    Complete DiDit KYC verification flow (token + session + decision)
 * @access  Public
 * @body    {
 *            callback?: string,
 *            features?: string,
 *            vendorData?: string
 *          }
 */
router.post('/didit/verify', authenticate, catchAsync(async (req, res) => {
  const context = { auth: req.auth };

  // Step 1: Get token
  const tokenResult = await apiManager.getDiditToken(context, {});
  
  if (tokenResult.error) {
    return res.status(tokenResult.statusCode || 500).json({
      error: 'Failed to get authentication token',
      details: tokenResult.error,
    });
  }

  const token = tokenResult.body.access_token;

  // Step 2: Create session
  const sessionResult = await apiManager.createDiditSession(context, { 
    token,
    ...req.body 
  });

  if (sessionResult.error) {
    return res.status(sessionResult.statusCode || 500).json({
      error: 'Failed to create verification session',
      details: sessionResult.error,
    });
  }

  const sessionData = sessionResult.body;

  res.status(201).json({
    success: true,
    message: 'KYC verification session created',
    data: {
      sessionId: sessionData.session_id,
      verificationUrl: sessionData.url,
      token: token,
      expiresIn: tokenResult.body.expires_in,
    },
  });
}));

// ===== SMART CONTRACT DEPLOYMENT =====

/**
 * @route   GET /api/custom/deploy/erc20
 * @desc    Deploy an ERC20 token contract
 * @access  Public
 * @query   {
 *            authToken: string (required),
 *            contractTokenName: string (required),
 *            contractTokenSymbol: string (required),
 *            contractTokenValue: number (required),
 *            contractMaxTokens: number (required),
 *            company: string (required),
 *            currency: string (required)
 *          }
 */
router.get('/deploy/erc20', authenticate, catchAsync(async (req, res) => {
  const { 
    authToken, 
    contractTokenName, 
    contractTokenSymbol, 
    contractTokenValue, 
    contractMaxTokens, 
    company, 
    currency 
  } = req.query;

  // Validate required fields
  validate(authToken, 'authToken is required');
  validate(contractTokenName, 'contractTokenName is required');
  validate(contractTokenSymbol, 'contractTokenSymbol is required');
  validate(contractTokenValue, 'contractTokenValue is required');
  validate(contractMaxTokens, 'contractMaxTokens is required');
  validate(company, 'company is required');
  validate(currency, 'currency is required');

  // Validate numeric fields
  const tokenValue = parseFloat(contractTokenValue);
  const maxTokens = parseFloat(contractMaxTokens);

  validate(!isNaN(tokenValue) && tokenValue > 0, 'contractTokenValue must be a positive number');
  validate(!isNaN(maxTokens) && maxTokens > 0, 'contractMaxTokens must be a positive number');

  const context = { auth: req.auth };
  const result = await apiManager.deployContractERC20(context, req.query);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to deploy ERC20 contract',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    message: 'ERC20 contract deployment initiated',
    contractType: 'ERC20',
    data: result.body,
  });
}));

/**
 * @route   POST /api/custom/deploy/erc20
 * @desc    Deploy an ERC20 token contract (POST method)
 * @access  Public
 * @body    Same as GET query parameters
 */
router.post('/deploy/erc20', authenticate, catchAsync(async (req, res) => {
  const { 
    authToken, 
    contractTokenName, 
    contractTokenSymbol, 
    contractTokenValue, 
    contractMaxTokens, 
    company, 
    currency 
  } = req.body;

  // Validate required fields
  validate(authToken, 'authToken is required');
  validate(contractTokenName, 'contractTokenName is required');
  validate(contractTokenSymbol, 'contractTokenSymbol is required');
  validate(contractTokenValue, 'contractTokenValue is required');
  validate(contractMaxTokens, 'contractMaxTokens is required');
  validate(company, 'company is required');
  validate(currency, 'currency is required');

  const context = { auth: req.auth };
  const result = await apiManager.deployContractERC20(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to deploy ERC20 contract',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    message: 'ERC20 contract deployment initiated',
    contractType: 'ERC20',
    data: result.body,
  });
}));

/**
 * @route   GET /api/custom/health
 * @desc    Health check for Custom API routes
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({
    service: 'Custom APIs',
    services: {
      polibit: 'operational',
      didit: 'operational',
      contractDeployment: 'operational',
    },
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;