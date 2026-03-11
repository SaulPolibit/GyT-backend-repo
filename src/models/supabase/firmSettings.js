/**
 * FirmSettings Supabase Model
 * Handles firm/company settings and configuration
 */

const { getSupabase } = require('../../config/database');

class FirmSettings {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      firmName: 'firm_name',
      firmLogo: 'firm_logo',
      firmDescription: 'firm_description',
      firmWebsite: 'firm_website',
      firmAddress: 'firm_address',
      firmPhone: 'firm_phone',
      firmEmail: 'firm_email',
      themeConfig: 'theme_config',
      navVisibilityConfig: 'nav_visibility_config',
      baseCurrency: 'base_currency',
      userId: 'user_id',
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
      firmName: dbData.firm_name,
      firmLogo: dbData.firm_logo,
      firmDescription: dbData.firm_description,
      firmWebsite: dbData.firm_website,
      firmAddress: dbData.firm_address,
      firmPhone: dbData.firm_phone,
      firmEmail: dbData.firm_email,
      themeConfig: dbData.theme_config,
      navVisibilityConfig: dbData.nav_visibility_config,
      baseCurrency: dbData.base_currency,
      userId: dbData.user_id,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create firm settings (should only be one record)
   */
  static async create(data) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(data);

    const { data: result, error } = await supabase
      .from('firm_settings')
      .insert([dbData])
      .select()
      .single();

    if (error) throw error;

    return this._toModel(result);
  }

  /**
   * Get firm settings (returns the single settings record)
   */
  static async get() {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('firm_settings')
      .select('*')
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Get firm settings by user ID
   * @param {string} userId - The user ID to find settings for
   */
  static async findByUserId(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('firm_settings')
      .select('*')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('firm_settings')
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
   * Update firm settings
   */
  static async update(updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    // Get the first (and should be only) record
    const existing = await this.get();

    if (!existing) {
      // If no settings exist, create them
      return this.create(updateData);
    }

    const { data, error } = await supabase
      .from('firm_settings')
      .update(dbData)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Update firm settings by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('firm_settings')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Delete firm settings
   */
  static async delete() {
    const supabase = getSupabase();
    const existing = await this.get();

    if (!existing) {
      throw new Error('No firm settings found to delete');
    }

    const { data, error } = await supabase
      .from('firm_settings')
      .delete()
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Delete firm settings by ID
   * @param {string} id - The settings ID to delete
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('firm_settings')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Initialize default settings if none exist
   * @param {string} userId - Optional user ID to associate with settings
   */
  static async initializeDefaults(userId = null) {
    const existing = await this.get();

    if (existing) {
      return existing;
    }

    const defaultSettings = {
      firmName: 'My Firm',
      firmDescription: '',
      firmWebsite: '',
      firmAddress: '',
      firmPhone: '',
      firmEmail: ''
    };

    // Add userId if provided
    if (userId) {
      defaultSettings.userId = userId;
    }

    return this.create(defaultSettings);
  }
}

module.exports = FirmSettings;
