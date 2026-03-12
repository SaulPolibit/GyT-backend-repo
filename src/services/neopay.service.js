/**
 * NeoPay Service
 * Handles all interactions with NeoPay payment gateway
 */
const axios = require('axios');
const neopayConfig = require('../config/neopay');
const { NeoPay } = require('../models/supabase');

class NeoPayService {
  constructor() {
    this.config = neopayConfig;
    this.httpClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.constants.TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Build authentication headers for NeoPay API
   * @param {string} shopperIP - Client IP address
   * @param {string} serverIP - Server IP address
   * @returns {Object} Headers object
   */
  _buildHeaders(shopperIP, serverIP) {
    return {
      'PaymentgwIP': this.config.apiUrl,
      'ShopperIP': shopperIP || '127.0.0.1',
      'MerchantServerIP': serverIP || process.env.SERVER_IP || '127.0.0.1',
      'MerchantUser': this.config.merchantUser,
      'MerchantPasswd': this.config.merchantPassword,
    };
  }

  /**
   * Format amount for NeoPay (remove decimals, last 2 digits are cents)
   * @param {number|string} amount - Amount with decimals (e.g., 175.50)
   * @returns {string} Formatted amount (e.g., "17550")
   */
  _formatAmount(amount) {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    const cents = Math.round(numAmount * 100);
    return cents.toString();
  }

  /**
   * Parse amount from NeoPay format
   * @param {string} formattedAmount - Amount without decimals (e.g., "17550")
   * @returns {number} Parsed amount (e.g., 175.50)
   */
  _parseAmount(formattedAmount) {
    const cents = parseInt(formattedAmount, 10);
    return cents / 100;
  }

  /**
   * Mask card number for storage
   * @param {string} cardNumber - Full card number
   * @returns {string} Last 4 digits
   */
  _maskCardNumber(cardNumber) {
    return cardNumber.slice(-4);
  }

  /**
   * Detect card type from number
   * @param {string} cardNumber - Card number
   * @returns {string} Card type code
   */
  _detectCardType(cardNumber) {
    const firstDigit = cardNumber.charAt(0);
    if (firstDigit === '4') {
      return this.config.cardTypes.VISA;
    } else if (firstDigit === '5') {
      return this.config.cardTypes.MASTERCARD;
    }
    return this.config.cardTypes.VISA; // Default
  }

  /**
   * Build base request object
   * @param {string} messageTypeId - Message type
   * @param {string} processingCode - Processing code
   * @param {string} systemsTraceNo - Trace number
   * @returns {Object} Base request object
   */
  _buildBaseRequest(messageTypeId, processingCode, systemsTraceNo) {
    return {
      MessageTypeId: messageTypeId,
      ProcessingCode: processingCode,
      SystemsTraceNo: systemsTraceNo,
      TimeLocalTrans: '',
      DateLocalTrans: '',
      PosEntryMode: this.config.constants.POS_ENTRY_MODE,
      Nii: this.config.constants.NII,
      PosConditionCode: this.config.constants.POS_CONDITION_CODE,
      FormatId: this.config.constants.FORMAT_ID,
      Merchant: {
        TerminalId: this.config.terminalId,
        CardAcqId: this.config.cardAcqId,
      },
    };
  }

  /**
   * Validate NeoPay response
   * @param {Object} response - NeoPay response
   * @returns {Object} Validation result
   */
  _validateResponse(response) {
    const { TypeOperation, ResponseCode } = response;
    const { responseCodes, typeOperations } = this.config;

    const isApproved =
      ResponseCode === responseCodes.APPROVED ||
      ResponseCode === responseCodes.PARTIAL_APPROVAL;

    const isPartialApproval = ResponseCode === responseCodes.PARTIAL_APPROVAL;

    return {
      isApproved,
      isPartialApproval,
      typeOperation: TypeOperation,
      responseCode: ResponseCode,
      isNeoPay: TypeOperation === typeOperations.NEOPAY,
      is3dSecure: TypeOperation === typeOperations.SECURE_3D,
      isTokenization: TypeOperation === typeOperations.TOKENIZATION,
    };
  }

  /**
   * Send request to NeoPay API
   * @param {Object} requestData - Request payload
   * @param {Object} options - Request options (shopperIP, serverIP)
   * @returns {Promise<Object>} NeoPay response
   */
  async _sendRequest(requestData, options = {}) {
    const headers = this._buildHeaders(options.shopperIP, options.serverIP);

    try {
      console.log('[NeoPay] Sending request:', {
        messageType: requestData.MessageTypeId,
        traceNo: requestData.SystemsTraceNo,
      });

      const response = await this.httpClient.post(
        this.config.endpoint,
        requestData,
        { headers }
      );

      console.log('[NeoPay] Response received:', {
        typeOperation: response.data.TypeOperation,
        responseCode: response.data.ResponseCode,
      });

      return response.data;
    } catch (error) {
      console.error('[NeoPay] Request failed:', error.message);

      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        // Timeout - need to send reversal
        throw new Error('NEOPAY_TIMEOUT');
      }

      throw error;
    }
  }

  // ============================================
  // PUBLIC METHODS - SALE OPERATIONS
  // ============================================

  /**
   * Process a simple sale (without 3D Secure)
   * @param {Object} params - Sale parameters
   * @returns {Promise<Object>} Transaction result
   */
  async processSale(params) {
    const {
      userId,
      structureId,
      investmentId,
      amount,
      cardNumber,
      cardExpiration,
      cvv,
      cardHolderName,
      orderInfo,
      additionalData,
      shopperIP,
      userAgent,
    } = params;

    // Validate config
    if (!this.config.isValid()) {
      throw new Error('NeoPay configuration is invalid');
    }

    // Get next trace number
    const systemsTraceNo = await NeoPay.getNextTraceNo();

    // Create transaction record
    const transaction = await NeoPay.create({
      userId,
      structureId,
      investmentId,
      systemsTraceNo,
      messageTypeId: this.config.messageTypes.SALE,
      processingCode: this.config.processingCodes.SALE,
      cardType: this._detectCardType(cardNumber),
      cardLastFour: this._maskCardNumber(cardNumber),
      cardHolderName,
      amountRequested: amount,
      currency: 'GTQ',
      status: 'pending',
      is3dSecure: false,
      orderInformation: orderInfo,
      additionalData,
      ipAddress: shopperIP,
      userAgent,
    });

    try {
      // Build request
      const request = {
        ...this._buildBaseRequest(
          this.config.messageTypes.SALE,
          this.config.processingCodes.SALE,
          systemsTraceNo
        ),
        Card: {
          Type: this._detectCardType(cardNumber),
          PrimaryAcctNum: cardNumber,
          DateExpiration: cardExpiration, // Format: YYMM
          Cvv2: cvv,
          Track2Data: '',
          CardTokenId: '',
        },
        Amount: {
          AmountTrans: this._formatAmount(amount),
          AmountDiscount: '',
          RateDiscount: '',
          AdditionalAmounts: '',
          TaxDetail: [],
        },
        PrivateUse60: {
          BatchNumber: '',
        },
        PrivateUse63: {
          LodgingFolioNumber14: '',
          NationalCard25: '',
          HostReferenceData31: '',
          TaxAmount1: '',
        },
      };

      if (orderInfo) {
        request.OrderInformation = orderInfo;
      }

      if (additionalData) {
        request.AdditionalData = additionalData;
      }

      // Send request
      const response = await this._sendRequest(request, { shopperIP });

      // Validate response
      const validation = this._validateResponse(response);

      // Update transaction with response
      const updatedTransaction = await NeoPay.updateStatus(
        transaction.id,
        validation.isApproved ? 'approved' : 'declined',
        {
          typeOperation: response.TypeOperation,
          responseCode: response.ResponseCode,
          responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '',
          authIdResponse: response.AuthIdResponse,
          retrievalRefNo: response.RetrievalRefNo,
          timeLocalTrans: response.TimeLocalTrans,
          dateLocalTrans: response.DateLocalTrans,
          amountApproved: validation.isApproved
            ? this._parseAmount(response.AmountTrans)
            : 0,
        }
      );

      return {
        success: validation.isApproved,
        isPartialApproval: validation.isPartialApproval,
        transaction: updatedTransaction,
        response: {
          authorizationCode: response.AuthIdResponse,
          referenceNumber: response.RetrievalRefNo,
          responseCode: response.ResponseCode,
          message: response.PrivateUse63?.AlternateHostResponse22,
        },
      };

    } catch (error) {
      if (error.message === 'NEOPAY_TIMEOUT') {
        // Send automatic reversal
        console.log('[NeoPay] Timeout detected, sending reversal...');
        await this._sendReversal(transaction, { shopperIP });

        await NeoPay.updateStatus(transaction.id, 'reversed', {
          responseMessage: 'Timeout - Automatic reversal sent',
          reversalReason: 'timeout',
        });

        throw new Error('Transaction timed out and was automatically reversed');
      }

      // Update transaction with error
      await NeoPay.updateStatus(transaction.id, 'error', {
        responseMessage: error.message,
      });

      throw error;
    }
  }

  // ============================================
  // PUBLIC METHODS - 3D SECURE OPERATIONS
  // ============================================

  /**
   * Process sale with 3D Secure - Step 1
   * @param {Object} params - Sale parameters including billing info
   * @returns {Promise<Object>} Step 1 result with 3DS data
   */
  async processSale3DS_Step1(params) {
    const {
      userId,
      structureId,
      investmentId,
      amount,
      cardNumber,
      cardExpiration,
      cvv,
      cardHolderName,
      billingInfo,
      urlCommerce,
      orderInfo,
      additionalData,
      shopperIP,
      userAgent,
    } = params;

    if (!this.config.isValid()) {
      throw new Error('NeoPay configuration is invalid');
    }

    const systemsTraceNo = await NeoPay.getNextTraceNo();

    // Create transaction record
    const transaction = await NeoPay.create({
      userId,
      structureId,
      investmentId,
      systemsTraceNo,
      messageTypeId: this.config.messageTypes.SALE,
      processingCode: this.config.processingCodes.SALE,
      cardType: this._detectCardType(cardNumber),
      cardLastFour: this._maskCardNumber(cardNumber),
      cardHolderName,
      amountRequested: amount,
      currency: 'GTQ',
      status: 'pending',
      is3dSecure: true,
      secure3dStep: 1,
      orderInformation: orderInfo,
      additionalData,
      ipAddress: shopperIP,
      userAgent,
    });

    try {
      const request = {
        ...this._buildBaseRequest(
          this.config.messageTypes.SALE,
          this.config.processingCodes.SALE,
          systemsTraceNo
        ),
        Card: {
          Type: this._detectCardType(cardNumber),
          PrimaryAcctNum: cardNumber,
          DateExpiration: cardExpiration,
          Cvv2: cvv,
          Track2Data: '',
          CardTokenId: '',
        },
        Amount: {
          AmountTrans: this._formatAmount(amount),
          AmountDiscount: '',
          RateDiscount: '',
          AdditionalAmounts: '',
          TaxDetail: [],
        },
        BillTo: {
          FirstName: billingInfo.firstName,
          LastName: billingInfo.lastName,
          Company: billingInfo.company || '',
          AddressOne: billingInfo.addressOne,
          AddressTwo: billingInfo.addressTwo || '',
          Locality: billingInfo.locality,
          AdministrativeArea: billingInfo.administrativeArea,
          PostalCode: billingInfo.postalCode,
          Country: billingInfo.country,
          Email: billingInfo.email,
          PhoneNumber: billingInfo.phoneNumber,
        },
        PayerAuthentication: {
          Step: '1',
          UrlCommerce: urlCommerce,
        },
        PrivateUse60: { BatchNumber: '' },
        PrivateUse63: {
          LodgingFolioNumber14: '',
          NationalCard25: '',
          HostReferenceData31: '',
          TaxAmount1: '',
        },
      };

      if (orderInfo) {
        request.OrderInformation = orderInfo;
      }

      if (additionalData) {
        request.AdditionalData = additionalData;
      }

      const response = await this._sendRequest(request, { shopperIP });

      // Check if 3DS step 1 was successful
      const is3DSStep1Approved =
        response.TypeOperation === this.config.typeOperations.SECURE_3D &&
        response.ResponseCode === this.config.responseCodes.APPROVED &&
        response.PayerAuthentication?.Step === '2';

      if (!is3DSStep1Approved) {
        await NeoPay.updateStatus(transaction.id, 'declined', {
          typeOperation: response.TypeOperation,
          responseCode: response.ResponseCode,
          responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '3DS Step 1 failed',
        });

        return {
          success: false,
          transaction,
          error: '3D Secure authentication failed at step 1',
        };
      }

      // Update transaction with 3DS reference
      await NeoPay.findByIdAndUpdate(transaction.id, {
        secure3dReferenceId: response.PayerAuthentication.ReferenceId,
        secure3dStep: 2,
      });

      return {
        success: true,
        transaction,
        nextStep: 2,
        secure3d: {
          referenceId: response.PayerAuthentication.ReferenceId,
          accessToken: response.PayerAuthentication.AccessToken,
          deviceDataCollectionUrl: response.PayerAuthentication.DeviceDataCollectionUrl,
        },
      };

    } catch (error) {
      await NeoPay.updateStatus(transaction.id, 'error', {
        responseMessage: error.message,
      });
      throw error;
    }
  }

  /**
   * Process sale with 3D Secure - Step 3 (after iFrame validation)
   * @param {Object} params - Step 3 parameters
   * @returns {Promise<Object>} Step 3 result
   */
  async processSale3DS_Step3(params) {
    const {
      transactionId,
      referenceId,
      shopperIP,
    } = params;

    const transaction = await NeoPay.findById(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.secure3dReferenceId !== referenceId) {
      throw new Error('Invalid 3DS reference ID');
    }

    try {
      const request = {
        ...this._buildBaseRequest(
          transaction.messageTypeId,
          transaction.processingCode,
          transaction.systemsTraceNo
        ),
        PayerAuthentication: {
          Step: '3',
          ReferenceId: referenceId,
        },
      };

      if (transaction.orderInformation) {
        request.OrderInformation = transaction.orderInformation;
      }

      const response = await this._sendRequest(request, { shopperIP });

      // Check response type
      const validation = this._validateResponse(response);

      // If approved at step 3 (TypeOperation = 1)
      if (validation.isNeoPay && validation.isApproved) {
        const updatedTransaction = await NeoPay.updateStatus(
          transaction.id,
          'approved',
          {
            typeOperation: response.TypeOperation,
            responseCode: response.ResponseCode,
            responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '',
            authIdResponse: response.AuthIdResponse,
            retrievalRefNo: response.RetrievalRefNo,
            timeLocalTrans: response.TimeLocalTrans,
            dateLocalTrans: response.DateLocalTrans,
            amountApproved: this._parseAmount(response.AmountTrans),
            secure3dStep: 3,
          }
        );

        return {
          success: true,
          isPartialApproval: validation.isPartialApproval,
          transaction: updatedTransaction,
          response: {
            authorizationCode: response.AuthIdResponse,
            referenceNumber: response.RetrievalRefNo,
            responseCode: response.ResponseCode,
            message: response.PrivateUse63?.AlternateHostResponse22,
          },
        };
      }

      // If needs step 4 and 5 (TypeOperation = 3, Step = 4)
      if (response.TypeOperation === this.config.typeOperations.SECURE_3D &&
          response.ResponseCode === this.config.responseCodes.APPROVED &&
          response.PayerAuthentication?.Step === '4') {

        await NeoPay.findByIdAndUpdate(transaction.id, {
          secure3dStep: 4,
        });

        return {
          success: true,
          needsAdditionalAuth: true,
          nextStep: 4,
          transaction,
          secure3d: {
            accessToken: response.PayerAuthentication.AccessToken,
            deviceDataCollectionUrl: response.PayerAuthentication.DeviceDataCollectionUrl,
          },
        };
      }

      // Otherwise declined
      await NeoPay.updateStatus(transaction.id, 'declined', {
        typeOperation: response.TypeOperation,
        responseCode: response.ResponseCode,
        responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '',
        secure3dStep: 3,
      });

      return {
        success: false,
        transaction,
        error: response.PrivateUse63?.AlternateHostResponse22 || 'Transaction declined',
      };

    } catch (error) {
      if (error.message === 'NEOPAY_TIMEOUT') {
        console.log('[NeoPay] Timeout at Step 3, sending reversal...');
        await this._sendReversal(transaction, { shopperIP });

        await NeoPay.updateStatus(transaction.id, 'reversed', {
          responseMessage: 'Timeout at Step 3 - Automatic reversal sent',
          reversalReason: 'timeout_step_3',
        });

        throw new Error('Transaction timed out at Step 3 and was automatically reversed');
      }

      await NeoPay.updateStatus(transaction.id, 'error', {
        responseMessage: error.message,
      });
      throw error;
    }
  }

  /**
   * Process sale with 3D Secure - Step 5 (after PIN verification)
   * @param {Object} params - Step 5 parameters
   * @returns {Promise<Object>} Final transaction result
   */
  async processSale3DS_Step5(params) {
    const {
      transactionId,
      referenceId,
      shopperIP,
    } = params;

    const transaction = await NeoPay.findById(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    try {
      const request = {
        ...this._buildBaseRequest(
          transaction.messageTypeId,
          transaction.processingCode,
          transaction.systemsTraceNo
        ),
        PayerAuthentication: {
          Step: '5',
          ReferenceId: referenceId,
        },
      };

      if (transaction.orderInformation) {
        request.OrderInformation = transaction.orderInformation;
      }

      const response = await this._sendRequest(request, { shopperIP });
      const validation = this._validateResponse(response);

      if (validation.isNeoPay && validation.isApproved) {
        const updatedTransaction = await NeoPay.updateStatus(
          transaction.id,
          'approved',
          {
            typeOperation: response.TypeOperation,
            responseCode: response.ResponseCode,
            responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '',
            authIdResponse: response.AuthIdResponse,
            retrievalRefNo: response.RetrievalRefNo,
            timeLocalTrans: response.TimeLocalTrans,
            dateLocalTrans: response.DateLocalTrans,
            amountApproved: this._parseAmount(response.AmountTrans),
            secure3dStep: 5,
          }
        );

        return {
          success: true,
          isPartialApproval: validation.isPartialApproval,
          transaction: updatedTransaction,
          response: {
            authorizationCode: response.AuthIdResponse,
            referenceNumber: response.RetrievalRefNo,
            responseCode: response.ResponseCode,
            message: response.PrivateUse63?.AlternateHostResponse22,
          },
        };
      }

      // Declined
      await NeoPay.updateStatus(transaction.id, 'declined', {
        typeOperation: response.TypeOperation,
        responseCode: response.ResponseCode,
        responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '',
        secure3dStep: 5,
      });

      return {
        success: false,
        transaction,
        error: response.PrivateUse63?.AlternateHostResponse22 || 'Transaction declined at Step 5',
      };

    } catch (error) {
      if (error.message === 'NEOPAY_TIMEOUT') {
        console.log('[NeoPay] Timeout at Step 5, sending reversal...');
        await this._sendReversal(transaction, { shopperIP });

        await NeoPay.updateStatus(transaction.id, 'reversed', {
          responseMessage: 'Timeout at Step 5 - Automatic reversal sent',
          reversalReason: 'timeout_step_5',
        });

        throw new Error('Transaction timed out at Step 5 and was automatically reversed');
      }

      await NeoPay.updateStatus(transaction.id, 'error', {
        responseMessage: error.message,
      });
      throw error;
    }
  }

  // ============================================
  // PUBLIC METHODS - VOID/REVERSAL OPERATIONS
  // ============================================

  /**
   * Process a void/cancellation
   * @param {Object} params - Void parameters
   * @returns {Promise<Object>} Void result
   */
  async processVoid(params) {
    const {
      originalTransactionId,
      userId,
      reason,
      shopperIP,
    } = params;

    const originalTransaction = await NeoPay.findById(originalTransactionId);
    if (!originalTransaction) {
      throw new Error('Original transaction not found');
    }

    const canVoid = await NeoPay.canBeVoided(originalTransactionId);
    if (!canVoid) {
      throw new Error('Transaction cannot be voided');
    }

    const systemsTraceNo = await NeoPay.getNextTraceNo();

    // Create void transaction record
    const voidTransaction = await NeoPay.create({
      userId,
      structureId: originalTransaction.structureId,
      investmentId: originalTransaction.investmentId,
      systemsTraceNo,
      messageTypeId: this.config.messageTypes.SALE,
      processingCode: this.config.processingCodes.VOID,
      cardType: originalTransaction.cardType,
      cardLastFour: originalTransaction.cardLastFour,
      cardHolderName: originalTransaction.cardHolderName,
      amountRequested: originalTransaction.amountApproved,
      currency: 'GTQ',
      status: 'pending',
      isReversal: false,
      originalTransactionId,
      reversalReason: reason,
      ipAddress: shopperIP,
    });

    try {
      const request = {
        ...this._buildBaseRequest(
          this.config.messageTypes.SALE,
          this.config.processingCodes.VOID,
          systemsTraceNo
        ),
        Card: {
          Type: originalTransaction.cardType,
          PrimaryAcctNum: '', // Not needed for void
          DateExpiration: '',
          Cvv2: '',
          Track2Data: '',
          CardTokenId: '',
        },
        Amount: {
          AmountTrans: this._formatAmount(originalTransaction.amountApproved),
          AmountDiscount: '',
          RateDiscount: '',
          AdditionalAmounts: '',
          TaxDetail: [],
        },
        PrivateUse60: { BatchNumber: '' },
        PrivateUse63: {
          LodgingFolioNumber14: '',
          NationalCard25: '',
          HostReferenceData31: '',
          TaxAmount1: '',
        },
      };

      const response = await this._sendRequest(request, { shopperIP });
      const validation = this._validateResponse(response);

      if (validation.isApproved) {
        // Update void transaction
        await NeoPay.updateStatus(voidTransaction.id, 'approved', {
          typeOperation: response.TypeOperation,
          responseCode: response.ResponseCode,
          responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '',
          authIdResponse: response.AuthIdResponse,
          retrievalRefNo: response.RetrievalRefNo,
          amountApproved: this._parseAmount(response.AmountTrans),
        });

        // Update original transaction
        await NeoPay.updateStatus(originalTransactionId, 'voided');

        return {
          success: true,
          voidTransaction,
          response: {
            authorizationCode: response.AuthIdResponse,
            referenceNumber: response.RetrievalRefNo,
          },
        };
      }

      await NeoPay.updateStatus(voidTransaction.id, 'declined', {
        typeOperation: response.TypeOperation,
        responseCode: response.ResponseCode,
        responseMessage: response.PrivateUse63?.AlternateHostResponse22 || '',
      });

      return {
        success: false,
        error: response.PrivateUse63?.AlternateHostResponse22 || 'Void declined',
      };

    } catch (error) {
      await NeoPay.updateStatus(voidTransaction.id, 'error', {
        responseMessage: error.message,
      });
      throw error;
    }
  }

  /**
   * Send automatic reversal (internal use for timeouts)
   * @param {Object} originalTransaction - Original transaction object
   * @param {Object} options - Request options
   * @returns {Promise<Object>} Reversal response
   */
  async _sendReversal(originalTransaction, options = {}) {
    const request = {
      ...this._buildBaseRequest(
        this.config.messageTypes.REVERSAL, // 0400
        originalTransaction.processingCode,
        originalTransaction.systemsTraceNo
      ),
      Card: {
        Type: originalTransaction.cardType,
        PrimaryAcctNum: '',
        DateExpiration: '',
        Cvv2: '',
        Track2Data: '',
        CardTokenId: '',
      },
      Amount: {
        AmountTrans: this._formatAmount(originalTransaction.amountRequested),
        AmountDiscount: '',
        RateDiscount: '',
        AdditionalAmounts: '',
        TaxDetail: [],
      },
      PrivateUse60: { BatchNumber: '' },
      PrivateUse63: {
        LodgingFolioNumber14: '',
        NationalCard25: '',
        HostReferenceData31: '',
        TaxAmount1: '',
      },
    };

    if (originalTransaction.orderInformation) {
      request.OrderInformation = originalTransaction.orderInformation;
    }

    try {
      const response = await this._sendRequest(request, options);
      console.log('[NeoPay] Reversal sent successfully:', response.ResponseCode);
      return response;
    } catch (error) {
      console.error('[NeoPay] Reversal failed:', error.message);
      // Don't throw - reversal failures should be logged but not block the flow
      return null;
    }
  }

  // ============================================
  // PUBLIC METHODS - VOUCHER/RECEIPT GENERATION
  // ============================================

  /**
   * Generate voucher data for a transaction
   * @param {string} transactionId - Transaction UUID
   * @returns {Promise<Object>} Voucher data
   */
  async generateVoucher(transactionId) {
    const transaction = await NeoPay.findById(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    const isVoid = transaction.processingCode === this.config.processingCodes.VOID;

    return {
      paymentMethod: 'NeoNet',
      date: transaction.dateLocalTrans
        ? `${transaction.dateLocalTrans.slice(0, 2)}/${transaction.dateLocalTrans.slice(2, 4)}`
        : new Date().toLocaleDateString('es-GT'),
      time: transaction.timeLocalTrans
        ? `${transaction.timeLocalTrans.slice(0, 2)}:${transaction.timeLocalTrans.slice(2, 4)}:${transaction.timeLocalTrans.slice(4, 6)}`
        : new Date().toLocaleTimeString('es-GT'),
      amount: isVoid
        ? -transaction.amountApproved
        : transaction.amountApproved,
      currency: transaction.currency,
      cardHolderName: transaction.cardHolderName,
      cardNumber: `XXXX-XXXX-XXXX-${transaction.cardLastFour}`,
      cardType: transaction.cardType === '001' ? 'VISA' : 'MASTERCARD',
      referenceNumber: transaction.retrievalRefNo,
      authorizationCode: transaction.authIdResponse,
      affiliation: this.config.cardAcqId,
      auditNumber: transaction.systemsTraceNo,
      transactionType: isVoid ? 'ANULACION' : 'VENTA',
      legend: '(01) Pagado Electrónicamente',
      status: transaction.status,
    };
  }
}

module.exports = new NeoPayService();
