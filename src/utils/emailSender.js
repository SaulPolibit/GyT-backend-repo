/**
 * Email Sender Utility
 * Handles sending emails via Resend
 *
 * Priority for "from" email:
 * 1. Explicit fromEmail parameter passed to sendEmail()
 * 2. Verified domain configuration from database
 * 3. RESEND_FROM_EMAIL environment variable (fallback)
 */

const { Resend } = require('resend');
const { EmailLog, EmailDomain } = require('../models/supabase');

// Create Resend client lazily to ensure it uses current env variable
// (avoids module caching issues in serverless environments)
function getResendClient() {
  return new Resend(process.env.RESEND_API_KEY);
}

// Cache for verified domain to avoid repeated DB queries
let cachedVerifiedDomain = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get the first verified domain from database (with caching)
 */
async function getVerifiedDomainConfig() {
  const now = Date.now();

  // Return cached value if still valid
  if (cachedVerifiedDomain !== null && now < cacheExpiry) {
    return cachedVerifiedDomain;
  }

  try {
    const verifiedDomains = await EmailDomain.findVerified();
    cachedVerifiedDomain = verifiedDomains.length > 0 ? verifiedDomains[0] : null;
    cacheExpiry = now + CACHE_TTL;
    return cachedVerifiedDomain;
  } catch (error) {
    console.error('Error fetching verified domain:', error.message);
    return null;
  }
}

/**
 * Clear the domain cache (call this when domain config changes)
 */
function clearDomainCache() {
  cachedVerifiedDomain = null;
  cacheExpiry = 0;
}

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
 * Test Resend connection by sending a test email
 */
async function testConnection(userId, testEmail) {
  if (!testEmail || !isValidEmail(testEmail)) {
    throw new Error('Valid test email address is required');
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  if (!process.env.RESEND_FROM_EMAIL) {
    throw new Error('RESEND_FROM_EMAIL environment variable is not configured');
  }

  try {
    const startTime = Date.now();
    const resend = getResendClient();

    // Send test email using Resend
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL,
      to: [testEmail],
      subject: 'Resend Test Email',
      html: '<p>This is a test email to verify your Resend configuration is working correctly.</p>',
      text: 'This is a test email to verify your Resend configuration is working correctly.'
    });

    if (error) {
      throw new Error(error.message || 'Failed to send test email');
    }

    const responseTime = Date.now() - startTime;

    return {
      connected: true,
      testEmailSent: true,
      responseTime,
      messageId: data.id
    };
  } catch (error) {
    throw new Error(`Resend connection failed: ${error.message}`);
  }
}

/**
 * Send email using Resend
 *
 * Priority for "from" configuration:
 * 1. Explicit fromEmail/fromName parameters
 * 2. Verified domain from database (white-label)
 * 3. Environment variables (fallback)
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

  // Validate Resend configuration
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is not configured');
  }

  // Get verified domain config from database
  const verifiedDomain = await getVerifiedDomainConfig();

  // Determine final "from" values with priority:
  // 1. Explicit parameter > 2. Database config > 3. Environment variable
  const finalFromEmail = fromEmail
    || (verifiedDomain?.fromEmail)
    || process.env.RESEND_FROM_EMAIL;

  const finalFromName = fromName
    || (verifiedDomain?.fromName)
    || null;

  const finalReplyTo = replyTo
    || (verifiedDomain?.replyToEmail)
    || null;

  if (!finalFromEmail) {
    throw new Error('No from email configured. Please configure a verified domain or set RESEND_FROM_EMAIL environment variable.');
  }

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

  // Prepare "from" field
  const from = finalFromName
    ? `${finalFromName} <${finalFromEmail}>`
    : finalFromEmail;

  // Process attachments for Resend format
  const processedAttachments = attachments ? attachments.map(att => {
    // Resend expects attachments in this format:
    // { filename: string, content: Buffer | string }
    if (att.content && typeof att.content === 'string') {
      // If content is base64 string, convert to Buffer
      return {
        filename: att.filename,
        content: Buffer.from(att.content, 'base64')
      };
    }
    return {
      filename: att.filename,
      content: att.content
    };
  }) : undefined;

  // Prepare email data for Resend
  const emailPayload = {
    from,
    to,
    subject,
    html: bodyHtml || undefined,
    text: bodyText || undefined,
    cc: cc && cc.length > 0 ? cc : undefined,
    bcc: bcc && bcc.length > 0 ? bcc : undefined,
    reply_to: finalReplyTo || undefined,
    attachments: processedAttachments
  };

  try {
    // Send email via Resend
    const resend = getResendClient();
    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
      throw new Error(error.message || 'Failed to send email via Resend');
    }

    // Log successful send
    await EmailLog.create({
      userId,
      emailSettingsId: null, // Not using EmailSettings anymore
      toAddresses: to,
      ccAddresses: cc || [],
      bccAddresses: bcc || [],
      subject,
      bodyText,
      bodyHtml,
      hasAttachments: !!(attachments && attachments.length > 0),
      attachmentCount: attachments ? attachments.length : 0,
      status: 'sent',
      messageId: data.id,
      sentAt: new Date().toISOString()
    });

    return {
      success: true,
      messageId: data.id,
      to,
      subject,
      sentAt: new Date().toISOString()
    };
  } catch (error) {
    // Log failed attempt
    await EmailLog.create({
      userId,
      emailSettingsId: null,
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
  validateEmailAddresses,
  clearDomainCache,
  getVerifiedDomainConfig
};
