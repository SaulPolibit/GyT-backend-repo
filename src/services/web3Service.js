/**
 * Web3 Service
 * Encapsulates all Web3 blockchain operations for easier testing and maintainability
 */

const { Web3 } = require('web3');

class Web3Service {
  constructor(rpcUrl = process.env.RPC_URL, web3Instance = null) {
    if (!rpcUrl) {
      throw new Error('RPC_URL is required');
    }
    // Allow injecting web3 instance for testing
    this.web3 = web3Instance || new Web3(rpcUrl);
    this.rpcUrl = rpcUrl;
  }

  /**
   * Check if an address is valid
   */
  isValidAddress(address) {
    return this.web3.utils.isAddress(address);
  }

  /**
   * Convert wei to ether
   */
  fromWei(value, unit = 'ether') {
    return this.web3.utils.fromWei(value, unit);
  }

  /**
   * Convert ether to wei
   */
  toWei(value, unit = 'ether') {
    return this.web3.utils.toWei(value, unit);
  }

  /**
   * Get balance of an address
   */
  async getBalance(address) {
    return await this.web3.eth.getBalance(address);
  }

  /**
   * Get contract owner
   */
  async getContractOwner(contractAddress) {
    const contractAbi = [{
      'inputs': [],
      'name': 'owner',
      'outputs': [{ 'internalType': 'address', 'name': '', 'type': 'address' }],
      'stateMutability': 'view',
      'type': 'function'
    }];

    const contract = new this.web3.eth.Contract(contractAbi, contractAddress);
    return await contract.methods.owner().call();
  }

  /**
   * Call a contract function
   */
  async callContractFunction(contractAddress, abi, functionName, params = []) {
    const contract = new this.web3.eth.Contract(abi, contractAddress);

    if (!contract.methods[functionName]) {
      throw new Error(`Function '${functionName}' not found in contract ABI`);
    }

    return await contract.methods[functionName](...params).call();
  }

  /**
   * Send a signed transaction
   */
  async sendSignedTransaction(signedTx) {
    return await this.web3.eth.sendSignedTransaction(signedTx);
  }

  /**
   * Create account from private key
   */
  createAccountFromPrivateKey(privateKey) {
    return this.web3.eth.accounts.privateKeyToAccount(privateKey);
  }

  /**
   * Add account to wallet
   */
  addAccountToWallet(account) {
    return this.web3.eth.accounts.wallet.add(account);
  }

  /**
   * Encode function call
   */
  encodeFunctionCall(abi, params) {
    return this.web3.eth.abi.encodeFunctionCall(abi, params);
  }

  /**
   * Get transaction count (nonce)
   */
  async getTransactionCount(address) {
    return await this.web3.eth.getTransactionCount(address);
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(tx) {
    return await this.web3.eth.estimateGas(tx);
  }

  /**
   * Get current gas price
   */
  async getGasPrice() {
    return await this.web3.eth.getGasPrice();
  }

  /**
   * Sign a transaction
   */
  async signTransaction(tx, privateKey) {
    return await this.web3.eth.accounts.signTransaction(tx, privateKey);
  }

  /**
   * Create contract instance
   */
  createContract(abi, address) {
    return new this.web3.eth.Contract(abi, address);
  }

  /**
   * Get network type from RPC URL
   */
  getNetworkType() {
    return this.rpcUrl.includes('polygon') ? 'Polygon' : 'Ethereum';
  }

  /**
   * Get token holders (requires event parsing)
   */
  async getTokenHolders(contractAddress, abi) {
    const contract = new this.web3.eth.Contract(abi, contractAddress);

    // Get Transfer events
    const events = await contract.getPastEvents('Transfer', {
      fromBlock: 0,
      toBlock: 'latest'
    });

    // Extract unique holders
    const holders = new Set();
    events.forEach(event => {
      const { to } = event.returnValues;
      if (to && to !== '0x0000000000000000000000000000000000000000') {
        holders.add(to.toLowerCase());
      }
    });

    return Array.from(holders);
  }

  /**
   * Get total supply of a token
   */
  async getTotalSupply(contractAddress, abi) {
    const contract = new this.web3.eth.Contract(abi, contractAddress);

    if (!contract.methods.totalSupply) {
      throw new Error('Contract does not have totalSupply function');
    }

    return await contract.methods.totalSupply().call();
  }

  /**
   * Send a transaction to the blockchain
   * @param {Object} params - Transaction parameters
   * @param {string} params.contractAddress - Contract address
   * @param {Array} params.abi - Contract ABI
   * @param {string} params.methodName - Method name to call
   * @param {Array} params.methodParams - Parameters for the method
   * @param {string} params.privateKey - Private key to sign transaction
   * @param {Object} params.txOptions - Optional transaction options (gas, gasPrice, etc.)
   */
  async sendContractTransaction({ contractAddress, abi, methodName, methodParams = [], privateKey, txOptions = {} }) {
    // Create contract instance
    const contract = new this.web3.eth.Contract(abi, contractAddress);

    // Validate method exists
    if (!contract.methods[methodName]) {
      throw new Error(`Method '${methodName}' not found in contract ABI`);
    }

    // Create account from private key
    const account = this.web3.eth.accounts.privateKeyToAccount(privateKey);
    this.web3.eth.accounts.wallet.add(account);

    // Encode the function call
    const encodedABI = contract.methods[methodName](...methodParams).encodeABI();

    // Get transaction count (nonce)
    const nonce = await this.web3.eth.getTransactionCount(account.address);

    // Prepare transaction object
    const tx = {
      from: account.address,
      to: contractAddress,
      data: encodedABI,
      nonce,
      ...txOptions
    };

    // Estimate gas if not provided
    if (!tx.gas) {
      tx.gas = await this.web3.eth.estimateGas(tx);
    }

    // Get gas price if not provided
    if (!tx.gasPrice) {
      tx.gasPrice = await this.web3.eth.getGasPrice();
    }

    // Sign the transaction
    const signedTx = await this.web3.eth.accounts.signTransaction(tx, privateKey);

    // Send the signed transaction
    const receipt = await this.web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    return receipt;
  }

  /**
   * Mint tokens on an ERC20-like contract
   */
  async mintTokens({ contractAddress, toAddress, amount, privateKey }) {
    const abi = [
      {
        'inputs': [
          { 'internalType': 'address', 'name': 'to', 'type': 'address' },
          { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
        ],
        'name': 'mint',
        'outputs': [],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    const amountInWei = this.web3.utils.toWei(amount.toString(), 'ether');

    return await this.sendContractTransaction({
      contractAddress,
      abi,
      methodName: 'mint',
      methodParams: [toAddress, amountInWei],
      privateKey
    });
  }

  /**
   * Transfer tokens from one address to another
   */
  async transferTokens({ contractAddress, fromAddress, toAddress, amount, privateKey }) {
    const abi = [
      {
        'inputs': [
          { 'internalType': 'address', 'name': 'from', 'type': 'address' },
          { 'internalType': 'address', 'name': 'to', 'type': 'address' },
          { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
        ],
        'name': 'transferFrom',
        'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    const amountInWei = this.web3.utils.toWei(amount.toString(), 'ether');

    return await this.sendContractTransaction({
      contractAddress,
      abi,
      methodName: 'transferFrom',
      methodParams: [fromAddress, toAddress, amountInWei],
      privateKey
    });
  }

  /**
   * Set allowance for a spender
   */
  async setAllowance({ contractAddress, spenderAddress, amount, privateKey }) {
    const abi = [
      {
        'inputs': [
          { 'internalType': 'address', 'name': 'spender', 'type': 'address' },
          { 'internalType': 'uint256', 'name': 'amount', 'type': 'uint256' }
        ],
        'name': 'approve',
        'outputs': [{ 'internalType': 'bool', 'name': '', 'type': 'bool' }],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    const amountInWei = this.web3.utils.toWei(amount.toString(), 'ether');

    return await this.sendContractTransaction({
      contractAddress,
      abi,
      methodName: 'approve',
      methodParams: [spenderAddress, amountInWei],
      privateKey
    });
  }

  /**
   * Get allowance between owner and spender
   */
  async getAllowance({ contractAddress, ownerAddress, spenderAddress }) {
    const abi = [
      {
        'inputs': [
          { 'internalType': 'address', 'name': 'owner', 'type': 'address' },
          { 'internalType': 'address', 'name': 'spender', 'type': 'address' }
        ],
        'name': 'allowance',
        'outputs': [{ 'internalType': 'uint256', 'name': '', 'type': 'uint256' }],
        'stateMutability': 'view',
        'type': 'function'
      }
    ];

    const contract = new this.web3.eth.Contract(abi, contractAddress);
    return await contract.methods.allowance(ownerAddress, spenderAddress).call();
  }

  /**
   * Register an agent in identity registry
   */
  async registerAgent({ identityRegistryAddress, agentAddress, privateKey }) {
    const abi = [
      {
        'inputs': [{ 'internalType': 'address', 'name': 'agent', 'type': 'address' }],
        'name': 'addAgent',
        'outputs': [],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    return await this.sendContractTransaction({
      contractAddress: identityRegistryAddress,
      abi,
      methodName: 'addAgent',
      methodParams: [agentAddress],
      privateKey
    });
  }

  /**
   * Remove an agent from identity registry
   */
  async removeAgent({ identityRegistryAddress, agentAddress, privateKey }) {
    const abi = [
      {
        'inputs': [{ 'internalType': 'address', 'name': 'agent', 'type': 'address' }],
        'name': 'removeAgent',
        'outputs': [],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    return await this.sendContractTransaction({
      contractAddress: identityRegistryAddress,
      abi,
      methodName: 'removeAgent',
      methodParams: [agentAddress],
      privateKey
    });
  }

  /**
   * Register a user identity
   */
  async registerUser({ identityAddress, userAddress, countryCode, privateKey }) {
    const abi = [
      {
        'inputs': [
          { 'internalType': 'address', 'name': 'user', 'type': 'address' },
          { 'internalType': 'uint16', 'name': 'country', 'type': 'uint16' }
        ],
        'name': 'registerIdentity',
        'outputs': [],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    return await this.sendContractTransaction({
      contractAddress: identityAddress,
      abi,
      methodName: 'registerIdentity',
      methodParams: [userAddress, countryCode],
      privateKey
    });
  }

  /**
   * Remove a user identity
   */
  async removeUser({ identityAddress, userAddress, privateKey }) {
    const abi = [
      {
        'inputs': [{ 'internalType': 'address', 'name': 'user', 'type': 'address' }],
        'name': 'deleteIdentity',
        'outputs': [],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    return await this.sendContractTransaction({
      contractAddress: identityAddress,
      abi,
      methodName: 'deleteIdentity',
      methodParams: [userAddress],
      privateKey
    });
  }

  /**
   * Add allowed country to compliance contract
   */
  async addCountry({ complianceAddress, countryCode, privateKey }) {
    const abi = [
      {
        'inputs': [{ 'internalType': 'uint16', 'name': 'country', 'type': 'uint16' }],
        'name': 'addAllowedCountry',
        'outputs': [],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    return await this.sendContractTransaction({
      contractAddress: complianceAddress,
      abi,
      methodName: 'addAllowedCountry',
      methodParams: [countryCode],
      privateKey
    });
  }

  /**
   * Remove allowed country from compliance contract
   */
  async removeCountry({ complianceAddress, countryCode, privateKey }) {
    const abi = [
      {
        'inputs': [{ 'internalType': 'uint16', 'name': 'country', 'type': 'uint16' }],
        'name': 'removeAllowedCountry',
        'outputs': [],
        'stateMutability': 'nonpayable',
        'type': 'function'
      }
    ];

    return await this.sendContractTransaction({
      contractAddress: complianceAddress,
      abi,
      methodName: 'removeAllowedCountry',
      methodParams: [countryCode],
      privateKey
    });
  }
}

module.exports = Web3Service;
