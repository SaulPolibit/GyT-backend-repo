/**
 * Authentication Middleware
 * Supports multiple authentication methods:
 * - Bearer Token (JWT)
 * - API Key (x-api-key header)
 * - Custom client keys (for Portal HQ, Vudy, etc.)
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @returns {object|null} - Decoded token payload or null if invalid
 */
const verifyJWT = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    return decoded;
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return null;
  }
};

/**
 * Hash API Key using SHA-256
 * @param {string} apiKey - API key to hash
 * @returns {string} - Hashed API key
 */
const hashApiKey = (apiKey) => {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
};

/**
 * Verify API Key using hash comparison
 * @param {string} hashedApiKey - Hashed API key from request header (already hashed by frontend)
 * @returns {boolean} - True if valid
 */
const verifyApiKey = (hashedApiKey) => {
  // The expected API key (plain text) stored in environment variables
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    console.warn('API_KEY not set in environment variables');
    return false;
  }

  if (!hashedApiKey) {
    return false;
  }

  // Hash the valid API key from environment to compare with the hashed key from headers
  const validKeyHash = hashApiKey(validApiKey);

  // Use timing-safe comparison to prevent timing attacks
  // Compare the hashed key from headers with our hashed key
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hashedApiKey),
      Buffer.from(validKeyHash)
    );
  } catch {
    // If lengths don't match, timingSafeEqual throws an error
    return false;
  }
};

/**
 * Main authentication middleware
 * Requires valid Bearer token or API key
 */
const authenticate = (req, res, next) => {
  // Skip authentication for OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  // Check if any authentication method is provided
  if (!authHeader && !apiKey) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please provide Authorization header (Bearer token)',
    });
  }

  // Try Bearer token authentication
  if (authHeader) {
    const parts = authHeader.split(' ');
    
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        error: 'Invalid authorization header',
        message: 'Format should be: Authorization: Bearer <token>',
      });
    }

    const token = parts[1];
    
    // Verify JWT token
    const decoded = verifyJWT(token);
    
    if (!decoded) {
      return res.status(401).json({
        error: 'Invalid or expired token',
        message: 'Please provide a valid authentication token',
      });
    }

    // Attach user info to request
    req.user = decoded;
    req.auth = { 
      authenticated: true, 
      method: 'bearer',
      userId: decoded.userId || decoded.id || decoded.sub,
    };
    
    return next();
  }

  // Try API key authentication
  if (apiKey) {
    if (!verifyApiKey(apiKey)) {
      return res.status(401).json({
        error: 'Invalid API key',
        message: 'Please provide a valid x-api-key',
      });
    }

    req.auth = { 
      authenticated: true, 
      method: 'apikey',
    };
    
    return next();
  }

  // Should not reach here, but just in case
  return res.status(401).json({
    error: 'Authentication failed',
    message: 'Unable to authenticate request',
  });
};

/**
 * Role-based authentication middleware
 * Checks if user has required role
 * @param {string|array} roles - Required role(s)
 */
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.auth?.authenticated) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please authenticate first',
      });
    }

    if (!req.user) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'User information not available',
      });
    }

    const userRole = req.user.role;
    const requiredRoles = Array.isArray(roles) ? roles : [roles];

    if (!requiredRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `Required role(s): ${requiredRoles.join(', ')}`,
      });
    }

    next();
  };
};

/**
 * Create JWT token
 * Helper function to generate tokens
 * @param {object} payload - Data to encode in token
 */
const createToken = (payload) => {
  return jwt.sign(
    payload, 
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: 86400 }// 24 hours
  );
};

/**
 * Validate client-specific API keys
 * For Portal HQ, Vudy, Bridge, etc.
 */
const validateClientKey = (req, res, next) => {
  const clientKey = req.headers['client-api-key'] || req.body.clientApiKey;

  if (!clientKey) {
    return res.status(401).json({
      error: 'Client API key required',
      message: 'Please provide client-api-key header or clientApiKey in body',
    });
  }

  // Add client key to request for use in API calls
  req.clientAuth = {
    apiKey: clientKey,
  };

  next();
};

/**
 * Rate limiting helper
 * Simple in-memory rate limiter
 */
const rateLimitStore = new Map();

const rateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // limit each IP to 100 requests per windowMs
  } = options;

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    const record = rateLimitStore.get(key);

    if (now > record.resetTime) {
      // Reset the window
      record.count = 1;
      record.resetTime = now + windowMs;
      return next();
    }

    if (record.count >= max) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Please try again later',
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    record.count++;
    next();
  };
};

/**
 * API Key only authentication middleware
 * Requires valid x-api-key header (does not accept Bearer token)
 */
const requireApiKey = (req, res, next) => {
  // Skip authentication for OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  // Check if API key is provided
  if (!apiKey) {
    return res.status(401).json({
      error: 'API key required',
      message: 'Please provide x-api-key header',
    });
  }

  // Verify API key
  if (!verifyApiKey(apiKey)) {
    return res.status(401).json({
      error: 'Invalid API key',
      message: 'Please provide a valid x-api-key',
    });
  }

  req.auth = {
    authenticated: true,
    method: 'apikey',
  };

  return next();
};

/**
 * Bearer Token only authentication middleware
 * Requires valid Bearer token (does not accept x-api-key)
 */
const requireBearerToken = (req, res, next) => {
  // Skip authentication for OPTIONS requests (CORS preflight)
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;

  // Check if authorization header is provided
  if (!authHeader) {
    return res.status(401).json({
      error: 'Bearer token required',
      message: 'Please provide Authorization header with Bearer token',
    });
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      error: 'Invalid authorization header',
      message: 'Format should be: Authorization: Bearer <token>',
    });
  }

  const token = parts[1];

  // Verify JWT token
  const decoded = verifyJWT(token);

  if (!decoded) {
    return res.status(401).json({
      error: 'Invalid or expired token',
      message: 'Please provide a valid authentication token',
    });
  }

  // Attach user info to request
  req.user = decoded;
  req.auth = {
    ...req.auth,
    authenticated: true,
    method: 'bearer',
    userId: decoded.userId || decoded.id || decoded.sub,
  };

  return next();
};

module.exports = {
  authenticate,
  requireRole,
  createToken,
  validateClientKey,
  rateLimit,
  verifyJWT,
  verifyApiKey,
  hashApiKey,
  requireApiKey,
  requireBearerToken,
};