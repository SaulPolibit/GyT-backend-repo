/**
 * Email Settings Supabase Model
 * Manages user SMTP configuration
 */

const { getSupabase } = require('../../config/database');
const { encrypt, decrypt } = require('../../utils/encryption');

class EmailSettings {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      userId: 'user_id',
      smtpHost: 'smtp_host',
      smtpPort: 'smtp_port',
      smtpSecure: 'smtp_secure',
      smtpUsername: 'smtp_username',
      smtpPassword: 'smtp_password',
      fromEmail: 'from_email',
      fromName: 'from_name',
      replyToEmail: 'reply_to_email',
      isActive: 'is_active',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      lastUsedAt: 'last_used_at'
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
   * Note: Excludes password for security
   */
  static _toModel(dbData, includePassword = false) {
    if (!dbData) return null;

    const model = {
      id: dbData.id,
      userId: dbData.user_id,
      smtpHost: dbData.smtp_host,
      smtpPort: dbData.smtp_port,
      smtpSecure: dbData.smtp_secure,
      smtpUsername: dbData.smtp_username,
      fromEmail: dbData.from_email,
      fromName: dbData.from_name,
      replyToEmail: dbData.reply_to_email,
      isActive: dbData.is_active,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at,
      lastUsedAt: dbData.last_used_at
    };

    // Only include encrypted password if explicitly requested
    if (includePassword && dbData.smtp_password) {
      model.smtpPassword = dbData.smtp_password;
    }

    return model;
  }

  /**
   * Create or update email settings for a user
   */
  static async upsert(userId, settingsData) {
    const supabase = getSupabase();

    // Encrypt password before storing
    if (settingsData.smtpPassword) {
      settingsData.smtpPassword = encrypt(settingsData.smtpPassword);
    }

    const dbData = this._toDbFields({
      userId,
      ...settingsData,
      updatedAt: new Date().toISOString()
    });

    // Check if settings exist
    const existing = await this.findByUserId(userId);

    if (existing) {
      // Update
      const { data, error } = await supabase
        .from('user_email_settings')
        .update(dbData)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Error updating email settings: ${error.message}`);
      }

      return this._toModel(data);
    } else {
      // Create
      const { data, error } = await supabase
        .from('user_email_settings')
        .insert([dbData])
        .select()
        .single();

      if (error) {
        throw new Error(`Error creating email settings: ${error.message}`);
      }

      return this._toModel(data);
    }
  }

  /**
   * Find email settings by user ID
   */
  static async findByUserId(userId, includePassword = false) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('user_email_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding email settings: ${error.message}`);
    }

    return this._toModel(data, includePassword);
  }

  /**
   * Get decrypted SMTP password for a user
   */
  static async getDecryptedPassword(userId) {
    const settings = await this.findByUserId(userId, true);

    if (!settings || !settings.smtpPassword) {
      return null;
    }

    try {
      return decrypt(settings.smtpPassword);
    } catch (error) {
      throw new Error(`Failed to decrypt password: ${error.message}`);
    }
  }

  /**
   * Update last used timestamp
   */
  static async updateLastUsed(userId) {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('user_email_settings')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Error updating last used: ${error.message}`);
    }

    return true;
  }

  /**
   * Delete email settings
   */
  static async delete(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('user_email_settings')
      .delete()
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting email settings: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Check if user has email settings configured
   */
  static async hasSettings(userId) {
    const settings = await this.findByUserId(userId);
    return !!settings;
  }
}

module.exports = EmailSettings;
