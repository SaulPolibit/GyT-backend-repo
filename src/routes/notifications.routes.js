/**
 * Notifications Settings API Routes
 * User notification preferences management endpoints
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  catchAsync,
  validate
} = require('../middleware/errorHandler');
const { NotificationSettings } = require('../models/supabase');
const { getUserContext, ROLES } = require('../middleware/rbac');

const router = express.Router();

// Add CORS headers for all notification routes
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

/**
 * @route   GET /api/notifications/settings/:id
 * @desc    Get user notification settings by user ID (Root/Admin only)
 * @access  Private (Root and Admin only)
 */
router.get('/settings/:id', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  // Only ROOT and ADMIN roles can access other users' notification settings
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can access user notification settings by ID'
    });
  }

  validate(id, 'User ID is required');

  // Find or create notification settings for the specified user
  let settings = await NotificationSettings.findByUserId(id);

  if (!settings) {
    // Create new settings with all fields set to false (defaults)
    settings = await NotificationSettings.create({ userId: id });
  }

  res.status(200).json({
    success: true,
    message: 'Notification settings retrieved successfully',
    data: settings
  });
}));

/**
 * @route   GET /api/notifications/settings
 * @desc    Get user notification settings (creates if not exists with all false)
 * @access  Private (requires Bearer token)
 */
router.get('/settings', authenticate, catchAsync(async (req, res) => {
  // Get userId from bearer token
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  // Find or create notification settings for the user
  let settings = await NotificationSettings.findByUserId(userId);

  if (!settings) {
    // Create new settings with all fields set to false (defaults)
    settings = await NotificationSettings.create({ userId });
  }

  res.status(200).json({
    success: true,
    message: 'Notification settings retrieved successfully',
    data: settings
  });
}));

/**
 * @route   PUT /api/notifications/settings
 * @desc    Update user notification settings
 * @access  Private (Root, Admin, Staff, Investor)
 */
router.put('/settings', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Allow roles: 0 (Root), 1 (Admin), 2 (Staff), 3 (Investor)
  const allowedRoles = [0, 1, 2, 3];
  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Only Root, Admin, Staff, and Investor users can update notification settings.'
    });
  }

  // Get userId from bearer token
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  // Extract only valid notification fields from request body
  const allowedFields = [
    'emailNotifications',
    'portfolioNotifications',
    'reportNotifications',
    'investorActivityNotifications',
    'systemUpdateNotifications',
    'marketingEmailNotifications',
    'pushNotifications',
    'smsNotifications',
    'notificationFrequency',
    'preferredContactMethod',
    'reportDeliveryFormat',
    'documentUploads',
    'generalAnnouncements',
    'capitalCallNotices',
    'distributionNotices',
    'k1TaxForms',
    'paymentConfirmations',
    'quarterlyReports',
    'securityAlerts',
    'urgentCapitalCalls'
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body.hasOwnProperty(field)) {
      updates[field] = req.body[field];
    }
  }

  // Update or create notification settings
  let settings = await NotificationSettings.findByUserId(userId);

  if (!settings) {
    // Create new settings with provided updates
    settings = await NotificationSettings.create({ userId, ...updates });
  } else {
    // Update existing settings
    settings = await NotificationSettings.updateByUserId(userId, updates);
  }

  res.status(200).json({
    success: true,
    message: 'Notification settings updated successfully',
    data: settings
  });
}));

/**
 * @route   PATCH /api/notifications/settings/enable-all
 * @desc    Enable all notification types
 * @access  Private (requires Bearer token)
 */
router.patch('/settings/enable-all', authenticate, catchAsync(async (req, res) => {
  // Get userId from bearer token
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  // Find or create notification settings
  let settings = await NotificationSettings.findOrCreateByUserId(userId);

  // Enable all notifications
  settings = await settings.enableAll();

  res.status(200).json({
    success: true,
    message: 'All notifications enabled successfully',
    data: settings
  });
}));

/**
 * @route   PATCH /api/notifications/settings/disable-all
 * @desc    Disable all notification types
 * @access  Private (requires Bearer token)
 */
router.patch('/settings/disable-all', authenticate, catchAsync(async (req, res) => {
  // Get userId from bearer token
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  // Find or create notification settings
  let settings = await NotificationSettings.findOrCreateByUserId(userId);

  // Disable all notifications
  settings = await settings.disableAll();

  res.status(200).json({
    success: true,
    message: 'All notifications disabled successfully',
    data: settings
  });
}));

/**
 * @route   DELETE /api/notifications/settings
 * @desc    Delete user notification settings (will be recreated with defaults on next GET)
 * @access  Private (requires Bearer token)
 */
router.delete('/settings', authenticate, catchAsync(async (req, res) => {
  // Get userId from bearer token
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  // Delete notification settings
  await NotificationSettings.findOneAndDelete({ userId });

  res.status(200).json({
    success: true,
    message: 'Notification settings deleted successfully'
  });
}));

module.exports = router;
