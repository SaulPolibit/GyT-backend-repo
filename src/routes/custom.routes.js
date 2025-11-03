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
const User = require('../models/user');
const { uploadProfileImage, deleteOldProfileImage } = require('../middleware/upload');
const { getFullImageUrl } = require('../utils/helpers');

const router = express.Router();


// ===== LOGIN API ENDPOINTS =====

router.post('/login', catchAsync(async (req, res) => {
  const { email, password } = req.body;

  // payload is required and should be an object with the data to encode in the token
  validate({email, password}, 'email and password are required to create a token');

  const user = await User.findByEmail(email);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // Check if user is active
  if (!user.isActive) {
    return res.status(403).json({
      success: false,
      message: 'Account has been deactivated'
    });
  }

  // Verify password
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Create token with user data (don't include password!)
  const token = createToken({
    id: user._id,
    email: user.email,
    role: user.role
  });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    token,
    expiresIn: '24h',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      appLanguage: user.appLanguage,
      profileImage: getFullImageUrl(user.profileImage, req),
      role: user.role,
      lastLogin: user.lastLogin
    }
  });
}));


// Add this REGISTER route
router.post('/register', authenticate, catchAsync(async (req, res) => {
  const { email, password, firstName, lastName } = req.body;

  // Validate input
  if (!email || !password || !firstName) {
    return res.status(400).json({
      success: false,
      message: 'Email, password, and firstName are required'
    });
  }

  // Check if user already exists
  // const existingUser = await User.findByEmail(email);
  // if (existingUser) {
  //   return res.status(409).json({
  //     success: false,
  //     message: 'User with this email already exists'
  //   });
  // }

  // Create new user (password will be hashed automatically)
  const user = new User({
    email,
    password,
    firstName,
    lastName: lastName || '',
    role: 'user'
  });

  await user.save();

  // Create token
  const token = createToken({
    id: user._id,
    email: user.email,
    role: user.role
  });

  res.status(201).json({
    success: true,
    message: 'User registered successfully',
    token,
    expiresIn: '24h',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      appLanguage: user.appLanguage,
      profileImage: getFullImageUrl(user.profileImage, req),
      role: user.role
    }
  });
}));

// ===== UPDATE USER ENDPOINT =====

/**
 * @route   PUT /api/custom/user/profile
 * @desc    Update user profile information
 * @access  Private (requires authentication)
 * @body    {
 *            firstName?: string,
 *            lastName?: string,
 *            email?: string,
 *            appLanguage?: string,
 *            newPassword?: string,
 *            oldPassword?: string (required if newPassword is provided)
 *          }
 */
router.put('/user/profile', authenticate, catchAsync(async (req, res) => {
  const { firstName, lastName, email, appLanguage, newPassword, oldPassword } = req.body;

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

  // If newPassword is provided, validate oldPassword
  if (newPassword) {
    validate(oldPassword, 'oldPassword is required when updating password');

    // Verify old password
    const isPasswordValid = await user.comparePassword(oldPassword);
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

    // Update password (will be hashed by the pre-save hook)
    user.password = newPassword;
  }

  // Update other fields if provided
  if (firstName !== undefined) {
    validate(firstName.trim().length > 0, 'firstName cannot be empty');
    user.firstName = firstName.trim();
  }

  if (lastName !== undefined) {
    user.lastName = lastName.trim();
  }

  if (email !== undefined) {
    validate(email.trim().length > 0, 'email cannot be empty');
    const emailRegex = /^\S+@\S+\.\S+$/;
    validate(emailRegex.test(email), 'Please provide a valid email');

    // Check if email is already taken by another user
    const existingUser = await User.findByEmail(email);
    if (existingUser && existingUser._id.toString() !== userId) {
      return res.status(409).json({
        success: false,
        message: 'Email is already taken by another user'
      });
    }

    user.email = email.toLowerCase().trim();
  }

  if (appLanguage !== undefined) {
    const validLanguages = ['en', 'es', 'fr', 'de', 'pt', 'it'];
    validate(validLanguages.includes(appLanguage), `appLanguage must be one of: ${validLanguages.join(', ')}`);
    user.appLanguage = appLanguage;
  }

  // Save updated user
  await user.save();

  res.status(200).json({
    success: true,
    message: 'Profile updated successfully',
    user: {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      appLanguage: user.appLanguage,
      profileImage: getFullImageUrl(user.profileImage, req),
      role: user.role
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
  user.profileImage = imagePath;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Profile image uploaded successfully',
    data: {
      profileImage: getFullImageUrl(user.profileImage, req),
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
  user.profileImage = null;
  await user.save();

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
 * @desc    Create a new DiDit KYC verification session
 * @access  Public
 * @body    {
 *            token: string (required - DiDit auth token),
 *            callback?: string (optional, default: https://cdmxhomes.polibit.io/marketplace),
 *            features?: string (optional, default: "OCR + FACE"),
 *            vendorData?: string (optional, default: "CDMXHomes")
 *          }
 */
router.post('/didit/session', authenticate, catchAsync(async (req, res) => {
  const { token } = req.body;

  validate(token, 'DiDit token is required');

  const context = { auth: req.auth };
  const result = await apiManager.createDiditSession(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to create DiDit session',
      details: result.body,
    });
  }

  res.status(result.statusCode || 201).json({
    success: true,
    message: 'KYC session created successfully',
    data: result.body,
  });
}));

/**
 * @route   GET /api/custom/didit/session/:sessionId
 * @desc    Get DiDit session decision/status
 * @access  Public
 * @params  sessionId - The DiDit session ID
 * @query   token: string (required - DiDit auth token)
 */
router.get('/didit/session/:sessionId', authenticate, catchAsync(async (req, res) => {
  const { sessionId } = req.params;
  const { token } = req.query;

  validate(sessionId, 'sessionId is required');
  validate(token, 'DiDit token is required in query parameters');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query, 
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

  res.status(result.statusCode || 200).json({
    success: true,
    sessionId,
    data: result.body,
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
 * @route   GET /api/custom/deploy/erc3643
 * @desc    Deploy an ERC3643 security token contract
 * @access  Public
 * @query   {
 *            authToken: string (required),
 *            contractTokenName: string (required),
 *            contractTokenSymbol: string (required),
 *            contractTokenValue: number (required),
 *            contractMaxTokens: number (required),
 *            company: string (required),
 *            currency: string (required),
 *            projectName: string (required)
 *          }
 */
router.get('/deploy/erc3643', authenticate, catchAsync(async (req, res) => {
  const {
    contractTokenName,
    contractTokenSymbol,
    contractTokenValue,
    contractMaxTokens,
    company,
    currency,
    projectName
  } = req.query;

  // Validate required fields
  validate(contractTokenName, 'contractTokenName is required');
  validate(contractTokenSymbol, 'contractTokenSymbol is required');
  validate(contractTokenValue, 'contractTokenValue is required');
  validate(contractMaxTokens, 'contractMaxTokens is required');
  validate(company, 'company is required');
  validate(currency, 'currency is required');
  validate(projectName, 'projectName is required');

  // Validate numeric fields
  const tokenValue = parseFloat(contractTokenValue);
  const maxTokens = parseFloat(contractMaxTokens);

  validate(!isNaN(tokenValue) && tokenValue > 0, 'contractTokenValue must be a positive number');
  validate(!isNaN(maxTokens) && maxTokens > 0, 'contractMaxTokens must be a positive number');

  const context = { auth: req.auth };
  const result = await apiManager.deployContractERC3643(context, req.query);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to deploy ERC3643 contract',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    message: 'ERC3643 contract deployment initiated',
    contractType: 'ERC3643',
    data: result.body,
  });
}));

/**
 * @route   POST /api/custom/deploy/erc3643
 * @desc    Deploy an ERC3643 security token contract (POST method)
 * @access  Public
 * @body    Same as GET query parameters
 */
router.post('/deploy/erc3643', authenticate, catchAsync(async (req, res) => {
  const { 
    authToken, 
    contractTokenName, 
    contractTokenSymbol, 
    contractTokenValue, 
    contractMaxTokens, 
    company, 
    currency,
    projectName 
  } = req.body;

  // Validate required fields
  validate(authToken, 'authToken is required');
  validate(contractTokenName, 'contractTokenName is required');
  validate(contractTokenSymbol, 'contractTokenSymbol is required');
  validate(contractTokenValue, 'contractTokenValue is required');
  validate(contractMaxTokens, 'contractMaxTokens is required');
  validate(company, 'company is required');
  validate(currency, 'currency is required');
  validate(projectName, 'projectName is required');

  const context = { auth: req.auth };
  const result = await apiManager.deployContractERC3643(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to deploy ERC3643 contract',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    message: 'ERC3643 contract deployment initiated',
    contractType: 'ERC3643',
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