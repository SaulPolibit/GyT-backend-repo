/**
 * Encryption Utility
 * AES-256-CBC encryption for sensitive data like SMTP passwords
 */

const crypto = require('crypto');

const algorithm = 'aes-256-cbc';

// Get encryption key from environment variable (must be 32 bytes)
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  // Ensure key is 32 bytes
  const keyBuffer = Buffer.from(key, 'utf-8');
  if (keyBuffer.length < 32) {
    // Pad the key if it's too short
    return Buffer.concat([keyBuffer, Buffer.alloc(32 - keyBuffer.length)], 32);
  }

  return keyBuffer.slice(0, 32);
};

/**
 * Encrypt text using AES-256-CBC
 * @param {string} text - Text to encrypt
 * @returns {string} - Encrypted text in format: iv:encryptedData
 */
function encrypt(text) {
  if (!text) {
    throw new Error('Text to encrypt cannot be empty');
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16); // Initialization vector

    const cipher = crypto.createCipheriv(algorithm, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV and encrypted data separated by colon
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt text using AES-256-CBC
 * @param {string} encryptedText - Encrypted text in format: iv:encryptedData
 * @returns {string} - Decrypted text
 */
function decrypt(encryptedText) {
  if (!encryptedText) {
    throw new Error('Encrypted text cannot be empty');
  }

  try {
    const key = getEncryptionKey();

    // Split IV and encrypted data
    const textParts = encryptedText.split(':');

    if (textParts.length !== 2) {
      throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(textParts[0], 'hex');
    const encryptedData = Buffer.from(textParts[1], 'hex');

    const decipher = crypto.createDecipheriv(algorithm, key, iv);

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Validate if text is properly encrypted
 * @param {string} text - Text to validate
 * @returns {boolean} - True if text appears to be encrypted
 */
function isEncrypted(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Check if text has the format: iv:encryptedData
  const parts = text.split(':');
  if (parts.length !== 2) {
    return false;
  }

  // Check if both parts are valid hex strings
  const hexRegex = /^[0-9a-f]+$/i;
  return hexRegex.test(parts[0]) && hexRegex.test(parts[1]);
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted
};
