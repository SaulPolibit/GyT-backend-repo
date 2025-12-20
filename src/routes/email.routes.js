/**
 * Email API Routes
 * Endpoints for managing user email settings and sending emails
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { EmailSettings, EmailLog } = require('../models/supabase');
const { sendEmail, testConnection, isValidEmail } = require('../utils/emailSender');
const { getUserContext, ROLES } = require('../middleware/rbac');

const router = express.Router();

/**
 * @route   POST /api/users/:userId/email-settings
 * @desc    Save or update email server settings
 * @access  Private (user can only manage their own settings, or admin)
 */
router.post('/:userId/email-settings', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { userId: targetUserId } = req.params;

  // Authorization: user can only manage their own settings unless admin/root
  if (userId !== targetUserId && userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      error: 'You can only manage your own email settings'
    });
  }

  const {
    smtpHost,
    smtpPort,
    smtpSecure,
    encryption, // Support for 'tls', 'ssl', 'none'
    smtpUsername,
    smtpPassword,
    fromEmail,
    fromName,
    replyToEmail
  } = req.body;

  // Convert encryption string to smtpSecure boolean
  let finalSmtpSecure = smtpSecure;
  if (encryption !== undefined) {
    if (encryption === 'ssl') {
      finalSmtpSecure = true; // Port 465 with implicit SSL
    } else if (encryption === 'tls' || encryption === 'starttls') {
      finalSmtpSecure = false; // Port 587 with STARTTLS
    } else if (encryption === 'none') {
      finalSmtpSecure = false; // Port 25 without encryption
    }
  }

  // Validate required fields
  validate(smtpHost, 'SMTP host is required');
  validate(smtpPort, 'SMTP port is required');
  validate(finalSmtpSecure !== undefined, 'SMTP secure setting is required');
  validate(smtpUsername, 'SMTP username is required');
  validate(smtpPassword, 'SMTP password is required');
  validate(fromEmail, 'From email is required');

  // Validate email addresses
  validate(isValidEmail(fromEmail), 'Invalid from email address');

  if (replyToEmail) {
    validate(isValidEmail(replyToEmail), 'Invalid reply-to email address');
  }

  // Validate port range
  validate(smtpPort >= 1 && smtpPort <= 65535, 'SMTP port must be between 1 and 65535');

  // Save or update settings
  const settings = await EmailSettings.upsert(targetUserId, {
    smtpHost,
    smtpPort,
    smtpSecure: finalSmtpSecure,
    smtpUsername,
    smtpPassword,
    fromEmail,
    fromName: fromName || null,
    replyToEmail: replyToEmail || null
  });

  res.status(200).json({
    success: true,
    message: 'Email settings saved successfully',
    data: settings
  });
}));

/**
 * @route   GET /api/users/:userId/email-settings
 * @desc    Get email server settings (password excluded)
 * @access  Private (user can only view their own settings, or admin)
 */
router.get('/:userId/email-settings', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { userId: targetUserId } = req.params;

  // Authorization
  if (userId !== targetUserId && userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      error: 'You can only view your own email settings'
    });
  }

  let settings = await EmailSettings.findByUserId(targetUserId);

  if (!settings) {
    // Create default settings for the logged-in user (not the target user from params)
    settings = await EmailSettings.upsert(userId, {
      smtpHost: '',
      smtpPort: 587,
      smtpSecure: false,
      smtpUsername: '',
      fromEmail: '',
      fromName: '',
      replyToEmail: '',
      isActive: true
    });
  }

  res.status(200).json({
    success: true,
    data: settings
  });
}));

/**
 * @route   POST /api/users/:userId/email-settings/test
 * @desc    Test SMTP connection
 * @access  Private
 */
router.post('/:userId/email-settings/test', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { userId: targetUserId } = req.params;
  const { testEmail } = req.body;

  // Authorization
  if (userId !== targetUserId && userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  // Validate test email if provided
  if (testEmail) {
    validate(isValidEmail(testEmail), 'Invalid test email address');
  }

  try {
    const result = await testConnection(targetUserId, testEmail);

    res.status(200).json({
      success: true,
      message: 'SMTP connection successful',
      details: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'SMTP connection failed',
      details: {
        message: error.message
      }
    });
  }
}));

/**
 * @route   DELETE /api/users/:userId/email-settings
 * @desc    Delete email server settings
 * @access  Private
 */
router.delete('/:userId/email-settings', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { userId: targetUserId } = req.params;

  // Authorization
  if (userId !== targetUserId && userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      error: 'You can only delete your own email settings'
    });
  }

  await EmailSettings.delete(targetUserId);

  res.status(200).json({
    success: true,
    message: 'Email settings deleted successfully'
  });
}));

/**
 * @route   POST /api/users/:userId/send-email
 * @desc    Send email using user's SMTP settings
 * @access  Private
 */
router.post('/:userId/send-email', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { userId: targetUserId } = req.params;

  // Authorization
  if (userId !== targetUserId && userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const {
    to,
    cc,
    bcc,
    subject,
    bodyText,
    bodyHtml,
    attachments,
    fromEmail,
    fromName,
    replyTo
  } = req.body;

  // Validate required fields
  validate(to && Array.isArray(to) && to.length > 0, 'At least one recipient email is required');
  validate(subject, 'Email subject is required');
  validate(bodyText || bodyHtml, 'Email body (text or HTML) is required');

  try {
    const result = await sendEmail(targetUserId, {
      to,
      cc,
      bcc,
      subject,
      bodyText,
      bodyHtml,
      attachments,
      fromEmail,
      fromName,
      replyTo
    });

    res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: {
        message: error.message
      }
    });
  }
}));

/**
 * @route   GET /api/users/:userId/email-logs
 * @desc    Get email sending history
 * @access  Private
 */
router.get('/:userId/email-logs', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { userId: targetUserId } = req.params;

  // Authorization
  if (userId !== targetUserId && userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      error: 'You can only view your own email logs'
    });
  }

  const {
    limit = 50,
    offset = 0,
    status,
    startDate,
    endDate
  } = req.query;

  const result = await EmailLog.findByUserId(targetUserId, {
    limit: parseInt(limit),
    offset: parseInt(offset),
    status,
    startDate,
    endDate
  });

  res.status(200).json({
    success: true,
    count: result.count,
    total: result.total,
    data: result.logs
  });
}));

/**
 * @route   GET /api/users/:userId/email-stats
 * @desc    Get email statistics
 * @access  Private
 */
router.get('/:userId/email-stats', authenticate, catchAsync(async (req, res) => {
  const { userId, userRole } = getUserContext(req);
  const { userId: targetUserId } = req.params;
  const { days = 30 } = req.query;

  // Authorization
  if (userId !== targetUserId && userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const stats = await EmailLog.getStatistics(targetUserId, parseInt(days));

  res.status(200).json({
    success: true,
    data: stats
  });
}));

module.exports = router;
