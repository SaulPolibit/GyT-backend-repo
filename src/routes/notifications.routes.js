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
const { NotificationSettings, Notification, Structure } = require('../models/supabase');
const { getUserContext, ROLES } = require('../middleware/rbac');
const {
  sendQuarterlyReportNotice,
  sendK1TaxFormNotice,
  sendGeneralAnnouncement
} = require('../utils/notificationHelper');

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
    'urgentCapitalCalls',
    'newStructureNotifications'
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

// ==========================================
// NOTIFICATION INBOX ROUTES
// ==========================================

/**
 * @route   GET /api/notifications
 * @desc    Get user's notifications
 * @access  Private (requires Bearer token)
 * @query   limit, offset, unreadOnly, channel, type
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { limit = 50, offset = 0, unreadOnly = false, channel, type } = req.query;

  const notifications = await Notification.findByUserId(userId, {
    limit: parseInt(limit),
    offset: parseInt(offset),
    unreadOnly: unreadOnly === 'true' || unreadOnly === true,
    channel,
    type
  });

  res.status(200).json({
    success: true,
    data: notifications,
    count: notifications.length
  });
}));

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get user's unread notification count
 * @access  Private (requires Bearer token)
 */
router.get('/unread-count', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  const count = await Notification.getUnreadCount(userId);

  res.status(200).json({
    success: true,
    count
  });
}));

/**
 * @route   GET /api/notifications/:id
 * @desc    Get single notification by ID
 * @access  Private (requires Bearer token)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  if (id === 'settings' || id === 'unread-count' || id === 'read-all') {
    return res.status(400).json({
      success: false,
      message: 'Invalid notification ID'
    });
  }

  const notification = await Notification.findById(id);

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found'
    });
  }

  // Check if user owns the notification
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
 * @desc    Create a notification (Admin only)
 * @access  Private (Root/Admin only)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const senderId = req.auth.userId || req.user.id;

  // Only ROOT and ADMIN can create notifications
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can create notifications'
    });
  }

  const {
    userId,
    notificationType,
    channel = 'portal',
    title,
    message,
    priority = 'normal',
    relatedEntityType,
    relatedEntityId,
    metadata,
    actionUrl,
    senderName,
    emailSubject,
    emailTemplate,
    expiresAt
  } = req.body;

  validate(userId, 'User ID is required');
  validate(notificationType, 'Notification type is required');
  validate(title, 'Title is required');
  validate(message, 'Message is required');

  const notification = await Notification.create({
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
    senderId,
    senderName,
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
 * @desc    Create multiple notifications (Admin only)
 * @access  Private (Root/Admin only)
 */
router.post('/bulk', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const senderId = req.auth.userId || req.user.id;

  // Only ROOT and ADMIN can create notifications
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can create notifications'
    });
  }

  const { notifications: notificationsData } = req.body;

  validate(notificationsData, 'Notifications array is required');
  validate(Array.isArray(notificationsData), 'Notifications must be an array');

  // Add senderId to all notifications
  const dataWithSender = notificationsData.map(n => ({
    ...n,
    senderId: n.senderId || senderId
  }));

  const notifications = await Notification.createMany(dataWithSender);

  res.status(201).json({
    success: true,
    message: `${notifications.length} notifications created successfully`,
    data: notifications,
    count: notifications.length
  });
}));

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private (requires Bearer token)
 */
router.put('/:id/read', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const notification = await Notification.markAsRead(id, userId);

  if (!notification) {
    return res.status(404).json({
      success: false,
      message: 'Notification not found or already read'
    });
  }

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

  const count = await Notification.markAllAsRead(userId);

  res.status(200).json({
    success: true,
    message: `${count} notifications marked as read`,
    count
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

  // Don't delete settings routes
  if (id === 'settings') {
    return res.status(400).json({
      success: false,
      message: 'Invalid notification ID'
    });
  }

  await Notification.delete(id, userId);

  res.status(200).json({
    success: true,
    message: 'Notification deleted successfully'
  });
}));

/**
 * @route   DELETE /api/notifications/cleanup/old
 * @desc    Delete old read notifications (Admin only)
 * @access  Private (Root/Admin only)
 * @query   daysOld - Delete notifications older than this many days (default: 30)
 */
router.delete('/cleanup/old', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Only ROOT and ADMIN can cleanup
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can cleanup notifications'
    });
  }

  const { daysOld = 30 } = req.query;

  const count = await Notification.deleteOldRead(parseInt(daysOld));

  res.status(200).json({
    success: true,
    message: `${count} old notifications deleted`,
    count
  });
}));

/**
 * @route   DELETE /api/notifications/cleanup/expired
 * @desc    Delete expired notifications (Admin only)
 * @access  Private (Root/Admin only)
 */
router.delete('/cleanup/expired', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Only ROOT and ADMIN can cleanup
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can cleanup notifications'
    });
  }

  const count = await Notification.deleteExpired();

  res.status(200).json({
    success: true,
    message: `${count} expired notifications deleted`,
    count
  });
}));

// ==========================================
// BULK NOTIFICATION SENDING ROUTES
// ==========================================

/**
 * @route   POST /api/notifications/send/quarterly-report
 * @desc    Send quarterly report notification to all investors in a structure
 * @access  Private (Root/Admin only)
 */
router.post('/send/quarterly-report', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);

  // Only ROOT and ADMIN can send bulk notifications
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can send bulk notifications'
    });
  }

  const { structureId, quarter, year, reportUrl } = req.body;

  validate(structureId, 'Structure ID is required');
  validate(quarter, 'Quarter is required (1-4)');
  validate(year, 'Year is required');
  validate(quarter >= 1 && quarter <= 4, 'Quarter must be between 1 and 4');

  // Validate structure exists
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const reportData = { structureId, quarter, year, reportUrl };
  const notifications = await sendQuarterlyReportNotice(reportData, structure, userId);

  res.status(201).json({
    success: true,
    message: `Quarterly report notification sent to ${notifications.length} investors`,
    data: {
      notificationsSent: notifications.length,
      quarter,
      year,
      structureName: structure.name
    }
  });
}));

/**
 * @route   POST /api/notifications/send/k1-tax-form
 * @desc    Send K-1 tax form notification to all investors in a structure
 * @access  Private (Root/Admin only)
 */
router.post('/send/k1-tax-form', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);

  // Only ROOT and ADMIN can send bulk notifications
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can send bulk notifications'
    });
  }

  const { structureId, taxYear, formUrl } = req.body;

  validate(structureId, 'Structure ID is required');
  validate(taxYear, 'Tax year is required');

  // Validate structure exists
  const structure = await Structure.findById(structureId);
  validate(structure, 'Structure not found');

  // Root can access any structure, Admin can only access their own
  if (userRole === ROLES.ADMIN) {
    validate(structure.createdBy === userId, 'Unauthorized access to structure');
  }

  const k1Data = { structureId, taxYear, formUrl };
  const notifications = await sendK1TaxFormNotice(k1Data, structure, userId);

  res.status(201).json({
    success: true,
    message: `K-1 tax form notification sent to ${notifications.length} investors`,
    data: {
      notificationsSent: notifications.length,
      taxYear,
      structureName: structure.name
    }
  });
}));

/**
 * @route   POST /api/notifications/send/announcement
 * @desc    Send general announcement to investors (structure-wide or specific users)
 * @access  Private (Root/Admin only)
 */
router.post('/send/announcement', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);

  // Only ROOT and ADMIN can send bulk notifications
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only Root and Admin users can send bulk notifications'
    });
  }

  const { structureId, userIds, title, message, priority, actionUrl } = req.body;

  validate(title, 'Title is required');
  validate(message, 'Message is required');
  validate(structureId || (userIds && userIds.length > 0), 'Either structureId or userIds is required');

  let structure = null;
  if (structureId) {
    // Validate structure exists
    structure = await Structure.findById(structureId);
    validate(structure, 'Structure not found');

    // Root can access any structure, Admin can only access their own
    if (userRole === ROLES.ADMIN) {
      validate(structure.createdBy === userId, 'Unauthorized access to structure');
    }
  }

  const announcementData = {
    title,
    message,
    structureId,
    priority: priority || 'normal',
    actionUrl,
    announcementType: 'general'
  };

  const notifications = await sendGeneralAnnouncement(announcementData, userId, userIds);

  res.status(201).json({
    success: true,
    message: `Announcement sent to ${notifications.length} users`,
    data: {
      notificationsSent: notifications.length,
      title,
      structureName: structure?.name || null
    }
  });
}));

module.exports = router;
