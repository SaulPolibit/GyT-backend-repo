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
const { User, MFAFactor, SmartContract } = require('../models/supabase');
const { getSupabase } = require('../config/database');

const router = express.Router();

// ===== HELPER FUNCTIONS =====

/**
 * Helper to ensure request body is parsed (for Vercel compatibility)
 * Vercel sometimes doesn't parse the body automatically
 */
const ensureBodyParsed = (req) => {
  return new Promise((resolve, reject) => {
    // If body is already parsed AND has content, return it
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
      console.log('[Body Parser] Body already parsed:', Object.keys(req.body));
      return resolve(req.body);
    }

    console.log('[Body Parser] Body not parsed or empty, reading raw body...');

    // Otherwise, manually parse the raw body
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        req.body = data ? JSON.parse(data) : {};
        console.log('[Body Parser] Parsed body:', Object.keys(req.body));
        resolve(req.body);
      } catch (error) {
        console.error('[Body Parser] Failed to parse body:', error);
        req.body = {};
        resolve({});
      }
    });
    req.on('error', (error) => {
      console.error('[Body Parser] Error reading body:', error);
      req.body = {};
      resolve({});
    });
  });
};

/**
 * Derive a deterministic Supabase password from prosperaId
 * This allows Prospera OAuth users to have Supabase Auth accounts for MFA
 * The password is derived (not stored) and can be recreated anytime
 * @param {string} prosperaId - User's Prospera ID
 * @returns {string} Derived password
 */
const deriveSupabasePassword = (prosperaId) => {
  const crypto = require('crypto');
  const secret = process.env.SUPABASE_USER_SECRET || 'default-secret-change-in-production';

  if (!process.env.SUPABASE_USER_SECRET) {
    console.warn('[Supabase Auth] WARNING: SUPABASE_USER_SECRET not set, using default. Set this in production!');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(prosperaId)
    .digest('hex');
};

/**
 * Create or sign in a Supabase Auth user for Prospera OAuth users
 * This enables MFA functionality for Prospera users
 * @param {Object} supabase - Supabase client
 * @param {string} email - User's email
 * @param {string} prosperaId - User's Prospera ID
 * @returns {Object} { session, user, error }
 */
const getOrCreateSupabaseAuthUser = async (supabase, email, prosperaId) => {
  const password = deriveSupabasePassword(prosperaId);

  // First, try to sign in (user might already exist)
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (signInData?.session) {
    console.log('[Supabase Auth] Signed in existing user:', email);
    return { session: signInData.session, user: signInData.user, error: null };
  }

  // If sign in failed, try to create the user
  console.log('[Supabase Auth] User not found or wrong password, creating new user...');

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: undefined, // No email confirmation needed
      data: {
        prospera_id: prosperaId,
        created_via: 'prospera_oauth'
      }
    }
  });

  if (signUpError) {
    // If user already exists but password is wrong, this is an edge case
    // The user might have been created with a different password
    console.error('[Supabase Auth] Sign up error:', signUpError.message);
    return { session: null, user: null, error: signUpError };
  }

  // If sign up requires email confirmation, sign in immediately
  if (signUpData?.user && !signUpData?.session) {
    // User created but needs confirmation - try admin approach or sign in
    console.log('[Supabase Auth] User created, attempting sign in...');
    const { data: newSignIn, error: newSignInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (newSignIn?.session) {
      return { session: newSignIn.session, user: newSignIn.user, error: null };
    }

    // If still can't sign in, return what we have
    return { session: signUpData.session, user: signUpData.user, error: newSignInError };
  }

  console.log('[Supabase Auth] Created new user:', email);
  return { session: signUpData.session, user: signUpData.user, error: null };
};

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

  // Check if user has MFA enabled
  if (user.mfaFactorId) {
    return res.status(401).json({
      success: false,
      mfaRequired: true,
      message: 'MFA verification required.',
      userId: user.id,
      factorId: user.mfaFactorId,
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
      phoneNumber: user.phoneNumber,
      appLanguage: user.appLanguage,
      profileImage: user.profileImage,
      role: user.role,
      lastLogin: updatedUser.lastLogin,
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      address: user.address,
      country: user.country,
      walletAddress: user.walletAddress || null
    }
  });
}));

/**
 * @route   POST /api/custom/mfa/login-verify
 * @desc    Verify MFA code during login flow (public endpoint)
 * @access  Public
 * @body    {
 *            userId: string - User ID from login response
 *            code: string - 6-digit TOTP code from authenticator app
 *          }
 */
router.post('/mfa/login-verify', catchAsync(async (req, res) => {
  const { userId, code } = req.body;

  // Validate required fields
  if (!userId || !code) {
    return res.status(400).json({
      success: false,
      message: 'User ID and verification code are required'
    });
  }

  // Get user from database
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Check if user is active
  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      message: 'Account has been deactivated'
    });
  }

  // Check if user has MFA enabled
  if (!user.mfaFactorId) {
    return res.status(400).json({
      success: false,
      message: 'MFA is not enabled for this user'
    });
  }

  const supabase = getSupabase();
  const factorId = user.mfaFactorId;

  try {
    // Create MFA challenge
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId
    });

    if (challengeError) {
      console.error('MFA challenge error:', challengeError);
      return res.status(400).json({
        success: false,
        message: 'Failed to create MFA challenge',
        error: challengeError.message
      });
    }

    // Verify the challenge with the code
    const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code
    });

    if (verifyError) {
      console.error('MFA verification error:', verifyError);
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code',
        error: verifyError.message
      });
    }

    // Update last used timestamp
    try {
      await MFAFactor.updateLastUsed(factorId);
    } catch (updateError) {
      console.error('Failed to update MFA last used:', updateError);
      // Don't fail the request if this fails
    }

    // Update last login
    const updatedUser = await User.findByIdAndUpdate(user.id, {
      lastLogin: new Date()
    });

    // Create JWT token
    const token = createToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    // Return success response with token and user data (same as login)
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
        phoneNumber: user.phoneNumber,
        appLanguage: user.appLanguage,
        profileImage: user.profileImage,
        role: user.role,
        lastLogin: updatedUser.lastLogin,
        kycId: user.kycId,
        kycStatus: user.kycStatus,
        kycUrl: user.kycUrl,
        address: user.address,
        country: user.country,
        walletAddress: user.walletAddress || null
      }
    });
  } catch (error) {
    console.error('MFA login verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred during MFA verification',
      error: error.message
    });
  }
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

  // Save factorId to user model
  await User.findByIdAndUpdate(userId, {
    mfaFactorId: data.id
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

  // Clear mfaFactorId from user model
  await User.findByIdAndUpdate(userId, {
    mfaFactorId: null
  });

  res.status(200).json({
    success: true,
    message: 'MFA removed successfully',
    data
  });
}));

/**
 * @route   GET /api/custom/mfa/enabled
 * @desc    Check if user has MFA enabled (simple boolean check)
 * @access  Private
 * @returns {boolean} enabled - True if user has MFA enabled
 */
router.get('/mfa/enabled', authenticate, catchAsync(async (req, res) => {
  const { id: userId } = req.user;

  // Get user from database
  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Check if user has mfaFactorId
  const mfaEnabled = !!(user.mfaFactorId);

  res.status(200).json({
    success: true,
    enabled: mfaEnabled,
    mfaFactorId: mfaEnabled ? user.mfaFactorId : null
  });
}));

/**
 * @route   GET /api/custom/mfa/status
 * @desc    Get user's MFA enrollment status (detailed)
 * @access  Private
 */
router.get('/mfa/status', authenticate, catchAsync(async (req, res) => {
  const { id: userId } = req.user;

  // Get user from database
  const user = await User.findById(userId);

  // Check if user has active MFA
  const hasActiveMFA = await MFAFactor.hasActiveMFA(userId);

  // Get all active factors
  const activeFactors = await MFAFactor.findByUserId(userId, true);

  res.status(200).json({
    success: true,
    data: {
      mfaEnabled: hasActiveMFA,
      mfaFactorId: user?.mfaFactorId || null,
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

/**
  * @route   POST /api/custom/mfa/challenge
  * @desc    Create MFA challenge for current session (to achieve AAL2)
  * @access  Private
  * @body    {
  *            supabaseAccessToken: string
  *            supabaseRefreshToken: string
  *            factorId?: string - Optional, will auto-retrieve if not provided
  *          }
  */
 router.post('/mfa/challenge', authenticate, catchAsync(async (req, res) => {
   const { id: userId } = req.user;
   const {
     factorId,
     supabaseAccessToken: bodyAccessToken,
     supabaseRefreshToken: bodyRefreshToken
   } = req.body || {};

   const supabaseAccessToken = bodyAccessToken || req.headers['x-supabase-access-token'];
   const supabaseRefreshToken = bodyRefreshToken || req.headers['x-supabase-refresh-token'];

   if (!supabaseAccessToken || !supabaseRefreshToken) {
     return res.status(400).json({
       success: false,
       message: 'Supabase tokens are required'
     });
   }

   let factorIdToUse = factorId;

   // Auto-retrieve factorId if not provided
   if (!factorIdToUse) {
     const factors = await MFAFactor.findByUserId(userId, true);
     if (factors.length === 0) {
       return res.status(404).json({
         success: false,
         message: 'No active MFA factor found'
       });
     }
     factorIdToUse = factors[0].factorId;
   }

   const supabase = getSupabase();

   // Set session
   const { error: sessionError } = await supabase.auth.setSession({
     access_token: supabaseAccessToken,
     refresh_token: supabaseRefreshToken
   });

   if (sessionError) {
     return res.status(401).json({
       success: false,
       message: 'Invalid session'
     });
   }

   // Create challenge
   const { data, error } = await supabase.auth.mfa.challenge({
     factorId: factorIdToUse
   });

   if (error) {
     return res.status(400).json({
       success: false,
       message: 'Failed to create MFA challenge',
       error: error.message
     });
   }

  res.status(200).json({
    success: true,
    data: {
      challengeId: data.id,
      factorId: factorIdToUse,
      expiresAt: data.expires_at
    }
  });
}));

/**
 * @route   POST /api/custom/mfa/verify
 * @desc    Verify MFA challenge to achieve AAL2
 * @access  Private
 * @body    {
 *            supabaseAccessToken: string
 *            supabaseRefreshToken: string
 *            factorId: string
 *            challengeId: string
 *            code: string - 6-digit TOTP code
 *          }
 */
router.post('/mfa/verify', authenticate, catchAsync(async (req, res) => {
  const {
    factorId,
    challengeId,
    code,
    supabaseAccessToken: bodyAccessToken,
    supabaseRefreshToken: bodyRefreshToken
  } = req.body || {};

   if (!factorId || !challengeId || !code) {
     return res.status(400).json({
       success: false,
       message: 'factorId, challengeId, and code are required'
     });
   }

  const supabaseAccessToken = bodyAccessToken || req.headers['x-supabase-access-token'];
  const supabaseRefreshToken = bodyRefreshToken || req.headers['x-supabase-refresh-token'];

  if (!supabaseAccessToken || !supabaseRefreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Supabase tokens are required'
    });
  }

  const supabase = getSupabase();

  // Set session
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: supabaseAccessToken,
    refresh_token: supabaseRefreshToken
  });

  if (sessionError) {
    return res.status(401).json({
      success: false,
      message: 'Invalid session'
    });
  }

  // Verify challenge
  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId,
    code
  });

  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid verification code',
      error: error.message
    });
  }

  // Update last used
  try {
    await MFAFactor.updateLastUsed(factorId);
  } catch (e) {
    console.error('Failed to update MFA last used:', e);
  }

  res.status(200).json({
    success: true,
    message: 'MFA verified successfully - AAL2 achieved',
    data: {
      aal: 'aal2' // Authenticator Assurance Level 2
    }
  });
}));

// ===== DIDIT KYC API =====

/**
 * @route   POST /api/custom/didit/session
 * @desc    Create a new DiDit KYC verification session or retrieve existing one
 * @access  Private (requires authentication)
 * @body    {
 *            callback?: string (optional, default: from env or https://cdmxhomes.polibit.io/marketplace),
 *            workflowId?: string (optional, default: from env DIDIT_WORKFLOW_ID),
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

  // If user already has a kyc_id, retrieve the existing session
  if (user.kycId) {
    const variables = {
      sessionID: user.kycId
    };

    const result = await apiManager.getDiditSession(context, variables);

    // Check if session is valid and not expired
    if (!result.error && result.body && result.body.status) {
      // Valid session - update kycStatus and return
      const sessionData = result.body;
      await User.findByIdAndUpdate(userId, {
        kycStatus: sessionData.status
      });

      console.log('[DiDit] Existing KYC session retrieved successfully');
      return res.status(200).json({
        success: true,
        message: 'Existing KYC session retrieved',
        existingSession: true,
        data: sessionData,
      });
    }

    // Session is expired, invalid, or error occurred - create new session
    console.log('[DiDit] Existing session invalid/expired, creating new session');
    console.log('[DiDit] Previous session error:', result.error || 'No valid status returned');
  }

  // No existing session OR expired session - create a new one
  const hadPreviousSession = !!user.kycId;

  const result = await apiManager.createDiditSession(context, {
    ...req.body
  });

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to create DiDit session',
      details: result.body,
    });
  }

  // Save session data to user profile (including new kycUrl for renewed sessions)
  const sessionData = result.body;
  await User.findByIdAndUpdate(userId, {
    kycId: sessionData.session_id,
    kycStatus: sessionData.status,
    kycUrl: sessionData.url
  });

  console.log(`[DiDit] KYC session ${hadPreviousSession ? 'renewed' : 'created'} successfully`);
  console.log(`[DiDit] New session ID: ${sessionData.session_id}`);

  res.status(result.statusCode || 201).json({
    success: true,
    message: hadPreviousSession
      ? 'Expired KYC session replaced with new one'
      : 'KYC session created successfully',
    existingSession: false,
    sessionRenewed: hadPreviousSession,
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
  const variables = {
    sessionID: sessionId
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
 */
router.get('/didit/session/:sessionId/pdf', authenticate, catchAsync(async (req, res) => {
  const { sessionId } = req.params;

  validate(sessionId, 'sessionId is required');

  const context = { auth: req.auth };
  const variables = {
    ...req.query,
    sessionID: sessionId
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
 * @desc    Complete DiDit KYC verification flow (create session)
 * @access  Public
 * @body    {
 *            callback?: string,
 *            workflowId?: string,
 *            vendorData?: string
 *          }
 */
router.post('/didit/verify', authenticate, catchAsync(async (req, res) => {
  const context = { auth: req.auth };

  // Create session
  const sessionResult = await apiManager.createDiditSession(context, {
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
      workflowId: sessionData.workflow_id,
    },
  });
}));

// ===== PROSPERA OAUTH ENDPOINTS =====

const prospera = require('../services/prospera.service');
const crossmint = require('../services/crossmint.service');

// Helper function to ensure Prospera is initialized (lazy initialization for serverless)
async function ensureProsperapInitialized() {
  if (!prospera.isReady()) {
    console.log('[Prospera] Service not ready, initializing...');
    const success = await prospera.initialize();
    if (!success) {
      throw new Error('Failed to initialize Prospera OAuth service');
    }
  }
  return true;
}

// Helper function to ensure Crossmint is initialized (lazy initialization for serverless)
async function ensureCrossmintInitialized() {
  if (!crossmint.isReady()) {
    console.log('[Crossmint] Service not ready, initializing...');
    const success = await crossmint.initialize();
    if (!success) {
      throw new Error('Failed to initialize Crossmint service');
    }
  }
  return true;
}

/**
 * @route   POST /api/custom/prospera/auth-url
 * @desc    Get Prospera OAuth authorization URL with PKCE
 * @access  Public
 * @response {
 *   success: boolean
 *   authUrl: string - URL to redirect user to
 *   codeVerifier: string - PKCE code verifier (store temporarily)
 * }
 */
router.post('/prospera/auth-url', catchAsync(async (req, res) => {
  // Ensure body is parsed (for Vercel compatibility)
  await ensureBodyParsed(req);

  const { redirectUri } = req.body || {};

  console.log('[Prospera] Generating authorization URL...');
  console.log('[Prospera] Request body:', req.body);
  if (redirectUri) {
    console.log('[Prospera] Requested redirect URI:', redirectUri);
  }

  // Ensure Prospera is initialized (lazy initialization)
  try {
    await ensureProsperapInitialized();
  } catch (error) {
    console.error('[Prospera] Initialization failed:', error.message);
    return res.status(503).json({
      success: false,
      message: 'Prospera OAuth service is not available. Please check server configuration.',
      error: error.message
    });
  }

  // Generate OAuth authorization URL with PKCE
  // Pass redirectUri to ensure correct redirect when multiple URIs are registered
  const { authUrl, codeVerifier, nonce } = prospera.generateAuthUrl(redirectUri);

  console.log('[Prospera] ✓ Authorization URL generated');

  res.status(200).json({
    success: true,
    authUrl,
    codeVerifier, // Frontend needs to store this temporarily
    nonce, // Frontend needs to store this for callback validation
  });
}));

/**
 * @route   POST /api/custom/prospera/callback
 * @desc    Handle Prospera OAuth callback and create/login user
 * @access  Public
 * @body    {
 *   code: string - Authorization code from OAuth callback
 *   codeVerifier: string - PKCE code verifier from auth-url request
 * }
 * @response {
 *   success: boolean
 *   message: string
 *   token: string - JWT token
 *   prospera: { accessToken, refreshToken, expiresAt }
 *   user: { ... } - User object
 * }
 */
router.post('/prospera/callback', catchAsync(async (req, res) => {
  // Ensure body is parsed (for Vercel compatibility)
  await ensureBodyParsed(req);

  const { code, codeVerifier, nonce, redirectUri } = req.body;

  // Validate required fields
  validate({ code, codeVerifier, nonce }, 'code, codeVerifier, and nonce are required');

  console.log('[Prospera Callback] Exchanging authorization code...');
  console.log('[Prospera Callback] Redirect URI:', redirectUri);

  // Ensure Prospera is initialized (lazy initialization)
  try {
    await ensureProsperapInitialized();
  } catch (error) {
    console.error('[Prospera] Initialization failed:', error.message);
    return res.status(503).json({
      success: false,
      message: 'Prospera OAuth service is not available',
      error: error.message
    });
  }

  // Exchange code for tokens and user info
  // Must use the same redirectUri that was used in the auth request
  const prosperapData = await prospera.exchangeCode(code, codeVerifier, nonce, redirectUri);

  console.log('[Prospera Callback] ✓ Token exchange successful');
  console.log('[Prospera Callback] User email:', prosperapData.user.email);

  // Verify user is an active Próspera resident
  let userProfile = null; // Declare outside try block so it's accessible later
  try {
    console.log('[Prospera Callback] Fetching user profile to get RPN...');

    // Get user's Próspera profile including RPN
    userProfile = await prospera.getUserProfile(prosperapData.accessToken);

    // DEBUG: Log full profile to see all available fields (country, entity type, etc.)
    console.log('[Prospera Callback] Full user profile:', JSON.stringify(userProfile, null, 2));

    // Extract RPN from profile (field name may vary - adjust based on actual API response)
    const rpn = userProfile.rpn || userProfile.resident_permit_number || userProfile.residentPermitNumber;

    if (!rpn) {
      console.warn('[Prospera Callback] No RPN found in user profile');
      return res.status(403).json({
        success: false,
        message: 'Access restricted to Próspera residents only',
        redirectUrl: process.env.EPROSPERA_ISSUER_URL === 'https://portal.eprospera.com'
          ? 'https://portal.eprospera.com/en/login?returnTo=%2F'
          : 'https://staging-portal.eprospera.com/en/login?returnTo=%2F'
      });
    }

    console.log('[Prospera Callback] RPN found, verifying residency status...');

    // Verify RPN is active using API key from environment
    const verification = await prospera.verifyRPN(rpn);

    // Check if user is an active resident
    const isActiveResident = verification.active === true &&
                             (verification.result === 'found_natural_person' ||
                              verification.result === 'found_legal_entity');

    if (!isActiveResident) {
      console.log('[Prospera Callback] User is not an active Próspera resident');
      console.log('[Prospera Callback] Verification result:', verification);

      return res.status(403).json({
        success: false,
        message: 'Access restricted to active Próspera residents only. Please ensure your Próspera residency is active.',
        redirectUrl: process.env.EPROSPERA_ISSUER_URL === 'https://portal.eprospera.com'
          ? 'https://portal.eprospera.com/en/login?returnTo=%2F'
          : 'https://staging-portal.eprospera.com/en/login?returnTo=%2F',
        details: {
          result: verification.result,
          active: verification.active
        }
      });
    }

    console.log('[Prospera Callback] ✓ User verified as active Próspera resident');
  } catch (verificationError) {
    console.error('[Prospera Callback] RPN verification failed:', verificationError.message);

    // Strict mode: Block login on any verification error
    return res.status(500).json({
      success: false,
      message: 'Unable to verify Próspera residency status. Please try again later or contact support.',
      error: verificationError.message,
      redirectUrl: process.env.EPROSPERA_ISSUER_URL === 'https://portal.eprospera.com'
        ? 'https://portal.eprospera.com/en/login?returnTo=%2F'
        : 'https://staging-portal.eprospera.com/en/login?returnTo=%2F'
    });
  }

  // Check if user exists by email or Prospera ID
  let user = await User.findOne({ email: prosperapData.user.email });

  if (!user) {
    // Check by Prospera ID in case email changed
    user = await User.findByProsperapId(prosperapData.user.prosperaId);
  }

  if (!user) {
    // New user - needs to accept terms before account creation
    console.log('[Prospera Callback] New user detected - terms acceptance required');

    return res.status(200).json({
      success: true,
      requiresTermsAcceptance: true,
      message: 'Please accept the terms and conditions to continue',
      userData: {
        email: prosperapData.user.email,
        name: prosperapData.user.name,
        prosperaId: prosperapData.user.prosperaId,
        picture: prosperapData.user.picture,
        emailVerified: prosperapData.user.emailVerified,
        // Include Prospera profile data for registration
        givenName: userProfile.givenName,
        surname: userProfile.surname,
        countryOfBirth: userProfile.countryOfBirth,
        citizenships: userProfile.citizenships,
        dateOfBirth: userProfile.dateOfBirth,
        sex: userProfile.sex,
        phoneNumber: userProfile.phoneNumber,
        address: userProfile.address,
        entityType: 'individual', // natural-person endpoint = individual
      },
      // Store these securely for the completion step
      sessionData: {
        accessToken: prosperapData.accessToken,
        refreshToken: prosperapData.refreshToken,
        expiresAt: prosperapData.expiresAt
      }
    });
  }

  // Existing user - update and proceed with login
  console.log('[Prospera Callback] Existing user - updating and proceeding with login...');

  user = await User.findByIdAndUpdate(
    user.id,
    {
      prosperaId: prosperapData.user.prosperaId,
      profileImage: prosperapData.user.picture || user.profileImage,
      lastLogin: new Date(),
      isEmailVerified: prosperapData.user.emailVerified || user.isEmailVerified,
    },
    { new: true } // Return the updated document
  );

  console.log('[Prospera Callback] ✓ User updated');

  // Create or retrieve Crossmint wallet for the user
  let walletData = null;
  try {
    // Ensure Crossmint is initialized (lazy initialization)
    await ensureCrossmintInitialized();

    console.log('[Prospera Callback] Creating/retrieving Crossmint wallet...');

    walletData = await crossmint.getOrCreateWallet({
      email: user.email,
      userId: user.id,
    });

    console.log('[Prospera Callback] ✓ Wallet ready:', walletData.walletAddress);

    // Update user with wallet address if new or changed
    if (user.walletAddress !== walletData.walletAddress) {
      user = await User.findByIdAndUpdate(
        user.id,
        { walletAddress: walletData.walletAddress },
        { new: true } // Return the updated document
      );
      console.log('[Prospera Callback] ✓ Wallet address saved to user profile');
    }
  } catch (walletError) {
    // Log wallet error but don't fail the login
    console.error('[Prospera Callback] Wallet creation failed:', walletError.message);
    console.error('[Prospera Callback] Continuing with login without wallet...');
  }

  // Check if user is active
  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      message: 'Account has been deactivated'
    });
  }

  // Sign into Supabase Auth for MFA functionality
  let supabaseSession = null;
  try {
    console.log('[Prospera Callback] Signing into Supabase Auth for MFA...');
    const supabase = getSupabase();
    const { session, error: supabaseError } = await getOrCreateSupabaseAuthUser(
      supabase,
      user.email,
      user.prosperaId
    );

    if (supabaseError) {
      console.error('[Prospera Callback] Supabase Auth error:', supabaseError.message);
    } else if (session) {
      supabaseSession = session;
      console.log('[Prospera Callback] ✓ Supabase Auth session ready');
    }
  } catch (supabaseAuthError) {
    console.error('[Prospera Callback] Supabase Auth failed:', supabaseAuthError.message);
  }

  // Check if user has MFA enabled
  if (user.mfaFactorId) {
    console.log('[Prospera Callback] MFA required for user:', user.email);
    return res.status(200).json({
      success: true,
      mfaRequired: true,
      message: 'MFA verification required.',
      factorId: user.mfaFactorId,
      // Include user info needed for MFA verification
      userId: user.id,
      userEmail: user.email,
      // Include Prospera tokens for after MFA verification
      prospera: {
        accessToken: prosperapData.accessToken,
        refreshToken: prosperapData.refreshToken,
        expiresAt: prosperapData.expiresAt,
      },
      // Include Supabase tokens for MFA verification
      supabase: supabaseSession ? {
        accessToken: supabaseSession.access_token,
        refreshToken: supabaseSession.refresh_token,
        expiresIn: supabaseSession.expires_in,
        expiresAt: supabaseSession.expires_at
      } : null,
    });
  }

  // Create JWT token (same format as regular login)
  const token = createToken({
    id: user.id,
    email: user.email,
    role: user.role
  });

  console.log('[Prospera Callback] ✓ Login successful for user:', user.email);

  res.status(200).json({
    success: true,
    message: 'Prospera login successful',
    token,
    expiresIn: '24h',
    // Include Prospera tokens for potential future use
    prospera: {
      accessToken: prosperapData.accessToken,
      refreshToken: prosperapData.refreshToken,
      expiresAt: prosperapData.expiresAt,
    },
    // Include Supabase tokens for MFA functionality
    supabase: supabaseSession ? {
      accessToken: supabaseSession.access_token,
      refreshToken: supabaseSession.refresh_token,
      expiresIn: supabaseSession.expires_in,
      expiresAt: supabaseSession.expires_at
    } : null,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      appLanguage: user.appLanguage,
      profileImage: user.profileImage,
      role: user.role,
      lastLogin: user.lastLogin,
      prosperaId: user.prosperaId,
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      address: user.addressLine1,
      country: user.country,
      walletAddress: user.walletAddress,
    }
  });
}));

/**
 * @route   POST /api/custom/prospera/complete-registration
 * @desc    Complete Próspera user registration after terms acceptance
 * @access  Public
 * @body    {
 *   userData: { email, name, prosperaId, picture, emailVerified }
 *   sessionData: { accessToken, refreshToken, expiresAt }
 *   termsAccepted: boolean
 * }
 */
router.post('/prospera/complete-registration', catchAsync(async (req, res) => {
  const { userData, sessionData, termsAccepted } = req.body;

  // Validate required fields
  validate({ userData, sessionData, termsAccepted }, 'userData, sessionData, and termsAccepted are required');

  if (!termsAccepted) {
    return res.status(400).json({
      success: false,
      message: 'Terms and conditions must be accepted to create an account'
    });
  }

  console.log('[Prospera Registration] Completing registration for:', userData.email);

  // Check if user already exists (shouldn't happen, but safety check)
  let user = await User.findOne({ email: userData.email });

  if (user) {
    return res.status(409).json({
      success: false,
      message: 'User already exists. Please log in instead.'
    });
  }

  // Create new investor user
  console.log('[Prospera Registration] Creating new user...');

  // Use Prospera profile data for names (more accurate than splitting full name)
  const firstName = userData.givenName || (userData.name || 'Prospera User').split(' ')[0];
  const lastName = userData.surname || (userData.name || '').split(' ').slice(1).join(' ');

  // Determine country: prefer address.country, fallback to countryOfBirth
  const country = userData.address?.country || userData.countryOfBirth || null;

  user = await User.create({
    email: userData.email,
    firstName: firstName || '',
    lastName: lastName || '',
    profileImage: userData.picture,
    role: 3, // Investor role (ROLES.INVESTOR)
    prosperaId: userData.prosperaId,
    kycStatus: 'Pending', // Will need to complete KYC
    isActive: true,
    isEmailVerified: userData.emailVerified || false,
    appLanguage: 'en',
    lastLogin: new Date(),
    // New fields from Prospera profile
    phoneNumber: userData.phoneNumber || null,
    country: country,
    countryOfBirth: userData.countryOfBirth || null,
    citizenships: userData.citizenships || [],
    dateOfBirth: userData.dateOfBirth || null,
    sex: userData.sex || null,
    addressLine1: userData.address?.line1 || null,
    addressLine2: userData.address?.line2 || null,
    city: userData.address?.city || null,
    state: userData.address?.state || null,
    postalCode: userData.address?.postalCode || null,
    entityType: userData.entityType || 'individual',
  });

  console.log('[Prospera Registration] ✓ New user created:', user.id);

  // Create or retrieve Crossmint wallet for the user
  let walletData = null;
  try {
    // Ensure Crossmint is initialized (lazy initialization)
    await ensureCrossmintInitialized();

    console.log('[Prospera Registration] Creating Crossmint wallet...');

    walletData = await crossmint.getOrCreateWallet({
      email: user.email,
      userId: user.id,
    });

    console.log('[Prospera Registration] ✓ Wallet ready:', walletData.walletAddress);

    // Update user with wallet address
    user = await User.findByIdAndUpdate(
      user.id,
      { walletAddress: walletData.walletAddress },
      { new: true } // Return the updated document
    );
    console.log('[Prospera Registration] ✓ Wallet address saved to user profile');
  } catch (walletError) {
    // Log wallet error but don't fail the registration
    console.error('[Prospera Registration] Wallet creation failed:', walletError.message);
    console.error('[Prospera Registration] Continuing with registration without wallet...');
  }

  // Create Supabase Auth user for MFA functionality
  let supabaseSession = null;
  try {
    console.log('[Prospera Registration] Creating Supabase Auth user for MFA...');
    const supabase = getSupabase();
    const { session, error: supabaseError } = await getOrCreateSupabaseAuthUser(
      supabase,
      user.email,
      userData.prosperaId
    );

    if (supabaseError) {
      console.error('[Prospera Registration] Supabase Auth error:', supabaseError.message);
      console.error('[Prospera Registration] MFA will not be available for this user');
    } else if (session) {
      supabaseSession = session;
      console.log('[Prospera Registration] ✓ Supabase Auth user ready for MFA');
    }
  } catch (supabaseAuthError) {
    console.error('[Prospera Registration] Supabase Auth creation failed:', supabaseAuthError.message);
    console.error('[Prospera Registration] MFA will not be available for this user');
  }

  // Create JWT token (same format as regular login)
  const token = createToken({
    id: user.id,
    email: user.email,
    role: user.role
  });

  console.log('[Prospera Registration] ✓ Registration complete for user:', user.email);

  res.status(201).json({
    success: true,
    message: 'Registration completed successfully',
    token,
    expiresIn: '24h',
    // Include Prospera tokens for potential future use
    prospera: {
      accessToken: sessionData.accessToken,
      refreshToken: sessionData.refreshToken,
      expiresAt: sessionData.expiresAt,
    },
    // Include Supabase tokens for MFA functionality
    supabase: supabaseSession ? {
      accessToken: supabaseSession.access_token,
      refreshToken: supabaseSession.refresh_token,
      expiresIn: supabaseSession.expires_in,
      expiresAt: supabaseSession.expires_at
    } : null,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      appLanguage: user.appLanguage,
      profileImage: user.profileImage,
      role: user.role,
      lastLogin: user.lastLogin,
      prosperaId: user.prosperaId,
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      address: user.addressLine1,
      country: user.country,
      walletAddress: user.walletAddress,
    }
  });
}));

/**
 * @route   POST /api/custom/prospera/link-wallet
 * @desc    Link Próspera wallet to existing user (for Investment Manager)
 * @access  Private (requires auth token)
 */
router.post('/prospera/link-wallet', authenticate, catchAsync(async (req, res) => {
  // Log body BEFORE ensureBodyParsed
  console.log('[Prospera Link Wallet] ==========================================');
  console.log('[Prospera Link Wallet] BODY PARSING DEBUG');
  console.log('[Prospera Link Wallet] - req.body before parsing:', req.body);
  console.log('[Prospera Link Wallet] - typeof req.body:', typeof req.body);
  console.log('[Prospera Link Wallet] - Object.keys(req.body):', req.body ? Object.keys(req.body) : 'null/undefined');
  console.log('[Prospera Link Wallet] ==========================================');

  // Ensure body is parsed (for Vercel compatibility)
  await ensureBodyParsed(req);

  // Log body AFTER ensureBodyParsed
  console.log('[Prospera Link Wallet] ==========================================');
  console.log('[Prospera Link Wallet] AFTER PARSING DEBUG');
  console.log('[Prospera Link Wallet] - req.body after parsing:', req.body);
  console.log('[Prospera Link Wallet] - Object.keys(req.body):', req.body ? Object.keys(req.body) : 'null/undefined');
  console.log('[Prospera Link Wallet] ==========================================');

  const { code, codeVerifier, nonce, redirectUri } = req.body;

  // Validate required fields
  validate({ code, codeVerifier, nonce }, 'code, codeVerifier, and nonce are required');

  console.log('[Prospera Link Wallet] Starting wallet link process for user:', req.user.email);
  console.log('[Prospera Link Wallet] Redirect URI:', redirectUri);
  console.log('[Prospera Link Wallet] Extracted values:');
  console.log('[Prospera Link Wallet] - code:', code ? 'present' : 'MISSING');
  console.log('[Prospera Link Wallet] - codeVerifier:', codeVerifier ? 'present' : 'MISSING');
  console.log('[Prospera Link Wallet] - nonce:', nonce ? 'present' : 'MISSING');
  console.log('[Prospera Link Wallet] - redirectUri:', redirectUri || 'UNDEFINED');

  try {
    // Exchange authorization code for tokens
    // Must use the same redirectUri that was used in the auth request
    const prosperapData = await prospera.exchangeCode(code, codeVerifier, nonce, redirectUri);

    console.log('[Prospera Link Wallet] ✓ OAuth tokens obtained');

    // Get the authenticated user (from JWT token)
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user already has a wallet
    if (user.walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'User already has a wallet linked',
        walletAddress: user.walletAddress
      });
    }

    // Update user with Próspera ID if not already set
    if (!user.prosperaId) {
      await User.findByIdAndUpdate(
        user.id,
        { prosperaId: prosperapData.user.prosperaId },
        { new: true }
      );
      console.log('[Prospera Link Wallet] ✓ Próspera ID linked to user');
    }

    // Create or retrieve Crossmint wallet
    let walletData = null;
    try {
      await ensureCrossmintInitialized();

      console.log('[Prospera Link Wallet] Creating/retrieving Crossmint wallet...');

      walletData = await crossmint.getOrCreateWallet({
        email: user.email,
        userId: user.id,
      });

      console.log('[Prospera Link Wallet] ✓ Wallet ready:', walletData.walletAddress);

      // Update user with wallet address
      const updatedUser = await User.findByIdAndUpdate(
        user.id,
        { walletAddress: walletData.walletAddress },
        { new: true }
      );

      console.log('[Prospera Link Wallet] ✓ Wallet address saved to user profile');

      return res.status(200).json({
        success: true,
        message: 'Wallet linked successfully',
        walletAddress: updatedUser.walletAddress,
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          walletAddress: updatedUser.walletAddress,
          prosperaId: updatedUser.prosperaId,
        }
      });

    } catch (walletError) {
      console.error('[Prospera Link Wallet] Wallet creation failed:', walletError.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to create wallet',
        error: walletError.message
      });
    }

  } catch (error) {
    console.error('[Prospera Link Wallet] Error:', error.message);
    console.error('[Prospera Link Wallet] DEBUG - redirectUri received:', redirectUri);
    console.error('[Prospera Link Wallet] DEBUG - FRONTEND_URL:', process.env.FRONTEND_URL);
    return res.status(500).json({
      success: false,
      message: 'Failed to link Próspera wallet',
      error: error.message,
      debug: {
        redirectUriReceived: redirectUri,
        frontendUrl: process.env.FRONTEND_URL,
        expectedRedirectUri: `${process.env.FRONTEND_URL}/investment-manager/account`
      }
    });
  }
}));

// ===== WALLET BALANCES ENDPOINT =====

/**
 * @route   GET /api/custom/wallet/balances
 * @desc    Get token balances for authenticated user's wallet
 * @access  Private
 */
router.get('/wallet/balances', authenticate, catchAsync(async (req, res) => {
  // Ensure Crossmint is initialized (for serverless environments)
  await ensureCrossmintInitialized();

  const user = await User.findById(req.auth.userId);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  if (!user.walletAddress) {
    return res.status(200).json({
      success: true,
      data: {
        balances: [],
        message: 'No wallet found for user'
      }
    });
  }

  // Build dynamic token list
  // Base tokens supported on polygon-amoy
  const baseTokens = ['pol', 'matic', 'usdc'];

  // Query all smart contracts with deployed addresses
  const contracts = await SmartContract.find({});
  const customTokens = contracts
    .filter(contract => contract.contractAddress && contract.contractAddress.trim())
    .map(contract => `polygon-amoy:${contract.contractAddress.trim()}`);

  // Combine base tokens with custom contract tokens
  const allTokens = [...baseTokens, ...customTokens];
  const tokensParam = allTokens.join(',');

  console.log('[Wallet Balances] Querying tokens:', tokensParam);

  // For non-custodial wallets, use wallet address directly as walletLocator
  const balances = await crossmint.getWalletBalances(
    user.walletAddress,
    tokensParam,
    'polygon-amoy'
  );

  res.status(200).json({
    success: true,
    data: {
      walletAddress: user.walletAddress,
      balances: balances || [],
      chain: 'polygon-amoy',
      queriedTokens: allTokens
    }
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
      prospera: prospera.isReady() ? 'operational' : 'unavailable',
    },
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;