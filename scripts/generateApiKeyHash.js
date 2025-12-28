/**
 * Generate API Key Hash
 *
 * This script generates a SHA-256 hash of your API key
 * to be used in the API_KEY_HASH environment variable.
 *
 * Usage:
 *   node scripts/generateApiKeyHash.js YOUR_API_KEY
 *
 * Example:
 *   node scripts/generateApiKeyHash.js mySecretApiKey123
 *   Output: API_KEY_HASH=5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8
 */

const crypto = require('crypto');

// Get API key from command line argument
const apiKey = process.argv[2];

if (!apiKey) {
  console.error('Error: Please provide an API key as an argument');
  console.log('\nUsage:');
  console.log('  node scripts/generateApiKeyHash.js YOUR_API_KEY');
  console.log('\nExample:');
  console.log('  node scripts/generateApiKeyHash.js mySecretApiKey123');
  process.exit(1);
}

// Generate hash
const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

console.log('\n=================================');
console.log('API Key Hash Generated');
console.log('=================================');
console.log('\nAdd this to your .env file:');
console.log(`API_KEY_HASH=${hash}`);
console.log('\nOr add it to your Vercel environment variables:');
console.log('Name:  API_KEY_HASH');
console.log(`Value: ${hash}`);
console.log('\n=================================');
console.log('Security Note:');
console.log('=================================');
console.log('- Store the HASH in environment variables, not the plain API key');
console.log('- Keep your original API key secure for clients to use');
console.log('- Once configured, you can remove API_KEY and only use API_KEY_HASH');
console.log('=================================\n');
