/**
 * Vudy API Routes
 * Payment request management endpoints
 */

const express = require('express');
const apiManager = require('../services/apiManager');
const { authenticate } = require('../middleware/auth');
const {
  catchAsync,
  validate,
  NotFoundError
} = require('../middleware/errorHandler');

const router = express.Router();

/**
 * @route   POST /api/vudy/requests
 * @desc    Create a new payment request
 * @access  Private (requires authentication)
 * @body    {
 *            amountInUsd: number,
 *            note: string,
 *            receiverWalletAddress: string,
 *            vendorId: string,
 *            generatedId: string,
 *            vudyApiKey?: string (optional, uses env if not provided)
 *          }
 */
router.post('/requests', authenticate, catchAsync(async (req, res) => {
  const { 
    amountInUsd, 
    note, 
    receiverWalletAddress, 
    vendorId, 
    generatedId 
  } = req.body;

  // Validate required fields
  validate(amountInUsd, 'amountInUsd is required');
  validate(amountInUsd > 0, 'amountInUsd must be greater than 0');
  validate(note, 'note is required');
  validate(receiverWalletAddress, 'receiverWalletAddress is required');
  validate(vendorId, 'vendorId is required');
  validate(generatedId, 'generatedId is required');

  // Validate wallet address format (basic check)
  const walletRegex = /^0x[a-fA-F0-9]{40}$/;
  validate(
    walletRegex.test(receiverWalletAddress), 
    'Invalid receiverWalletAddress format (should be 0x...)'
  );

  const context = { auth: req.auth };
  const result = await apiManager.createRequest(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to create payment request',
      details: result.body,
    });
  }

  res.status(result.statusCode || 201).json({
    success: true,
    message: 'Payment request created successfully',
    data: result.body,
  });
}));

/**
 * @route   GET /api/vudy/requests/:requestId
 * @desc    Get a single payment request by ID
 * @access  Public
 * @params  requestId - The payment request ID
 * @query   vudyApiKey?: string (optional)
 */
router.get('/requests/:requestId', authenticate, catchAsync(async (req, res) => {
  const { requestId } = req.params;

  // Validate request ID
  validate(requestId, 'requestId is required');
  validate(requestId.length > 0, 'Invalid requestId');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query, 
    requestID: requestId 
  };

  const result = await apiManager.getSingleRequest(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`Payment request with ID ${requestId} not found`);
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch payment request',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    data: result.body,
  });
}));

/**
 * @route   GET /api/vudy/requests
 * @desc    Get multiple payment requests
 * @access  Public
 * @query   {
 *            ids?: string (comma-separated request IDs),
 *            vendorIDs?: string (comma-separated vendor IDs),
 *            vudyApiKey?: string (optional)
 *          }
 */
router.get('/requests', authenticate, catchAsync(async (req, res) => {
  const { ids, vendorIDs } = req.query;

  // At least one filter should be provided
  validate(
    ids || vendorIDs, 
    'Please provide at least one filter: ids or vendorIDs'
  );

  const context = { auth: req.auth };
  const result = await apiManager.getMultipleRequests(context, req.query);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch payment requests',
      details: result.body,
    });
  }

  // Parse response data
  const requests = result.body || [];
  const count = Array.isArray(requests) ? requests.length : 0;

  res.status(result.statusCode || 200).json({
    success: true,
    count,
    data: requests,
  });
}));

/**
 * @route   GET /api/vudy/requests/vendor/:vendorId
 * @desc    Get all requests for a specific vendor
 * @access  Public
 * @params  vendorId - The vendor ID
 * @query   vudyApiKey?: string (optional)
 */
router.get('/requests/vendor/:vendorId', authenticate, catchAsync(async (req, res) => {
  const { vendorId } = req.params;

  validate(vendorId, 'vendorId is required');

  const context = { auth: req.auth };
  const variables = {
    ...req.query,
    vendorIDs: vendorId,
  };

  const result = await apiManager.getMultipleRequests(context, variables);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: `Failed to fetch requests for vendor ${vendorId}`,
      details: result.body,
    });
  }

  const requests = result.body || [];
  const count = Array.isArray(requests) ? requests.length : 0;

  res.status(result.statusCode || 200).json({
    success: true,
    vendorId,
    count,
    data: requests,
  });
}));

/**
 * @route   POST /api/vudy/requests/batch
 * @desc    Get multiple requests by IDs in batch
 * @access  Public
 * @body    {
 *            ids: string[] (array of request IDs)
 *          }
 */
router.post('/requests/batch', authenticate, catchAsync(async (req, res) => {
  const { ids } = req.body;

  validate(ids, 'ids array is required');
  validate(Array.isArray(ids), 'ids must be an array');
  validate(ids.length > 0, 'ids array cannot be empty');
  validate(ids.length <= 100, 'Maximum 100 IDs allowed per batch');

  const context = { auth: req.auth };
  const variables = {
    ...req.body,
    ids: ids.join(','), // Convert array to comma-separated string
  };

  const result = await apiManager.getMultipleRequests(context, variables);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch batch requests',
      details: result.body,
    });
  }

  const requests = result.body || [];
  const count = Array.isArray(requests) ? requests.length : 0;

  res.status(result.statusCode || 200).json({
    success: true,
    requested: ids.length,
    found: count,
    data: requests,
  });
}));

/**
 * @route   GET /api/vudy/requests/:requestId/status
 * @desc    Get payment request status
 * @access  Public
 * @params  requestId - The payment request ID
 */
router.get('/requests/:requestId/status', authenticate, catchAsync(async (req, res) => {
  const { requestId } = req.params;

  validate(requestId, 'requestId is required');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query, 
    requestID: requestId 
  };

  const result = await apiManager.getSingleRequest(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`Payment request with ID ${requestId} not found`);
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch request status',
    });
  }

  // Extract status information
  const requestData = result.body;
  const status = {
    requestId: requestData.id || requestId,
    status: requestData.status || 'unknown',
    amountInUsd: requestData.amountInUsd,
    createdAt: requestData.createdAt,
    updatedAt: requestData.updatedAt,
    isPaid: requestData.isPaid || false,
  };

  res.status(200).json({
    success: true,
    data: status,
  });
}));

/**
 * @route   GET /api/vudy/health
 * @desc    Health check for Vudy API routes
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({
    service: 'Vudy API',
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;