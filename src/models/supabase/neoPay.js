/**
 * NeoPay Transaction Model
 * Handles all database operations for NeoPay transactions
 */
const { getSupabase } = require('../../config/database');

class NeoPay {
  /**
   * Field mapping: camelCase (API) -> snake_case (DB)
   */
  static _fieldMap = {
    id: 'id',
    userId: 'user_id',
    structureId: 'structure_id',
    investmentId: 'investment_id',
    systemsTraceNo: 'systems_trace_no',
    messageTypeId: 'message_type_id',
    processingCode: 'processing_code',
    cardType: 'card_type',
    cardLastFour: 'card_last_four',
    cardHolderName: 'card_holder_name',
    amountRequested: 'amount_requested',
    amountApproved: 'amount_approved',
    currency: 'currency',
    typeOperation: 'type_operation',
    responseCode: 'response_code',
    responseMessage: 'response_message',
    authIdResponse: 'auth_id_response',
    retrievalRefNo: 'retrieval_ref_no',
    timeLocalTrans: 'time_local_trans',
    dateLocalTrans: 'date_local_trans',
    is3dSecure: 'is_3d_secure',
    secure3dStep: 'secure_3d_step',
    secure3dReferenceId: 'secure_3d_reference_id',
    status: 'status',
    isReversal: 'is_reversal',
    originalTransactionId: 'original_transaction_id',
    reversalReason: 'reversal_reason',
    orderInformation: 'order_information',
    additionalData: 'additional_data',
    ipAddress: 'ip_address',
    userAgent: 'user_agent',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    processedAt: 'processed_at',
  };

  /**
   * Convert camelCase to snake_case for database
   * @param {Object} data - Data with camelCase keys
   * @returns {Object} Data with snake_case keys
   */
  static _toDbFields(data) {
    const dbData = {};
    for (const [camelKey, snakeKey] of Object.entries(this._fieldMap)) {
      if (data[camelKey] !== undefined) {
        dbData[snakeKey] = data[camelKey];
      }
    }
    return dbData;
  }

  /**
   * Convert snake_case to camelCase for API
   * @param {Object} dbData - Data with snake_case keys
   * @returns {Object} Data with camelCase keys
   */
  static _toModel(dbData) {
    if (!dbData) return null;
    const model = {};
    for (const [camelKey, snakeKey] of Object.entries(this._fieldMap)) {
      if (dbData[snakeKey] !== undefined) {
        model[camelKey] = dbData[snakeKey];
      }
    }
    return model;
  }

  /**
   * Get next SystemsTraceNo
   * @returns {Promise<string>} 6-digit trace number
   */
  static async getNextTraceNo() {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('get_next_trace_no');

    if (error) {
      console.error('[NeoPay] Error getting trace number:', error);
      throw error;
    }

    return data;
  }

  /**
   * Create new transaction
   * @param {Object} transactionData - Transaction data
   * @returns {Promise<Object>} Created transaction
   */
  static async create(transactionData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(transactionData);

    const { data, error } = await supabase
      .from('neopay_transactions')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      console.error('[NeoPay] Error creating transaction:', error);
      throw error;
    }

    console.log(`[NeoPay] Transaction created: ${data.id}`);
    return this._toModel(data);
  }

  /**
   * Find transaction by ID
   * @param {string} id - Transaction UUID
   * @returns {Promise<Object|null>} Transaction or null
   */
  static async findById(id) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('neopay_transactions')
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
   * Find transaction by SystemsTraceNo
   * @param {string} traceNo - 6-digit trace number
   * @returns {Promise<Object|null>} Transaction or null
   */
  static async findByTraceNo(traceNo) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('neopay_transactions')
      .select('*')
      .eq('systems_trace_no', traceNo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find transaction by RetrievalRefNo
   * @param {string} refNo - Reference number from NeoPay
   * @returns {Promise<Object|null>} Transaction or null
   */
  static async findByRetrievalRefNo(refNo) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('neopay_transactions')
      .select('*')
      .eq('retrieval_ref_no', refNo)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Update transaction by ID
   * @param {string} id - Transaction UUID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated transaction
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('neopay_transactions')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[NeoPay] Error updating transaction:', error);
      throw error;
    }

    console.log(`[NeoPay] Transaction updated: ${id}`);
    return this._toModel(data);
  }

  /**
   * Update transaction status
   * @param {string} id - Transaction UUID
   * @param {string} status - New status
   * @param {Object} additionalData - Additional fields to update
   * @returns {Promise<Object>} Updated transaction
   */
  static async updateStatus(id, status, additionalData = {}) {
    return this.findByIdAndUpdate(id, {
      status,
      processedAt: new Date().toISOString(),
      ...additionalData,
    });
  }

  /**
   * Find transactions by user ID
   * @param {string} userId - User UUID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of transactions
   */
  static async findByUserId(userId, options = {}) {
    const supabase = getSupabase();
    const { limit = 50, offset = 0, status } = options;

    let query = supabase
      .from('neopay_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data.map(item => this._toModel(item));
  }

  /**
   * Find all transactions with filters
   * @param {Object} criteria - Filter criteria
   * @returns {Promise<Array>} List of transactions
   */
  static async find(criteria = {}) {
    const supabase = getSupabase();
    const dbCriteria = this._toDbFields(criteria);

    let query = supabase
      .from('neopay_transactions')
      .select('*')
      .order('created_at', { ascending: false });

    Object.entries(dbCriteria).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query;

    if (error) throw error;
    return data.map(item => this._toModel(item));
  }

  /**
   * Get transaction statistics
   * @param {Object} filters - Optional filters (userId, dateFrom, dateTo)
   * @returns {Promise<Object>} Statistics object
   */
  static async getStats(filters = {}) {
    const supabase = getSupabase();

    let query = supabase
      .from('neopay_transactions')
      .select('status, amount_requested, amount_approved, response_code');

    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }
    if (filters.dateFrom) {
      query = query.gte('created_at', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte('created_at', filters.dateTo);
    }

    const { data, error } = await query;

    if (error) throw error;

    const stats = {
      total: data.length,
      approved: 0,
      declined: 0,
      reversed: 0,
      pending: 0,
      totalAmountRequested: 0,
      totalAmountApproved: 0,
    };

    data.forEach(tx => {
      stats.totalAmountRequested += parseFloat(tx.amount_requested) || 0;
      stats.totalAmountApproved += parseFloat(tx.amount_approved) || 0;

      switch (tx.status) {
        case 'approved':
          stats.approved++;
          break;
        case 'declined':
          stats.declined++;
          break;
        case 'reversed':
          stats.reversed++;
          break;
        case 'pending':
          stats.pending++;
          break;
      }
    });

    return stats;
  }

  /**
   * Check if transaction can be voided
   * @param {string} id - Transaction UUID
   * @returns {Promise<boolean>}
   */
  static async canBeVoided(id) {
    const transaction = await this.findById(id);
    if (!transaction) return false;

    // Only approved transactions can be voided
    if (transaction.status !== 'approved') return false;

    // Check if already has a reversal
    const supabase = getSupabase();
    const { data } = await supabase
      .from('neopay_transactions')
      .select('id')
      .eq('original_transaction_id', id)
      .eq('is_reversal', true)
      .limit(1);

    return !data || data.length === 0;
  }
}

module.exports = NeoPay;
