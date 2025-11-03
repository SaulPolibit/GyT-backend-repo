/**
 * Helper Utilities
 * Common utility functions used throughout the application
 */

const crypto = require('crypto');

// ===== STRING HELPERS =====

/**
 * Escape string for JSON
 * Escapes special characters for safe JSON string embedding
 * @param {any} val - Value to escape
 * @returns {any} Escaped string or original value
 */
function escapeStringForJson(val) {
  if (typeof val !== 'string') {
    return val;
  }
  return val
    .replace(/[\\]/g, '\\\\')
    .replace(/["]/g, '\\"')
    .replace(/[\n]/g, '\\n')
    .replace(/[\r]/g, '\\r')
    .replace(/[\t]/g, '\\t')
    .replace(/[\b]/g, '\\b')
    .replace(/[\f]/g, '\\f');
}

/**
 * Capitalize first letter of string
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalizeFirst(str) {
  if (!str || typeof str !== 'string') return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Convert string to camelCase
 * @param {string} str - String to convert
 * @returns {string} camelCase string
 */
function toCamelCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (match, chr) => chr.toUpperCase());
}

/**
 * Convert string to snake_case
 * @param {string} str - String to convert
 * @returns {string} snake_case string
 */
function toSnakeCase(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Truncate string to specified length
 * @param {string} str - String to truncate
 * @param {number} length - Maximum length
 * @param {string} suffix - Suffix to add (default: '...')
 * @returns {string} Truncated string
 */
function truncate(str, length, suffix = '...') {
  if (!str || typeof str !== 'string') return str;
  if (str.length <= length) return str;
  return str.substring(0, length - suffix.length) + suffix;
}

/**
 * Generate random string
 * @param {number} length - Length of string
 * @param {string} charset - Character set to use
 * @returns {string} Random string
 */
function randomString(length = 32, charset = 'alphanumeric') {
  const charsets = {
    alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    alphabetic: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    numeric: '0123456789',
    hex: '0123456789abcdef',
  };

  const chars = charsets[charset] || charsets.alphanumeric;
  let result = '';
  
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return result;
}

// ===== ENVIRONMENT HELPERS =====

/**
 * Get environment variable with fallback
 * @param {string} key - Environment variable key
 * @param {any} defaultValue - Default value if not found
 * @returns {any} Environment variable value or default
 */
function getEnvVariable(key, defaultValue) {
  const value = process.env[key];
  return value !== undefined ? value : defaultValue;
}

/**
 * Check if running in production
 * @returns {boolean} True if production
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if running in development
 * @returns {boolean} True if development
 */
function isDevelopment() {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

/**
 * Check if running in test environment
 * @returns {boolean} True if test
 */
function isTest() {
  return process.env.NODE_ENV === 'test';
}

// ===== VALIDATION HELPERS =====

/**
 * Validate required parameters
 * Throws error if any required field is missing
 * @param {Object} params - Parameters object
 * @param {Array<string>} requiredFields - Array of required field names
 * @throws {Error} If any required field is missing
 */
function validateRequiredParams(params, requiredFields) {
  const missing = requiredFields.filter(field => {
    const value = params[field];
    return value === undefined || value === null || value === '';
  });

  if (missing.length > 0) {
    throw new Error(`Missing required parameters: ${missing.join(', ')}`);
  }
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate Ethereum address
 * @param {string} address - Ethereum address
 * @returns {boolean} True if valid address
 */
function isValidEthAddress(address) {
  if (!address || typeof address !== 'string') return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate UUID
 * @param {string} uuid - UUID to validate
 * @returns {boolean} True if valid UUID
 */
function isValidUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// ===== OBJECT HELPERS =====

/**
 * Deep clone object
 * @param {any} obj - Object to clone
 * @returns {any} Cloned object
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  
  if (obj instanceof Date) return new Date(obj.getTime());
  if (obj instanceof Array) return obj.map(item => deepClone(item));
  
  const clonedObj = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      clonedObj[key] = deepClone(obj[key]);
    }
  }
  
  return clonedObj;
}

/**
 * Remove undefined/null values from object
 * @param {Object} obj - Object to clean
 * @returns {Object} Cleaned object
 */
function removeEmpty(obj) {
  const cleaned = {};
  
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      if (value !== undefined && value !== null && value !== '') {
        cleaned[key] = value;
      }
    }
  }
  
  return cleaned;
}

/**
 * Pick specific keys from object
 * @param {Object} obj - Source object
 * @param {Array<string>} keys - Keys to pick
 * @returns {Object} Object with picked keys
 */
function pick(obj, keys) {
  const picked = {};
  
  keys.forEach(key => {
    if (obj.hasOwnProperty(key)) {
      picked[key] = obj[key];
    }
  });
  
  return picked;
}

/**
 * Omit specific keys from object
 * @param {Object} obj - Source object
 * @param {Array<string>} keys - Keys to omit
 * @returns {Object} Object without omitted keys
 */
function omit(obj, keys) {
  const omitted = { ...obj };
  
  keys.forEach(key => {
    delete omitted[key];
  });
  
  return omitted;
}

/**
 * Merge objects deeply
 * @param {...Object} objects - Objects to merge
 * @returns {Object} Merged object
 */
function deepMerge(...objects) {
  const result = {};
  
  objects.forEach(obj => {
    Object.keys(obj).forEach(key => {
      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        result[key] = deepMerge(result[key] || {}, obj[key]);
      } else {
        result[key] = obj[key];
      }
    });
  });
  
  return result;
}

// ===== ARRAY HELPERS =====

/**
 * Chunk array into smaller arrays
 * @param {Array} array - Array to chunk
 * @param {number} size - Chunk size
 * @returns {Array<Array>} Array of chunks
 */
function chunk(array, size) {
  if (!Array.isArray(array)) return [];
  
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  
  return chunks;
}

/**
 * Remove duplicates from array
 * @param {Array} array - Array with duplicates
 * @returns {Array} Array without duplicates
 */
function unique(array) {
  if (!Array.isArray(array)) return [];
  return [...new Set(array)];
}

/**
 * Flatten nested array
 * @param {Array} array - Nested array
 * @param {number} depth - Depth to flatten (default: Infinity)
 * @returns {Array} Flattened array
 */
function flatten(array, depth = Infinity) {
  if (!Array.isArray(array)) return [];
  return array.flat(depth);
}

// ===== DATE/TIME HELPERS =====

/**
 * Format date to ISO string
 * @param {Date|string|number} date - Date to format
 * @returns {string} ISO date string
 */
function formatDateISO(date) {
  return new Date(date).toISOString();
}

/**
 * Format date to human-readable string
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  return new Date(date).toLocaleString();
}

/**
 * Get timestamp in seconds
 * @returns {number} Unix timestamp in seconds
 */
function getTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Check if date is expired
 * @param {Date|string|number} date - Date to check
 * @returns {boolean} True if expired
 */
function isExpired(date) {
  return new Date(date) < new Date();
}

/**
 * Add days to date
 * @param {Date|string|number} date - Base date
 * @param {number} days - Days to add
 * @returns {Date} New date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ===== CRYPTO HELPERS =====

/**
 * Generate UUID v4
 * @returns {string} UUID
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Generate random bytes as hex
 * @param {number} length - Number of bytes
 * @returns {string} Hex string
 */
function randomBytes(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash string with SHA256
 * @param {string} str - String to hash
 * @returns {string} Hash hex string
 */
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Create HMAC signature
 * @param {string} data - Data to sign
 * @param {string} secret - Secret key
 * @returns {string} HMAC signature
 */
function createHmac(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

// ===== NUMBER HELPERS =====

/**
 * Format number with commas
 * @param {number} num - Number to format
 * @param {number} decimals - Decimal places
 * @returns {string} Formatted number
 */
function formatNumber(num, decimals = 2) {
  return Number(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Round to decimal places
 * @param {number} num - Number to round
 * @param {number} decimals - Decimal places
 * @returns {number} Rounded number
 */
function roundTo(num, decimals = 2) {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Generate random number in range
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Random number
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ===== PROMISE HELPERS =====

/**
 * Sleep/delay for specified time
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry async function with delay
 * @param {Function} fn - Async function to retry
 * @param {number} retries - Number of retries
 * @param {number} delay - Delay between retries (ms)
 * @returns {Promise<any>} Result or error
 */
async function retry(fn, retries = 3, delay = 1000) {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
}

/**
 * Timeout promise
 * @param {Promise} promise - Promise to timeout
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise<any>} Result or timeout error
 */
function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    ),
  ]);
}

// ===== ERROR HELPERS =====

/**
 * Safe JSON parse
 * @param {string} str - JSON string
 * @param {any} defaultValue - Default value if parse fails
 * @returns {any} Parsed object or default
 */
function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * Safe JSON stringify
 * @param {any} obj - Object to stringify
 * @param {string} defaultValue - Default value if stringify fails
 * @returns {string} JSON string or default
 */
function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj);
  } catch {
    return defaultValue;
  }
}

// Export all helpers
module.exports = {
  // String helpers
  escapeStringForJson,
  capitalizeFirst,
  toCamelCase,
  toSnakeCase,
  truncate,
  randomString,

  // Environment helpers
  getEnvVariable,
  isProduction,
  isDevelopment,
  isTest,

  // Validation helpers
  validateRequiredParams,
  isValidEmail,
  isValidUrl,
  isValidEthAddress,
  isValidUUID,

  // Object helpers
  deepClone,
  removeEmpty,
  pick,
  omit,
  deepMerge,

  // Array helpers
  chunk,
  unique,
  flatten,

  // Date/Time helpers
  formatDateISO,
  formatDate,
  getTimestamp,
  isExpired,
  addDays,

  // Crypto helpers
  generateUUID,
  randomBytes,
  sha256,
  createHmac,

  // Number helpers
  formatNumber,
  roundTo,
  randomInt,

  // Promise helpers
  sleep,
  retry,
  timeout,

  // Error helpers
  safeJsonParse,
  safeJsonStringify,

  // URL helpers
  getBaseUrl,
  getFullImageUrl,
};

// ===== URL HELPERS =====

/**
 * Get base URL from request
 * @param {Object} req - Express request object
 * @returns {string} Base URL (e.g., http://localhost:3000)
 */
function getBaseUrl(req) {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

/**
 * Get full URL for image path
 * @param {string} imagePath - Relative image path
 * @param {Object} req - Express request object
 * @returns {string|null} Full image URL or null if no image
 */
function getFullImageUrl(imagePath, req) {
  if (!imagePath) return null;
  const baseUrl = getBaseUrl(req);
  return `${baseUrl}${imagePath}`;
}