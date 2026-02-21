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
const { User, MFAFactor, SmartContract, Notification, NotificationSettings } = require('../models/supabase');
const { getSupabase } = require('../config/database');

/**
 * Helper function to create security alert notification
 * @param {string} userId - User ID
 * @param {string} alertType - Type of security alert (mfa_enabled, mfa_disabled, password_changed)
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 */
async function createSecurityAlertNotification(userId, alertType, title, message) {
  try {
    // Check if user has security alerts enabled
    const settings = await NotificationSettings.findByUserId(userId);

    // Default to sending if no settings found or securityAlerts is enabled
    const shouldSend = !settings || settings.securityAlerts !== false;

    if (!shouldSend) {
      console.log(`[Security Alert] User ${userId} has security alerts disabled, skipping notification`);
      return;
    }

    await Notification.create({
      userId,
      notificationType: 'security_alert',
      channel: 'portal',
      title,
      message,
      priority: 'high',
      metadata: {
        alertType,
        timestamp: new Date().toISOString()
      }
    });

    console.log(`[Security Alert] Notification created for user ${userId}: ${alertType}`);
  } catch (error) {
    // Log error but don't fail the main operation
    console.error('[Security Alert] Error creating notification:', error.message);
  }
}

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

// ===== LOGIN API ENDPOINTS =====

router.post('/login', catchAsync(async (req, res) => {
  const { email, password } = req.body;

  // Validate required fields
  validate({email, password}, 'email and password are required to login');

  // Create a dedicated admin client for auth that won't affect DB queries
  const { createClient } = require('@supabase/supabase-js');
  const authClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY  // Use anon key for auth
  );

  // Authenticate with Supabase Auth using dedicated client
  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
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
  console.log('[Login] Authenticated user ID:', authData.user.id, 'Email:', authData.user.email);

  // Use service role client for DB queries (bypasses RLS)
  const serviceSupabase = getSupabase();

  // Debug: Try to query directly (without .single() to see all results)
  let directQuery = null;
  try {
    const { data, error, count } = await serviceSupabase
      .from('users')
      .select('*', { count: 'exact' })
      .eq('id', authData.user.id);

    directQuery = {
      found: data && data.length > 0,
      count: data?.length || 0,
      error: error?.message
    };
    console.log('[Login] Direct query result:', directQuery);
    if (data && data.length > 0) {
      console.log('[Login] Found users:', data.map(u => ({ id: u.id, email: u.email })));
    }
  } catch (e) {
    console.error('[Login] Direct query error:', e);
    directQuery = { found: false, error: e.message };
  }

  const user = await User.findById(authData.user.id);
  console.log('[Login] User.findById result:', user ? 'found' : 'not found');

  if (!user) {
    console.error('[Login] User exists in Auth but not in users table:', {
      authUserId: authData.user.id,
      email: authData.user.email,
      createdAt: authData.user.created_at,
      directQueryWorked: directQuery?.found
    });
    return res.status(404).json({
      success: false,
      message: 'User not found in system. Please contact administrator.',
      debug: process.env.NODE_ENV === 'development' ? {
        authUserId: authData.user.id,
        email: authData.user.email,
        hint: 'User exists in Supabase Auth but not in users table',
        directQueryWorked: directQuery?.found,
        directQueryCount: directQuery?.count,
        directQueryError: directQuery?.error
      } : undefined
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
      // Include Supabase session tokens needed for MFA challenge
      supabase: {
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
        expiresIn: authData.session.expires_in,
        expiresAt: authData.session.expires_at
      }
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
      walletAddress: user.walletAddress || null,
      mfaEnabled: !!user.mfaFactorId,
      mfaFactorId: user.mfaFactorId || null
    }
  });
}));

/**
 * @route   POST /api/custom/reset-password
 * @desc    Reset user password using Supabase access token from password recovery email
 * @access  Public
 * @body    {
 *            accessToken: string - Supabase access token from password reset email URL
 *            newPassword: string - New password (min 8 characters)
 *          }
 */
router.post('/reset-password', catchAsync(async (req, res) => {
  const { accessToken, newPassword } = req.body;

  // Validate required fields
  if (!accessToken || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Access token and new password are required'
    });
  }

  // Validate password length
  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 8 characters long'
    });
  }

  try {
    // Create Supabase client with the access token from the email
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Update password using the access token
    const { data, error } = await supabase.auth.updateUser(
      { password: newPassword },
      { accessToken: accessToken }
    );

    if (error) {
      console.error('[Reset Password] Supabase error:', error);

      // Handle specific error cases
      if (error.message?.includes('expired') || error.message?.includes('invalid')) {
        return res.status(400).json({
          success: false,
          message: 'Password reset link has expired or is invalid. Please request a new one.'
        });
      }

      return res.status(400).json({
        success: false,
        message: error.message || 'Failed to reset password'
      });
    }

    console.log('[Reset Password] Password updated successfully for user:', data.user?.id);

    return res.json({
      success: true,
      message: 'Password reset successfully',
      data: {
        userId: data.user?.id,
        email: data.user?.email
      }
    });
  } catch (error) {
    console.error('[Reset Password] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while resetting password'
    });
  }
}));

/**
 * @route   POST /api/custom/mfa/login-verify
 * @desc    Verify MFA code during login flow (public endpoint)
 * @access  Public
 * @body    {
 *            userId: string - User ID from login response
 *            code: string - 6-digit TOTP code from authenticator app
 *            supabaseAccessToken: string - Supabase access token from login response
 *            supabaseRefreshToken: string - Supabase refresh token from login response
 *          }
 */
router.post('/mfa/login-verify', catchAsync(async (req, res) => {
  const { userId, code, supabaseAccessToken, supabaseRefreshToken } = req.body;

  // Validate required fields
  if (!userId || !code) {
    return res.status(400).json({
      success: false,
      message: 'User ID and verification code are required'
    });
  }

  // Validate Supabase tokens
  if (!supabaseAccessToken || !supabaseRefreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Supabase session tokens are required for MFA verification'
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

  const factorId = user.mfaFactorId;

  try {
    // Create authenticated Supabase client with user's session
    const { createClient } = require('@supabase/supabase-js');
    const userSupabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Set the user's session
    const { data: sessionData, error: sessionError } = await userSupabase.auth.setSession({
      access_token: supabaseAccessToken,
      refresh_token: supabaseRefreshToken
    });

    if (sessionError || !sessionData.session) {
      console.error('Failed to set Supabase session:', sessionError);
      return res.status(401).json({
        success: false,
        message: 'Invalid session tokens',
        error: sessionError?.message
      });
    }

    console.log('[MFA Login Verify] Session set successfully for user:', userId);

    // Create MFA challenge with authenticated client
    const { data: challengeData, error: challengeError } = await userSupabase.auth.mfa.challenge({
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

    console.log('[MFA Login Verify] Challenge created:', challengeData.id);

    // Verify the challenge with the code
    const { data: verifyData, error: verifyError } = await userSupabase.auth.mfa.verify({
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
        walletAddress: user.walletAddress || null,
        mfaEnabled: !!user.mfaFactorId,
        mfaFactorId: user.mfaFactorId || null
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

  // IMPORTANT: Before enrolling, check if user has MFA already fully enabled
  // This prevents creating duplicate factors
  const user = await User.findById(userId);
  if (user?.mfaFactorId) {
    console.log(`[MFA Enroll] User ${userId} already has active MFA: ${user.mfaFactorId}`);
    return res.status(400).json({
      success: false,
      message: 'MFA is already enabled on this account. Please disable it first before re-enrolling.',
      error: 'MFA_ALREADY_ENABLED'
    });
  }

  // Check for any pending factors in our database and Supabase Auth
  // This handles the case where user cancelled enrollment and factor still exists
  console.log(`[MFA Enroll] Checking for existing factors for user ${userId}...`);

  // List all factors in Supabase Auth for this user
  const { data: existingFactors, error: listError } = await supabase.auth.mfa.listFactors();

  if (!listError && existingFactors && existingFactors.totp && existingFactors.totp.length > 0) {
    console.log(`[MFA Enroll] Found ${existingFactors.totp.length} existing factor(s) in Supabase Auth`);

    // Clean up each existing factor
    for (const factor of existingFactors.totp) {
      console.log(`[MFA Enroll] Cleaning up existing factor: ${factor.id}`);
      try {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({
          factorId: factor.id
        });

        if (unenrollError) {
          console.error(`[MFA Enroll] Error unenrolling factor ${factor.id}:`, unenrollError);
        } else {
          console.log(`[MFA Enroll] Successfully unenrolled factor ${factor.id}`);
        }

        // Also clean up from our database
        await MFAFactor.delete(factor.id);
      } catch (cleanupError) {
        console.error('[MFA Enroll] Error during factor cleanup:', cleanupError);
      }
    }
  }

  // Now proceed with enrollment
  console.log(`[MFA Enroll] Creating new MFA enrollment for user ${userId}`);
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

  // Save MFA factor to database with isActive: false (pending verification)
  // MFA will only be activated after user verifies their first TOTP code
  await MFAFactor.upsert({
    userId,
    factorId: data.id,
    factorType,
    friendlyName: friendlyName || 'Authenticator App',
    isActive: false, // Pending verification
    enrolledAt: new Date().toISOString()
  });

  // NOTE: We do NOT save mfaFactorId to user model yet
  // This will be done in /mfa/verify-enrollment after user verifies their first code
  // This prevents users from getting locked out if they don't complete enrollment

  res.status(200).json({
    success: true,
    message: `MFA enrollment initiated using ${factorType.toUpperCase()}. Scan the QR code with your authenticator app and enter the verification code to complete setup.`,
    info: !wasFactorTypeProvided ? 'Using default factorType: totp' : undefined,
    requiresVerification: true,
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
 * @route   POST /api/custom/mfa/verify-enrollment
 * @desc    Verify first TOTP code to complete MFA enrollment
 * @access  Private
 * @body    {
 *            factorId: string - Factor ID from enrollment
 *            code: string - 6-digit TOTP code from authenticator app
 *            supabaseAccessToken: string - Supabase access token
 *            supabaseRefreshToken: string - Supabase refresh token
 *          }
 */
router.post('/mfa/verify-enrollment', authenticate, catchAsync(async (req, res) => {
  const { id: userId } = req.user;
  const {
    factorId,
    code,
    supabaseAccessToken: bodyAccessToken,
    supabaseRefreshToken: bodyRefreshToken
  } = req.body || {};

  // Validate required fields
  if (!factorId || !code) {
    return res.status(400).json({
      success: false,
      message: 'Factor ID and verification code are required'
    });
  }

  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      success: false,
      message: 'Verification code must be 6 digits'
    });
  }

  // Get Supabase tokens
  const supabaseAccessToken = bodyAccessToken || req.headers['x-supabase-access-token'];
  const supabaseRefreshToken = bodyRefreshToken || req.headers['x-supabase-refresh-token'];

  if (!supabaseAccessToken || !supabaseRefreshToken) {
    return res.status(400).json({
      success: false,
      message: 'Supabase access and refresh tokens are required'
    });
  }

  // Verify the factor belongs to this user and is pending
  const factor = await MFAFactor.findByFactorId(factorId);
  if (!factor) {
    return res.status(404).json({
      success: false,
      message: 'MFA factor not found. Please start enrollment again.'
    });
  }

  if (factor.userId !== userId) {
    return res.status(403).json({
      success: false,
      message: 'This MFA factor does not belong to you'
    });
  }

  if (factor.isActive) {
    return res.status(400).json({
      success: false,
      message: 'MFA is already verified and active'
    });
  }

  // Create a fresh Supabase client and set the user's session
  // Using a fresh client avoids singleton state issues with the service role client
  const { createClient } = require('@supabase/supabase-js');
  const userSupabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // Debug: Log token info (first 20 chars only for security)
  console.log('[MFA Verify Enrollment] Access token prefix:', supabaseAccessToken?.substring(0, 20));
  console.log('[MFA Verify Enrollment] Token length:', supabaseAccessToken?.length);

  // Set the user's session on the fresh client
  const { data: sessionData, error: sessionError } = await userSupabase.auth.setSession({
    access_token: supabaseAccessToken,
    refresh_token: supabaseRefreshToken
  });

  if (sessionError) {
    console.error('[MFA Verify Enrollment] Session error:', sessionError);
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired session. Please login again.',
      error: sessionError.message
    });
  }

  console.log('[MFA Verify Enrollment] Session established for user:', sessionData?.user?.email);

  try {
    // Create MFA challenge using user-authenticated client
    const { data: challengeData, error: challengeError } = await userSupabase.auth.mfa.challenge({
      factorId
    });

    if (challengeError) {
      console.error('MFA challenge error during enrollment verification:', challengeError);
      return res.status(400).json({
        success: false,
        message: 'Failed to create verification challenge',
        error: challengeError.message
      });
    }

    // Verify the code
    const { data: verifyData, error: verifyError } = await userSupabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code
    });

    if (verifyError) {
      console.error('MFA verification error during enrollment:', verifyError);
      return res.status(401).json({
        success: false,
        message: 'Invalid verification code. Please check your authenticator app and try again.',
        error: verifyError.message
      });
    }

    // Verification successful - now activate MFA
    // Update MFA factor to active
    await MFAFactor.upsert({
      userId,
      factorId,
      factorType: factor.factorType,
      friendlyName: factor.friendlyName,
      isActive: true,
      enrolledAt: factor.enrolledAt
    });

    // Now save factorId to user model - MFA is officially active
    await User.findByIdAndUpdate(userId, {
      mfaFactorId: factorId
    });

    console.log(`[MFA] Enrollment verified and activated for user ${userId}`);

    // Create security alert notification for MFA enabled
    await createSecurityAlertNotification(
      userId,
      'mfa_enabled',
      'Two-Factor Authentication Enabled',
      'Two-factor authentication has been successfully enabled on your account. Your account is now more secure.'
    );

    res.status(200).json({
      success: true,
      message: 'MFA has been successfully enabled on your account',
      data: {
        factorId,
        isActive: true
      }
    });

  } catch (error) {
    console.error('Error during MFA enrollment verification:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify MFA enrollment',
      error: error.message
    });
  }
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
    // First check active factors
    const activeFactors = await MFAFactor.findByUserId(userId, true);
    const activeFactor = activeFactors.find(f => f.factorType === factorType);

    if (activeFactor) {
      factorIdToRemove = activeFactor.factorId;
    } else {
      // If no active factor, check for pending factors
      const allFactors = await MFAFactor.findByUserId(userId, false);
      const pendingFactor = allFactors.find(f => f.factorType === factorType && !f.isActive);

      if (pendingFactor) {
        console.log(`[MFA Unenroll] Found pending factor to clean up: ${pendingFactor.factorId}`);
        factorIdToRemove = pendingFactor.factorId;
      } else {
        return res.status(404).json({
          success: false,
          message: 'No MFA factor found for this user'
        });
      }
    }
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

  // Create security alert notification for MFA disabled
  await createSecurityAlertNotification(
    userId,
    'mfa_disabled',
    'Two-Factor Authentication Disabled',
    'Two-factor authentication has been removed from your account. We recommend re-enabling it for better security.'
  );

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

  // Check if user has active MFA (based on user.mfaFactorId being set)
  const hasActiveMFA = !!(user?.mfaFactorId);

  // Get all factors (both active and pending) for cleanup purposes
  const allFactors = await MFAFactor.findByUserId(userId, false); // false = all factors
  const activeFactors = allFactors.filter(f => f.isActive);
  const pendingFactors = allFactors.filter(f => !f.isActive);

  res.status(200).json({
    success: true,
    data: {
      mfaEnabled: hasActiveMFA,
      mfaFactorId: user?.mfaFactorId || null,
      factorCount: activeFactors.length,
      pendingFactorCount: pendingFactors.length,
      factors: allFactors.map(factor => ({
        id: factor.id,
        factorId: factor.factorId,
        factorType: factor.factorType,
        friendlyName: factor.friendlyName,
        isActive: factor.isActive,
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


/**
 * @route   GET /api/custom/health
 * @desc    Health check for Custom API routes
 * @access  Public
 */
/**
 * Diagnostic endpoint to check if a user exists in both Auth and users table
 */
router.get('/diagnostic/user/:email', catchAsync(async (req, res) => {
  const { email } = req.params;
  const supabase = getSupabase();

  // Check in users table by email
  const userByEmail = await User.findByEmail(email);

  // Check in Supabase Auth (admin only)
  let authUser = null;
  let authError = null;
  try {
    const { data, error } = await supabase.auth.admin.listUsers();
    if (error) {
      authError = error.message;
    } else {
      authUser = data.users.find(u => u.email === email);
    }
  } catch (error) {
    authError = error.message;
  }

  // If we found the auth user, also try finding by ID (like login does)
  let userById = null;
  if (authUser) {
    userById = await User.findById(authUser.id);
  }

  res.json({
    success: true,
    email: email,
    existsInUsersTable: !!userByEmail,
    existsInAuth: !!authUser,
    userTableData: {
      byEmail: userByEmail ? {
        id: userByEmail.id,
        email: userByEmail.email,
        role: userByEmail.role,
        isActive: userByEmail.isActive
      } : null,
      byId: userById ? {
        id: userById.id,
        email: userById.email,
        role: userById.role,
        isActive: userById.isActive
      } : null,
      idsMatch: userByEmail && userById ? userByEmail.id === userById.id : null
    },
    authData: authUser ? {
      id: authUser.id,
      email: authUser.email,
      createdAt: authUser.created_at
    } : null,
    authError: authError,
    diagnosis: !userByEmail && authUser ? 'User exists in Auth but missing from users table - THIS IS THE PROBLEM' :
               userByEmail && !authUser ? 'User exists in table but missing from Auth' :
               userByEmail && authUser && !userById ? 'User found by email but NOT by ID - ID MISMATCH ISSUE' :
               userByEmail && authUser && userById ? 'User exists in both and findById works - should work fine' :
               'User does not exist in either system',
    timestamp: new Date().toISOString()
  });
}));

/**
 * Diagnostic endpoint to check Supabase configuration
 */
router.get('/diagnostic/supabase', catchAsync(async (req, res) => {
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hasAnonKey = !!process.env.SUPABASE_ANON_KEY;
  const keyType = hasServiceKey ? 'service_role' : (hasAnonKey ? 'anon' : 'none');

  // Try to query users table
  const supabase = getSupabase();
  let canQueryUsers = false;
  let userCount = null;
  let queryError = null;

  try {
    const { data, error, count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      queryError = {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      };
    } else {
      canQueryUsers = true;
      userCount = count;
    }
  } catch (error) {
    queryError = error.message;
  }

  res.json({
    success: true,
    supabase: {
      url: process.env.SUPABASE_URL,
      keyType: keyType,
      hasServiceRoleKey: hasServiceKey,
      hasAnonKey: hasAnonKey
    },
    database: {
      canQueryUsers,
      userCount,
      error: queryError
    },
    timestamp: new Date().toISOString()
  });
}));

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