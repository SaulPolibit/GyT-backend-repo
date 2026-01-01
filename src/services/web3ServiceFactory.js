/**
 * Web3 Service Factory
 * Creates Web3Service instances - this module can be easily mocked in tests
 */

const Web3Service = require('./web3Service');

/**
 * Create a new Web3Service instance
 * @param {string} rpcUrl - The RPC URL to connect to
 * @returns {Web3Service} A new Web3Service instance
 */
function createWeb3Service(rpcUrl) {
  return new Web3Service(rpcUrl);
}

module.exports = {
  createWeb3Service
};
