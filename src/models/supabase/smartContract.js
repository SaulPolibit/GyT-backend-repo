// models/supabase/smartContract.js
const { getSupabase } = require('../../config/database');

class SmartContract {
  /**
   * Create a new smart contract
   * @param {Object} contractData - Contract data
   * @returns {Promise<Object>} Created contract
   */
  static async create(contractData) {
    const supabase = getSupabase();

    const dbData = this._toDbFields(contractData);

    const { data, error } = await supabase
      .from('smart_contracts')
      .insert([dbData])
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Find contract by ID
   * @param {string} id - Contract ID
   * @returns {Promise<Object|null>} Contract or null
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('smart_contracts')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find contract by project ID
   * @param {string} projectId - Project ID
   * @returns {Promise<Object|null>} Contract or null
   */
  static async findByProjectId(projectId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('smart_contracts')
      .select('*')
      .eq('project_id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find contract by contract address
   * @param {string} contractAddress - Contract address
   * @returns {Promise<Object|null>} Contract or null
   */
  static async findByContractAddress(contractAddress) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('smart_contracts')
      .select('*')
      .eq('contract_address', contractAddress.trim())
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find contracts by company (case insensitive partial match)
   * @param {string} company - Company name
   * @returns {Promise<Array>} Array of contracts
   */
  static async findByCompany(company) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('smart_contracts')
      .select('*')
      .ilike('company', `%${company}%`);

    if (error) throw error;

    return data.map(contract => this._toModel(contract));
  }

  /**
   * Find contracts by token symbol
   * @param {string} tokenSymbol - Token symbol
   * @returns {Promise<Array>} Array of contracts
   */
  static async findByTokenSymbol(tokenSymbol) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('smart_contracts')
      .select('*')
      .eq('token_symbol', tokenSymbol.toUpperCase());

    if (error) throw error;

    return data.map(contract => this._toModel(contract));
  }

  /**
   * Find one contract by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object|null>} Contract or null
   */
  static async findOne(criteria) {
    const supabase = getSupabase();

    let query = supabase.from('smart_contracts').select('*');

    const dbCriteria = this._toDbFields(criteria);

    Object.entries(dbCriteria).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find contracts by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array>} Array of contracts
   */
  static async find(criteria = {}) {
    const supabase = getSupabase();

    let query = supabase.from('smart_contracts').select('*');

    const dbCriteria = this._toDbFields(criteria);

    Object.entries(dbCriteria).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query;

    if (error) throw error;

    return data.map(contract => this._toModel(contract));
  }

  /**
   * Update contract by ID
   * @param {string} id - Contract ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated contract
   */
  static async findByIdAndUpdate(id, updateData, options = {}) {
    const supabase = getSupabase();

    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('smart_contracts')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Delete contract by ID
   * @param {string} id - Contract ID
   * @returns {Promise<Object>} Deleted contract
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('smart_contracts')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Convert database fields to model fields
   * @param {Object} dbContract - Contract from database
   * @returns {Object} Contract model
   * @private
   */
  static _toModel(dbContract) {
    if (!dbContract) return null;

    const model = {
      id: dbContract.id,
      structureId: dbContract.structure_id,
      contractType: dbContract.contract_type,
      deploymentStatus: dbContract.deployment_status,
      complianceRegistryAddress: dbContract.compliance_registry_address,
      contractAddress: dbContract.contract_address,
      factoryAddress: dbContract.factory_address,
      identityRegistryAddress: dbContract.identity_registry_address,
      transactionHash: dbContract.transaction_hash,
      network: dbContract.network,
      company: dbContract.company,
      currency: dbContract.currency,
      maxTokens: parseInt(dbContract.max_tokens, 10),
      mintedTokens: dbContract.minted_tokens,
      projectName: dbContract.project_name,
      tokenName: dbContract.token_name,
      tokenSymbol: dbContract.token_symbol,
      tokenValue: dbContract.token_value,
      deployedBy: dbContract.deployed_by,
      deploymentError: dbContract.deployment_error,
      deploymentResponse: dbContract.deployment_response,
      operatingAgreementHash: dbContract.operating_agreement_hash,
      createdAt: dbContract.created_at,
      updatedAt: dbContract.updated_at,

      // Virtual: Check if fully minted
      get isFullyMinted() {
        const minted = parseInt(this.mintedTokens, 10);
        return minted >= this.maxTokens;
      },

      // Instance method to update minted tokens
      async updateMintedTokens(amount) {
        return SmartContract.findByIdAndUpdate(this.id, {
          mintedTokens: amount.toString()
        });
      },

      // Instance method to get minting progress
      getMintingProgress() {
        const minted = parseInt(this.mintedTokens, 10);
        const max = this.maxTokens;
        const percentage = max > 0 ? (minted / max) * 100 : 0;

        return {
          mintedTokens: minted,
          maxTokens: max,
          remainingTokens: max - minted,
          progressPercentage: percentage.toFixed(2),
          isFullyMinted: minted >= max
        };
      },

      // Instance method to check if more tokens can be minted
      canMintMore() {
        const minted = parseInt(this.mintedTokens, 10);
        return minted < this.maxTokens;
      },

      // Include virtuals when converting to JSON
      toJSON() {
        const obj = { ...this };
        obj.isFullyMinted = this.isFullyMinted;
        delete obj.toJSON;
        delete obj.toObject;
        return obj;
      },

      toObject() {
        const obj = { ...this };
        obj.isFullyMinted = this.isFullyMinted;
        delete obj.toJSON;
        delete obj.toObject;
        return obj;
      }
    };

    return model;
  }

  /**
   * Convert model fields to database fields
   * @param {Object} modelData - Data in camelCase
   * @returns {Object} Data in snake_case
   * @private
   */
  static _toDbFields(modelData) {
    const dbData = {};

    const fieldMap = {
      structureId: 'structure_id',
      contractType: 'contract_type',
      deploymentStatus: 'deployment_status',
      complianceRegistryAddress: 'compliance_registry_address',
      contractAddress: 'contract_address',
      factoryAddress: 'factory_address',
      identityRegistryAddress: 'identity_registry_address',
      transactionHash: 'transaction_hash',
      network: 'network',
      maxTokens: 'max_tokens',
      mintedTokens: 'minted_tokens',
      projectName: 'project_name',
      tokenName: 'token_name',
      tokenSymbol: 'token_symbol',
      tokenValue: 'token_value',
      deployedBy: 'deployed_by',
      deploymentError: 'deployment_error',
      deploymentResponse: 'deployment_response',
      operatingAgreementHash: 'operating_agreement_hash',
    };

    Object.entries(modelData).forEach(([key, value]) => {
      // Skip methods and computed properties
      if (typeof value === 'function' || key === 'isFullyMinted') {
        return;
      }
      const dbKey = fieldMap[key] || key;
      dbData[dbKey] = value;
    });

    return dbData;
  }

  /**
   * Mark contract as deployed
   */
  static async markAsDeployed(id, deploymentData) {
    const updateData = {
      deploymentStatus: 'deployed'
    };

    if (deploymentData) {
      // Extract deployment details from nested structure
      const deployment = deploymentData.deployment || deploymentData;

      // Map tokenAddress to contractAddress
      if (deployment.tokenAddress) updateData.contractAddress = deployment.tokenAddress;
      if (deployment.contractAddress) updateData.contractAddress = deployment.contractAddress;

      if (deployment.transactionHash) updateData.transactionHash = deployment.transactionHash;
      if (deployment.complianceRegistryAddress) updateData.complianceRegistryAddress = deployment.complianceRegistryAddress;
      if (deployment.factoryAddress) updateData.factoryAddress = deployment.factoryAddress;
      if (deployment.identityRegistryAddress) updateData.identityRegistryAddress = deployment.identityRegistryAddress;

      // Store the full response
      updateData.deploymentResponse = deploymentData;
    }

    return this.findByIdAndUpdate(id, updateData);
  }

  /**
   * Mark contract as failed
   */
  static async markAsFailed(id, error) {
    return this.findByIdAndUpdate(id, {
      deploymentStatus: 'failed',
      deploymentError: error
    });
  }

  /**
   * Mark contract as deploying
   */
  static async markAsDeploying(id) {
    return this.findByIdAndUpdate(id, {
      deploymentStatus: 'deploying'
    });
  }
}

module.exports = SmartContract;
