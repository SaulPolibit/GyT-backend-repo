/**
 * Firm Settings API Routes
 * Endpoints for managing firm/company settings
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const FirmSettings = require('../models/supabase/firmSettings');
const { handleFirmLogoUpload } = require('../middleware/upload');
const { uploadToSupabase } = require('../utils/fileUpload');
const { canCreate, getUserContext } = require('../middleware/rbac');

const router = express.Router();

/**
 * @route   GET /api/firm-settings/health
 * @desc    Health check
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Firm Settings API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

/**
 * @route   GET /api/firm-settings/logo
 * @desc    Get firm logo (public endpoint)
 * @access  Public
 */
router.get('/logo', catchAsync(async (_req, res) => {
  // Get the firm settings (single record)
  const settings = await FirmSettings.get();

  res.status(200).json({
    success: true,
    data: {
      firmLogo: settings?.firmLogo || null
    }
  });
}));

/**
 * @route   GET /api/firm-settings
 * @desc    Get firm settings for logged-in user
 * @access  Private
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  // Get settings by user ID
  let settings = await FirmSettings.findByUserId(userId);

  // If no settings exist for this user, create new ones
  if (!settings) {
    const defaultSettings = {
      firmName: 'My Firm',
      firmDescription: '',
      firmWebsite: '',
      firmAddress: '',
      firmPhone: '',
      firmEmail: '',
      userId
    };

    settings = await FirmSettings.create(defaultSettings);
  }

  res.status(200).json({
    success: true,
    data: settings
  });
}));

/**
 * @route   POST /api/firm-settings
 * @desc    Create firm settings for logged-in user
 * @access  Private (Root, Admin only)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Block GUEST, SUPPORT, and INVESTOR from creating
  if (!canCreate(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Root and Admin users can create firm settings.'
    });
  }

  const userId = req.auth.userId || req.user.id;

  const {
    firmName,
    firmLogo,
    firmDescription,
    firmWebsite,
    firmAddress,
    firmPhone,
    firmEmail
  } = req.body;

  // Check if settings already exist for this user
  const existing = await FirmSettings.findByUserId(userId);
  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'Firm settings already exist for this user. Use PUT to update.'
    });
  }

  const settingsData = {
    firmName: firmName?.trim() || 'My Firm',
    firmLogo: firmLogo?.trim() || null,
    firmDescription: firmDescription?.trim() || '',
    firmWebsite: firmWebsite?.trim() || '',
    firmAddress: firmAddress?.trim() || '',
    firmPhone: firmPhone?.trim() || '',
    firmEmail: firmEmail?.trim() || '',
    userId
  };

  const settings = await FirmSettings.create(settingsData);

  res.status(201).json({
    success: true,
    message: 'Firm settings created successfully',
    data: settings
  });
}));

/**
 * @route   PUT /api/firm-settings
 * @desc    Update firm settings for logged-in user
 * @access  Private (Root, Admin only)
 * @body    FormData with optional 'firmLogo' file field and other fields
 */
router.put('/', authenticate, handleFirmLogoUpload, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Block GUEST, SUPPORT, and INVESTOR from updating
  if (!canCreate(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Root and Admin users can update firm settings.'
    });
  }

  const userId = req.auth.userId || req.user.id;

  // Get user's existing settings
  let existingSettings = await FirmSettings.findByUserId(userId);

  // If no settings exist, create them first
  if (!existingSettings) {
    const defaultSettings = {
      firmName: 'My Firm',
      firmDescription: '',
      firmWebsite: '',
      firmAddress: '',
      firmPhone: '',
      firmEmail: '',
      userId
    };
    existingSettings = await FirmSettings.create(defaultSettings);
  }

  const updateData = {};
  const allowedFields = [
    'firmName',
    'firmLogo',
    'firmDescription',
    'firmWebsite',
    'firmAddress',
    'firmPhone',
    'firmEmail'
  ];

  // Handle file upload if present
  if (req.file) {
    try {
      // Upload to Supabase storage
      const uploadResult = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        'firm-logos',
        'firm-logos'
      );

      // Set the public URL as firmLogo
      updateData.firmLogo = uploadResult.publicUrl;
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: `Error uploading firm logo: ${error.message}`
      });
    }
  }

  // Process other fields from request body
  for (const field of allowedFields) {
    // Skip firmLogo if it was already set from file upload
    if (field === 'firmLogo' && req.file) continue;

    if (req.body[field] !== undefined) {
      if (typeof req.body[field] === 'string') {
        updateData[field] = req.body[field].trim();
      } else {
        updateData[field] = req.body[field];
      }
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  // Update using the existing settings ID
  const settings = await FirmSettings.findByIdAndUpdate(existingSettings.id, updateData);

  res.status(200).json({
    success: true,
    message: 'Firm settings updated successfully',
    data: settings
  });
}));

/**
 * @route   PUT /api/firm-settings/:id
 * @desc    Update firm settings by ID (only if user owns it)
 * @access  Private (Root, Admin only)
 * @body    FormData with optional 'firmLogo' file field and other fields
 */
router.put('/:id', authenticate, handleFirmLogoUpload, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Block GUEST, SUPPORT, and INVESTOR from updating
  if (!canCreate(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Root and Admin users can update firm settings.'
    });
  }

  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Verify the settings belong to the user
  const existingSettings = await FirmSettings.findById(id);
  validate(existingSettings, 'Firm settings not found');
  validate(existingSettings.userId === userId, 'Unauthorized: You can only update your own firm settings');

  const updateData = {};
  const allowedFields = [
    'firmName',
    'firmLogo',
    'firmDescription',
    'firmWebsite',
    'firmAddress',
    'firmPhone',
    'firmEmail'
  ];

  // Handle file upload if present
  if (req.file) {
    try {
      // Upload to Supabase storage
      const uploadResult = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        'firm-logos',
        'firm-logos'
      );

      // Set the public URL as firmLogo
      updateData.firmLogo = uploadResult.publicUrl;
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: `Error uploading firm logo: ${error.message}`
      });
    }
  }

  // Process other fields from request body
  for (const field of allowedFields) {
    // Skip firmLogo if it was already set from file upload
    if (field === 'firmLogo' && req.file) continue;

    if (req.body[field] !== undefined) {
      if (typeof req.body[field] === 'string') {
        updateData[field] = req.body[field].trim();
      } else {
        updateData[field] = req.body[field];
      }
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const settings = await FirmSettings.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Firm settings updated successfully',
    data: settings
  });
}));

/**
 * @route   DELETE /api/firm-settings
 * @desc    Delete firm settings for logged-in user
 * @access  Private (Root, Admin only)
 */
router.delete('/', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Block GUEST, SUPPORT, and INVESTOR from deleting
  if (!canCreate(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Root and Admin users can delete firm settings.'
    });
  }

  const userId = req.auth.userId || req.user.id;

  // Get user's settings
  const settings = await FirmSettings.findByUserId(userId);
  validate(settings, 'No firm settings found for this user');

  // Delete by ID
  await FirmSettings.findByIdAndDelete(settings.id);

  res.status(200).json({
    success: true,
    message: 'Firm settings deleted successfully'
  });
}));

module.exports = router;
