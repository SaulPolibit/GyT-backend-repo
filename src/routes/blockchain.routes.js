/**
 * Blockchain API Routes
 * Smart contract interaction endpoints
 */

const express = require('express');
const { Web3 } = require('web3');
const apiManager = require('../services/apiManager');
const { authenticate, requireApiKey, requireBearerToken } = require('../middleware/auth');
const {
  catchAsync,
  validate
} = require('../middleware/errorHandler');
const { SmartContract } = require('../models/supabase');

const router = express.Router();

// Country codes mapping (ISO 3166-1 numeric)
const COUNTRY_CODES = {
  'afghanistan': 4, 'albania': 8, 'algeria': 12, 'andorra': 20, 'angola': 24,
  'antigua and barbuda': 28, 'argentina': 32, 'armenia': 51, 'australia': 36,
  'austria': 40, 'azerbaijan': 31, 'bahamas': 44, 'bahrain': 48, 'bangladesh': 50,
  'barbados': 52, 'belarus': 112, 'belgium': 56, 'belize': 84, 'benin': 204,
  'bhutan': 64, 'bolivia': 68, 'bosnia and herzegovina': 70, 'botswana': 72,
  'brazil': 76, 'brunei': 96, 'bulgaria': 100, 'burkina faso': 854, 'burundi': 108,
  'cabo verde': 132, 'cambodia': 116, 'cameroon': 120, 'canada': 124,
  'central african republic': 140, 'chad': 148, 'chile': 152, 'china': 156,
  'colombia': 170, 'comoros': 174, 'congo': 178, 'costa rica': 188,
  "cote d'ivoire": 384, 'croatia': 191, 'cuba': 192, 'cyprus': 196,
  'czech republic': 203, 'denmark': 208, 'djibouti': 262, 'dominica': 212,
  'dominican republic': 214, 'ecuador': 218, 'egypt': 818, 'el salvador': 222,
  'equatorial guinea': 226, 'eritrea': 232, 'estonia': 233, 'eswatini': 748,
  'ethiopia': 231, 'fiji': 242, 'finland': 246, 'france': 250, 'gabon': 266,
  'gambia': 270, 'georgia': 268, 'germany': 276, 'ghana': 288, 'greece': 300,
  'grenada': 308, 'guatemala': 320, 'guinea': 324, 'guinea-bissau': 624,
  'guyana': 328, 'haiti': 332, 'honduras': 340, 'hungary': 348, 'iceland': 352,
  'india': 356, 'indonesia': 360, 'iran': 364, 'iraq': 368, 'ireland': 372,
  'israel': 376, 'italy': 380, 'jamaica': 388, 'japan': 392, 'jordan': 400,
  'kazakhstan': 398, 'kenya': 404, 'kiribati': 296, 'korea north': 408,
  'korea south': 410, 'kosovo': 0, 'kuwait': 414, 'kyrgyzstan': 417, 'laos': 418,
  'latvia': 428, 'lebanon': 422, 'lesotho': 426, 'liberia': 430, 'libya': 434,
  'liechtenstein': 438, 'lithuania': 440, 'luxembourg': 442, 'madagascar': 450,
  'malawi': 454, 'malaysia': 458, 'maldives': 462, 'mali': 466, 'malta': 470,
  'marshall islands': 584, 'mauritania': 478, 'mauritius': 480, 'mexico': 484,
  'micronesia': 583, 'moldova': 498, 'monaco': 492, 'mongolia': 496,
  'montenegro': 499, 'morocco': 504, 'mozambique': 508, 'myanmar': 104,
  'namibia': 516, 'nauru': 520, 'nepal': 524, 'netherlands': 528,
  'new zealand': 554, 'nicaragua': 558, 'niger': 562, 'nigeria': 566,
  'north macedonia': 807, 'norway': 578, 'oman': 512, 'pakistan': 586,
  'palau': 585, 'panama': 591, 'papua new guinea': 598, 'paraguay': 600,
  'peru': 604, 'philippines': 608, 'poland': 616, 'portugal': 620, 'qatar': 634,
  'romania': 642, 'russia': 643, 'rwanda': 646, 'saint kitts and nevis': 659,
  'saint lucia': 662, 'saint vincent and the grenadines': 670, 'samoa': 882,
  'san marino': 674, 'sao tome and principe': 678, 'saudi arabia': 682,
  'senegal': 686, 'serbia': 688, 'seychelles': 690, 'sierra leone': 694,
  'singapore': 702, 'slovakia': 703, 'slovenia': 705, 'solomon islands': 90,
  'somalia': 706, 'south africa': 710, 'south sudan': 728, 'spain': 724,
  'sri lanka': 144, 'sudan': 729, 'suriname': 740, 'sweden': 752,
  'switzerland': 756, 'syria': 760, 'taiwan': 158, 'tajikistan': 762,
  'tanzania': 834, 'thailand': 764, 'timor-leste': 626, 'togo': 768,
  'tonga': 776, 'trinidad and tobago': 780, 'tunisia': 788, 'turkey': 792,
  'turkmenistan': 795, 'tuvalu': 798, 'uganda': 800, 'ukraine': 804,
  'united arab emirates': 784, 'united kingdom': 826, 'united states': 840,
  'uruguay': 858, 'uzbekistan': 860, 'vanuatu': 548, 'vatican city': 336,
  'venezuela': 862, 'vietnam': 704, 'yemen': 887, 'zambia': 894, 'zimbabwe': 716
};

// Helper function to get country code
function getCountryCode(country) {
  const countryName = country.trim().toLowerCase();
  return COUNTRY_CODES[countryName] || -1;
}

/**
 * @route   POST /api/blockchain/contract/owner
 * @desc    Get the owner of a smart contract
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string }
 */
router.post('/contract/owner', authenticate, catchAsync(async (req, res) => {
  const { contractAddress } = req.body;

  validate(contractAddress, 'Contract address is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate contract address format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid Ethereum address'
    });
  }

  // Contract ABI for the owner function
  const contractAbi = [{
    'inputs': [],
    'name': 'owner',
    'outputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Call the owner function
    const ownerAddress = await contract.methods.owner().call();

    // Validate the response
    if (!ownerAddress || ownerAddress === '0x0000000000000000000000000000000000000000') {
      return res.status(404).json({
        success: false,
        error: 'Owner not found',
        message: 'Contract owner could not be determined'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Contract owner retrieved successfully',
      data: {
        contractAddress,
        ownerAddress: ownerAddress.toLowerCase(),
        network: rpcURL.includes('polygon') ? 'Polygon' : 'Ethereum'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract error',
        message: 'Contract call reverted. The contract may not have an owner() function.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Contract call failed',
      message: error.message || 'Failed to retrieve contract owner'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/call
 * @desc    Call a read-only function on a smart contract
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string, abi: array, functionName: string, params: array }
 */
router.post('/contract/call', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, abi, functionName, params = [] } = req.body;

  validate(contractAddress, 'Contract address is required');
  validate(abi, 'Contract ABI is required');
  validate(functionName, 'Function name is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate contract address format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid Ethereum address'
    });
  }

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(abi, contractAddress);

    // Check if function exists
    if (!contract.methods[functionName]) {
      return res.status(400).json({
        success: false,
        error: 'Function not found',
        message: `Function '${functionName}' not found in contract ABI`
      });
    }

    // Call the function
    const result = await contract.methods[functionName](...params).call();

    res.status(200).json({
      success: true,
      message: 'Contract function called successfully',
      data: {
        contractAddress,
        functionName,
        params,
        result
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract error',
        message: 'Contract call reverted'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Contract call failed',
      message: error.message || 'Failed to call contract function'
    });
  }
}));

/**
 * @route   GET /api/blockchain/balance/:address
 * @desc    Get the balance of an Ethereum address
 * @access  Private (requires Bearer token)
 */
router.get('/balance/:address', authenticate, catchAsync(async (req, res) => {
  const { address } = req.params;

  validate(address, 'Address is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address format
  if (!web3.utils.isAddress(address)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid Ethereum address'
    });
  }

  try {
    // Get balance in wei
    const balanceWei = await web3.eth.getBalance(address);

    // Convert to ether
    const balanceEther = web3.utils.fromWei(balanceWei, 'ether');

    res.status(200).json({
      success: true,
      message: 'Balance retrieved successfully',
      data: {
        address: address.toLowerCase(),
        balanceWei: balanceWei.toString(),
        balanceEther: balanceEther,
        network: rpcURL.includes('polygon') ? 'Polygon' : 'Ethereum'
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Failed to get balance',
      message: error.message || 'Failed to retrieve address balance'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/token-holders
 * @desc    Get the number of token holders for a smart contract
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string }
 */
router.post('/contract/token-holders', authenticate, catchAsync(async (req, res) => {
  const { contractAddress } = req.body;

  validate(contractAddress, 'Contract address is required');

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate contract address format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid Ethereum address'
    });
  }

  // Contract ABI for the getTokenHolders function
  const contractAbi = [{
    'inputs': [],
    'name': 'getTokenHolders',
    'outputs': [{
      'internalType': 'address[]',
      'name': '',
      'type': 'address[]'
    }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Call the getTokenHolders function
    const result = await contract.methods.getTokenHolders().call();

    // Check if result is valid
    if (!result || !Array.isArray(result)) {
      return res.status(404).json({
        success: false,
        error: 'No result',
        message: 'No result returned from contract or invalid format'
      });
    }

    // Convert addresses to lowercase for consistency
    const tokenHolderAddresses = result.map(address => address.toLowerCase());

    res.status(200).json({
      success: true,
      message: 'Token holders retrieved successfully',
      data: {
        contractAddress: contractAddress.toLowerCase(),
        tokenHolders: tokenHolderAddresses,
        totalHolders: tokenHolderAddresses.length,
        network: rpcURL.includes('polygon') ? 'Polygon' : 'Ethereum'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract error',
        message: 'Contract call reverted. The contract may not have a getTokenHolders() function.'
      });
    }

    if (error.message && error.message.includes('network')) {
      return res.status(500).json({
        success: false,
        error: 'Network error',
        message: 'Failed to connect to blockchain network. Please try again later.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Contract call failed',
      message: error.message || 'Failed to retrieve token holders count'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/register-agent
 * @desc    Register an agent identity on a smart contract
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string, userAddress: string }
 */
router.post('/contract/register-agent', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, userAddress } = req.body;

  validate(contractAddress, 'Contract address is required');
  validate(userAddress, 'User address is required');

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate addresses format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid user address'
    });
  }

  // Contract ABI for the addAgent function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'address',
      'name': 'agent',
      'type': 'address'
    }],
    'name': 'addAgent',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: contractAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.addAgent(userAddress).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Agent registered successfully',
      data: {
        transactionHash: receipt.transactionHash,
        contractAddress: contractAddress.toLowerCase(),
        agentAddress: userAddress.toLowerCase(),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. The user may already be registered as an agent or you may not have permission.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to register agent identity'
    });
  }
}));

/**
 * @route   GET /api/blockchain/contract/:contractAddress/check-agent/:agentAddress
 * @desc    Check if an address is registered as an agent on a smart contract
 * @access  Private (requires Bearer token)
 * @param   {string} contractAddress - The contract address
 * @param   {string} agentAddress - The agent address to check
 */
router.get('/contract/:contractAddress/check-agent/:agentAddress', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, agentAddress } = req.params;

  validate(contractAddress, 'Contract address is required');
  validate(agentAddress, 'Agent address is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate addresses format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(agentAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid agent address'
    });
  }

  // Contract ABI for the isAgent function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'address',
      'name': '',
      'type': 'address'
    }],
    'name': 'isAgent',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Call the isAgent function
    const isAgent = await contract.methods.isAgent(agentAddress).call();

    res.status(200).json({
      success: true,
      message: 'Agent status retrieved successfully',
      data: {
        contractAddress: contractAddress.toLowerCase(),
        agentAddress: agentAddress.toLowerCase(),
        isAgent: isAgent,
        network: rpcURL.includes('polygon') ? 'Polygon' : 'Ethereum'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract error',
        message: 'Contract call reverted. The contract may not have an isAgent() function.'
      });
    }

    if (error.message && error.message.includes('Invalid hex')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address',
        message: 'Invalid address format provided'
      });
    }

    if (error.message && error.message.includes('network')) {
      return res.status(500).json({
        success: false,
        error: 'Network error',
        message: 'Failed to connect to blockchain network'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Contract call failed',
      message: error.message || 'Failed to check agent status'
    });
  }
}));

/**
 * @route   DELETE /api/blockchain/contract/remove-agent
 * @desc    Remove an agent identity from a smart contract
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string, userAddress: string }
 */
router.delete('/contract/remove-agent', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, userAddress } = req.body;

  validate(contractAddress, 'Contract address is required');
  validate(userAddress, 'User address is required');

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate addresses format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid user address'
    });
  }

  // Contract ABI for the removeAgent function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'address',
      'name': 'agent',
      'type': 'address'
    }],
    'name': 'removeAgent',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: contractAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.removeAgent(userAddress).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    // Check transaction status
    if (!receipt.status) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Transaction was reverted by the contract'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Agent removed successfully',
      data: {
        transactionHash: receipt.transactionHash,
        contractAddress: contractAddress.toLowerCase(),
        agentAddress: userAddress.toLowerCase(),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. The user may not be registered as an agent or you may not have permission.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    if (error.message && error.message.includes('Invalid hex')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address',
        message: 'Invalid address format provided'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to remove agent identity'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/register-user
 * @desc    Register a user identity on a smart contract (Identity Registry)
 * @access  Private (requires Bearer token)
 * @body    { identityAddress: string, userAddress: string, country: string, investorType: number }
 * investorType Options {0: retail, 1: professional, 2: institutional}
 */
router.post('/contract/register-user', authenticate, catchAsync(async (req, res) => {
  const { identityAddress, userAddress, country, investorType } = req.body;

  validate(identityAddress, 'Identity Contract address is required');
  validate(userAddress, 'User address is required');
  validate(country, 'Country is required');
  validate(investorType !== undefined && investorType !== null, 'Investor type is required');

  // Get country code
  const countryCode = getCountryCode(country);
  if (countryCode === -1) {
    return res.status(400).json({
      success: false,
      error: 'Invalid country',
      message: 'Country not found. Please provide a valid country name.'
    });
  }

  // Validate investor type (should be 0-255 for uint8)
  if (typeof investorType !== 'number' || investorType < 0 || investorType > 255) {
    return res.status(400).json({
      success: false,
      error: 'Invalid investor type',
      message: 'Investor type must be a number between 0 and 255'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate addresses format
  if (!web3.utils.isAddress(identityAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid user address'
    });
  }

  // Contract ABI for the registerIdentity function
  const contractAbi = [{
    'inputs': [
      {
        'internalType': 'address',
        'name': 'user',
        'type': 'address'
      },
      {
        'internalType': 'uint16',
        'name': 'country',
        'type': 'uint16'
      },
      {
        'internalType': 'uint8',
        'name': 'investorType',
        'type': 'uint8'
      }
    ],
    'name': 'registerIdentity',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, identityAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: identityAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.registerIdentity(userAddress, countryCode, investorType).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'User identity registered successfully',
      data: {
        transactionHash: receipt.transactionHash,
        identityAddress: identityAddress.toLowerCase(),
        userAddress: userAddress.toLowerCase(),
        country: country,
        countryCode: countryCode,
        investorType: investorType,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. The user may already be registered or you may not have permission.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to register user identity'
    });
  }
}));

/**
 * @route   GET /api/blockchain/contract/:identityAddress/check-user/:userAddress
 * @desc    Check if a user identity is verified on a smart contract (Identity Registry)
 * @access  Private (requires Bearer token)
 * @param   {string} identityAddress - The Identity Registry contract address
 * @param   {string} userAddress - The user address to check
 */
router.get('/contract/:identityAddress/check-user/:userAddress', authenticate, catchAsync(async (req, res) => {
  const { identityAddress, userAddress } = req.params;

  validate(identityAddress, 'Identity Contract address is required');
  validate(userAddress, 'User address is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate addresses format
  if (!web3.utils.isAddress(identityAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid user address'
    });
  }

  // Contract ABI for the isVerified function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'address',
      'name': 'user',
      'type': 'address'
    }],
    'name': 'isVerified',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, identityAddress);

    // Call the isVerified function
    const isVerified = await contract.methods.isVerified(userAddress).call();

    res.status(200).json({
      success: true,
      message: 'User verification status retrieved successfully',
      data: {
        identityAddress: identityAddress.toLowerCase(),
        userAddress: userAddress.toLowerCase(),
        isVerified: isVerified,
        status: isVerified ? 'verified' : 'not_verified',
        network: rpcURL.includes('polygon') ? 'Polygon' : 'Ethereum'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract error',
        message: 'Contract call reverted. The contract may not have an isVerified() function.'
      });
    }

    if (error.message && error.message.includes('Invalid hex')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address',
        message: 'Invalid address format provided'
      });
    }

    if (error.message && error.message.includes('network')) {
      return res.status(500).json({
        success: false,
        error: 'Network error',
        message: 'Failed to connect to blockchain network'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Contract call failed',
      message: error.message || 'Failed to check user verification status'
    });
  }
}));

/**
 * @route   DELETE /api/blockchain/contract/remove-user
 * @desc    Remove a user identity from a smart contract (Identity Registry)
 * @access  Private (requires Bearer token)
 * @body    { identityAddress: string, userAddress: string }
 */
router.delete('/contract/remove-user', authenticate, catchAsync(async (req, res) => {
  const { identityAddress, userAddress } = req.body;

  validate(identityAddress, 'Identity Contract address is required');
  validate(userAddress, 'User address is required');

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate addresses format
  if (!web3.utils.isAddress(identityAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid user address'
    });
  }

  // Contract ABI for the deleteIdentity function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'address',
      'name': 'user',
      'type': 'address'
    }],
    'name': 'deleteIdentity',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, identityAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: identityAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.deleteIdentity(userAddress).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    // Check transaction status
    if (!receipt.status) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Transaction was reverted by the contract'
      });
    }

    res.status(200).json({
      success: true,
      message: 'User identity removed successfully',
      data: {
        transactionHash: receipt.transactionHash,
        identityAddress: identityAddress.toLowerCase(),
        userAddress: userAddress.toLowerCase(),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. The user may not be registered or you may not have permission.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    if (error.message && error.message.includes('Invalid hex')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address',
        message: 'Invalid address format provided'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to remove user identity'
    });
  }
}));



/**
 * @route   GET /api/blockchain/contract/:complianceAddress/check-country/:country
 * @desc    Check if a country is allowed in the compliance registry contract
 * @access  Private (requires Bearer token)
 * @param   {string} complianceAddress - The compliance registry contract address
 * @param   {string} country - The country name to check (e.g., "mexico", "canada")
 */
router.get('/contract/:complianceAddress/check-country/:country', authenticate, catchAsync(async (req, res) => {
  const { complianceAddress, country } = req.params;

  validate(complianceAddress, 'Compliance address is required');
  validate(country, 'Country is required');

  // Get country code
  const countryCode = getCountryCode(country);
  if (countryCode === -1) {
    return res.status(400).json({
      success: false,
      error: 'Invalid country',
      message: 'Country not found. Please provide a valid country name.'
    });
  }

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address format
  if (!web3.utils.isAddress(complianceAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid compliance address'
    });
  }

  // Contract ABI for the isCountryAllowed function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'uint16',
      'name': 'country',
      'type': 'uint16'
    }],
    'name': 'isCountryAllowed',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, complianceAddress);

    // Call the isCountryAllowed function
    const isAllowed = await contract.methods.isCountryAllowed(countryCode).call();

    res.status(200).json({
      success: true,
      message: 'Country status retrieved successfully',
      data: {
        complianceAddress: complianceAddress.toLowerCase(),
        country: country,
        countryCode: countryCode,
        isAllowed: isAllowed,
        status: isAllowed ? 'allowed' : 'not_allowed',
        network: rpcURL.includes('polygon') ? 'Polygon' : 'Ethereum'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract error',
        message: 'Contract call reverted. The contract may not have an isCountryAllowed() function.'
      });
    }

    if (error.message && error.message.includes('Invalid hex')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid code',
        message: 'Invalid country code format'
      });
    }

    if (error.message && error.message.includes('network')) {
      return res.status(500).json({
        success: false,
        error: 'Network error',
        message: 'Failed to connect to blockchain network'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Contract call failed',
      message: error.message || 'Failed to check country status'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/add-country
 * @desc    Add an allowed country to the compliance registry contract
 * @access  Private (requires Bearer token)
 * @body    { complianceAddress: string, country: string }
 */
router.post('/contract/add-country', authenticate, catchAsync(async (req, res) => {
  const { complianceAddress, country } = req.body;

  validate(complianceAddress, 'Compliance address is required');
  validate(country, 'Country is required');

  // Get country code
  const countryCode = getCountryCode(country);
  if (countryCode === -1) {
    return res.status(400).json({
      success: false,
      error: 'Invalid country',
      message: 'Country not found. Please provide a valid country name.'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address format
  if (!web3.utils.isAddress(complianceAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid compliance address'
    });
  }

  // Contract ABI for the addAllowedCountry function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'uint16',
      'name': 'country',
      'type': 'uint16'
    }],
    'name': 'addAllowedCountry',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, complianceAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: complianceAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.addAllowedCountry(countryCode).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Country added successfully to allowed countries',
      data: {
        transactionHash: receipt.transactionHash,
        complianceAddress: complianceAddress.toLowerCase(),
        country: country,
        countryCode: countryCode,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. The country may already be allowed or you may not have permission.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to add country to allowed countries'
    });
  }
}));

/**
 * @route   DELETE /api/blockchain/contract/remove-country
 * @desc    Remove an allowed country from the compliance registry contract
 * @access  Private (requires Bearer token)
 * @body    { complianceAddress: string, country: string }
 */
router.delete('/contract/remove-country', authenticate, catchAsync(async (req, res) => {
  const { complianceAddress, country } = req.body;

  validate(complianceAddress, 'Compliance address is required');
  validate(country, 'Country is required');

  // Get country code
  const countryCode = getCountryCode(country);
  if (countryCode === -1) {
    return res.status(400).json({
      success: false,
      error: 'Invalid country',
      message: 'Country not found. Please provide a valid country name.'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address format
  if (!web3.utils.isAddress(complianceAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid compliance address'
    });
  }

  // Contract ABI for the removeAllowedCountry function
  const contractAbi = [{
    'inputs': [{
      'internalType': 'uint16',
      'name': 'country',
      'type': 'uint16'
    }],
    'name': 'removeAllowedCountry',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, complianceAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: complianceAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.removeAllowedCountry(countryCode).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Country removed successfully from allowed countries',
      data: {
        transactionHash: receipt.transactionHash,
        complianceAddress: complianceAddress.toLowerCase(),
        country: country,
        countryCode: countryCode,
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. The country may not be in the allowed list or you may not have permission.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to remove country from allowed countries'
    });
  }
}));

/**
 * @route   GET /api/blockchain/contract/:contractAddress/balance/:userAddress
 * @desc    Get token balance of a user address
 * @access  Private (requires Bearer token)
 * @param   {string} contractAddress - Token contract address
 * @param   {string} userAddress - User wallet address to check balance
 */
router.get('/contract/:contractAddress/balance/:userAddress', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, userAddress } = req.params;

  validate(contractAddress, 'Contract address is required');
  validate(userAddress, 'User address is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address formats
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid user address'
    });
  }

  // Contract ABI for the balanceOf function (ERC20 standard)
  const contractAbi = [{
    'inputs': [{
      'name': 'account',
      'type': 'address'
    }],
    'name': 'balanceOf',
    'outputs': [{
      'name': '',
      'type': 'uint256'
    }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Call balanceOf function (read-only, no transaction needed)
    const balance = await contract.methods.balanceOf(userAddress).call();

    res.status(200).json({
      success: true,
      message: 'Balance retrieved successfully',
      data: {
        contractAddress: contractAddress.toLowerCase(),
        userAddress: userAddress.toLowerCase(),
        balance: balance.toString(),
        balanceFormatted: web3.utils.fromWei(balance.toString(), 'ether'),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('Returned values aren\'t valid')) {
      return res.status(400).json({
        success: false,
        error: 'Contract error',
        message: 'Unable to retrieve balance. Please verify the contract address is a valid ERC20 token.'
      });
    }

    if (error.message && error.message.includes('CONTRACT_NOT_DEPLOYED')) {
      return res.status(400).json({
        success: false,
        error: 'Contract not found',
        message: 'Contract not deployed at the provided address'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve balance',
      message: error.message || 'Unable to retrieve token balance'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/mint-tokens
 * @desc    Mint tokens to a user address
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string, userAddress: string, amount: number }
 */
router.post('/contract/mint-tokens', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, userAddress, amount } = req.body;

  validate(contractAddress, 'Contract address is required');
  validate(userAddress, 'User address is required');
  validate(amount !== undefined && amount !== null && amount !== '', 'Amount is required');

  // Parse and validate amount is a positive number
  const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount',
      message: 'Amount must be a positive number'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address formats
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(userAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid user address'
    });
  }

  // Contract ABI for the mint function
  const contractAbi = [{
    'inputs': [
      {
        'name': 'account',
        'type': 'address'
      },
      {
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'mint',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: contractAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.mint(userAddress, parsedAmount).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Tokens minted successfully',
      data: {
        transactionHash: receipt.transactionHash,
        contractAddress: contractAddress.toLowerCase(),
        userAddress: userAddress.toLowerCase(),
        amount: parsedAmount.toString(),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. You may not have permission to mint tokens or the amount exceeds limits.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to mint tokens'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/transfer-tokens
 * @desc    Transfer tokens from one address to another using transferFrom
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string, addressFrom: string, addressTo: string, amount: number }
 */
router.post('/contract/transfer-tokens', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, addressFrom, addressTo, amount } = req.body;

  validate(contractAddress, 'Contract address is required');
  validate(addressFrom, 'From address is required');
  validate(addressTo, 'To address is required');
  validate(amount !== undefined && amount !== null, 'Amount is required');

  // Validate amount is a positive number
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount',
      message: 'Amount must be a positive number'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address formats
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(addressFrom)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid from address'
    });
  }

  if (!web3.utils.isAddress(addressTo)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid to address'
    });
  }

  // Contract ABI for the transferFrom function (ERC20 standard)
  const contractAbi = [{
    'inputs': [
      {
        'internalType': 'address',
        'name': 'from',
        'type': 'address'
      },
      {
        'internalType': 'address',
        'name': 'to',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'transferFrom',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: contractAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.transferFrom(addressFrom, addressTo, amount).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Tokens transferred successfully',
      data: {
        transactionHash: receipt.transactionHash,
        contractAddress: contractAddress.toLowerCase(),
        from: addressFrom.toLowerCase(),
        to: addressTo.toLowerCase(),
        amount: amount.toString(),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. Insufficient balance, no allowance, or transfer not allowed by compliance rules.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to transfer tokens'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/set-allowance
 * @desc    Set (increase) allowance for a spender to transfer tokens on behalf of owner
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string, owner: string, spender: string, amount: number }
 */
router.post('/contract/set-allowance', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, owner, spender, amount } = req.body;

  validate(contractAddress, 'Contract address is required');
  validate(owner, 'Owner address is required');
  validate(spender, 'Spender address is required');
  validate(amount !== undefined && amount !== null, 'Amount is required');

  // Validate amount is a positive number
  if (typeof amount !== 'number' || amount < 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount',
      message: 'Amount must be a non-negative number'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address formats
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(owner)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid owner address'
    });
  }

  if (!web3.utils.isAddress(spender)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid spender address'
    });
  }

  // Contract ABI for the increaseAllowance function
  const contractAbi = [{
    'inputs': [
      {
        'internalType': 'address',
        'name': 'owner',
        'type': 'address'
      },
      {
        'internalType': 'address',
        'name': 'spender',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': '_addedValue',
        'type': 'uint256'
      }
    ],
    'name': 'increaseAllowance',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: contractAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.increaseAllowance(owner, spender, amount).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Allowance set successfully',
      data: {
        transactionHash: receipt.transactionHash,
        contractAddress: contractAddress.toLowerCase(),
        owner: owner.toLowerCase(),
        spender: spender.toLowerCase(),
        amount: amount.toString(),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. You may not have permission to set allowance or parameters are invalid.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the transaction'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to set allowance'
    });
  }
}));

/**
 * @route   GET /api/blockchain/contract/allowance
 * @desc    Get the allowance amount for a spender on behalf of an owner
 * @access  Private (requires Bearer token)
 * @query   contractAddress - The contract address
 * @query   owner - The owner address
 * @query   spender - The spender address
 */
router.get('/contract/allowance', requireBearerToken, catchAsync(async (req, res) => {
  const { contractAddress, owner, spender } = req.query;

  // Validate required fields
  validate(contractAddress, 'Contract address is required');
  validate(owner, 'Owner address is required');
  validate(spender, 'Spender address is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address formats
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(owner)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid owner address'
    });
  }

  if (!web3.utils.isAddress(spender)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid spender address'
    });
  }

  // Contract ABI for the allowance function (ERC20 standard)
  const contractAbi = [{
    'inputs': [
      {
        'name': 'owner',
        'type': 'address'
      },
      {
        'name': 'spender',
        'type': 'address'
      }
    ],
    'name': 'allowance',
    'outputs': [{
      'name': '',
      'type': 'uint256'
    }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Call the allowance function (read-only, no transaction needed)
    const allowanceAmount = await contract.methods.allowance(owner, spender).call();

    res.status(200).json({
      success: true,
      message: 'Allowance retrieved successfully',
      data: {
        contractAddress: contractAddress.toLowerCase(),
        owner: owner.toLowerCase(),
        spender: spender.toLowerCase(),
        allowance: allowanceAmount.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract call reverted',
        message: 'Contract call reverted. The contract may not support the allowance function.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Failed to get allowance',
      message: error.message || 'Failed to retrieve allowance'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/batch-transfer-tokens
 * @desc    Batch transfer tokens to multiple addresses
 * @access  Private (requires Bearer token)
 * @body    { contractAddress: string, addresses: string[], amounts: number[] }
 */
router.post('/contract/batch-transfer-tokens', authenticate, catchAsync(async (req, res) => {
  const { contractAddress, addressList, amountsList } = req.body;

  // Validate required fields
  validate(contractAddress, 'Contract address is required');
  validate(addressList, 'Address list array is required');
  validate(amountsList, 'Amounts list array is required');

  // Validate addresses is an array
  if (!Array.isArray(addressList) || amountsList.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid addresses',
      message: 'Address list must be a non-empty array'
    });
  }

  // Validate amounts is an array
  if (!Array.isArray(amountsList) || amountsList.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amounts',
      message: 'Amounts list must be a non-empty array'
    });
  }

  // Validate that addresses and amounts arrays have the same length
  if (addressList.length !== amountsList.length) {
    return res.status(400).json({
      success: false,
      error: 'Array length mismatch',
      message: 'Address list and amounts list must have the same length'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate contract address format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  // Validate all recipient addressList
  for (let i = 0; i < addressList.length; i++) {
    if (!web3.utils.isAddress(addressList[i])) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address',
        message: `Invalid recipient address at index ${i}: ${addressList[i]}`
      });
    }
  }

  // Validate all amountsList are positive numbers
  for (let i = 0; i < amountsList.length; i++) {
    if (typeof amountsList[i] !== 'number' || amountsList[i] <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount',
        message: `Amount at index ${i} must be a positive number`
      });
    }
  }

  // Contract ABI for the batchTransfer function
  const contractAbi = [{
    'inputs': [
      {
        'internalType': 'address[]',
        'name': 'to',
        'type': 'address[]'
      },
      {
        'internalType': 'uint256[]',
        'name': 'amounts',
        'type': 'uint256[]'
      }
    ],
    'name': 'batchTransfer',
    'outputs': [],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: contractAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.batchTransfer(addressList, amountsList).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Batch transfer completed successfully',
      data: {
        transactionHash: receipt.transactionHash.toString(),
        contractAddress: contractAddress.toLowerCase(),
        recipientCount: addressList.length,
        recipients: addressList.map(addr => addr.toLowerCase()),
        amountsList: amountsList.map(amt => amt.toString()),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. Insufficient balance or transfer not allowed by compliance rules.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the batch transfer'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to complete batch transfer'
    });
  }
}));

/**
 * @route   POST /api/blockchain/contract/force-transfer-tokens
 * @desc    Force transfer tokens from one address to another (admin function)
 * @access  Private (requires API Key in x-api-key header AND Bearer token)
 * @body    { contractAddress: string, addressFrom: string, addressTo: string, amount: number }
 */
router.post('/contract/force-transfer-tokens', requireApiKey, requireBearerToken, catchAsync(async (req, res) => {
  const { contractAddress, addressFrom, addressTo, amount } = req.body;

  // Validate required fields
  validate(contractAddress, 'Contract address is required');
  validate(addressFrom, 'From address is required');
  validate(addressTo, 'To address is required');
  validate(amount !== undefined && amount !== null, 'Amount is required');

  // Validate amount is a positive number
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid amount',
      message: 'Amount must be a positive number'
    });
  }

  // Get RPC URL and Private Key from environment variables
  const rpcURL = process.env.RPC_URL;
  const privateKey = process.env.PORTAL_HQ_PRIVATE_KEY;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  if (!privateKey) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'PORTAL_HQ_PRIVATE_KEY not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate address formats
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  if (!web3.utils.isAddress(addressFrom)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid from address'
    });
  }

  if (!web3.utils.isAddress(addressTo)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid to address'
    });
  }

  // Contract ABI for the forcedTransfer function
  const contractAbi = [{
    'inputs': [
      {
        'internalType': 'address',
        'name': 'from',
        'type': 'address'
      },
      {
        'internalType': 'address',
        'name': 'to',
        'type': 'address'
      },
      {
        'internalType': 'uint256',
        'name': 'amount',
        'type': 'uint256'
      }
    ],
    'name': 'forcedTransfer',
    'outputs': [{
      'internalType': 'bool',
      'name': '',
      'type': 'bool'
    }],
    'stateMutability': 'nonpayable',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Create account from private key (ensure it has 0x prefix)
    const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = web3.eth.accounts.privateKeyToAccount(formattedPrivateKey);
    web3.eth.accounts.wallet.add(account);

    // Get current nonce
    const nonce = await web3.eth.getTransactionCount(account.address, 'pending');

    // Get current gas price
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction
    const tx = {
      from: account.address,
      to: contractAddress,
      gas: 300000,
      gasPrice: gasPrice,
      nonce: nonce,
      data: contract.methods.forcedTransfer(addressFrom, addressTo, amount).encodeABI(),
      chainId: parseInt(process.env.CHAIN_ID || '80002') // Chain ID from env
    };

    // Sign and send transaction
    const signedTx = await web3.eth.accounts.signTransaction(tx, formattedPrivateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    res.status(200).json({
      success: true,
      message: 'Forced transfer completed successfully',
      data: {
        transactionHash: receipt.transactionHash.toString(),
        contractAddress: contractAddress.toLowerCase(),
        from: addressFrom.toLowerCase(),
        to: addressTo.toLowerCase(),
        amount: amount.toString(),
        blockNumber: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Transaction reverted',
        message: 'Contract call reverted. Insufficient balance, unauthorized, or transfer not allowed by compliance rules.'
      });
    }

    if (error.message && error.message.includes('insufficient funds')) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient funds',
        message: 'Insufficient funds to complete the forced transfer'
      });
    }

    if (error.message && error.message.includes('nonce')) {
      return res.status(400).json({
        success: false,
        error: 'Nonce error',
        message: 'Transaction nonce error. Please try again.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Transaction failed',
      message: error.message || 'Failed to complete forced transfer'
    });
  }
}));

/**
 * @route   POST /api/blockchain/deploy/erc3643
 * @desc    Deploy an ERC3643 security token contract (POST method)
 * @access  Private (requires API Key in x-api-key header AND Bearer token)
 * @body    Same as GET query parameters
 */
router.post('/deploy/erc3643', requireApiKey, requireBearerToken, catchAsync(async (req, res) => {
  const {
    structureId,
    contractTokenName,
    contractTokenSymbol,
    contractTokenValue,
    contractMaxTokens,
    company,
    currency,
    projectName,
    network,
    operatingAgreementHash
  } = req.body;

  // Validate required fields
  validate(contractTokenName, 'contractTokenName is required');
  validate(contractTokenSymbol, 'contractTokenSymbol is required');
  validate(contractTokenValue, 'contractTokenValue is required');
  validate(contractMaxTokens, 'contractMaxTokens is required');
  validate(company, 'company is required');
  validate(currency, 'currency is required');
  validate(projectName, 'projectName is required');

  // Create smart contract record in database
  const contractData = {
    structureId,
    contractType: 'ERC3643',
    deploymentStatus: 'deploying',
    company,
    currency,
    maxTokens: contractMaxTokens,
    projectName,
    tokenName: contractTokenName,
    tokenSymbol: contractTokenSymbol,
    tokenValue: contractTokenValue,
    deployedBy: req.auth?.userId || req.auth?.sub,
    network: network || 'polygon',
    operatingAgreementHash: operatingAgreementHash || 'n/a'
  };

  try {
    // Save initial record
    const smartContract = await SmartContract.create(contractData);

    // Deploy contract
    const context = { auth: req.auth };
    const result = await apiManager.deployContractERC3643(context, req.body);

    if (result.error) {
      // Mark as failed
      await SmartContract.markAsFailed(smartContract.id, result.error);

      return res.status(result.statusCode || 500).json({
        error: result.error,
        message: 'Failed to deploy ERC3643 contract',
        details: result.body,
        contractId: smartContract.id
      });
    }

    // Update with deployment result
    await SmartContract.markAsDeployed(smartContract.id, result.body);

    res.status(result.statusCode || 200).json({
      success: true,
      message: 'ERC3643 contract deployment initiated',
      contractType: 'ERC3643',
      contractId: smartContract.id,
      data: result.body,
    });
  } catch (error) {
    // Error occurred during creation or deployment - no need to mark as failed
    // since the record may not have been created yet
    throw error;
  }
}));

/**
 * @route   GET /api/blockchain/contract/total-supply
 * @desc    Get the total supply of tokens for a contract
 * @access  Private (requires Bearer token)
 * @query   contractAddress - The contract address
 */
router.get('/contract/total-supply', requireBearerToken, catchAsync(async (req, res) => {
  const { contractAddress } = req.query;

  // Validate required fields
  validate(contractAddress, 'Contract address is required');

  // Get RPC URL from environment variables
  const rpcURL = process.env.RPC_URL;

  if (!rpcURL) {
    return res.status(500).json({
      success: false,
      error: 'Configuration error',
      message: 'RPC_URL not configured in environment variables'
    });
  }

  // Initialize Web3 with the RPC URL
  const web3 = new Web3(rpcURL);

  // Validate contract address format
  if (!web3.utils.isAddress(contractAddress)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid address',
      message: 'Please provide a valid contract address'
    });
  }

  // Contract ABI for the totalSupply function (ERC20 standard)
  const contractAbi = [{
    'inputs': [],
    'name': 'totalSupply',
    'outputs': [{
      'name': '',
      'type': 'uint256'
    }],
    'stateMutability': 'view',
    'type': 'function'
  }];

  try {
    // Create contract instance
    const contract = new web3.eth.Contract(contractAbi, contractAddress);

    // Call the totalSupply function (read-only, no transaction needed)
    const totalSupply = await contract.methods.totalSupply().call();

    res.status(200).json({
      success: true,
      message: 'Total supply retrieved successfully',
      data: {
        contractAddress: contractAddress.toLowerCase(),
        totalSupply: totalSupply.toString(),
        network: process.env.NETWORK_NAME || 'Polygon Amoy'
      }
    });

  } catch (error) {
    // Handle specific Web3 errors
    if (error.message && error.message.includes('revert')) {
      return res.status(400).json({
        success: false,
        error: 'Contract call reverted',
        message: 'Contract call reverted. The contract may not support the totalSupply function.'
      });
    }

    // Generic error handling
    return res.status(500).json({
      success: false,
      error: 'Failed to get total supply',
      message: error.message || 'Failed to retrieve total supply'
    });
  }
}));

module.exports = router;
