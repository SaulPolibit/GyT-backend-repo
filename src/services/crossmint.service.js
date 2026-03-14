/**
 * Crossmint Wallet Service
 * Handles wallet creation and management for users via REST API
 */

const axios = require('axios');

class CrossmintWalletService {
  constructor() {
    this.apiKey = null;
    this.baseUrl = null;
    this.chain = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the Crossmint service
   */
  async initialize() {
    try {
      console.log('[Crossmint] Initializing...');

      // Check required environment variables
      if (!process.env.CROSSMINT_API_KEY) {
        console.warn('[Crossmint] Missing API key. Set CROSSMINT_API_KEY environment variable');
        return false;
      }

      this.apiKey = process.env.CROSSMINT_API_KEY;

      // Set base URL and chain based on environment
      const environment = process.env.CROSSMINT_ENVIRONMENT || 'staging';
      this.baseUrl = environment === 'production'
        ? 'https://www.crossmint.com/api'
        : 'https://staging.crossmint.com/api';
      this.chain = environment === 'production' ? 'polygon' : 'polygon-amoy';

      this.isInitialized = true;
      console.log('[Crossmint] ✓ Initialized successfully');
      console.log(`[Crossmint] Environment: ${environment}`);
      console.log(`[Crossmint] Chain: ${this.chain}`);
      console.log(`[Crossmint] Base URL: ${this.baseUrl}`);

      return true;
    } catch (error) {
      console.error('[Crossmint] Initialization failed:', error.message);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Create a custodial wallet for a user
   * @param {Object} userData - User information
   * @param {string} userData.email - User's email
   * @param {string} userData.userId - User's unique ID
   * @returns {Object} { walletAddress, walletId }
   */
  async createWallet(userData) {
    if (!this.isInitialized) {
      throw new Error('Crossmint service not initialized. Call initialize() first.');
    }

    try {
      console.log('[Crossmint] Creating wallet for user:', userData.email);
      console.log('[Crossmint] Chain:', this.chain);

      const response = await axios.post(
        `${this.baseUrl}/v1-alpha1/wallets`,
        {
          type: 'evm-smart-wallet',
          email: userData.email,
          chain: this.chain,
        },
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[Crossmint] Raw response:', JSON.stringify(response.data, null, 2));

      const wallet = response.data;
      const walletAddress = wallet.address || wallet.walletAddress || wallet.publicKey;

      console.log('[Crossmint] ✓ Wallet created successfully');
      console.log('[Crossmint] Wallet Address:', walletAddress);

      return {
        walletAddress: walletAddress,
        walletId: wallet.id || wallet.walletId,
        chain: wallet.chain || 'polygon',
      };
    } catch (error) {
      console.error('[Crossmint] Wallet creation failed:', error.response?.data || error.message);

      // Check if wallet already exists
      if (error.response?.status === 409 || error.response?.data?.message?.includes('already exists')) {
        console.log('[Crossmint] Wallet already exists, retrieving existing wallet...');
        return this.getWallet(userData);
      }

      throw new Error(`Failed to create Crossmint wallet: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get existing wallet for a user
   * @param {Object} userData - User information
   * @param {string} userData.email - User's email
   * @param {string} userData.userId - User's unique ID
   * @returns {Object} { walletAddress, walletId }
   */
  async getWallet(userData) {
    if (!this.isInitialized) {
      throw new Error('Crossmint service not initialized. Call initialize() first.');
    }

    try {
      console.log('[Crossmint] Retrieving wallet for user:', userData.email);

      // For non-custodial wallets, use email and userId as separate params
      const response = await axios.get(
        `${this.baseUrl}/v1-alpha1/wallets`,
        {
          params: {
            email: userData.email,
            userId: userData.userId
          },
          headers: {
            'X-API-KEY': this.apiKey,
          },
        }
      );

      const wallets = response.data;

      if (!wallets || wallets.length === 0) {
        throw new Error('No wallet found for user');
      }

      const wallet = wallets[0]; // Get first wallet
      const walletAddress = wallet.address || wallet.walletAddress || wallet.publicKey;

      console.log('[Crossmint] ✓ Wallet retrieved');
      console.log('[Crossmint] Wallet Address:', walletAddress);

      return {
        walletAddress: walletAddress,
        walletId: wallet.id || wallet.walletId,
        chain: wallet.chain || 'polygon',
      };
    } catch (error) {
      console.error('[Crossmint] Wallet retrieval failed:', error.response?.data || error.message);
      throw new Error(`Failed to retrieve Crossmint wallet: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create or retrieve wallet for user (idempotent)
   * @param {Object} userData - User information
   * @returns {Object} { walletAddress, walletId, isNew }
   */
  async getOrCreateWallet(userData) {
    try {
      // Try to get existing wallet first
      const existingWallet = await this.getWallet(userData);
      return { ...existingWallet, isNew: false };
    } catch (error) {
      // If no wallet exists, create one
      console.log('[Crossmint] No existing wallet, creating new one...');
      const newWallet = await this.createWallet(userData);
      return { ...newWallet, isNew: true };
    }
  }

  /**
   * Get wallet token balances
   * @param {string} walletLocator - Wallet address or Crossmint wallet ID
   * @param {string} tokens - Comma-separated list of token symbols (e.g., 'pol,usdt')
   * @param {string} chains - Optional comma-separated list of chains (defaults to environment chain)
   * @returns {Array} Array of token balances with details
   */
  async getWalletBalances(walletLocator, tokens = 'pol,matic,usdc', chains = null) {
    if (!this.isInitialized) {
      throw new Error('Crossmint service not initialized. Call initialize() first.');
    }

    try {
      // Use provided chains or default to the environment chain
      const targetChains = chains || this.chain;

      console.log('[Crossmint] Fetching balances for wallet:', walletLocator);
      console.log('[Crossmint] Tokens:', tokens);
      console.log('[Crossmint] Chains:', targetChains);

      const params = { tokens };
      if (targetChains) {
        params.chains = targetChains;
      }

      const response = await axios.get(
        `${this.baseUrl}/2025-06-09/wallets/${walletLocator}/balances`,
        {
          params,
          headers: {
            'X-API-KEY': this.apiKey,
          },
        }
      );

      console.log('[Crossmint] ✓ Balances retrieved');
      console.log('[Crossmint] Balances:', JSON.stringify(response.data, null, 2));

      return response.data || [];
    } catch (error) {
      console.error('[Crossmint] Failed to fetch balances:', error.response?.data || error.message);
      throw new Error(`Failed to fetch wallet balances: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Transfer tokens to another wallet
   * @param {string} walletLocator - Source wallet address
   * @param {string} tokenLocator - Token identifier (e.g., 'polygon-amoy:0x...' or 'polygon-amoy:pol')
   * @param {string} recipient - Destination wallet address
   * @param {string} amount - Amount to transfer as decimal string
   * @returns {Object} Transfer transaction details
   */
  async transferToken(walletLocator, tokenLocator, recipient, amount) {
    if (!this.isInitialized) {
      throw new Error('Crossmint service not initialized. Call initialize() first.');
    }

    try {
      console.log('[Crossmint] Initiating transfer...');
      console.log('[Crossmint] From wallet:', walletLocator);
      console.log('[Crossmint] Token:', tokenLocator);
      console.log('[Crossmint] To:', recipient);
      console.log('[Crossmint] Amount:', amount);

      const response = await axios.post(
        `${this.baseUrl}/2025-06-09/wallets/${walletLocator}/tokens/${tokenLocator}/transfers`,
        {
          recipient: recipient,
          amount: amount.toString(),
        },
        {
          headers: {
            'X-API-KEY': this.apiKey,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[Crossmint] ✓ Transfer initiated successfully');
      console.log('[Crossmint] Transfer response:', JSON.stringify(response.data, null, 2));

      return {
        success: true,
        id: response.data.id,
        status: response.data.status,
        onChain: response.data.onChain || null,
        createdAt: response.data.createdAt,
      };
    } catch (error) {
      console.error('[Crossmint] Transfer failed:', error.response?.data || error.message);

      const errorMessage = error.response?.data?.message
        || error.response?.data?.error
        || error.message
        || 'Transfer failed';

      throw new Error(`Failed to transfer tokens: ${errorMessage}`);
    }
  }

  /**
   * Get transfer status
   * @param {string} walletLocator - Wallet address
   * @param {string} tokenLocator - Token identifier
   * @param {string} transferId - Transfer ID
   * @returns {Object} Transfer status details
   */
  async getTransferStatus(walletLocator, tokenLocator, transferId) {
    if (!this.isInitialized) {
      throw new Error('Crossmint service not initialized. Call initialize() first.');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/2025-06-09/wallets/${walletLocator}/tokens/${tokenLocator}/transfers/${transferId}`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
          },
        }
      );

      return {
        id: response.data.id,
        status: response.data.status,
        onChain: response.data.onChain || null,
        createdAt: response.data.createdAt,
        completedAt: response.data.completedAt,
      };
    } catch (error) {
      console.error('[Crossmint] Get transfer status failed:', error.response?.data || error.message);
      throw new Error(`Failed to get transfer status: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get wallet NFTs
   * @param {string} walletId - Crossmint wallet ID
   * @returns {Array} Array of NFTs
   */
  async getWalletNFTs(walletId) {
    if (!this.isInitialized) {
      throw new Error('Crossmint service not initialized. Call initialize() first.');
    }

    try {
      console.log('[Crossmint] Fetching NFTs for wallet:', walletId);

      const response = await axios.get(
        `${this.baseUrl}/v1-alpha1/wallets/${walletId}/nfts`,
        {
          headers: {
            'X-API-KEY': this.apiKey,
          },
        }
      );

      console.log('[Crossmint] ✓ NFTs retrieved');

      return response.data.nfts || response.data || [];
    } catch (error) {
      console.error('[Crossmint] Failed to fetch NFTs:', error.response?.data || error.message);
      throw new Error(`Failed to fetch wallet NFTs: ${error.response?.data?.message || error.message}`);
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
module.exports = new CrossmintWalletService();
