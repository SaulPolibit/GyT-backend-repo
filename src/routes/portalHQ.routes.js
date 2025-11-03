/**
 * Portal HQ API Routes
 * Client management, wallet creation, and blockchain transaction endpoints
 */

const express = require('express');
const apiManager = require('../services/apiManager');
const { authenticate } = require('../middleware/auth');
const {
  catchAsync,
  validate,
  NotFoundError,
  AuthenticationError
} = require('../middleware/errorHandler');

const router = express.Router();

// ===== CLIENT MANAGEMENT =====

/**
 * @route   POST /api/portal/clients
 * @desc    Create a new Portal HQ client
 * @access  Public
 * @body    {
 *            portalAPIKey?: string (optional, uses env if not provided)
 *          }
 */
router.post('/clients', authenticate, catchAsync(async (req, res) => {
  const context = { auth: req.auth };
  const result = await apiManager.createNewClient(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to create client',
      details: result.body,
    });
  }

  res.status(result.statusCode || 201).json({
    success: true,
    message: 'Client created successfully',
    data: result.body,
  });
}));

/**
 * @route   GET /api/portal/clients/:clientId
 * @desc    Get a single client by ID
 * @access  Public
 * @params  clientId - The Portal client ID
 * @query   portalAPIKey?: string (optional)
 */
router.get('/clients/:clientId', authenticate, catchAsync(async (req, res) => {
  const { clientId } = req.params;

  validate(clientId, 'clientId is required');
  validate(clientId.length > 0, 'Invalid clientId');

  const context = { auth: req.auth };
  const variables = { 
    ...req.body, 
    ...req.query, 
    portalClientId: clientId 
  };

  const result = await apiManager.getASingleClient(context, variables);

  if (result.error) {
    if (result.statusCode === 404) {
      throw new NotFoundError(`Client with ID ${clientId} not found`);
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch client',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    data: result.body,
  });
}));

// ===== ASSETS & BALANCES =====

/**
 * @route   GET /api/portal/clients/me/assets/:chainId
 * @desc    Get client's asset balance by chain (requires authentication)
 * @access  Private
 * @params  chainId - The blockchain chain ID (e.g., "eip155:137" for Polygon)
 * @query   {
 *            clientApiKey: string (required),
 *            includeNfts?: boolean,
 *            portalAPIKey?: string
 *          }
 */
router.get('/clients/me/assets/:chainId', authenticate, catchAsync(async (req, res) => {
  const { chainId } = req.params;
  const { clientApiKey } = req.query;

  console.log('Requested params:', req.params);
  console.log('Requested query:', req.query);
  validate(chainId, 'chainId is required');
  validate(clientApiKey, 'clientApiKey is required in query parameters');

  // Validate chain ID format (e.g., eip155:137)
  const chainIdRegex = /^[a-z0-9]+:[0-9]+$/;
  validate(
    chainIdRegex.test(chainId),
    'Invalid chainId format (should be like "eip155:137")'
  );

  const context = { auth: req.auth };
  const variables = { 
    ...req.body, 
    ...req.query, 
    chainId 
  };

  console.log('****** 1');
  const result = await apiManager.getClientsAssetBalanceByChain(context, variables);
  console.log('****** 3');

  if (result.error) {
    if (result.statusCode === 401 || result.statusCode === 403) {
      throw new AuthenticationError('Invalid client API key');
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch asset balance',
      details: result.body,
    });
  }

  // Parse and format response
  const assets = result.body || [];

  res.status(result.statusCode || 200).json({
    success: true,
    chainId,
    nativeBalance: assets.nativeBalance.balance || '0',
    data: assets,
  });
}));

/**
 * @route   GET /api/portal/clients/me/assets
 * @desc    Get client's assets across all chains
 * @access  Private
 * @query   clientApiKey: string (required)
 */
router.get('/clients/me/assets', authenticate, catchAsync(async (req, res) => {
  const { clientApiKey } = req.query;

  validate(clientApiKey, 'clientApiKey is required');

  // Common chain IDs
  const chains = [
    'eip155:1',    // Ethereum Mainnet
    'eip155:137',  // Polygon
    'eip155:56',   // BSC
    'eip155:43114', // Avalanche
  ];

  const context = { auth: req.auth };
  const results = [];

  // Fetch assets from multiple chains
  for (const chainId of chains) {
    try {
      const variables = { clientApiKey, chainId };
      const result = await apiManager.getClientsAssetBalanceByChain(context, variables);
      
      if (!result.error && result.body) {
        results.push({
          chainId,
          assets: result.body,
        });
      }
    } catch (error) {
      console.error(`Error fetching assets for chain ${chainId}:`, error.message);
    }
  }

  res.status(200).json({
    success: true,
    chains: results.length,
    data: results,
  });
}));

// ===== TRANSACTIONS =====

/**
 * @route   GET /api/portal/clients/me/transactions
 * @desc    Get client's transaction history (requires authentication)
 * @access  Private
 * @query   {
 *            clientApiKey: string (required),
 *            chainId: string (required),
 *            includeNfts?: boolean,
 *            limit?: number,
 *            offset?: number
 *          }
 */
router.get('/clients/me/transactions', authenticate, catchAsync(async (req, res) => {
  const { clientApiKey, chainId, limit = 50, offset = 0 } = req.query;

  validate(clientApiKey, 'clientApiKey is required');
  validate(chainId, 'chainId is required');

  const limitNum = parseInt(limit);
  const offsetNum = parseInt(offset);
  
  validate(!isNaN(limitNum) && limitNum > 0, 'limit must be a positive number');
  validate(!isNaN(offsetNum) && offsetNum >= 0, 'offset must be a non-negative number');
  validate(limitNum <= 100, 'limit cannot exceed 100');

  const context = { auth: req.auth };
  const variables = { 
    ...req.query,
    chainId,
    clientApiKey,
  };

  const result = await apiManager.getClientChainTransactionHistory(context, variables);

  if (result.error) {
    if (result.statusCode === 401 || result.statusCode === 403) {
      throw new AuthenticationError('Invalid client API key');
    }
    
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to fetch transaction history',
      details: result.body,
    });
  }

  const transactions = result.body || [];
  const count = Array.isArray(transactions) ? transactions.length : 0;

  res.status(result.statusCode || 200).json({
    success: true,
    chainId,
    count,
    limit: limitNum,
    offset: offsetNum,
    hasMore: count === limitNum,
    data: transactions,
  });
}));

/**
 * @route   GET /api/portal/clients/me/transactions/recent
 * @desc    Get recent transactions across all chains
 * @access  Private
 * @query   clientApiKey: string (required)
 */
router.get('/clients/me/transactions/recent', authenticate, catchAsync(async (req, res) => {
  const { clientApiKey } = req.query;

  validate(clientApiKey, 'clientApiKey is required');

  const chains = [
    'eip155:1',    // Ethereum
    'eip155:137',  // Polygon
  ];

  const context = { auth: req.auth };
  const allTransactions = [];

  for (const chainId of chains) {
    try {
      const variables = { clientApiKey, chainId };
      const result = await apiManager.getClientChainTransactionHistory(context, variables);
      
      if (!result.error && result.body) {
        const txs = result.body.map(tx => ({ ...tx, chainId }));
        allTransactions.push(...txs);
      }
    } catch (error) {
      console.error(`Error fetching transactions for ${chainId}:`, error.message);
    }
  }

  // Sort by timestamp (most recent first)
  allTransactions.sort((a, b) => {
    return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
  });

  // Get only the 20 most recent
  const recent = allTransactions.slice(0, 20);

  res.status(200).json({
    success: true,
    count: recent.length,
    data: recent,
  });
}));

// ===== WALLET MANAGEMENT =====

/**
 * @route   PATCH /api/portal/clients/me/signing-share-pairs
 * @desc    Confirm wallet creation (requires authentication)
 * @access  Private
 * @body    {
 *            clientApiKey: string (required),
 *            secp256k1Id: string (required),
 *            ed25519Id: string (required)
 *          }
 */
router.patch('/clients/me/signing-share-pairs', authenticate, catchAsync(async (req, res) => {
  const { clientApiKey, secp256k1Id, ed25519Id } = req.body;

  validate(clientApiKey, 'clientApiKey is required');
  validate(secp256k1Id, 'secp256k1Id is required');
  validate(ed25519Id, 'ed25519Id is required');

  const context = { auth: req.auth };
  const result = await apiManager.confirmWalletCreation(context, req.body);

  if ([200, 201, 204].includes(result.statusCode)) {
    res.status(200).json({
      success: true,
      message: 'Wallet creation confirmed successfully',
      data: result.body,
    });
  } else {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to confirm wallet creation',
      details: result.body,
    });
  }
}));

/**
 * @route   POST /api/portal/wallets/generate
 * @desc    Create/generate a new wallet
 * @access  Public
 * @body    {
 *            userKey: string (required)
 *          }
 */
router.post('/wallets/generate', authenticate, catchAsync(async (req, res) => {
  const { clientApiKey } = req.body;

  validate(clientApiKey, 'clientApiKey is required');

  const context = { auth: req.auth };
  const result = await apiManager.createAWallet(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to generate wallet',
      details: result.body,
    });
  }

  res.status(result.statusCode || 201).json({
    success: true,
    message: 'Wallet generated successfully',
    data: result.body,
  });
}));

/**
 * @route   POST /api/portal/wallets/send
 * @desc    Send tokens from wallet (Polygon)
 * @access  Public
 * @body    {
 *            clientApiKey: string (required),
 *            share: string (required),
 *            chain: string (required - e.g., "POLYGON"),
 *            to: string (required - recipient address),
 *            token: string (required - token address or native),
 *            amount: string (required),
 *            rpcUrl: string (required),
 *            metadataStr?: string
 *          }
 */
router.post('/wallets/send', authenticate, catchAsync(async (req, res) => {
  const { clientApiKey, share, chain, to, token, amount, rpcUrl } = req.body;

  // Validate required fields
  validate(clientApiKey, 'clientApiKey is required');
  validate(share, 'share is required');
  validate(chain, 'chain is required');
  validate(to, 'to (recipient address) is required');
  validate(token, 'token is required');
  validate(amount, 'amount is required');
  validate(rpcUrl, 'rpcUrl is required');

  // Validate addresses
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;
  validate(
    addressRegex.test(to),
    'Invalid recipient address format'
  );

  // Validate amount
  const amountNum = parseFloat(amount);
  validate(!isNaN(amountNum) && amountNum > 0, 'amount must be a positive number');

  const context = { auth: req.auth };
  const result = await apiManager.sendPolygonTokenFromWallet(context, req.body);

  if (result.error) {
    return res.status(result.statusCode || 500).json({
      error: result.error,
      message: 'Failed to send tokens',
      details: result.body,
    });
  }

  res.status(result.statusCode || 200).json({
    success: true,
    message: 'Transaction sent successfully',
    data: result.body,
  });
}));

/**
 * @route   POST /api/portal/wallets/send/estimate
 * @desc    Estimate gas for token transfer (placeholder)
 * @access  Public
 * @body    Same as /send endpoint
 */
router.post('/wallets/send/estimate', authenticate, catchAsync(async (req, res) => {
  const { chain, to, amount } = req.body;

  validate(to, 'to address is required');
  validate(amount, 'amount is required');

  // This is a placeholder - implement actual gas estimation
  const estimatedGas = {
    gasLimit: '21000',
    gasPrice: '50',
    estimatedCost: '0.00105',
    currency: chain === 'POLYGON' ? 'MATIC' : 'ETH',
  };

  res.status(200).json({
    success: true,
    message: 'Gas estimation calculated',
    data: estimatedGas,
  });
}));

/**
 * @route   GET /api/portal/chains
 * @desc    Get supported blockchain chains
 * @access  Public
 */
router.get('/chains', (req, res) => {
  const supportedChains = [
    {
      chainId: 'eip155:1',
      name: 'Ethereum Mainnet',
      nativeCurrency: 'ETH',
      rpcUrl: 'https://eth.llamarpc.com',
    },
    {
      chainId: 'eip155:137',
      name: 'Polygon',
      nativeCurrency: 'MATIC',
      rpcUrl: 'https://polygon-rpc.com',
    },
    {
      chainId: 'eip155:56',
      name: 'BNB Smart Chain',
      nativeCurrency: 'BNB',
      rpcUrl: 'https://bsc-dataseed.binance.org',
    },
    {
      chainId: 'eip155:43114',
      name: 'Avalanche C-Chain',
      nativeCurrency: 'AVAX',
      rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    },
  ];

  res.status(200).json({
    success: true,
    count: supportedChains.length,
    data: supportedChains,
  });
});

/**
 * @route   GET /api/portal/health
 * @desc    Health check for Portal HQ API routes
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({
    service: 'Portal HQ API',
    status: 'operational',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;