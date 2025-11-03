/**
 * HTTP Client Service
 * Centralized HTTP request handling with axios
 */

const axios = require('axios').default;
const qs = require('qs');

class HttpClient {
  constructor() {
    // Create axios instance with default config
    this.axiosInstance = axios.create({
      timeout: 30000, // 30 seconds
      headers: {
        'User-Agent': 'API-Project/1.0.0',
      },
    });

    // Setup request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        // Log request in development
        if (process.env.NODE_ENV === 'development') {
          console.log(`[HTTP Request] ${config.method.toUpperCase()} ${config.url}`);
        }
        return config;
      },
      (error) => {
        console.error('[HTTP Request Error]', error.message);
        return Promise.reject(error);
      }
    );

    // Setup response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        // Log response in development
        if (process.env.NODE_ENV === 'development') {
          console.log(`[HTTP Response] ${response.status} ${response.config.url}`);
        }
        return response;
      },
      (error) => {
        // Enhanced error logging
        this.logError(error);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Log HTTP errors with details
   * @param {Error} error - Axios error object
   */
  logError(error) {
    if (error.response) {
      // Server responded with error status
      console.error('[HTTP Error] Response Error:', {
        status: error.response.status,
        statusText: error.response.statusText,
        url: error.config?.url,
        method: error.config?.method?.toUpperCase(),
        data: error.response.data,
      });
    } else if (error.request) {
      // Request was made but no response received
      console.error('[HTTP Error] No Response:', {
        url: error.config?.url,
        method: error.config?.method?.toUpperCase(),
        message: error.message,
      });
    } else {
      // Error in setting up the request
      console.error('[HTTP Error] Request Setup:', error.message);
    }
  }

  /**
   * Make an HTTP request
   * @param {Object} options - Request options
   * @param {string} options.method - HTTP method (get, post, put, delete, etc.)
   * @param {string} options.url - Request URL
   * @param {Object} options.headers - Request headers
   * @param {Object} options.params - URL query parameters
   * @param {any} options.body - Request body
   * @param {boolean} options.returnBody - Whether to return response body (default: true)
   * @param {boolean} options.isStreamingApi - Whether this is a streaming API (default: false)
   * @param {number} options.timeout - Request timeout in ms (optional)
   * @returns {Promise<Object>} Response object
   */
  async makeApiRequest({
    method,
    url,
    headers = {},
    params = {},
    body,
    returnBody = true,
    isStreamingApi = false,
    timeout,
  }) {
    try {
      // Validate required parameters
      if (!method || !url) {
        throw new Error('Method and URL are required');
      }

      // Build request config
      const config = {
        method: method.toLowerCase(),
        url,
        headers: { ...headers },
        params,
        responseType: isStreamingApi ? 'stream' : 'json',
        ...(timeout && { timeout }),
      };

      // Add request body if present
      if (body !== undefined && body !== null) {
        config.data = body;
      }

      // Make the request
      const response = await this.axiosInstance.request(config);

      // Return formatted response
      return {
        statusCode: response.status,
        headers: response.headers,
        ...(returnBody && { body: response.data }),
        isStreamingApi,
        success: true,
      };
    } catch (error) {
      // Handle axios errors
      if (error.response) {
        // Server responded with error status
        return {
          statusCode: error.response.status,
          headers: error.response.headers || {},
          ...(returnBody && { body: error.response.data }),
          error: error.message,
          errorType: 'response_error',
          success: false,
        };
      } else if (error.request) {
        // Request was made but no response received
        return {
          statusCode: 503, // Service Unavailable
          headers: {},
          error: 'No response received from server',
          errorType: 'no_response',
          originalError: error.message,
          success: false,
        };
      } else {
        // Error in request setup
        return {
          statusCode: 500,
          headers: {},
          error: error.message,
          errorType: 'request_setup',
          success: false,
        };
      }
    }
  }

  /**
   * Create request body based on content type
   * @param {Object} options - Body creation options
   * @param {Object} options.headers - Request headers (will be modified)
   * @param {Object} options.params - URL parameters
   * @param {any} options.body - Raw body content
   * @param {string} options.bodyType - Body type (JSON, TEXT, X_WWW_FORM_URL_ENCODED)
   * @returns {any} Formatted body
   */
  createBody({ headers, params, body, bodyType }) {
    switch (bodyType) {
      case 'JSON':
        headers['Content-Type'] = 'application/json';
        // Parse body if it's a string
        if (typeof body === 'string') {
          try {
            return JSON.parse(body);
          } catch {
            console.warn('[HttpClient] Failed to parse JSON body, returning as-is');
            return body;
          }
        }
        return body;

      case 'TEXT':
        headers['Content-Type'] = 'text/plain';
        return body;

      case 'X_WWW_FORM_URL_ENCODED':
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        return qs.stringify(params);

      case 'FORM_DATA':
        // Note: Don't set Content-Type for FormData, axios will set it with boundary
        return body;

      default:
        return body;
    }
  }

  /**
   * GET request helper
   * @param {string} url - Request URL
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response object
   */
  async get(url, options = {}) {
    return this.makeApiRequest({
      method: 'get',
      url,
      ...options,
    });
  }

  /**
   * POST request helper
   * @param {string} url - Request URL
   * @param {any} body - Request body
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response object
   */
  async post(url, body, options = {}) {
    return this.makeApiRequest({
      method: 'post',
      url,
      body,
      ...options,
    });
  }

  /**
   * PUT request helper
   * @param {string} url - Request URL
   * @param {any} body - Request body
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response object
   */
  async put(url, body, options = {}) {
    return this.makeApiRequest({
      method: 'put',
      url,
      body,
      ...options,
    });
  }

  /**
   * PATCH request helper
   * @param {string} url - Request URL
   * @param {any} body - Request body
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response object
   */
  async patch(url, body, options = {}) {
    return this.makeApiRequest({
      method: 'patch',
      url,
      body,
      ...options,
    });
  }

  /**
   * DELETE request helper
   * @param {string} url - Request URL
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response object
   */
  async delete(url, options = {}) {
    return this.makeApiRequest({
      method: 'delete',
      url,
      ...options,
    });
  }

  /**
   * Download file from URL
   * @param {string} url - File URL
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response with file stream
   */
  async downloadFile(url, options = {}) {
    return this.makeApiRequest({
      method: 'get',
      url,
      isStreamingApi: true,
      ...options,
    });
  }

  /**
   * Upload file
   * @param {string} url - Upload URL
   * @param {FormData} formData - Form data with file
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response object
   */
  async uploadFile(url, formData, options = {}) {
    return this.makeApiRequest({
      method: 'post',
      url,
      body: formData,
      headers: {
        ...options.headers,
        // Let axios set Content-Type with boundary for multipart/form-data
      },
      ...options,
    });
  }

  /**
   * Make multiple requests in parallel
   * @param {Array<Object>} requests - Array of request options
   * @returns {Promise<Array<Object>>} Array of responses
   */
  async batchRequest(requests) {
    const promises = requests.map(request => this.makeApiRequest(request));
    return Promise.allSettled(promises);
  }

  /**
   * Retry request with exponential backoff
   * @param {Object} requestOptions - Request options
   * @param {number} maxRetries - Maximum number of retries (default: 3)
   * @param {number} initialDelay - Initial delay in ms (default: 1000)
   * @returns {Promise<Object>} Response object
   */
  async retryRequest(requestOptions, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.makeApiRequest(requestOptions);
        
        // If successful, return immediately
        if (response.success || response.statusCode < 500) {
          return response;
        }
        
        lastError = response;
      } catch (error) {
        lastError = error;
      }

      // Don't delay after the last attempt
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`[HttpClient] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await this.sleep(delay);
      }
    }

    // Return last error after all retries exhausted
    return lastError;
  }

  /**
   * Sleep helper for retry logic
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if URL is reachable
   * @param {string} url - URL to check
   * @param {number} timeout - Timeout in ms (default: 5000)
   * @returns {Promise<boolean>} True if reachable
   */
  async isReachable(url, timeout = 5000) {
    try {
      const response = await this.makeApiRequest({
        method: 'head',
        url,
        timeout,
      });
      return response.statusCode < 400;
    } catch {
      return false;
    }
  }

  /**
   * Get axios instance for advanced usage
   * @returns {axios.AxiosInstance}
   */
  getAxiosInstance() {
    return this.axiosInstance;
  }
}

// Export singleton instance
module.exports = new HttpClient();