/**
 * DocuSeal API Routes
 * Document submission management endpoints
 */

const express = require('express');
const apiManager = require('../services/apiManager');
const { authenticate } = require('../middleware/auth');
const {
  catchAsync,
  validate,
  NotFoundError,
  AuthorizationError
} = require('../middleware/errorHandler');
const { User, DocusealSubmission, Payment } = require('../models/supabase');

const router = express.Router();

/**
 * @route   GET /api/docuseal/submissions/:submissionId
 * @desc    Get a single document submission by ID
 * @access  Public
 * @params  submissionId - The submission ID
 * @query   aPIToken?: string (optional, uses env if not provided)
 */
router.get('/submissions/:submissionId', authenticate, catchAsync(async (req, res) => {
  const { submissionId } = req.params;

  // Validate submission ID
  validate(submissionId, 'submissionId is required');
  validate(submissionId.length > 0, 'Invalid submissionId');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query, 
    submissionID: submissionId 
  };

  const result = await apiManager.getSingleSubmission(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`Submission with ID ${submissionId} not found`);
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch submission',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    data: result.body,
  });
}));

/**
 * @route   DELETE /api/docuseal/submissions/:submissionId
 * @desc    Delete a document submission
 * @access  Private (requires authentication)
 * @params  submissionId - The submission ID
 * @query   aPIToken?: string (optional)
 */
router.delete('/submissions/:submissionId', authenticate, catchAsync(async (req, res) => {
  const { submissionId } = req.params;

  // Validate submission ID
  validate(submissionId, 'submissionId is required');
  validate(submissionId.length > 0, 'Invalid submissionId');

  const context = { auth: req.auth };
  const variables = { 
    submissionID: submissionId, 
    ...req.body,
    ...req.query 
  };

  const result = await apiManager.deleteSubmission(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`Submission with ID ${submissionId} not found`);
    }

    if (result.statusCode === 403) {
      throw new AuthorizationError('You do not have permission to delete this submission');
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to delete submission',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    message: `Submission ${submissionId} deleted successfully`,
    data: result.body,
  });
}));

/**
 * @route   GET /api/docuseal/submissions
 * @desc    Get all submissions with optional filters
 * @access  Public
 * @query   {
 *            q?: string (search query),
 *            templateId?: string (filter by template),
 *            status?: string (filter by status),
 *            limit?: number (max results, default 50),
 *            offset?: number (pagination offset),
 *            aPIToken?: string (optional)
 *          }
 */
router.get('/submissions', authenticate, catchAsync(async (req, res) => {
  const { q, templateId, status, limit = 50, offset = 0 } = req.query;

  // Validate pagination parameters
  const limitNum = parseInt(limit);
  const offsetNum = parseInt(offset);
  
  validate(!isNaN(limitNum) && limitNum > 0, 'limit must be a positive number');
  validate(!isNaN(offsetNum) && offsetNum >= 0, 'offset must be a non-negative number');
  validate(limitNum <= 100, 'limit cannot exceed 100');

  const context = { auth: req.auth };
  const variables = {
    q,
    templateId,
    status,
    limit: limitNum,
    offset: offsetNum,
    ...req.query,
  };

  const result = await apiManager.getSubmissions(context, variables);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch submissions',
      details: result.body,
    });
  }

  const submissions = result.body || [];
  const count = Array.isArray(submissions) ? submissions.length : 0;

  res.status(result.statusCode || 200).json({
    success: true,
    count,
    limit: limitNum,
    offset: offsetNum,
    hasMore: count === limitNum,
    data: submissions,
  });
}));

/**
 * @route   GET /api/docuseal/submissions/search
 * @desc    Search submissions by query
 * @access  Public
 * @query   {
 *            q: string (required - search query),
 *            templateId?: string,
 *            aPIToken?: string
 *          }
 */
router.get('/submissions/search', authenticate, catchAsync(async (req, res) => {
  const { q, templateId } = req.query;

  validate(q, 'Search query (q) is required');
  validate(q.length >= 2, 'Search query must be at least 2 characters');

  const context = { auth: req.auth };
  const variables = {
    q,
    templateId,
    ...req.query,
  };

  const result = await apiManager.getSubmissions(context, variables);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to search submissions',
      details: result.body,
    });
  }

  const submissions = result.body || [];
  const count = Array.isArray(submissions) ? submissions.length : 0;

  res.status(result.statusCode || 200).json({
    success: true,
    query: q,
    count,
    data: submissions,
  });
}));

/**
 * @route   GET /api/docuseal/submissions/template/:templateId
 * @desc    Get all submissions for a specific template
 * @access  Public
 * @params  templateId - The template ID
 * @query   {
 *            limit?: number,
 *            offset?: number,
 *            aPIToken?: string
 *          }
 */
router.get('/submissions/template/:templateId', authenticate, catchAsync(async (req, res) => {
  const { templateId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  validate(templateId, 'templateId is required');

  const limitNum = parseInt(limit);
  const offsetNum = parseInt(offset);
  
  validate(!isNaN(limitNum) && limitNum > 0, 'limit must be a positive number');
  validate(!isNaN(offsetNum) && offsetNum >= 0, 'offset must be a non-negative number');

  const context = { auth: req.auth };
  const variables = {
    templateId,
    limit: limitNum,
    offset: offsetNum,
    ...req.query,
  };

  const result = await apiManager.getSubmissions(context, variables);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: `Failed to fetch submissions for template ${templateId}`,
      details: result.body,
    });
  }

  const submissions = result.body || [];
  const count = Array.isArray(submissions) ? submissions.length : 0;

  res.status(result.statusCode || 200).json({
    success: true,
    templateId,
    count,
    limit: limitNum,
    offset: offsetNum,
    hasMore: count === limitNum,
    data: submissions,
  });
}));

/**
 * @route   GET /api/docuseal/submissions/:submissionId/status
 * @desc    Get submission status and completion info
 * @access  Public
 * @params  submissionId - The submission ID
 */
router.get('/submissions/:submissionId/status', authenticate, catchAsync(async (req, res) => {
  const { submissionId } = req.params;

  validate(submissionId, 'submissionId is required');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query, 
    submissionID: submissionId 
  };

  const result = await apiManager.getSingleSubmission(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`Submission with ID ${submissionId} not found`);
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch submission status',
    });
  }

  const submission = result.body;
  const status = {
    submissionId: submission.id || submissionId,
    status: submission.status || 'unknown',
    completed: submission.completed || false,
    completedAt: submission.completed_at,
    createdAt: submission.created_at,
    updatedAt: submission.updated_at,
    signers: submission.signers || [],
    template: {
      id: submission.template_id,
      name: submission.template_name,
    },
  };

  res.status(200).json({
    success: true,
    data: status,
  });
}));

/**
 * @route   GET /api/docuseal/submissions/:submissionId/download
 * @desc    Get download URL for submission documents
 * @access  Public
 * @params  submissionId - The submission ID
 */
router.get('/submissions/:submissionId/download', authenticate, catchAsync(async (req, res) => {
  const { submissionId } = req.params;

  validate(submissionId, 'submissionId is required');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query, 
    submissionID: submissionId 
  };

  const result = await apiManager.getSingleSubmission(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`Submission with ID ${submissionId} not found`);
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to get download URL',
    });
  }

  const submission = result.body;
  
  // Check if submission is completed
  if (!submission.completed) {
    return res.status(400).json({
      success: false,
      message: 'Submission is not completed yet',
      status: submission.status,
    });
  }

  res.status(200).json({
    success: true,
    submissionId,
    downloadUrls: submission.documents || [],
    expiresIn: '24 hours',
  });
}));

/**
 * @route   POST /api/docuseal/submissions/:submissionId/resend
 * @desc    Resend submission notification (placeholder - implement based on DocuSeal API)
 * @access  Private
 * @params  submissionId - The submission ID
 */
router.post('/submissions/:submissionId/resend', authenticate, catchAsync(async (req, res) => {
  const { submissionId } = req.params;

  validate(submissionId, 'submissionId is required');

  // Note: This is a placeholder. Implement actual resend logic based on DocuSeal API
  res.status(200).json({
    success: true,
    message: `Notification resent for submission ${submissionId}`,
    submissionId,
  });
}));

/**
 * @route   GET /api/docuseal/submissions/stats
 * @desc    Get submission statistics
 * @access  Public
 * @query   templateId?: string
 */
router.get('/submissions/stats', authenticate, catchAsync(async (req, res) => {
  const { templateId } = req.query;

  const context = { auth: req.auth };
  const variables = {
    templateId,
    ...req.query,
  };

  const result = await apiManager.getSubmissions(context, variables);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch submission stats',
    });
  }

  const submissions = result.body || [];
  
  // Calculate statistics
  const stats = {
    total: submissions.length,
    completed: submissions.filter(s => s.completed === true).length,
    pending: submissions.filter(s => s.status === 'pending').length,
    expired: submissions.filter(s => s.status === 'expired').length,
    declined: submissions.filter(s => s.status === 'declined').length,
  };

  stats.completionRate = stats.total > 0 
    ? ((stats.completed / stats.total) * 100).toFixed(2) + '%' 
    : '0%';

  res.status(200).json({
    success: true,
    ...(templateId && { templateId }),
    stats,
  });
}));

/**
 * @route   POST /api/docuseal/webhook
 * @desc    Handle DocuSeal webhook events
 * @access  Public (DocuSeal webhook)
 * @body    Webhook payload from DocuSeal
 */
router.post('/webhook', catchAsync(async (req, res) => {
  // Log incoming webhook request for debugging
  console.log('[DocuSeal Webhook] Received webhook request');
  console.log('[DocuSeal Webhook] Headers:', JSON.stringify(req.headers, null, 2));
  console.log('[DocuSeal Webhook] Body:', JSON.stringify(req.body, null, 2));

  // Validate X-PoliBit-Signature header
  const signature = req.headers['x-polibit-signature'];
  const expectedSignature = '2900f56566097c95876078f8ebed731a374a888d7f5a5a518e2e5d9f518775d8';

  console.log('[DocuSeal Webhook] Signature validation:', {
    received: signature,
    expected: expectedSignature,
    isValid: signature === expectedSignature
  });

  if (signature !== expectedSignature) {
    console.log('[DocuSeal Webhook] Invalid signature - rejecting request');
    return res.status(401).json({
      success: false,
      message: 'Invalid signature',
      signature: signature
    });
  }

  const { event_type, data } = req.body;

  console.log('[DocuSeal Webhook] Event type:', event_type);

  // Validate webhook payload
  validate(event_type, 'event_type is required');
  validate(data, 'data is required');

  // Only process submission.created and form.completed events
  if (event_type === 'submission.created') {
    console.log('[DocuSeal Webhook] Processing submission.created event');

    // For submission.created, data is directly in the data object (no nested submission)
    const submissionId = data.id;
    const slug = data.slug;
    const auditLogUrl = data.audit_log_url;
    const status = data.status || 'created';

    // Get email from submitters array
    const submitters = data.submitters || [];
    console.log('[DocuSeal Webhook] ===== SUBMISSION CREATED DEBUG =====');
    console.log('[DocuSeal Webhook] All submitters:', JSON.stringify(submitters, null, 2));
    console.log('[DocuSeal Webhook] Full data object:', JSON.stringify(data, null, 2));
    console.log('[DocuSeal Webhook] External ID:', data.external_id);

    let email = null;
    let userId = null;

    // Strategy 1: Use external_id to find the user directly (most reliable)
    if (data.external_id && data.external_id.startsWith('user_')) {
      const extractedUserId = data.external_id.replace('user_', '');
      console.log('[DocuSeal Webhook] Found external_id, extracting user ID:', extractedUserId);

      try {
        const user = await User.findById(extractedUserId);
        if (user) {
          email = user.email;
          userId = user.id;
          console.log('[DocuSeal Webhook] ✅ Found user by external_id:', { userId: user.id, email: user.email });
        } else {
          console.log('[DocuSeal Webhook] ⚠️ User not found with ID:', extractedUserId);
        }
      } catch (error) {
        console.log('[DocuSeal Webhook] ⚠️ Error finding user by external_id:', error.message);
      }
    }

    // Strategy 2: If external_id didn't work, try finding submitter by role
    if (!email && submitters.length > 0) {
      const clientSubmitter = submitters.find(s =>
        s.name && (
          s.name.toLowerCase() === 'client' ||
          s.name.toLowerCase() === 'customer' ||
          s.name.toLowerCase() === 'investor'
        )
      );

      if (clientSubmitter && clientSubmitter.email) {
        email = clientSubmitter.email;
        console.log('[DocuSeal Webhook] Found client submitter by role name:', {
          name: clientSubmitter.name,
          email: clientSubmitter.email
        });
      }
    }

    // Strategy 3: Check if data has an email field directly
    if (!email && data.email) {
      email = data.email;
      console.log('[DocuSeal Webhook] Found email in data.email:', email);
    }

    // Strategy 4: Use first submitter with an email (least reliable)
    if (!email && submitters.length > 0) {
      const firstWithEmail = submitters.find(s => s.email);
      email = firstWithEmail ? firstWithEmail.email : null;
      console.log('[DocuSeal Webhook] ⚠️ Using first submitter with email (fallback):', email);

      // Log submitter structure for debugging
      if (submitters.length > 0) {
        console.log('[DocuSeal Webhook] First submitter structure:', submitters[0]);
      }
    }

    console.log('[DocuSeal Webhook] ===== FINAL RESULT =====');
    console.log('[DocuSeal Webhook] Extracted email:', email);
    console.log('[DocuSeal Webhook] Extracted userId:', userId);

    // Construct submission URL from slug
    const submissionURL = `https://docuseal.com/s/${slug}`;

    console.log('[DocuSeal Webhook] Extracted data:', {
      submissionId,
      email,
      slug,
      submissionURL,
      auditLogUrl,
      status
    });

    // Validate required fields
    if (!email || !submissionId) {
      console.log('[DocuSeal Webhook] Validation failed - missing email or submissionId');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email or submissionId'
      });
    }

    console.log('[DocuSeal Webhook] Creating new submission:', { email, submissionId, submissionURL, auditLogUrl, status, userId });

    // If we don't have userId yet, try to find user by email
    if (!userId && email) {
      const user = await User.findByEmail(email);
      userId = user ? user.id : null;

      if (!user) {
        console.log('[DocuSeal Webhook] ⚠️ Warning: No user found for email:', email);
      } else {
        console.log('[DocuSeal Webhook] Found user by email:', { id: user.id, email: user.email });
      }
    }

    // Create new submission record with user_id
    const newSubmission = await DocusealSubmission.create({
      email,
      submissionId,
      submissionURL,
      auditLogUrl,
      status,
      userId
    });

    console.log('[DocuSeal Webhook] Submission created successfully:', newSubmission);

    return res.status(201).json({
      success: true,
      message: 'Submission created successfully',
      data: newSubmission
    });
  }

  if (event_type === 'submission.completed') {
    console.log('[DocuSeal Webhook] Processing submission.completed event');

    // Handle both structures: nested submission or direct data
    const submission = data.submission || data;
    const submissionId = submission.id;
    const slug = submission.slug || data.slug;
    const auditLogUrl = submission.audit_log_url || data.audit_log_url;
    const status = submission.status || 'completed';

    // Get email from submitters array
    const submitters = data.submitters || submission.submitters || [];
    console.log('[DocuSeal Webhook] ===== SUBMISSION COMPLETED DEBUG =====');
    console.log('[DocuSeal Webhook] All submitters:', JSON.stringify(submitters, null, 2));
    console.log('[DocuSeal Webhook] Full data object:', JSON.stringify(data, null, 2));
    console.log('[DocuSeal Webhook] Full submission object:', JSON.stringify(submission, null, 2));
    console.log('[DocuSeal Webhook] External ID:', submission.external_id || data.external_id);

    let email = null;
    let userId = null;

    // Strategy 1: Use external_id to find the user directly (most reliable)
    const externalId = submission.external_id || data.external_id;
    if (externalId && externalId.startsWith('user_')) {
      const extractedUserId = externalId.replace('user_', '');
      console.log('[DocuSeal Webhook] Found external_id, extracting user ID:', extractedUserId);

      try {
        const user = await User.findById(extractedUserId);
        if (user) {
          email = user.email;
          userId = user.id;
          console.log('[DocuSeal Webhook] ✅ Found user by external_id:', { userId: user.id, email: user.email });
        } else {
          console.log('[DocuSeal Webhook] ⚠️ User not found with ID:', extractedUserId);
        }
      } catch (error) {
        console.log('[DocuSeal Webhook] ⚠️ Error finding user by external_id:', error.message);
      }
    }

    // Strategy 2: If external_id didn't work, try finding submitter by role
    if (!email && submitters.length > 0) {
      const clientSubmitter = submitters.find(s =>
        s.name && (
          s.name.toLowerCase() === 'client' ||
          s.name.toLowerCase() === 'customer' ||
          s.name.toLowerCase() === 'investor'
        )
      );

      if (clientSubmitter && clientSubmitter.email) {
        email = clientSubmitter.email;
        console.log('[DocuSeal Webhook] Found client submitter by role name:', {
          name: clientSubmitter.name,
          email: clientSubmitter.email
        });
      }
    }

    // Strategy 3: Check if data/submission has an email field directly
    if (!email && data.email) {
      email = data.email;
      console.log('[DocuSeal Webhook] Found email in data.email:', email);
    } else if (!email && submission.email) {
      email = submission.email;
      console.log('[DocuSeal Webhook] Found email in submission.email:', email);
    }

    // Strategy 4: Use first submitter with an email (least reliable)
    if (!email && submitters.length > 0) {
      const firstWithEmail = submitters.find(s => s.email);
      email = firstWithEmail ? firstWithEmail.email : null;
      console.log('[DocuSeal Webhook] ⚠️ Using first submitter with email (fallback):', email);

      // Log submitter structure for debugging
      if (submitters.length > 0) {
        console.log('[DocuSeal Webhook] First submitter structure:', submitters[0]);
      }
    }

    console.log('[DocuSeal Webhook] ===== FINAL RESULT =====');
    console.log('[DocuSeal Webhook] Extracted email:', email);
    console.log('[DocuSeal Webhook] Extracted userId:', userId);

    // Construct submission URL
    const submissionURL = submission.url || (slug ? `https://docuseal.com/s/${slug}` : null);

    console.log('[DocuSeal Webhook] Extracted data:', {
      submissionId,
      email,
      slug,
      submissionURL,
      auditLogUrl,
      status
    });

    // Validate required fields
    if (!email || !submissionId) {
      console.log('[DocuSeal Webhook] Validation failed - missing email or submissionId');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: email or submissionId'
      });
    }

    console.log('[DocuSeal Webhook] Looking for existing submission:', submissionId);

    // Find existing submission by submissionId
    const existingSubmission = await DocusealSubmission.findBySubmissionId(submissionId);

    if (!existingSubmission) {
      console.log('[DocuSeal Webhook] No existing submission found - creating new one');

      // If we don't have userId yet, try to find user by email
      if (!userId && email) {
        const user = await User.findByEmail(email);
        userId = user ? user.id : null;

        if (!user) {
          console.log('[DocuSeal Webhook] ⚠️ Warning: No user found for email:', email);
        } else {
          console.log('[DocuSeal Webhook] Found user by email:', { id: user.id, email: user.email });
        }
      }

      // Create new submission if it doesn't exist
      const newSubmission = await DocusealSubmission.create({
        email,
        submissionId,
        submissionURL,
        auditLogUrl,
        status,
        userId
      });

      console.log('[DocuSeal Webhook] New submission created:', newSubmission);

      return res.status(201).json({
        success: true,
        message: 'Submission created successfully',
        data: newSubmission
      });
    }

    console.log('[DocuSeal Webhook] Updating existing submission:', existingSubmission.id);

    // Update existing submission with completed status
    const updatedSubmission = await DocusealSubmission.findByIdAndUpdate(
      existingSubmission.id,
      {
        status,
        submissionURL,
        auditLogUrl
      }
    );

    console.log('[DocuSeal Webhook] Submission updated successfully:', updatedSubmission);

    return res.status(200).json({
      success: true,
      message: 'Submission updated successfully',
      data: updatedSubmission
    });
  }

  // For other event types, just acknowledge receipt
  console.log('[DocuSeal Webhook] Unhandled event type:', event_type);

  res.status(200).json({
    success: true,
    message: `Webhook event ${event_type} received`,
    processed: false
  });
}));

/**
 * @route   GET /api/docuseal/verifyUserSignature
 * @desc    Verify if the logged-in user has unused DocuSeal submissions
 * @access  Private (requires authentication)
 * @returns {boolean} validation - true if user has unused submissions, false otherwise
 */
router.get('/verifyUserSignature', authenticate, catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Find the user to get their email
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Get all submissions for this user's email
  const userSubmissions = await DocusealSubmission.findByEmail(user.email);

  // Get all payments for this user's email
  const userPayments = await Payment.findByEmail(user.email);

  // Debug logging
  console.log('[verifyUserSignature] User email:', user.email);
  console.log('[verifyUserSignature] Total payments found:', userPayments.length);
  console.log('[verifyUserSignature] Payment submission IDs:', userPayments.map(p => ({
    submissionId: p.submissionId,
    type: typeof p.submissionId
  })));
  console.log('[verifyUserSignature] DocuSeal submissions:', userSubmissions.map(s => ({
    id: s.id,
    submissionId: s.submissionId,
    type: typeof s.submissionId
  })));

  // Extract unique submission IDs that are already used in payments
  // Note: payments.submission_id stores the Supabase UUID (docuseal_submissions.id), not the DocuSeal submission ID
  const usedSubmissionIds = new Set(
    userPayments
      .map(payment => String(payment.submissionId))
      .filter(id => id && id !== 'null' && id !== 'undefined')
  );

  console.log('[verifyUserSignature] Used submission IDs Set:', Array.from(usedSubmissionIds));

  // Find submissions that are NOT already used in payments
  // Compare payment.submissionId with submission.id (both are Supabase UUIDs)
  const freeSubmissions = userSubmissions.filter(submission => {
    const submissionIdStr = String(submission.id); // Use submission.id instead of submission.submissionId
    const isUsed = usedSubmissionIds.has(submissionIdStr);
    console.log(`[verifyUserSignature] Checking submission ID ${submissionIdStr} (DocuSeal ID: ${submission.submissionId}): isUsed=${isUsed}`);
    return !isUsed && submission.status == 'completed';
  });

  const hasFreeSubmission = freeSubmissions.length > 0;

  res.status(200).json({
    success: true,
    validation: hasFreeSubmission,
    passed: hasFreeSubmission,
    email: user.email,
    totalSubmissions: userSubmissions.length,
    usedSubmissions: usedSubmissionIds.size,
    freeSubmissions: freeSubmissions.length,
    availableSubmissions: freeSubmissions.map(sub => ({
      id: sub.id,
      submissionId: sub.submissionId,
      status: sub.status,
      submissionURL: sub.submissionURL,
      createdAt: sub.createdAt
    }))
  });
}));

/**
 * @route   GET /api/docuseal/my-submissions
 * @desc    Get all DocuSeal submissions for the logged-in user
 * @access  Private (requires authentication)
 */
router.get('/my-submissions', authenticate, catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Find the user to get their email
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Get all submissions for this user's email
  const submissions = await DocusealSubmission.findByEmail(user.email);

  res.status(200).json({
    success: true,
    count: submissions.length,
    data: submissions
  });
}));

/**
 * @route   GET /api/docuseal/verify-submission
 * @desc    Verify if current user has any docuseal submissions
 * @access  Private (requires authentication)
 * @returns {boolean} hasSubmissions - true if user has at least one submission, false otherwise
 */
router.get('/verify-submission', authenticate, catchAsync(async (req, res) => {
  // Get user ID from authenticated token
  const userId = req.auth.userId || req.user.id;

  // Find the user to get their email
  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Get all submissions for this user's email
  const submissions = await DocusealSubmission.findByEmail(user.email);

  // Return true if user has at least one submission, false otherwise
  const hasSubmissions = submissions.length > 0;

  res.status(200).json({
    success: true,
    hasSubmissions,
    count: submissions.length,
    email: user.email
  });
}));

router.get('/health', (_req, res) => {
  res.json({
    service: 'DocuSeal API',
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;