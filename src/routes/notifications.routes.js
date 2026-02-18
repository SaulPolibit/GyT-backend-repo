/**
 * Notifications API Routes
 * User notification preferences and inbox management endpoints
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  catchAsync,
  validate
} = require('../middleware/errorHandler');
const { NotificationSettings, Notification } = require('../models/supabase');
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

// ============================================================================
// NOTIFICATION INBOX ROUTES
// ============================================================================

/**
 * @route   GET /api/notifications
 * @desc    Get user's notifications (inbox)
 * @access  Private (requires Bearer token)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  // Parse query parameters
  const options = {
    status: req.query.status,
    channel: req.query.channel,
    notificationType: req.query.type,
    unreadOnly: req.query.unread === 'true',
    limit: parseInt(req.query.limit) || 50,
    offset: parseInt(req.query.offset) || 0,
    orderBy: req.query.orderBy || 'created_at',
    ascending: req.query.order === 'asc'
  };

  const notifications = await Notification.findByUserId(userId, options);

  res.status(200).json({
    success: true,
    message: 'Notifications retrieved successfully',
    data: notifications,
    pagination: {
      limit: options.limit,
      offset: options.offset,
      count: notifications.length
    }
  });
}));

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get user's unread notification count
 * @access  Private (requires Bearer token)
 */
router.get('/unread-count', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  const count = await Notification.getUnreadCount(userId);

  res.status(200).json({
    success: true,
    data: { count }
  });
}));

/**
 * @route   GET /api/notifications/:id
 * @desc    Get a specific notification by ID
 * @access  Private (requires Bearer token)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  validate(id, 'Notification ID is required');

  const notification = await Notification.findById(id);

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found'
    });
  }

  // Verify notification belongs to user
  if (notification.userId !== userId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  res.status(200).json({
    success: true,
    data: notification
  });
}));

/**
 * @route   POST /api/notifications
 * @desc    Create a new notification (Admin/System only)
 * @access  Private (Root and Admin only)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Only ROOT and ADMIN can create notifications
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can create notifications'
    });
  }

  const senderId = req.auth.userId || req.user.id;

  const {
    userId,
    notificationType,
    channel,
    title,
    message,
    priority,
    relatedEntityType,
    relatedEntityId,
    metadata,
    actionUrl,
    emailSubject,
    emailTemplate,
    expiresAt
  } = req.body;

  validate(userId, 'User ID is required');
  validate(notificationType, 'Notification type is required');
  validate(title, 'Title is required');
  validate(message, 'Message is required');

  // Validate notification type
  if (!Notification.TYPES.includes(notificationType)) {
    return res.status(400).json({
      success: false,
      message: `Invalid notification type. Must be one of: ${Notification.TYPES.join(', ')}`
    });
  }

  // Validate channel if provided
  if (channel && !Notification.CHANNELS.includes(channel)) {
    return res.status(400).json({
      success: false,
      message: `Invalid channel. Must be one of: ${Notification.CHANNELS.join(', ')}`
    });
  }

  // Validate priority if provided
  if (priority && !Notification.PRIORITIES.includes(priority)) {
    return res.status(400).json({
      success: false,
      message: `Invalid priority. Must be one of: ${Notification.PRIORITIES.join(', ')}`
    });
  }

  const notification = await Notification.create({
    userId,
    notificationType,
    channel: channel || 'portal',
    title,
    message,
    priority: priority || 'normal',
    relatedEntityType,
    relatedEntityId,
    metadata,
    actionUrl,
    senderId,
    emailSubject,
    emailTemplate,
    expiresAt
  });

  res.status(201).json({
    success: true,
    message: 'Notification created successfully',
    data: notification
  });
}));

/**
 * @route   POST /api/notifications/bulk
 * @desc    Create multiple notifications (Admin/System only)
 * @access  Private (Root and Admin only)
 */
router.post('/bulk', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Only ROOT and ADMIN can create notifications
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can create notifications'
    });
  }

  const senderId = req.auth.userId || req.user.id;
  const { notifications } = req.body;

  validate(notifications, 'Notifications array is required');

  if (!Array.isArray(notifications) || notifications.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Notifications must be a non-empty array'
    });
  }

  // Add sender to each notification
  const notificationsWithSender = notifications.map(n => ({
    ...n,
    senderId,
    channel: n.channel || 'portal',
    priority: n.priority || 'normal'
  }));

  const createdNotifications = await Notification.createMany(notificationsWithSender);

  res.status(201).json({
    success: true,
    message: `${createdNotifications.length} notifications created successfully`,
    data: createdNotifications
  });
}));

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Mark a notification as read
 * @access  Private (requires Bearer token)
 */
router.put('/:id/read', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  validate(id, 'Notification ID is required');

  const notification = await Notification.markAsRead(id, userId);

  res.status(200).json({
    success: true,
    message: 'Notification marked as read',
    data: notification
  });
}));

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private (requires Bearer token)
 */
router.put('/read-all', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  validate(userId, 'User ID is required');

  const count = await Notification.markAllAsRead(userId);

  res.status(200).json({
    success: true,
    message: `${count} notifications marked as read`
  });
}));

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete a notification
 * @access  Private (requires Bearer token)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  validate(id, 'Notification ID is required');

  // First verify notification belongs to user
  const notification = await Notification.findById(id);

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found'
    });
  }

  if (notification.userId !== userId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }

  await Notification.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Notification deleted successfully'
  });
}));

/**
 * @route   DELETE /api/notifications/cleanup/old
 * @desc    Delete old read notifications (Admin only)
 * @access  Private (Root and Admin only)
 */
router.delete('/cleanup/old', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can cleanup notifications'
    });
  }

  const daysOld = parseInt(req.query.days) || 30;
  const count = await Notification.deleteOldRead(daysOld);

  res.status(200).json({
    success: true,
    message: `${count} old notifications deleted`
  });
}));

/**
 * @route   DELETE /api/notifications/cleanup/expired
 * @desc    Delete expired notifications (Admin only)
 * @access  Private (Root and Admin only)
 */
router.delete('/cleanup/expired', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can cleanup notifications'
    });
  }

  const count = await Notification.deleteExpired();

  res.status(200).json({
    success: true,
    message: `${count} expired notifications deleted`
  });
}));

module.exports = router;
