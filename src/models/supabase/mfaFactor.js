/**
 * MFA Factor Supabase Model
 * Manages user MFA enrollment records
 */

const { getSupabase } = require('../../config/database');

class MFAFactor {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      userId: 'user_id',
      factorId: 'factor_id',
      factorType: 'factor_type',
      friendlyName: 'friendly_name',
      isActive: 'is_active',
      enrolledAt: 'enrolled_at',
      lastUsedAt: 'last_used_at',
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
      userId: dbData.user_id,
      factorId: dbData.factor_id,
      factorType: dbData.factor_type,
      friendlyName: dbData.friendly_name,
      isActive: dbData.is_active,
      enrolledAt: dbData.enrolled_at,
      lastUsedAt: dbData.last_used_at,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create or update MFA factor record
   */
  static async upsert(factorData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(factorData);

    // Set updated_at
    dbData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('user_mfa_factors')
      .upsert([dbData], {
        onConflict: 'user_id,factor_type'
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error upserting MFA factor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find MFA factors by user ID
   */
  static async findByUserId(userId, activeOnly = false) {
    const supabase = getSupabase();

    let query = supabase
      .from('user_mfa_factors')
      .select('*')
      .eq('user_id', userId)
      .order('enrolled_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding MFA factors: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find MFA factor by factor ID
   */
  static async findByFactorId(factorId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('user_mfa_factors')
      .select('*')
      .eq('factor_id', factorId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding MFA factor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Update last used timestamp
   */
  static async updateLastUsed(factorId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('user_mfa_factors')
      .update({
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('factor_id', factorId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating MFA factor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Deactivate MFA factor
   */
  static async deactivate(factorId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('user_mfa_factors')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('factor_id', factorId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deactivating MFA factor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete MFA factor
   */
  static async delete(factorId) {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_mfa_factors')
      .delete()
      .eq('factor_id', factorId);

    if (error) {
      throw new Error(`Error deleting MFA factor: ${error.message}`);
    }

    return true;
  }

  /**
   * Check if user has active MFA
   */
  static async hasActiveMFA(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('user_mfa_factors')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .limit(1);

    if (error) {
      throw new Error(`Error checking MFA status: ${error.message}`);
    }

    return data && data.length > 0;
  }
}

module.exports = MFAFactor;
