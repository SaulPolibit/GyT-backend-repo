/**
 * Email Domain API Routes
 * Endpoints for managing email domains for white-label email sending
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { EmailDomain } = require('../models/supabase');
const { getUserContext, ROLES } = require('../middleware/rbac');
const {
  createDomain,
  getDomain,
  verifyDomain,
  listDomains,
  deleteDomain,
  formatDnsRecords
} = require('../utils/resendDomains');
const { clearDomainCache } = require('../utils/emailSender');

const router = express.Router();

/**
 * @route   GET /api/email-domains
 * @desc    Get all email domains
 * @access  Private (Root and Admin only)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  // Only ROOT and ADMIN can view domains
  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only ROOT and ADMIN users can view email domains'
    });
  }

  const domains = await EmailDomain.findAll();

  res.status(200).json({
    success: true,
    count: domains.length,
    data: domains
  });
}));

/**
 * @route   GET /api/email-domains/verified
 * @desc    Get only verified domains (for sending emails)
 * @access  Private (Root and Admin only)
 */
router.get('/verified', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);

  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  const domains = await EmailDomain.findVerified();

  res.status(200).json({
    success: true,
    count: domains.length,
    data: domains
  });
}));

/**
 * @route   GET /api/email-domains/:id
 * @desc    Get a single email domain by ID
 * @access  Private (Root and Admin only)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  const domain = await EmailDomain.findById(id);

  if (!domain) {
    return res.status(404).json({
      success: false,
      message: 'Email domain not found'
    });
  }

  // Get latest status from Resend if we have a resend domain ID
  if (domain.resendDomainId) {
    try {
      const resendDomain = await getDomain(domain.resendDomainId);
      // Update local record if status changed
      if (resendDomain.status !== domain.status) {
        await EmailDomain.updateStatus(
          domain.id,
          resendDomain.status,
          resendDomain.records
        );
        domain.status = resendDomain.status;
        domain.dnsRecords = resendDomain.records;
      }
    } catch (error) {
      console.error('Error fetching domain from Resend:', error.message);
    }
  }

  res.status(200).json({
    success: true,
    data: domain
  });
}));

/**
 * @route   POST /api/email-domains
 * @desc    Add a new email domain
 * @access  Private (Root only)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { domainName, region } = req.body;

  // Only ROOT can add domains
  if (userRole !== ROLES.ROOT) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only ROOT users can add email domains'
    });
  }

  validate(domainName, 'Domain name is required');

  // Check if domain already exists in our database
  const existingDomain = await EmailDomain.findByDomainName(domainName);
  if (existingDomain) {
    return res.status(409).json({
      success: false,
      message: 'This domain is already registered'
    });
  }

  // Create domain in Resend
  let resendDomain;
  try {
    resendDomain = await createDomain(domainName.toLowerCase(), region);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }

  // Save to our database
  const emailDomain = await EmailDomain.create({
    resendDomainId: resendDomain.id,
    domainName: resendDomain.name,
    status: resendDomain.status,
    region: resendDomain.region,
    dnsRecords: resendDomain.records
  });

  res.status(201).json({
    success: true,
    message: 'Domain added successfully. Please add the DNS records to verify.',
    data: {
      ...emailDomain,
      dnsRecords: formatDnsRecords(resendDomain.records)
    }
  });
}));

/**
 * @route   POST /api/email-domains/:id/verify
 * @desc    Verify a domain's DNS records
 * @access  Private (Root and Admin only)
 */
router.post('/:id/verify', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  const domain = await EmailDomain.findById(id);

  if (!domain) {
    return res.status(404).json({
      success: false,
      message: 'Email domain not found'
    });
  }

  if (!domain.resendDomainId) {
    return res.status(400).json({
      success: false,
      message: 'Domain is not linked to Resend'
    });
  }

  // Trigger verification in Resend
  try {
    await verifyDomain(domain.resendDomainId);
  } catch (error) {
    // Ignore verify errors, we'll check actual status next
    console.log('Verify call result:', error.message);
  }

  // Get the actual current status from Resend
  let domainStatus;
  try {
    // Debug: Log which API key is being used (first 10 chars only)
    const apiKey = process.env.RESEND_API_KEY || '';
    console.log('[EmailDomain] Using API key:', apiKey.substring(0, 10) + '...');

    domainStatus = await getDomain(domain.resendDomainId);
    // Debug: Log what Resend returns
    console.log('[EmailDomain] Resend domain status:', JSON.stringify(domainStatus, null, 2));
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: `Failed to get domain status: ${error.message}`
    });
  }

  // Update local record with actual status
  const updatedDomain = await EmailDomain.updateStatus(
    domain.id,
    domainStatus.status,
    domainStatus.records
  );

  const isVerified = domainStatus.status === 'verified';

  // Clear email sender cache so it picks up the newly verified domain
  if (isVerified) {
    clearDomainCache();
  }

  res.status(200).json({
    success: true,
    verified: isVerified,
    message: isVerified
      ? 'Domain verified successfully! You can now send emails from this domain.'
      : 'DNS records not yet verified. Please ensure all records are added correctly and try again.',
    data: {
      ...updatedDomain,
      dnsRecords: formatDnsRecords(domainStatus.records)
    }
  });
}));

/**
 * @route   PUT /api/email-domains/:id/config
 * @desc    Update email configuration (fromEmail, fromName, replyTo)
 * @access  Private (Root and Admin only)
 */
router.put('/:id/config', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;
  const { fromEmail, fromName, replyToEmail } = req.body;

  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  const domain = await EmailDomain.findById(id);

  if (!domain) {
    return res.status(404).json({
      success: false,
      message: 'Email domain not found'
    });
  }

  // Validate that fromEmail matches the domain
  if (fromEmail) {
    const emailDomain = fromEmail.split('@')[1];
    if (emailDomain?.toLowerCase() !== domain.domainName.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: `From email must use the domain ${domain.domainName}`
      });
    }
  }

  // Validate replyToEmail format if provided
  if (replyToEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(replyToEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reply-to email format'
      });
    }
  }

  const updatedDomain = await EmailDomain.updateEmailConfig(id, {
    fromEmail,
    fromName,
    replyToEmail
  });

  // Clear email sender cache so it picks up the new config
  clearDomainCache();

  res.status(200).json({
    success: true,
    message: 'Email configuration updated successfully',
    data: updatedDomain
  });
}));

/**
 * @route   DELETE /api/email-domains/:id
 * @desc    Delete an email domain
 * @access  Private (Root only)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  // Only ROOT can delete domains
  if (userRole !== ROLES.ROOT) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Only ROOT users can delete email domains'
    });
  }

  const domain = await EmailDomain.findById(id);

  if (!domain) {
    return res.status(404).json({
      success: false,
      message: 'Email domain not found'
    });
  }

  // Delete from Resend
  if (domain.resendDomainId) {
    try {
      await deleteDomain(domain.resendDomainId);
    } catch (error) {
      console.error('Error deleting domain from Resend:', error.message);
      // Continue with local deletion even if Resend fails
    }
  }

  // Delete from our database
  await EmailDomain.delete(id);

  // Clear email sender cache
  clearDomainCache();

  res.status(200).json({
    success: true,
    message: 'Email domain deleted successfully'
  });
}));

/**
 * @route   GET /api/email-domains/:id/dns-records
 * @desc    Get DNS records for a domain (refresh from Resend)
 * @access  Private (Root and Admin only)
 */
router.get('/:id/dns-records', authenticate, catchAsync(async (req, res) => {
  const { userRole } = getUserContext(req);
  const { id } = req.params;

  if (userRole !== ROLES.ROOT && userRole !== ROLES.ADMIN) {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized'
    });
  }

  const domain = await EmailDomain.findById(id);

  if (!domain) {
    return res.status(404).json({
      success: false,
      message: 'Email domain not found'
    });
  }

  if (!domain.resendDomainId) {
    return res.status(400).json({
      success: false,
      message: 'Domain is not linked to Resend'
    });
  }

  // Get fresh DNS records from Resend
  let resendDomain;
  try {
    resendDomain = await getDomain(domain.resendDomainId);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: `Failed to get DNS records: ${error.message}`
    });
  }

  // Update local record
  await EmailDomain.updateStatus(
    domain.id,
    resendDomain.status,
    resendDomain.records
  );

  res.status(200).json({
    success: true,
    data: {
      domainName: domain.domainName,
      status: resendDomain.status,
      records: formatDnsRecords(resendDomain.records)
    }
  });
}));

module.exports = router;
