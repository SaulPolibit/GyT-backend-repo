/**
 * User API Routes
 * Endpoints for managing users
 */
const express = require('express');
const { authenticate, createToken } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { User } = require('../models/supabase');
const { requireRootAccess, ROLES, getUserContext } = require('../middleware/rbac');
const { getSupabase } = require('../config/database');
const { uploadProfileImage } = require('../middleware/upload');
const { uploadToSupabase, deleteFromSupabase } = require('../utils/fileUpload');

const router = express.Router();

/**
 * @route   POST /api/users/register
 * @desc    Register a new user
 * @access  Private (requires authentication, ROOT only)
 */
router.post('/register', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { email, password, firstName, lastName, role } = req.body;

  // Only ROOT role can create users
  if (userRole !== ROLES.ROOT) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only ROOT users can create new users'
    });
  }

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
      message: 'Role is required. Must be 0 (root), 1 (admin), 2 (support), 3 (investor), or 4 (guest)'
    });
  }

  // Validate role value
  if (role !== 0 && role !== 1 && role !== 2 && role !== 3 && role !== 4) {
    return res.status(400).json({
      success: false,
      message: 'Invalid role. Must be 0 (root), 1 (admin), 2 (support), 3 (investor), or 4 (guest)'
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

  // If user already exists in Supabase Auth, try to get their ID and create users table entry
  if (authError && authError.message === 'User already registered') {
    console.log('User exists in Supabase Auth but not in users table, attempting to sync...');

    // Use service role to get the user by email
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Get user by email from Supabase Auth
    const { data: { users }, error: getUserError } = await adminClient.auth.admin.listUsers();

    if (getUserError) {
      console.error('Error getting user from Supabase Auth:', getUserError);
      return res.status(500).json({
        success: false,
        message: 'Failed to sync user account',
        error: getUserError.message
      });
    }

    const authUser = users.find(u => u.email === email);

    if (!authUser) {
      return res.status(400).json({
        success: false,
        message: 'User registration state is inconsistent. Please contact support.',
        error: 'User exists in Auth but cannot be retrieved'
      });
    }

    // Update password in Supabase Auth to match the new password
    const { error: updatePasswordError } = await adminClient.auth.admin.updateUserById(
      authUser.id,
      { password: password }
    );

    if (updatePasswordError) {
      console.error('Error updating password in Supabase Auth:', updatePasswordError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update password during sync',
        error: updatePasswordError.message
      });
    }

    console.log('Password updated in Supabase Auth for user:', authUser.id);

    // Create user in users table with existing Auth ID
    let user;
    try {
      user = await User.create({
        id: authUser.id,
        email,
        password,
        firstName,
        lastName: lastName || '',
        role
      });
      console.log('User synced successfully in users table:', user.id);

      // Create token
      const token = createToken({
        id: user.id,
        email: user.email,
        role: user.role
      });

      return res.status(201).json({
        success: true,
        message: 'User account synced and registered successfully',
        token,
        expiresIn: '24h',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          appLanguage: user.appLanguage,
          profileImage: user.profileImage,
          role: user.role,
          kycId: user.kycId,
          kycStatus: user.kycStatus,
          kycUrl: user.kycUrl,
          address: user.address,
          country: user.country
        }
      });
    } catch (createError) {
      console.error('Error creating user in users table during sync:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to sync user profile',
        error: createError.message
      });
    }
  }

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
      profileImage: user.profileImage,
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
 * @route   GET /api/users/profile
 * @desc    Get user profile information
 * @access  Private (requires authentication)
 */
router.get('/profile', authenticate, catchAsync(async (req, res) => {
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
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      appLanguage: user.appLanguage,
      profileImage: user.profileImage,
      role: user.role,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      phoneNumber: user.phoneNumber,
      // KYC fields
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      // Address fields
      address: user.address,
      country: user.country,
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      city: user.city,
      state: user.state,
      postalCode: user.postalCode,
      // Investor fields
      investorType: user.investorType,
      taxId: user.taxId,
      accreditedInvestor: user.accreditedInvestor,
      riskTolerance: user.riskTolerance,
      investmentPreferences: user.investmentPreferences,
      // Individual investor fields
      fullName: user.fullName,
      dateOfBirth: user.dateOfBirth,
      nationality: user.nationality,
      passportNumber: user.passportNumber,
      // Institution investor fields
      institutionName: user.institutionName,
      institutionType: user.institutionType,
      registrationNumber: user.registrationNumber,
      legalRepresentative: user.legalRepresentative,
      // Fund of Funds investor fields
      fundName: user.fundName,
      fundManager: user.fundManager,
      aum: user.aum,
      // Family Office investor fields
      officeName: user.officeName,
      familyName: user.familyName,
      principalContact: user.principalContact,
      assetsUnderManagement: user.assetsUnderManagement,
      // Blockchain wallet
      walletAddress: user.walletAddress,
    }
  });
}));

/**
 * @route   PUT /api/users/profile
 * @desc    Update user profile information
 * @access  Private (requires authentication)
 */
router.put('/profile', authenticate, catchAsync(async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    appLanguage,
    newPassword,
    oldPassword,
    role,
    address,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    phoneNumber,
    // Investor fields
    investorType,
    taxId,
    accreditedInvestor,
    riskTolerance,
    investmentPreferences,
    // Individual investor fields
    fullName,
    dateOfBirth,
    nationality,
    passportNumber,
    // Institution investor fields
    institutionName,
    institutionType,
    registrationNumber,
    legalRepresentative,
    // Fund of Funds investor fields
    fundName,
    fundManager,
    aum,
    // Family Office investor fields
    officeName,
    familyName,
    principalContact,
    assetsUnderManagement
  } = req.body;

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

    // Check if new password is the same as old password
    if (newPassword === oldPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    // Verify old password using Supabase Auth
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Create client for password verification
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: user.email,
      password: oldPassword
    });

    if (authError || !authData.user) {
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

    // Update password using service role key to bypass MFA requirement
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { error: updateAuthError } = await adminClient.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateAuthError) {
      console.error('Supabase Auth password update error:', updateAuthError);
      return res.status(500).json({
        success: false,
        message: 'Failed to update password in authentication system',
        debug: process.env.NODE_ENV === 'development' ? updateAuthError.message : undefined
      });
    }

    // Also update in users table for backward compatibility
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
    if (role !== 0 && role !== 1 && role !== 2 && role !== 3 && role !== 4) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be 0 (root), 1 (admin), 2 (support), 3 (investor), or 4 (guest)'
      });
    }
    updateData.role = role;
  }

  if (appLanguage !== undefined) {
    const validLanguages = ['en', 'es', 'fr', 'de', 'pt', 'it'];
    validate(validLanguages.includes(appLanguage), `appLanguage must be one of: ${validLanguages.join(', ')}`);
    updateData.appLanguage = appLanguage;
  }

  if (address !== undefined && address !== null && address !== '') {
    updateData.address = address;
  }

  if (country !== undefined && country !== null && country !== '') {
    updateData.country = country;
  }

  if (phoneNumber !== undefined && phoneNumber !== null && phoneNumber !== '') {
    updateData.phoneNumber = phoneNumber;
  }

  // Address fields
  if (addressLine1 !== undefined && addressLine1 !== null && addressLine1 !== '') {
    updateData.addressLine1 = addressLine1;
  }

  if (addressLine2 !== undefined && addressLine2 !== null && addressLine2 !== '') {
    updateData.addressLine2 = addressLine2;
  }

  if (city !== undefined && city !== null && city !== '') {
    updateData.city = city;
  }

  if (state !== undefined && state !== null && state !== '') {
    updateData.state = state;
  }

  if (postalCode !== undefined && postalCode !== null && postalCode !== '') {
    updateData.postalCode = postalCode;
  }

  // Investor fields
  if (investorType !== undefined && investorType !== null && investorType !== '') {
    updateData.investorType = investorType;
  }

  if (taxId !== undefined && taxId !== null && taxId !== '') {
    updateData.taxId = taxId;
  }

  if (accreditedInvestor !== undefined && accreditedInvestor !== null) {
    updateData.accreditedInvestor = accreditedInvestor;
  }

  if (riskTolerance !== undefined && riskTolerance !== null && riskTolerance !== '') {
    updateData.riskTolerance = riskTolerance;
  }

  if (investmentPreferences !== undefined && investmentPreferences !== null && investmentPreferences !== '') {
    updateData.investmentPreferences = investmentPreferences;
  }

  // Individual investor fields
  if (fullName !== undefined && fullName !== null && fullName !== '') {
    updateData.fullName = fullName;
  }

  if (dateOfBirth !== undefined && dateOfBirth !== null && dateOfBirth !== '') {
    updateData.dateOfBirth = dateOfBirth;
  }

  if (nationality !== undefined && nationality !== null && nationality !== '') {
    updateData.nationality = nationality;
  }

  if (passportNumber !== undefined && passportNumber !== null && passportNumber !== '') {
    updateData.passportNumber = passportNumber;
  }

  // Institution investor fields
  if (institutionName !== undefined && institutionName !== null && institutionName !== '') {
    updateData.institutionName = institutionName;
  }

  if (institutionType !== undefined && institutionType !== null && institutionType !== '') {
    updateData.institutionType = institutionType;
  }

  if (registrationNumber !== undefined && registrationNumber !== null && registrationNumber !== '') {
    updateData.registrationNumber = registrationNumber;
  }

  if (legalRepresentative !== undefined && legalRepresentative !== null && legalRepresentative !== '') {
    updateData.legalRepresentative = legalRepresentative;
  }

  // Fund of Funds investor fields
  if (fundName !== undefined && fundName !== null && fundName !== '') {
    updateData.fundName = fundName;
  }

  if (fundManager !== undefined && fundManager !== null && fundManager !== '') {
    updateData.fundManager = fundManager;
  }

  if (aum !== undefined && aum !== null && aum !== '') {
    updateData.aum = aum;
  }

  // Family Office investor fields
  if (officeName !== undefined && officeName !== null && officeName !== '') {
    updateData.officeName = officeName;
  }

  if (familyName !== undefined && familyName !== null && familyName !== '') {
    updateData.familyName = familyName;
  }

  if (principalContact !== undefined && principalContact !== null && principalContact !== '') {
    updateData.principalContact = principalContact;
  }

  if (assetsUnderManagement !== undefined && assetsUnderManagement !== null && assetsUnderManagement !== '') {
    updateData.assetsUnderManagement = assetsUnderManagement;
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
      profileImage: updatedUser.profileImage,
      role: updatedUser.role,
      isActive: updatedUser.isActive,
      isEmailVerified: updatedUser.isEmailVerified,
      phoneNumber: updatedUser.phoneNumber,
      // KYC fields
      kycId: updatedUser.kycId,
      kycStatus: updatedUser.kycStatus,
      kycUrl: updatedUser.kycUrl,
      // Address fields
      address: updatedUser.address,
      country: updatedUser.country,
      addressLine1: updatedUser.addressLine1,
      addressLine2: updatedUser.addressLine2,
      city: updatedUser.city,
      state: updatedUser.state,
      postalCode: updatedUser.postalCode,
      // Investor fields
      investorType: updatedUser.investorType,
      taxId: updatedUser.taxId,
      accreditedInvestor: updatedUser.accreditedInvestor,
      riskTolerance: updatedUser.riskTolerance,
      investmentPreferences: updatedUser.investmentPreferences,
      // Individual investor fields
      fullName: updatedUser.fullName,
      dateOfBirth: updatedUser.dateOfBirth,
      nationality: updatedUser.nationality,
      passportNumber: updatedUser.passportNumber,
      // Institution investor fields
      institutionName: updatedUser.institutionName,
      institutionType: updatedUser.institutionType,
      registrationNumber: updatedUser.registrationNumber,
      legalRepresentative: updatedUser.legalRepresentative,
      // Fund of Funds investor fields
      fundName: updatedUser.fundName,
      fundManager: updatedUser.fundManager,
      aum: updatedUser.aum,
      // Family Office investor fields
      officeName: updatedUser.officeName,
      familyName: updatedUser.familyName,
      principalContact: updatedUser.principalContact,
      assetsUnderManagement: updatedUser.assetsUnderManagement,
      // Blockchain wallet
      walletAddress: updatedUser.walletAddress,
    }
  });
}));

/**
 * @route   POST /api/users/profile-image
 * @desc    Upload user profile image
 * @access  Private (requires authentication)
 */
router.post('/profile-image', authenticate, uploadProfileImage.single('profileImage'), catchAsync(async (req, res) => {
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

  // Delete old profile image from Supabase Storage if exists
  if (user.profileImage) {
    try {
      // Extract path from Supabase URL if it's a full URL
      if (user.profileImage.includes('supabase')) {
        const urlParts = user.profileImage.split('/documents/');
        if (urlParts[1]) {
          await deleteFromSupabase(urlParts[1]);
        }
      }
    } catch (error) {
      console.error('Error deleting old profile image:', error);
      // Continue with upload even if delete fails
    }
  }

  // Upload to Supabase Storage
  const uploadResult = await uploadToSupabase(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    'profiles'
  );

  // Save Supabase public URL to database
  const updatedUser = await User.findByIdAndUpdate(userId, {
    profileImage: uploadResult.publicUrl
  });

  res.status(200).json({
    success: true,
    message: 'Profile image uploaded successfully',
    data: {
      profileImage: updatedUser.profileImage,
      filename: uploadResult.fileName,
      size: uploadResult.size,
      mimetype: req.file.mimetype
    }
  });
}));

/**
 * @route   DELETE /api/users/profile-image
 * @desc    Delete user profile image
 * @access  Private (requires authentication)
 */
router.delete('/profile-image', authenticate, catchAsync(async (req, res) => {
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

  // Delete the image from Supabase Storage
  try {
    // Extract path from Supabase URL if it's a full URL
    if (user.profileImage.includes('supabase')) {
      const urlParts = user.profileImage.split('/documents/');
      if (urlParts[1]) {
        await deleteFromSupabase(urlParts[1]);
      }
    }
  } catch (error) {
    console.error('Error deleting profile image from storage:', error);
    // Continue to remove from database even if storage delete fails
  }

  // Remove from database
  await User.findByIdAndUpdate(userId, {
    profileImage: null
  });

  res.status(200).json({
    success: true,
    message: 'Profile image deleted successfully'
  });
}));

/**
 * @route   GET /api/users
 * @desc    Get all users (name and UUID)
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  // Get all users
  const users = await User.find({});

  // Map to return user information including role, active status, and last login
  const usersList = users.map(user => ({
    id: user.id,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin
  }));

  res.status(200).json({
    success: true,
    count: usersList.length,
    data: usersList
  });
}));

/**
 * @route   GET /api/users/filter
 * @desc    Filter users by one or more roles
 * @access  Private (requires authentication, Root/Admin/Support/Guest only - Investor role blocked)
 * @query   role - Single role number (0-4) or comma-separated roles (e.g., ?role=0,1,2)
 */
router.get('/filter', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Block INVESTOR role from accessing this endpoint
  validate(userRole !== ROLES.INVESTOR, 'Access denied. Investor role cannot access this endpoint.');

  const { role } = req.query;

  validate(role !== undefined, 'Role parameter is required');

  // Parse role parameter - can be single value or comma-separated
  let roles = [];
  if (typeof role === 'string') {
    // Handle comma-separated roles like "0,1,2" or single role "3"
    roles = role.split(',').map(r => parseInt(r.trim(), 10));
  } else if (Array.isArray(role)) {
    // Handle array of roles from query like ?role=0&role=1
    roles = role.map(r => parseInt(r, 10));
  } else {
    roles = [parseInt(role, 10)];
  }

  // Validate all roles are valid numbers 0-4
  const validRoles = roles.every(r => !isNaN(r) && r >= 0 && r <= 4);
  validate(validRoles, 'Invalid role value(s). Role must be between 0-4 (0=Root, 1=Admin, 2=Support, 3=Investor, 4=Guest)');

  // Get all users
  const allUsers = await User.find({});

  // Filter users by the specified roles
  const filteredUsers = allUsers.filter(user => roles.includes(user.role));

  // Map to return user details
  const usersList = filteredUsers.map(user => ({
    id: user.id,
    name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    roleName: user.role === 0 ? 'Root' : user.role === 1 ? 'Admin' : user.role === 2 ? 'Support' : 'Investor'
  }));

  res.status(200).json({
    success: true,
    count: usersList.length,
    roles: roles,
    data: usersList
  });
}));

/**
 * @route   GET /api/users/:id
 * @desc    Get single user by ID
 * @access  Private (requires authentication, Root/Admin/Staff can access any user, Investor can access only their own)
 * @params  id - User UUID to retrieve
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { userRole, userId: currentUserId } = getUserContext(req);
  const { id } = req.params;

  // ROOT, ADMIN, and STAFF can access any user
  const canAccessAnyUser = userRole === ROLES.ROOT || userRole === ROLES.ADMIN || userRole === ROLES.STAFF;

  // INVESTOR can only access their own user data
  const isAccessingOwnData = userRole === ROLES.INVESTOR && id === currentUserId;

  if (!canAccessAnyUser && !isAccessingOwnData) {
    return res.status(403).json({
      success: false,
      message: userRole === ROLES.INVESTOR
        ? 'Unauthorized: Investors can only access their own user details'
        : 'Unauthorized: Only Root, Admin, Staff, and Investor (own data) users can access user details'
    });
  }

  validate(id, 'User ID is required');

  // Find the user
  const user = await User.findById(id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  res.status(200).json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      appLanguage: user.appLanguage,
      profileImage: user.profileImage,
      role: user.role,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      phoneNumber: user.phoneNumber,
      // KYC fields
      kycId: user.kycId,
      kycStatus: user.kycStatus,
      kycUrl: user.kycUrl,
      // Address fields
      address: user.address,
      country: user.country,
      addressLine1: user.addressLine1,
      addressLine2: user.addressLine2,
      city: user.city,
      state: user.state,
      postalCode: user.postalCode,
      // Investor fields
      investorType: user.investorType,
      taxId: user.taxId,
      accreditedInvestor: user.accreditedInvestor,
      riskTolerance: user.riskTolerance,
      investmentPreferences: user.investmentPreferences,
      // Individual investor fields
      fullName: user.fullName,
      dateOfBirth: user.dateOfBirth,
      nationality: user.nationality,
      passportNumber: user.passportNumber,
      // Institution investor fields
      institutionName: user.institutionName,
      institutionType: user.institutionType,
      registrationNumber: user.registrationNumber,
      legalRepresentative: user.legalRepresentative,
      // Fund of Funds investor fields
      fundName: user.fundName,
      fundManager: user.fundManager,
      aum: user.aum,
      // Family Office investor fields
      officeName: user.officeName,
      familyName: user.familyName,
      principalContact: user.principalContact,
      assetsUnderManagement: user.assetsUnderManagement,
      // Blockchain wallet
      walletAddress: user.walletAddress,
      // Timestamps
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }
  });
}));

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user by ID
 * @access  Private (requires authentication, Root only)
 * @params  id - User UUID to delete
 */
router.delete('/:id', authenticate, requireRootAccess, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  // Only ROOT role can delete users
  if (userRole !== ROLES.ROOT) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only ROOT users can delete users'
    });
  }

  validate(id, 'User ID is required');

  // Check if user exists
  const user = await User.findById(id);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Delete the user
  await User.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
    data: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    }
  });
}));

/**
 * @route   GET /api/users/health
 * @desc    Health check for User API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'User API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
