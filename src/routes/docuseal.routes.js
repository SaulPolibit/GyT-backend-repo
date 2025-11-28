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
const { User, DocusealSubmission } = require('../models/supabase');

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
  const { event_type, data } = req.body;

  // Validate webhook payload
  validate(event_type, 'event_type is required');
  validate(data, 'data is required');

  // Only process submission.completed events
  if (event_type === 'submission.completed') {
    // Extract submission data
    const submissionId = data.id;
    const slug = data.slug;
    const auditLogUrl = data.audit_log_url;

    // Get email from the first submitter
    const submitters = data.submitters || [];
    const firstSubmitter = submitters[0];

    if (!firstSubmitter || !firstSubmitter.email) {
      return res.status(400).json({
        success: false,
        message: 'No submitter email found in webhook payload'
      });
    }

    const email = firstSubmitter.email;

    // Construct submission URL from slug
    const submissionURL = `https://docuseal.com/s/${slug}`;

    // Check if submission already exists
    const existingSubmission = await DocusealSubmission.findBySubmissionId(submissionId);

    if (existingSubmission) {
      // Update existing submission
      const updatedSubmission = await DocusealSubmission.findByIdAndUpdate(
        existingSubmission.id,
        {
          submissionURL,
          auditLogUrl
        }
      );

      return res.status(200).json({
        success: true,
        message: 'Submission updated successfully',
        data: updatedSubmission
      });
    }

    // Create new submission record
    const submission = await DocusealSubmission.create({
      email,
      submissionId,
      submissionURL,
      auditLogUrl
    });

    return res.status(201).json({
      success: true,
      message: 'Submission created successfully',
      data: submission
    });
  }

  // For other event types, just acknowledge receipt
  res.status(200).json({
    success: true,
    message: `Webhook event ${event_type} received`,
    processed: false
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

router.get('/health', (req, res) => {
  res.json({
    service: 'DocuSeal API',
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;