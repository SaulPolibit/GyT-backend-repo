/**
 * Error Handler Middleware
 * Centralized error handling for the application
 */

/**
 * Custom Error Classes
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
    this.name = 'AuthenticationError';
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403);
    this.name = 'AuthorizationError';
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409);
    this.name = 'ConflictError';
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}

class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(message, 500);
    this.name = 'InternalError';
  }
}

class ExternalAPIError extends AppError {
  constructor(message, statusCode = 502, apiName = 'External API') {
    super(message, statusCode);
    this.name = 'ExternalAPIError';
    this.apiName = apiName;
  }
}

/**
 * Log error details
 * @param {Error} err - Error object
 * @param {object} req - Express request object
 */
const logError = (err, req) => {
  const timestamp = new Date().toISOString();
  const method = req.method;
  const url = req.originalUrl;
  const ip = req.ip || req.connection.remoteAddress;

  console.error('\n--- Error Log ---');
  console.error(`Timestamp: ${timestamp}`);
  console.error(`IP: ${ip}`);
  console.error(`Method: ${method}`);
  console.error(`URL: ${url}`);
  console.error(`Error Name: ${err.name}`);
  console.error(`Error Message: ${err.message}`);
  console.error(`Status Code: ${err.statusCode || 500}`);
  
  if (process.env.NODE_ENV === 'development') {
    console.error('Stack Trace:', err.stack);
    console.error('Request Body:', JSON.stringify(req.body, null, 2));
    console.error('Request Query:', JSON.stringify(req.query, null, 2));
    console.error('Request Params:', JSON.stringify(req.params, null, 2));
  }
  
  console.error('--- End Error Log ---\n');
};

/**
 * Format error response
 * @param {Error} err - Error object
 * @param {object} req - Express request object
 * @returns {object} - Formatted error response
 */
const formatErrorResponse = (err, req) => {
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  const response = {
    status: err.status || 'error',
    statusCode,
    message: err.message || 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  };

  // Add error name for operational errors
  if (err.isOperational) {
    response.error = err.name;
  }

  // Add API name for external API errors
  if (err.apiName) {
    response.apiName = err.apiName;
  }

  // Add validation details if available
  if (err.errors) {
    response.errors = err.errors;
  }

  // Add stack trace in development
  if (!isProduction) {
    response.stack = err.stack;
    response.originalError = err.originalError;
  }

  // Add request ID if available
  if (req.id) {
    response.requestId = req.id;
  }

  return response;
};

/**
 * Handle specific error types
 */
const handleCastError = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new ValidationError(message);
};

const handleDuplicateFieldsError = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value`;
  return new ConflictError(message);
};


// Handle validation errors safely
const handleValidationError = (error, res) => {
  console.error('Validation Error:', error);
  
  // Safely handle errors object
  let errors = {};
  
  if (error.errors && typeof error.errors === 'object') {
    try {
      // Check if errors is an object and not null
      if (error.errors !== null && typeof error.errors === 'object') {
        errors = Object.values(error.errors).map(err => ({
          field: err.path || err.field || 'unknown',
          message: err.message || 'Validation failed'
        }));
      }
    } catch (e) {
      console.error('Error processing validation errors:', e);
      errors = [{ field: 'unknown', message: error.message || 'Validation failed' }];
    }
  } else {
    // If no errors object, use the main error message
    errors = [{ field: 'general', message: error.message || 'Validation failed' }];
  }

  return res.status(400).json({
    success: false,
    error: 'Validation Error',
    message: error.message || 'Validation failed',
    errors: errors
  });
};

const handleJWTError = () => {
  return new AuthenticationError('Invalid token. Please log in again');
};

const handleJWTExpiredError = () => {
  return new AuthenticationError('Your token has expired. Please log in again');
};

const handleAxiosError = (err) => {
  const statusCode = err.response?.status || 502;
  const apiName = err.config?.url || 'External API';
  const message = err.response?.data?.message || err.message || 'External API error';
  
  return new ExternalAPIError(message, statusCode, apiName);
};

/**
 * Main error handling middleware
 */
const errorHandler = (err, req, res, _next) => {
  // Log error
  logError(err, req);

  let error = { ...err };
  error.message = err.message;
  error.name = err.name;
  error.statusCode = err.statusCode;
  error.status = err.status;
  error.isOperational = err.isOperational;

  // Handle specific error types
  if (err.name === 'CastError') error = handleCastError(err);
  if (err.code === 11000) error = handleDuplicateFieldsError(err);
  if (err.name === 'ValidationError') return handleValidationError(err, res);
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();
  if (err.isAxiosError) error = handleAxiosError(err);

  // Format response
  const response = formatErrorResponse(error, req);

  // Send response
  res.status(error.statusCode || 500).json(response);
};

/**
 * Handle async errors
 * Wrapper for async route handlers
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Handle 404 errors
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Cannot find ${req.originalUrl} on this server`);
  next(error);
};

/**
 * Handle unhandled promise rejections
 */
const handleUnhandledRejection = (err) => {
  console.error('UNHANDLED REJECTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  
  // Give the server time to finish pending requests
  setTimeout(() => {
    process.exit(1);
  }, 1000);
};

/**
 * Handle uncaught exceptions
 */
const handleUncaughtException = (err) => {
  console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  
  process.exit(1);
};

/**
 * Setup global error handlers
 */
const setupGlobalHandlers = () => {
  process.on('unhandledRejection', handleUnhandledRejection);
  process.on('uncaughtException', handleUncaughtException);
};

/**
 * Validate request data
 * Helper to throw validation errors
 */
const validate = (condition, message) => {
  if (!condition) {
    throw new ValidationError(message);
  }
};

/**
 * Assert authentication
 */
const assertAuthenticated = (req) => {
  if (!req.auth?.authenticated) {
    throw new AuthenticationError('Authentication required');
  }
};

/**
 * Assert authorization
 */
const assertAuthorized = (condition, message) => {
  if (!condition) {
    throw new AuthorizationError(message);
  }
};

module.exports = {
  // Middleware
  errorHandler,
  notFoundHandler,
  catchAsync,
  
  // Setup
  setupGlobalHandlers,
  
  // Custom Error Classes
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  ExternalAPIError,
  
  // Helpers
  validate,
  assertAuthenticated,
  assertAuthorized,
};