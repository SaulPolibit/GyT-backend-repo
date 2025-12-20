/**
 * Email Sender Utility
 * Handles sending emails via SMTP using nodemailer
 */

const nodemailer = require('nodemailer');
const { EmailSettings, EmailLog } = require('../models/supabase');
const { decrypt } = require('./encryption');

/**
 * Validate email address format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate email addresses in an array
 */
function validateEmailAddresses(emails) {
  if (!Array.isArray(emails)) {
    return { valid: false, error: 'Email addresses must be an array' };
  }

  for (const email of emails) {
    if (!isValidEmail(email)) {
      return { valid: false, error: `Invalid email address: ${email}` };
    }
  }

  return { valid: true };
}

/**
 * Create nodemailer transporter from user's email settings
 */
async function createTransporter(userId) {
  // Get user's email settings
  const settings = await EmailSettings.findByUserId(userId, true);

  if (!settings) {
    throw new Error('Email settings not configured. Please configure SMTP settings first.');
  }

  if (!settings.isActive) {
    throw new Error('Email settings are inactive');
  }

  // Decrypt password
  let password;
  try {
    password = decrypt(settings.smtpPassword);
  } catch (error) {
    throw new Error('Failed to decrypt SMTP password');
  }

  // Create transporter with proper SSL/TLS configuration
  const transportConfig = {
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure, // true for 465, false for other ports (587, 25)
    auth: {
      user: settings.smtpUsername,
      pass: password
    },
    // TLS options for better compatibility
    tls: {
      // Do not fail on invalid certs (useful for self-signed certificates)
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    }
  };

  const transporter = nodemailer.createTransport(transportConfig);

  return { transporter, settings };
}

/**
 * Test SMTP connection
 */
async function testConnection(userId, testEmail = null) {
  try {
    const { transporter, settings } = await createTransporter(userId);

    // Verify connection
    const startTime = Date.now();
    await transporter.verify();
    const responseTime = Date.now() - startTime;

    let testEmailSent = false;

    // Optionally send test email
    if (testEmail && isValidEmail(testEmail)) {
      await transporter.sendMail({
        from: `"${settings.fromName || 'Test'}" <${settings.fromEmail}>`,
        to: testEmail,
        subject: 'SMTP Test Email',
        text: 'This is a test email to verify your SMTP configuration is working correctly.',
        html: '<p>This is a test email to verify your SMTP configuration is working correctly.</p>'
      });
      testEmailSent = true;
    }

    return {
      connected: true,
      testEmailSent,
      responseTime
    };
  } catch (error) {
    throw new Error(`SMTP connection failed: ${error.message}`);
  }
}

/**
 * Send email using user's SMTP settings
 */
async function sendEmail(userId, emailData) {
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
  } = emailData;

  // Validate required fields
  if (!to || !Array.isArray(to) || to.length === 0) {
    throw new Error('At least one recipient email address is required');
  }

  if (!subject) {
    throw new Error('Email subject is required');
  }

  if (!bodyText && !bodyHtml) {
    throw new Error('Email body (text or HTML) is required');
  }

  // Validate email addresses
  const toValidation = validateEmailAddresses(to);
  if (!toValidation.valid) {
    throw new Error(toValidation.error);
  }

  if (cc) {
    const ccValidation = validateEmailAddresses(cc);
    if (!ccValidation.valid) {
      throw new Error(ccValidation.error);
    }
  }

  if (bcc) {
    const bccValidation = validateEmailAddresses(bcc);
    if (!bccValidation.valid) {
      throw new Error(bccValidation.error);
    }
  }

  // Get transporter and settings
  const { transporter, settings } = await createTransporter(userId);

  // Process attachments to ensure proper format
  const processedAttachments = attachments ? attachments.map(att => {
    // If attachment has base64 content, ensure encoding is specified
    if (att.content && typeof att.content === 'string') {
      return {
        filename: att.filename,
        content: att.content,
        encoding: att.encoding || 'base64',
        contentType: att.contentType || att.mimeType
      };
    }
    // If it's already in proper nodemailer format (path, href, etc.)
    return att;
  }) : [];

  // Prepare email
  const mailOptions = {
    from: `"${fromName || settings.fromName || ''}" <${fromEmail || settings.fromEmail}>`,
    to: to.join(', '),
    cc: cc ? cc.join(', ') : undefined,
    bcc: bcc ? bcc.join(', ') : undefined,
    replyTo: replyTo || settings.replyToEmail,
    subject,
    text: bodyText,
    html: bodyHtml,
    attachments: processedAttachments
  };

  try {
    // Send email
    const info = await transporter.sendMail(mailOptions);

    // Log successful send
    await EmailLog.create({
      userId,
      emailSettingsId: settings.id,
      toAddresses: to,
      ccAddresses: cc || [],
      bccAddresses: bcc || [],
      subject,
      bodyText,
      bodyHtml,
      hasAttachments: !!(attachments && attachments.length > 0),
      attachmentCount: attachments ? attachments.length : 0,
      status: 'sent',
      messageId: info.messageId,
      sentAt: new Date().toISOString()
    });

    // Update last used timestamp
    await EmailSettings.updateLastUsed(userId);

    return {
      success: true,
      messageId: info.messageId,
      to,
      subject,
      sentAt: new Date().toISOString()
    };
  } catch (error) {
    // Log failed attempt
    await EmailLog.create({
      userId,
      emailSettingsId: settings.id,
      toAddresses: to,
      ccAddresses: cc || [],
      bccAddresses: bcc || [],
      subject,
      bodyText,
      bodyHtml,
      hasAttachments: !!(attachments && attachments.length > 0),
      attachmentCount: attachments ? attachments.length : 0,
      status: 'failed',
      errorMessage: error.message
    });

    throw new Error(`Failed to send email: ${error.message}`);
  }
}

module.exports = {
  sendEmail,
  testConnection,
  isValidEmail,
  validateEmailAddresses
};
