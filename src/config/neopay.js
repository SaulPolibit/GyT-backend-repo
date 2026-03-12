/**
 * NeoPay Configuration
 * Pasarela de pagos para Guatemala (NeoNet)
 */
require('dotenv').config();

const neopayConfig = {
  // API Configuration
  apiUrl: process.env.NEOPAY_API_URL || 'https://epaytestvisanet.com.gt:4433/V3',
  endpoint: '/api/AuthorizationPaymentCommerce',

  // Merchant Credentials
  terminalId: process.env.NEOPAY_TERMINAL_ID,
  cardAcqId: process.env.NEOPAY_CARD_ACQ_ID,
  merchantUser: process.env.NEOPAY_MERCHANT_USER,
  merchantPassword: process.env.NEOPAY_MERCHANT_PASSWORD,

  // Environment
  environment: process.env.NEOPAY_ENVIRONMENT || 'development',

  // Constants
  constants: {
    POS_ENTRY_MODE: '012',
    NII: '003',
    POS_CONDITION_CODE: '00',
    FORMAT_ID: '1',
    TIMEOUT_MS: 60000, // 60 seconds
  },

  // Message Types
  messageTypes: {
    SALE: '0200',
    CHECK_IN: '0100',
    CHECK_OUT: '0220',
    REVERSAL: '0400',
  },

  // Processing Codes
  processingCodes: {
    SALE: '000000',
    VOID: '020000',
  },

  // Card Types
  cardTypes: {
    VISA: '001',
    MASTERCARD: '002',
  },

  // Response Codes
  responseCodes: {
    APPROVED: '00',
    PARTIAL_APPROVAL: '10',
  },

  // Type Operations
  typeOperations: {
    NEOPAY: 1,
    TOKENIZATION: 2,
    SECURE_3D: 3,
    NETWORK_TOKEN: 4,
  },

  // Value Products
  products: {
    POINTS: 'LU',
    INSTALLMENTS_3: 'VC03',
    INSTALLMENTS_6: 'VC06',
    INSTALLMENTS_10: 'VC10',
    INSTALLMENTS_12: 'VC12',
    INSTALLMENTS_18: 'VC18',
    INSTALLMENTS_24: 'VC24',
  },

  /**
   * Validate configuration
   * @returns {boolean}
   */
  isValid() {
    const required = [
      this.terminalId,
      this.cardAcqId,
      this.merchantUser,
      this.merchantPassword,
    ];
    return required.every(val => val && val.trim() !== '');
  },

  /**
   * Get full API URL
   * @returns {string}
   */
  getFullUrl() {
    return `${this.apiUrl}${this.endpoint}`;
  },
};

module.exports = neopayConfig;
