/**
 * Subscription Supabase Model
 * Handles subscription data for structure investments
 */

const { getSupabase } = require('../../config/database');

class Subscription {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      structureId: 'structure_id',
      userId: 'user_id',
      fundId: 'fund_id',
      requestedAmount: 'requested_amount',
      currency: 'currency',
      status: 'status',
      paymentId: 'payment_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    };

    for (const [camelKey, snakeKey] of Object.entries(fieldMap)) {
      if (data[camelKey] !== undefined) {
        dbData[snakeKey] = data[camelKey];
      }
    }

    return dbData;
  }

  /**
   * Convert snake_case database fields to camelCase for model
   */
  static _toModel(dbData) {
    if (!dbData) return null;

    return {
      id: dbData.id,
      structureId: dbData.structure_id,
      userId: dbData.user_id,
      fundId: dbData.fund_id,
      requestedAmount: dbData.requested_amount,
      currency: dbData.currency,
      status: dbData.status,
      paymentId: dbData.payment_id,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new subscription record
   * @param {Object} data - Subscription data
   * @returns {Promise<Object>} Created subscription
   */
  static async create(data) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(data);

    const { data: result, error } = await supabase
      .from('subscriptions')
      .insert([dbData])
      .select()
      .single();

    if (error) throw error;

    return this._toModel(result);
  }

  /**
   * Find subscription by ID
   * @param {string} id - Subscription ID
   * @returns {Promise<Object|null>} Subscription or null
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('subscriptions')
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
   * Find subscriptions by user ID
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of subscriptions
   */
  static async findByUserId(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Find subscriptions by structure ID
   * @param {string} structureId - Structure ID
   * @returns {Promise<Array>} Array of subscriptions
   */
  static async findByStructureId(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('structure_id', structureId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Find subscriptions by fund ID
   * @param {string} fundId - Fund ID
   * @returns {Promise<Array>} Array of subscriptions
   */
  static async findByFundId(fundId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('fund_id', fundId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Find subscription by payment ID
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object|null>} Subscription or null
   */
  static async findByPaymentId(paymentId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('payment_id', paymentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find subscriptions by status
   * @param {string} status - Subscription status
   * @returns {Promise<Array>} Array of subscriptions
   */
  static async findByStatus(status) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Find subscriptions by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array>} Array of subscriptions
   */
  static async find(criteria = {}) {
    const supabase = getSupabase();
    const dbCriteria = this._toDbFields(criteria);

    let query = supabase.from('subscriptions').select('*');

    Object.entries(dbCriteria).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Update subscription by ID
   * @param {string} id - Subscription ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated subscription
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('subscriptions')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Delete subscription by ID
   * @param {string} id - Subscription ID
   * @returns {Promise<Object>} Deleted subscription
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('subscriptions')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Update subscription status
   * @param {string} id - Subscription ID
   * @param {string} status - New status
   * @returns {Promise<Object>} Updated subscription
   */
  static async updateStatus(id, status) {
    return this.findByIdAndUpdate(id, { status });
  }

  /**
   * Update subscription payment ID
   * @param {string} id - Subscription ID
   * @param {string} paymentId - Payment ID
   * @returns {Promise<Object>} Updated subscription
   */
  static async updatePaymentId(id, paymentId) {
    return this.findByIdAndUpdate(id, { paymentId });
  }
}

module.exports = Subscription;
