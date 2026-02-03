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
 * @desc    Get firm logo and name (public endpoint)
 * @access  Public
 */
router.get('/logo', catchAsync(async (_req, res) => {
  // Get the firm settings (single record)
  const settings = await FirmSettings.get();

  res.status(200).json({
    success: true,
    data: {
      firmLogo: settings?.firmLogo || null,
      firmName: settings?.firmName || 'PoliBit'
    }
  });
}));

/**
 * @route   GET /api/firm-settings
 * @desc    Get global firm settings
 * @access  Private
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  // Get global settings
  const settings = await FirmSettings.get();

  if (!settings) {
    return res.status(404).json({
      success: false,
      message: 'No firm settings found. Please contact administrator.'
    });
  }

  res.status(200).json({
    success: true,
    data: settings
  });
}));

/**
 * @route   POST /api/firm-settings
 * @desc    Create global firm settings
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

  // Check if global settings already exist
  const existing = await FirmSettings.get();
  if (existing) {
    return res.status(400).json({
      success: false,
      message: 'Firm settings already exist. Use PUT to update.'
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
    userId  // Track who created it
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
 * @desc    Update global firm settings
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

  // Get existing global settings
  const existingSettings = await FirmSettings.get();

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

  // Add userId to track who made the update/creation
  updateData.userId = userId;

  let settings;
  let message;
  let statusCode;

  // If settings don't exist, create them
  if (!existingSettings) {
    // Set defaults for required fields if not provided
    const createData = {
      firmName: updateData.firmName || 'My Firm',
      firmLogo: updateData.firmLogo || null,
      firmDescription: updateData.firmDescription || '',
      firmWebsite: updateData.firmWebsite || '',
      firmAddress: updateData.firmAddress || '',
      firmPhone: updateData.firmPhone || '',
      firmEmail: updateData.firmEmail || '',
      userId
    };

    settings = await FirmSettings.create(createData);
    message = 'Firm settings created successfully';
    statusCode = 201;
  } else {
    // Update using the existing settings ID
    settings = await FirmSettings.findByIdAndUpdate(existingSettings.id, updateData);
    message = 'Firm settings updated successfully';
    statusCode = 200;
  }

  res.status(statusCode).json({
    success: true,
    message,
    data: settings
  });
}));

/**
 * @route   PUT /api/firm-settings/:id
 * @desc    Update global firm settings by ID
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

  // Verify the settings exist
  const existingSettings = await FirmSettings.findById(id);
  validate(existingSettings, 'Firm settings not found');

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

  // Add userId to track who made the update
  updateData.userId = userId;

  const settings = await FirmSettings.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Firm settings updated successfully',
    data: settings
  });
}));

/**
 * @route   DELETE /api/firm-settings
 * @desc    Delete global firm settings
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

  // Get global settings
  const settings = await FirmSettings.get();
  validate(settings, 'No firm settings found');

  // Delete by ID
  await FirmSettings.findByIdAndDelete(settings.id);

  res.status(200).json({
    success: true,
    message: 'Firm settings deleted successfully'
  });
}));

module.exports = router;
