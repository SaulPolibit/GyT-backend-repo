// models/supabase/notificationSettings.js
const { getSupabase } = require('../../config/database');

class NotificationSettings {
  /**
   * Create notification settings
   * @param {Object} settingsData - Settings data
   * @returns {Promise<Object>} Created settings
   */
  static async create(settingsData) {
    const supabase = getSupabase();

    const dbData = this._toDbFields(settingsData);

    const { data, error } = await supabase
      .from('notification_settings')
      .insert([dbData])
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Find settings by ID
   * @param {string} id - Settings ID
   * @returns {Promise<Object|null>} Settings or null
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notification_settings')
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
   * Find settings by user ID
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Settings or null
   */
  static async findByUserId(userId) {
    return this.findOne({ userId });
  }

  /**
   * Find or create notification settings for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Settings
   */
  static async findOrCreateByUserId(userId) {
    let settings = await this.findByUserId(userId);

    if (!settings) {
      settings = await this.create({ userId });
    }

    return settings;
  }

  /**
   * Find one by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object|null>} Settings or null
   */
  static async findOne(criteria) {
    const supabase = getSupabase();

    let query = supabase.from('notification_settings').select('*');

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
   * Update notification settings by user ID
   * @param {string} userId - User ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated settings
   */
  static async updateByUserId(userId, updates) {
    const supabase = getSupabase();

    const dbUpdates = this._toDbFields(updates);

    const { data, error } = await supabase
      .from('notification_settings')
      .update(dbUpdates)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Update by ID
   * @param {string} id - Settings ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated settings
   */
  static async findByIdAndUpdate(id, updates, options = {}) {
    const supabase = getSupabase();

    const dbUpdates = this._toDbFields(updates);

    const { data, error } = await supabase
      .from('notification_settings')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Find and update or create (upsert)
   * @param {Object} filter - Filter criteria
   * @param {Object} updateData - Data to update or insert
   * @param {Object} options - Options
   * @returns {Promise<Object>} Updated or created settings
   */
  static async findOneAndUpdate(filter, updateData, options = {}) {
    const supabase = getSupabase();

    const dbFilter = this._toDbFields(filter);
    const dbData = this._toDbFields(updateData);

    if (options.upsert) {
      const upsertData = { ...dbData, ...dbFilter };

      const { data, error } = await supabase
        .from('notification_settings')
        .upsert([upsertData], {
          onConflict: 'user_id',
          returning: 'representation'
        })
        .select()
        .single();

      if (error) throw error;

      return this._toModel(data);
    }

    let query = supabase.from('notification_settings').select('*');

    Object.entries(dbFilter).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data: existing, error: findError } = await query.single();

    if (findError && findError.code !== 'PGRST116') throw findError;

    if (existing) {
      const { data, error } = await supabase
        .from('notification_settings')
        .update(dbData)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;

      return this._toModel(data);
    }

    return null;
  }

  /**
   * Delete settings by ID
   * @param {string} id - Settings ID
   * @returns {Promise<Object>} Deleted settings
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notification_settings')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Find one and delete by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object|null>} Deleted settings or null
   */
  static async findOneAndDelete(criteria) {
    const supabase = getSupabase();

    const dbCriteria = this._toDbFields(criteria);

    let query = supabase.from('notification_settings').delete().select();

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
   * Convert database fields to model fields
   * @param {Object} dbSettings - Settings from database
   * @returns {Object} Settings model
   * @private
   */
  static _toModel(dbSettings) {
    if (!dbSettings) return null;

    const model = {
      id: dbSettings.id,
      userId: dbSettings.user_id,
      emailNotifications: dbSettings.email_notifications,
      portfolioNotifications: dbSettings.portfolio_notifications,
      reportNotifications: dbSettings.report_notifications,
      investorActivityNotifications: dbSettings.investor_activity_notifications,
      systemUpdateNotifications: dbSettings.system_update_notifications,
      marketingEmailNotifications: dbSettings.marketing_email_notifications,
      pushNotifications: dbSettings.push_notifications,
      smsNotifications: dbSettings.sms_notifications,
      notificationFrequency: dbSettings.notification_frequency,
      preferredContactMethod: dbSettings.preferred_contact_method,
      reportDeliveryFormat: dbSettings.report_delivery_format,
      documentUploads: dbSettings.document_uploads,
      generalAnnouncements: dbSettings.general_announcements,
      capitalCallNotices: dbSettings.capital_call_notices,
      distributionNotices: dbSettings.distribution_notices,
      k1TaxForms: dbSettings.k1_tax_forms,
      paymentConfirmations: dbSettings.payment_confirmations,
      quarterlyReports: dbSettings.quarterly_reports,
      securityAlerts: dbSettings.security_alerts,
      urgentCapitalCalls: dbSettings.urgent_capital_calls,
      newStructureNotifications: dbSettings.new_structure_notifications,
      createdAt: dbSettings.created_at,
      updatedAt: dbSettings.updated_at,

      // Instance method to check if a specific notification type is enabled
      isNotificationEnabled(notificationType) {
        return this[notificationType] === true;
      },

      // Instance method to enable all notifications
      async enableAll() {
        return NotificationSettings.findByIdAndUpdate(this.id, {
          emailNotifications: true,
          portfolioNotifications: true,
          reportNotifications: true,
          investorActivityNotifications: true,
          systemUpdateNotifications: true,
          marketingEmailNotifications: true,
          pushNotifications: true,
          smsNotifications: true,
          documentUploads: true,
          generalAnnouncements: true,
          capitalCallNotices: true,
          distributionNotices: true,
          k1TaxForms: true,
          paymentConfirmations: true,
          quarterlyReports: true,
          securityAlerts: true,
          urgentCapitalCalls: true,
          newStructureNotifications: true
        });
      },

      // Instance method to disable all notifications
      async disableAll() {
        return NotificationSettings.findByIdAndUpdate(this.id, {
          emailNotifications: false,
          portfolioNotifications: false,
          reportNotifications: false,
          investorActivityNotifications: false,
          systemUpdateNotifications: false,
          marketingEmailNotifications: false,
          pushNotifications: false,
          smsNotifications: false,
          documentUploads: false,
          generalAnnouncements: false,
          capitalCallNotices: false,
          distributionNotices: false,
          k1TaxForms: false,
          paymentConfirmations: false,
          quarterlyReports: false,
          securityAlerts: false,
          urgentCapitalCalls: false,
          newStructureNotifications: false
        });
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
      userId: 'user_id',
      emailNotifications: 'email_notifications',
      portfolioNotifications: 'portfolio_notifications',
      reportNotifications: 'report_notifications',
      investorActivityNotifications: 'investor_activity_notifications',
      systemUpdateNotifications: 'system_update_notifications',
      marketingEmailNotifications: 'marketing_email_notifications',
      pushNotifications: 'push_notifications',
      smsNotifications: 'sms_notifications',
      notificationFrequency: 'notification_frequency',
      preferredContactMethod: 'preferred_contact_method',
      reportDeliveryFormat: 'report_delivery_format',
      documentUploads: 'document_uploads',
      generalAnnouncements: 'general_announcements',
      capitalCallNotices: 'capital_call_notices',
      distributionNotices: 'distribution_notices',
      k1TaxForms: 'k1_tax_forms',
      paymentConfirmations: 'payment_confirmations',
      quarterlyReports: 'quarterly_reports',
      securityAlerts: 'security_alerts',
      urgentCapitalCalls: 'urgent_capital_calls',
      newStructureNotifications: 'new_structure_notifications',
    };

    Object.entries(modelData).forEach(([key, value]) => {
      const dbKey = fieldMap[key] || key;
      // Skip methods
      if (typeof value !== 'function') {
        dbData[dbKey] = value;
      }
    });

    return dbData;
  }
}

module.exports = NotificationSettings;
