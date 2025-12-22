/**
 * Prospera OAuth Service
 * Handles OAuth 2.0 / OIDC authentication with eProspera platform
 */

const { Issuer, generators } = require('openid-client');

class ProsperapOAuthService {
  constructor() {
    this.client = null;
    this.issuer = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the OAuth client with eProspera OIDC configuration
   * This should be called once when the server starts
   */
  async initialize() {
    try {
      console.log('[Prospera OAuth] Initializing...');
      console.log('[Prospera OAuth] Environment check:');
      console.log('  - CLIENT_ID:', process.env.EPROSPERA_CLIENT_ID ? '✓ Set' : '✗ Missing');
      console.log('  - CLIENT_SECRET:', process.env.EPROSPERA_CLIENT_SECRET ? '✓ Set' : '✗ Missing');
      console.log('  - ISSUER_URL:', process.env.EPROSPERA_ISSUER_URL || 'Using default');
      console.log('  - FRONTEND_URL:', process.env.FRONTEND_URL || '✗ Missing');

      // Check required environment variables
      if (!process.env.EPROSPERA_CLIENT_ID || !process.env.EPROSPERA_CLIENT_SECRET) {
        console.error('[Prospera OAuth] ✗ Missing credentials. Set EPROSPERA_CLIENT_ID and EPROSPERA_CLIENT_SECRET');
        return false;
      }

      if (!process.env.FRONTEND_URL) {
        console.error('[Prospera OAuth] ✗ Missing FRONTEND_URL environment variable');
        return false;
      }

      // Discover Prospera OIDC configuration
      // Staging: https://staging-portal.eprospera.com
      // Production: https://portal.eprospera.com
      const issuerUrl = process.env.EPROSPERA_ISSUER_URL || 'https://staging-portal.eprospera.com';

      console.log(`[Prospera OAuth] Discovering issuer: ${issuerUrl}`);
      this.issuer = await Issuer.discover(issuerUrl);

      console.log('[Prospera OAuth] ✓ Issuer discovered');

      // Create OAuth client
      const redirectUri = `${process.env.FRONTEND_URL}/lp-portal/login`;
      console.log(`[Prospera OAuth] Creating client with redirect URI: ${redirectUri}`);

      this.client = new this.issuer.Client({
        client_id: process.env.EPROSPERA_CLIENT_ID,
        client_secret: process.env.EPROSPERA_CLIENT_SECRET,
        redirect_uris: [redirectUri],
        response_types: ['code'],
      });

      this.isInitialized = true;
      console.log('[Prospera OAuth] ✓ Initialized successfully');
      console.log(`[Prospera OAuth] Issuer: ${this.issuer.issuer}`);
      console.log(`[Prospera OAuth] Redirect URI: ${redirectUri}`);

      return true;
    } catch (error) {
      console.error('[Prospera OAuth] ✗ Initialization failed');
      console.error('[Prospera OAuth] Error type:', error.constructor.name);
      console.error('[Prospera OAuth] Error message:', error.message);
      console.error('[Prospera OAuth] Stack trace:', error.stack);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Generate OAuth authorization URL with PKCE
   * @returns {Object} { authUrl, codeVerifier }
   */
  generateAuthUrl() {
    if (!this.isInitialized || !this.client) {
      throw new Error('Prospera OAuth client not initialized. Call initialize() first.');
    }

    // Generate PKCE code verifier and challenge
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    // Generate nonce for OpenID Connect
    const nonce = generators.nonce();

    // Generate authorization URL
    const authUrl = this.client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: generators.state(), // CSRF protection
      nonce: nonce, // Required by Prospera for openid scope
    });

    console.log('[Prospera OAuth] Generated auth URL');

    return {
      authUrl,
      codeVerifier,
      nonce, // Return nonce so frontend can store it
    };
  }

  /**
   * Exchange authorization code for tokens and user info
   * @param {string} code - Authorization code from OAuth callback
   * @param {string} codeVerifier - PKCE code verifier
   * @param {string} nonce - Nonce for ID token validation
   * @returns {Object} { accessToken, refreshToken, expiresAt, user }
   */
  async exchangeCode(code, codeVerifier, nonce) {
    if (!this.isInitialized || !this.client) {
      throw new Error('Prospera OAuth client not initialized. Call initialize() first.');
    }

    try {
      console.log('[Prospera OAuth] Exchanging authorization code for tokens...');

      // Exchange code for tokens
      const tokenSet = await this.client.callback(
        `${process.env.FRONTEND_URL}/lp-portal/login`,
        { code },
        { code_verifier: codeVerifier, nonce: nonce }
      );

      console.log('[Prospera OAuth] ✓ Token exchange successful');

      // Get user information
      const userinfo = await this.client.userinfo(tokenSet.access_token);

      console.log('[Prospera OAuth] ✓ User info retrieved');
      console.log('[Prospera OAuth] User email:', userinfo.email);

      return {
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token,
        expiresAt: tokenSet.expires_at,
        idToken: tokenSet.id_token,
        user: {
          prosperaId: userinfo.sub,
          email: userinfo.email,
          name: userinfo.name || '',
          picture: userinfo.picture || null,
          emailVerified: userinfo.email_verified || false,
        },
      };
    } catch (error) {
      console.error('[Prospera OAuth] Code exchange failed:', error.message);
      throw new Error(`Failed to authenticate with Prospera: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token from previous authentication
   * @returns {Object} { accessToken, refreshToken, expiresAt }
   */
  async refreshToken(refreshToken) {
    if (!this.isInitialized || !this.client) {
      throw new Error('Prospera OAuth client not initialized. Call initialize() first.');
    }

    try {
      console.log('[Prospera OAuth] Refreshing access token...');

      const tokenSet = await this.client.refresh(refreshToken);

      console.log('[Prospera OAuth] ✓ Token refresh successful');

      return {
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token,
        expiresAt: tokenSet.expires_at,
      };
    } catch (error) {
      console.error('[Prospera OAuth] Token refresh failed:', error.message);
      throw new Error(`Failed to refresh Prospera token: ${error.message}`);
    }
  }

  /**
   * Get user's Próspera profile including RPN
   * @param {string} accessToken - OAuth access token
   * @returns {Object} User profile data including RPN
   */
  async getUserProfile(accessToken) {
    try {
      // Determine base URL based on environment (staging vs production)
      const issuerUrl = process.env.EPROSPERA_ISSUER_URL || 'https://staging-portal.eprospera.com';
      const baseUrl = issuerUrl.replace('staging-portal', 'staging-portal').replace('portal', 'portal');
      const apiUrl = `${baseUrl}/api/v1/me/natural-person`;

      console.log('[Prospera OAuth] Fetching user profile from:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Prospera OAuth] Failed to fetch user profile:', response.status, errorText);
        throw new Error(`Failed to fetch user profile: ${response.status} ${errorText}`);
      }

      const profileData = await response.json();
      console.log('[Prospera OAuth] ✓ User profile retrieved');

      return profileData;
    } catch (error) {
      console.error('[Prospera OAuth] Error fetching user profile:', error.message);
      throw new Error(`Failed to get user profile from Próspera: ${error.message}`);
    }
  }

  /**
   * Verify if an RPN corresponds to an active Próspera resident
   * @param {string} rpn - Resident Permit Number
   * @param {string} accessToken - OAuth access token
   * @returns {Object} { result: 'found_legal_entity' | 'found_natural_person' | 'not_found', active: boolean }
   */
  async verifyRPN(rpn, accessToken) {
    try {
      // Determine base URL based on environment (staging vs production)
      const issuerUrl = process.env.EPROSPERA_ISSUER_URL || 'https://staging-portal.eprospera.com';
      const baseUrl = issuerUrl.replace('staging-portal', 'staging-portal').replace('portal', 'portal');
      const apiUrl = `${baseUrl}/api/v1/verify_rpn`;

      console.log('[Prospera OAuth] Verifying RPN:', rpn);
      console.log('[Prospera OAuth] Using API URL:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rpn }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Prospera OAuth] RPN verification failed:', response.status, errorText);
        throw new Error(`Failed to verify RPN: ${response.status} ${errorText}`);
      }

      const verificationData = await response.json();
      console.log('[Prospera OAuth] ✓ RPN verification result:', verificationData);

      return verificationData;
    } catch (error) {
      console.error('[Prospera OAuth] Error verifying RPN:', error.message);
      throw new Error(`Failed to verify RPN with Próspera: ${error.message}`);
    }
  }

  /**
   * Check if the service is ready to use
   * @returns {boolean}
   */
  isReady() {
    return this.isInitialized && this.client !== null;
  }
}

// Export singleton instance
module.exports = new ProsperapOAuthService();
