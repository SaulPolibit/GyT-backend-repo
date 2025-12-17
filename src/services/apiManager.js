const httpClient = require('./httpClient');
const { escapeStringForJson, getEnvVariable } = require('../utils/helpers');
const axios = require('axios');
const qs = require('querystring');

class ApiManager {
  constructor() {
    this.unauthenticatedResponse = {
      statusCode: 401,
      headers: {},
      error: 'API call requires authentication',
    };
  }

  // Portal HQ Group
  createPortalHQGroup() {
    return {
      baseUrl: 'https://api.portalhq.io/api/v3',
      headers: {},
    };
  }

  async createNewClient(context, variables) {
    const portalAPIKey = getEnvVariable('PORTAL_API_KEY', variables.portalAPIKey);
    const group = this.createPortalHQGroup();

    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/custodians/me/clients`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${portalAPIKey}`,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getASingleClient(context, variables) {
    const { portalClientId } = variables;
    const portalAPIKey = getEnvVariable('PORTAL_API_KEY', variables.portalAPIKey);
    const group = this.createPortalHQGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/custodians/me/clients/${portalClientId}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${portalAPIKey}`,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getClientsAssetBalanceByChain(context, variables) {
    // if (!context.auth?.authenticated) {
    //   return this.unauthenticatedResponse;
    // }
    console.log('****** 2.1');

    const { clientApiKey, chainId } = variables;
    const group = this.createPortalHQGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/clients/me/chains/${chainId}/assets`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientApiKey}`,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getClientChainTransactionHistory(context, variables) {
    // if (!context.auth?.authenticated) {
    //   return this.unauthenticatedResponse;
    // }

    const { clientApiKey, chainId } = variables;
    const group = this.createPortalHQGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/clients/me/transactions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientApiKey}`,
      },
      params: { chainId },
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async confirmWalletCreation(context, variables) {
    // if (!context.auth?.authenticated) {
    //   return this.unauthenticatedResponse;
    // }

    const { clientApiKey, secp256k1Id, ed25519Id } = variables;
    const group = this.createPortalHQGroup();

    const body = JSON.stringify({
      status: 'STORED_CLIENT',
      signingSharePairIds: [
        escapeStringForJson(secp256k1Id),
        escapeStringForJson(ed25519Id),
      ],
    });

    return httpClient.makeApiRequest({
      method: 'patch',
      url: `${group.baseUrl}/clients/me/signing-share-pairs`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientApiKey}`,
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

  // Portal HQ VI Group
  createPortalHQVIGroup() {
    return {
      baseUrl: 'https://mpc-client.portalhq.io/v1',
      headers: {},
    };
  }

  async createAWallet(context, variables) {
    const { clientApiKey } = variables;
    const group = this.createPortalHQVIGroup();

    const body = JSON.stringify({ None: 'none' });

    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/generate`,
      headers: {
        Authorization: `Bearer ${clientApiKey}`,
        'Content-Type': 'application/json',
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async sendPolygonTokenFromWallet(context, variables) {
    const { clientApiKey, share, chain, to, token, amount, rpcUrl } = variables;
    const group = this.createPortalHQVIGroup();

    const body = JSON.stringify({
      share: escapeStringForJson(share),
      chain: escapeStringForJson(chain),
      to: escapeStringForJson(to),
      token: escapeStringForJson(token),
      amount: escapeStringForJson(amount),
      rpcUrl: escapeStringForJson(rpcUrl),
    });

    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/assets/send`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientApiKey}`,
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

  // Vudy API Group
  createVudyAPIGroup() {
    return {
      baseUrl: 'https://vudy.tech/api/v1',
      headers: {
        'Content-Type': 'application/json',
      },
    };
  }

  async createRequest(context, variables) {
    if (!context.auth?.authenticated) {
      return this.unauthenticatedResponse;
    }

    const { amountInUsd, note, receiverWalletAddress, vendorId, generatedId } = variables;
    const vudyApiKey = getEnvVariable('VUDY_API_KEY', variables.vudyApiKey);
    const group = this.createVudyAPIGroup();

    const body = JSON.stringify({
      amountInUsd,
      note: escapeStringForJson(note),
      receiverWalletAddress: escapeStringForJson(receiverWalletAddress),
      vendorId: escapeStringForJson(vendorId),
      generatedId: escapeStringForJson(generatedId),
    });

    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/request/create`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': vudyApiKey,
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getSingleRequest(context, variables) {
    const { requestID } = variables;
    const vudyApiKey = getEnvVariable('VUDY_API_KEY', variables.vudyApiKey);
    const group = this.createVudyAPIGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/request/${requestID}`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': vudyApiKey,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getMultipleRequests(context, variables) {
    const { ids, vendorIDs } = variables;
    const vudyApiKey = getEnvVariable('VUDY_API_KEY', variables.vudyApiKey);
    const group = this.createVudyAPIGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/request/multiple`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': vudyApiKey,
      },
      params: { ids, vendorId: vendorIDs },
      returnBody: true,
      isStreamingApi: false,
    });
  }

  // DocuSeal Group
  createDocuSealGroup() {
    return {
      baseUrl: 'https://api.docuseal.com',
      headers: {
        'content-type': 'application/json',
      },
    };
  }

  async getSingleSubmission(context, variables) {
    const { submissionID } = variables;
    const aPIToken = getEnvVariable('DOCUSEAL_API_TOKEN', variables.aPIToken);
    const group = this.createDocuSealGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/submissions/${submissionID}`,
      headers: {
        'X-Auth-Token': aPIToken,
        'content-type': 'application/json',
      },
      params: { submissionId: submissionID },
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async deleteSubmission(context, variables) {
    const { submissionID } = variables;
    const aPIToken = getEnvVariable('DOCUSEAL_API_TOKEN', variables.aPIToken);
    const group = this.createDocuSealGroup();

    return httpClient.makeApiRequest({
      method: 'delete',
      url: `${group.baseUrl}/submissions/${submissionID}`,
      headers: {
        'X-Auth-Token': aPIToken,
        'content-type': 'application/json',
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getSubmissions(context, variables) {
    const { q, templateId } = variables;
    const aPIToken = getEnvVariable('DOCUSEAL_API_TOKEN', variables.aPIToken);
    const group = this.createDocuSealGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/submissions`,
      headers: {
        'X-Auth-Token': aPIToken,
        'content-type': 'application/json',
      },
      params: { q, template_id: templateId },
      returnBody: true,
      isStreamingApi: false,
    });
  }

  // Bridge Wallets Group
  createBridgeWalletsGroup() {
    return {
      baseUrl: 'https://api.bridge.xyz',
      // baseUrl: 'https://api.sandbox.bridge.xyz',
      headers: {},
    };
  }

  async getAllWallets(context, variables) {
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeWalletsGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/wallets`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getABridgeWallet(context, variables) {
    const { customerID, walletID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeWalletsGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers/${customerID}/wallets/${walletID}`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async createABridgeWallet(context, variables) {
    try {
      const { idempotencyKey, customerID, chain } = variables;
      const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
      const group = this.createBridgeWalletsGroup();
      const formData = qs.stringify({ 
        chain: escapeStringForJson(chain),
      });

      const response = await axios({
        method: 'POST',
        url: `${group.baseUrl}/v0/customers/${customerID}/wallets`,
        data: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Api-Key': apikey,
          'Idempotency-Key': idempotencyKey,
        }
      });

      return {
        statusCode: response.status,
        headers: response.headers,
        body: response.data,
        error: null,
        success: true
      };
    } catch (error) {
      return {
        statusCode: error.response?.status || 500,
        headers: error.response?.headers,
        body: error.response?.data || null,
        error: error.message,
        success: false
      };
    }
  }

  async getTransactionHistoryForAWallet(context, variables) {
    const { walletID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeWalletsGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/wallets/${walletID}/history`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getAllBridgeWalletsForACustomer(context, variables) {
    const { customerID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeWalletsGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers/${customerID}/wallets`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  // Bridge Customers Group
  createBridgeCustomersGroup() {
    return {
      baseUrl: 'https://api.bridge.xyz',
      // baseUrl: 'https://api.sandbox.bridge.xyz',
      headers: {},
    };
  }

  async getAllCustomers(context, variables) {
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getSingleCustomer(context, variables) {
    const { customerID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers/${customerID}`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async deleteSingleCustomer(context, variables) {
    const { customerID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    return httpClient.makeApiRequest({
      method: 'delete',
      url: `${group.baseUrl}/v0/customers/${customerID}`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async createAShortCustomer(context, variables) {
    const { idempotencyKey, type, fullName, email, redirectURI } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    const body = JSON.stringify({
      type: escapeStringForJson(type),
      full_name: fullName,
      email: escapeStringForJson(email),
      redirect_uri: escapeStringForJson(redirectURI),
    });

    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/v0/kyc_links`,
      headers: {
        'Api-Key': apikey,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async createAFullCustomer(context, variables) {
    const {
      idempotencyKey, type, firstName, middleName, lastName, email, phone,
      addressStreet1, addressCity, addressSubdivision, addressPostalCode, addressCountry,
      birthDate, nationality, identifyingInformation
    } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    const body = JSON.stringify({
      type: escapeStringForJson(type),
      first_name: escapeStringForJson(firstName),
      middle_name: escapeStringForJson(middleName),
      last_name: escapeStringForJson(lastName),
      email: escapeStringForJson(email),
      phone: escapeStringForJson(phone),
      residential_address: {
        street_line_1: escapeStringForJson(addressStreet1),
        city: escapeStringForJson(addressCity),
        subdivision: escapeStringForJson(addressSubdivision),
        postal_code: escapeStringForJson(addressPostalCode),
        country: escapeStringForJson(addressCountry),
      },
      birth_date: escapeStringForJson(birthDate),
      nationality: escapeStringForJson(nationality),
      // identifying_information: [{
      //   type: escapeStringForJson(identifyingType),
      //   issuing_country: escapeStringForJson(identifyingIssuingCountry),
      //   number: escapeStringForJson(identifyingNumber),
      //   description: escapeStringForJson(identifyingDescription),
      //   expiration: escapeStringForJson(identifyingExpiration),
      //   image_front: escapeStringForJson(identifyingImageFrontBase64),
      //   image_back: escapeStringForJson(identifyingImageBackBase64),
      // }],
      identifying_information: identifyingInformation
    });
console.log('****** BODY:', body);
    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/v0/customers`,
      headers: {
        'Api-Key': apikey,
        'Idempotency-Key': idempotencyKey,
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async retrieveURLForToSAcceptance(context, variables) {
    const { customerID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers/${customerID}/tos_acceptance_link`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async retrieveCustomerKYCURL(context, variables) {
    const { customerID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers/${customerID}/kyc_link`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getUserTransfers(context, variables) {
    const { customerID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeCustomersGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers/${customerID}/transfers`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  // Bridge Virtual Accounts Group
  createBridgeVirtualAccountsGroup() {
    return {
      // baseUrl: 'https://api.sandbox.bridge.xyz',
      baseUrl: 'https://api.bridge.xyz',
      headers: {},
    };
  }

  async listUserVirtualAccounts(context, variables) {
    const { customerID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeVirtualAccountsGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/customers/${customerID}/virtual_accounts`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async createUserVirtualAccounts(context, variables) {
    try {
      const {
        idempotencyKey, customerID, developerFeePercent, sourceCurrency,
        destinationCurrency, destinationPaymentRail, destinationAddress
      } = variables;
      
      const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
      const group = this.createBridgeWalletsGroup();

      // Option 1: Flatten the nested structure for form-urlencoded
      const formData = qs.stringify({
        developer_fee_percent: developerFeePercent,
        'source[currency]': sourceCurrency,
        'destination[currency]': destinationCurrency,
        'destination[payment_rail]': destinationPaymentRail,
        'destination[address]': destinationAddress,
      });

      console.log('Form data:', formData);

      const response = await axios({
        method: 'POST',
        url: `${group.baseUrl}/v0/customers/${customerID}/virtual_accounts`,
        data: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Api-Key': apikey,
          'Idempotency-Key': idempotencyKey,
        }
      });

      return {
        statusCode: response.status,
        headers: response.headers,
        body: response.data,
        error: null,
        success: true
      };
      
    } catch (error) {
      console.error('Bridge API Error:', error.response?.data || error.message);
      return {
        statusCode: error.response?.status || 500,
        headers: error.response?.headers,
        body: error.response?.data || null,
        error: error.message,
        success: false
      };
    }
  }

  async updateUserVirtualAccount(context, variables) {
    try {
      const {
        // idempotencyKey, 
        customerID, 
        virtualAccountID, 
        sourceCurrency,
        destinationCurrency, 
        destinationPaymentRail, 
        destinationAddress, 
        developerFeePercent
      } = variables;
      
      const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
      const group = this.createBridgeVirtualAccountsGroup();

      // Validate required fields
      if (!customerID || !virtualAccountID) {
        return {
          statusCode: 400,
          body: { error: 'customerID and virtualAccountID are required' },
          error: 'Missing required parameters',
          success: false
        };
      }

      // Build request body as object (axios will convert to JSON)
      const requestBody = {
        developer_fee_percent: developerFeePercent,
        source: { 
          currency: sourceCurrency 
        },
        destination: {
          currency: destinationCurrency,
          payment_rail: destinationPaymentRail,
          address: destinationAddress,
        },
      };

      const response = await axios({
        method: 'PUT',
        url: `${group.baseUrl}/v0/customers/${customerID}/virtual_accounts/${virtualAccountID}`,
        data: requestBody, // Send as object, axios converts to JSON
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': apikey,
        },
        validateStatus: () => true // Handle all status codes
      });

      console.log('Response Status:', response.status);
      console.log('Response Body:', JSON.stringify(response.data, null, 2));

      if (response.status >= 400) {
        return {
          statusCode: response.status,
          headers: response.headers,
          body: response.data,
          error: response.data?.message || `Request failed with status ${response.status}`,
          success: false
        };
      }

      return {
        statusCode: response.status,
        headers: response.headers,
        body: response.data,
        error: null,
        success: true
      };

    } catch (error) {
      console.error('Update Virtual Account Error:', error.response?.data || error.message);
      return {
        statusCode: error.response?.status || 500,
        headers: error.response?.headers,
        body: error.response?.data || null,
        error: error.message,
        success: false
      };
    }
  }

  async deactivateUserVirtualAccount(context, variables) {
    const { idempotencyKey, customerID, virtualAccountID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeVirtualAccountsGroup();

    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/v0/customers/${customerID}/virtual_accounts/${virtualAccountID}/deactivate`,
      headers: {
        'Api-Key': apikey,
        'Idempotency-Key': idempotencyKey,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async reactivateUserVirtualAccount(context, variables) {
    const { idempotencyKey, customerID, virtualAccountID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeVirtualAccountsGroup();

    return httpClient.makeApiRequest({
      method: 'post',
      url: `${group.baseUrl}/v0/customers/${customerID}/virtual_accounts/${virtualAccountID}/reactivate`,
      headers: {
        'Api-Key': apikey,
        'Idempotency-Key': idempotencyKey,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }
  // Bridge Transfers Group
  createBridgeTransfersGroup() {
    return {
      // baseUrl: 'https://api.sandbox.bridge.xyz',
      baseUrl: 'https://api.bridge.xyz',
      headers: {},
    };
  }

  async getAllTransfers(context, variables) {
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeTransfersGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/transfers`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async createATransfer(context, variables) {
    try {
      const {
        idempotencyKey,
        onBehalfOf,
        sourcePaymentRail,
        sourcePaymentCurrency,
        destinationPaymentRail,
        destinationPaymentCurrency,
        destinationPaymentAddress,
        amount,
        developerFeePercent,
        developerFee
      } = variables;
      
      const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
      const group = this.createBridgeTransfersGroup();

      // Validate required fields
      if (!onBehalfOf) {
        return {
          statusCode: 400,
          body: { error: 'on_behalf_of is required' },
          error: 'Missing on_behalf_of parameter',
          success: false
        };
      }

      if (!sourcePaymentRail || !sourcePaymentCurrency) {
        return {
          statusCode: 400,
          body: { error: 'source payment_rail and currency are required' },
          error: 'Missing source parameters',
          success: false
        };
      }

      if (!destinationPaymentRail || !destinationPaymentCurrency || !destinationPaymentAddress) {
        return {
          statusCode: 400,
          body: { error: 'destination payment_rail, currency, and to_address are required' },
          error: 'Missing destination parameters',
          success: false
        };
      }

      // Build request body as JSON object
      const requestBody = {
        on_behalf_of: onBehalfOf,
        source: {
          payment_rail: sourcePaymentRail,
          currency: sourcePaymentCurrency,
        },
        destination: {
          payment_rail: destinationPaymentRail,
          currency: destinationPaymentCurrency,
          to_address: destinationPaymentAddress,
        },
        amount: String(amount),
      };

      // Add developer_fee_percent if provided
      if (developerFee !== undefined && developerFee !== null) {
        requestBody.developer_fee = String(developerFee);
      }
      if (developerFeePercent !== undefined && developerFeePercent !== null) {
        requestBody.developer_fee_percent = String(developerFeePercent);
      }

      const response = await axios({
        method: 'POST',
        url: `${group.baseUrl}/v0/transfers`,
        data: requestBody, // Send as JSON object
        headers: {
          'Content-Type': 'application/json', // Changed to JSON
          'Api-Key': apikey,
          'Idempotency-Key': idempotencyKey,
        },
        validateStatus: () => true // Handle all status codes
      });

      if (response.status >= 400) {
        return {
          statusCode: response.status,
          headers: response.headers,
          body: response.data,
          error: response.data?.message || `Request failed with status ${response.status}`,
          success: false
        };
      }

      return {
        statusCode: response.status,
        headers: response.headers,
        body: response.data,
        error: null,
        success: true
      };

    } catch (error) {
      return {
        statusCode: error.response?.status || 500,
        headers: error.response?.headers,
        body: error.response?.data || null,
        error: error.message,
        success: false
      };
    }
  }

  async updateATransfer(context, variables) {

    try {
      const {
        transferID,
        onBehalfOf,
        sourcePaymentRail,
        sourcePaymentCurrency,
        destinationPaymentRail,
        destinationPaymentCurrency,
        destinationPaymentAddress,
        amount,
        developerFeePercent,
        developerFee
      } = variables;
      
      const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
      const group = this.createBridgeTransfersGroup();

      // Validate required fields
      if (!onBehalfOf) {
        return {
          statusCode: 400,
          body: { error: 'on_behalf_of is required' },
          error: 'Missing on_behalf_of parameter',
          success: false
        };
      }

      if (!sourcePaymentRail || !sourcePaymentCurrency) {
        return {
          statusCode: 400,
          body: { error: 'source payment_rail and currency are required' },
          error: 'Missing source parameters',
          success: false
        };
      }

      if (!destinationPaymentRail || !destinationPaymentCurrency || !destinationPaymentAddress) {
        return {
          statusCode: 400,
          body: { error: 'destination payment_rail, currency, and to_address are required' },
          error: 'Missing destination parameters',
          success: false
        };
      }

      // Build request body as JSON object
      const requestBody = {
        on_behalf_of: onBehalfOf,
        source: {
          payment_rail: sourcePaymentRail,
          currency: sourcePaymentCurrency,
        },
        destination: {
          payment_rail: destinationPaymentRail,
          currency: destinationPaymentCurrency,
          to_address: destinationPaymentAddress,
        },
        amount: String(amount),
      };

      // Add developer_fee_percent if provided
      if (developerFee !== undefined && developerFee !== null) {
        requestBody.developer_fee = String(developerFee);
      }
      if (developerFeePercent !== undefined && developerFeePercent !== null) {
        requestBody.developer_fee_percent = String(developerFeePercent);
      }

      const response = await axios({
        method: 'PUT',
        url: `${group.baseUrl}/v0/transfers/${transferID}`,
        data: requestBody, // Send as JSON object
        headers: {
          'Content-Type': 'application/json', // Changed to JSON
          'Api-Key': apikey,
        },
        validateStatus: () => true // Handle all status codes
      });

      if (response.status >= 400) {
        return {
          statusCode: response.status,
          headers: response.headers,
          body: response.data,
          error: response.data?.message || `Request failed with status ${response.status}`,
          success: false
        };
      }

      return {
        statusCode: response.status,
        headers: response.headers,
        body: response.data,
        error: null,
        success: true
      };

    } catch (error) {
      return {
        statusCode: error.response?.status || 500,
        headers: error.response?.headers,
        body: error.response?.data || null,
        error: error.message,
        success: false
      };
    }

    // const {
    //   transferID, onBehalfOf, sourcePaymentRail, sourcePaymentCurrency,
    //   destinationPaymentRail, destinationPaymentCurrency, destinationPaymentAddress,
    //   developerFee, amount
    // } = variables;
    // const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    // const group = this.createBridgeTransfersGroup();

    // const body = JSON.stringify({
    //   on_behalf_of: escapeStringForJson(onBehalfOf),
    //   source: {
    //     payment_rail: escapeStringForJson(sourcePaymentRail),
    //     currency: escapeStringForJson(sourcePaymentCurrency),
    //   },
    //   destination: {
    //     payment_rail: escapeStringForJson(destinationPaymentRail),
    //     currency: escapeStringForJson(destinationPaymentCurrency),
    //     to_address: escapeStringForJson(destinationPaymentAddress),
    //   },
    //   amount: String(amount),
    //   developer_fee: String(developerFee),
    // });

    // return httpClient.makeApiRequest({
    //   method: 'put',
    //   url: `${group.baseUrl}/v0/transfers/${transferID}`,
    //   headers: { 'Api-Key': apikey },
    //   params: {},
    //   body,
    //   returnBody: true,
    //   isStreamingApi: false,
    // });
  }

  async getSingleTransfer(context, variables) {
    const { transferID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeTransfersGroup();

    return httpClient.makeApiRequest({
      method: 'get',
      url: `${group.baseUrl}/v0/transfers/${transferID}`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async deleteATransfer(context, variables) {
    const { transferID } = variables;
    const apikey = getEnvVariable('BRIDGE_API_KEY', variables.apikey);
    const group = this.createBridgeTransfersGroup();

    return httpClient.makeApiRequest({
      method: 'delete',
      url: `${group.baseUrl}/v0/transfers/${transferID}`,
      headers: { 'Api-Key': apikey },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  // Custom API Calls
  async getPoliBitSellSideEntities(context, variables) {
    const aPITokenDS = getEnvVariable('POLIBIT_API_TOKEN', variables.aPITokenDS);

    const body = JSON.stringify({
      query: 'query GetSellSideEntities2 { getSellSideEntities { ID title details logoUrl isPublic }}'
    });

    return httpClient.makeApiRequest({
      method: 'post',
      url: 'https://api.polibit.io/gql',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aPITokenDS}`,
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

async getDiditToken(_context, _variables) {
  const authBasic = getEnvVariable('DIDIT_AUTH_BASIC', '');

  try {
    const formData = qs.stringify({ 
      grant_type: 'client_credentials' 
    });

    const response = await axios({
      method: 'POST',
      url: 'https://apx.didit.me/auth/v2/token/',
      data: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authBasic}`,
      }
    });

    return {
      statusCode: response.status,
      headers: response.headers,
      body: response.data,
      error: null,
      success: true
    };
  } catch (error) {
    return {
      statusCode: error.response?.status || 500,
      headers: error.response?.headers,
      body: error.response?.data || null,
      error: error.message,
      success: false
    };
  }
}

  async createDiditSession(context, variables) {
    const { token, callback, features, vendorData } = variables;

    const body = JSON.stringify({
      callback: callback || process.env.DIDIT_CALLBACK_URL || 'https://cdmxhomes.polibit.io/marketplace',
      features: features || process.env.DIDIT_FEATURES || 'OCR + FACE',
      vendor_data: vendorData || process.env.DIDIT_VENDOR_DATA || 'CDMXHomes',
    });

    return httpClient.makeApiRequest({
      method: 'post',
      url: 'https://verification.didit.me/v1/session/',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      params: {},
      body,
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getDiditSession(context, variables) {
    const { token, sessionID } = variables;

    return httpClient.makeApiRequest({
      method: 'get',
      url: `https://verification.didit.me/v1/session/${sessionID}/decision/`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async getDiditPDF(context, variables) {
    const { token, sessionID } = variables;

    return httpClient.makeApiRequest({
      method: 'get',
      url: `https://verification.didit.me/v1/session/${sessionID}/generate-pdf/`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      params: {},
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async deployContractERC20(context, variables) {
    const {
      authToken, contractTokenName, contractTokenSymbol, contractTokenValue,
      contractMaxTokens, company, currency
    } = variables;

    return httpClient.makeApiRequest({
      method: 'get',
      url: process.env.DEPLOY_ERC20_URL || 'https://deployerc20contract-owsxmo2jdq-uc.a.run.app',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      params: {
        name: contractTokenName,
        symbol: contractTokenSymbol,
        tokenValue: contractTokenValue,
        maxTokens: contractMaxTokens,
        company,
        currency,
      },
      returnBody: true,
      isStreamingApi: false,
    });
  }

  async deployContractERC3643(context, variables) {
    const {
      authToken, contractTokenName, contractTokenSymbol, contractTokenValue,
      contractMaxTokens, company, currency, projectName, operatingAgreementHash
    } = variables;

    // Build params object, only include operatingAgreementHash if it's provided
    const params = {
      name: contractTokenName,
      symbol: contractTokenSymbol,
      tokenValue: contractTokenValue,
      maxTokens: contractMaxTokens,
      company,
      currency,
      projectName,
    };

    // Only add operatingAgreementHash if it's not null/undefined
    if (operatingAgreementHash != null) {
      params.operatingAgreementHash = operatingAgreementHash;
    }

    return httpClient.makeApiRequest({
      method: 'get',
      url: process.env.DEPLOY_ERC3643_URL || 'https://deployerc3643contract-owsxmo2jdq-uc.a.run.app',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      params,
      returnBody: true,
      isStreamingApi: false,
    });
  }
}

module.exports = new ApiManager();