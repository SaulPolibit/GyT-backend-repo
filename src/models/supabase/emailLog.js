/**
 * Email Log Supabase Model
 * Logs all email sending attempts
 */

const { getSupabase } = require('../../config/database');

class EmailLog {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      userId: 'user_id',
      emailSettingsId: 'email_settings_id',
      toAddresses: 'to_addresses',
      ccAddresses: 'cc_addresses',
      bccAddresses: 'bcc_addresses',
      subject: 'subject',
      bodyText: 'body_text',
      bodyHtml: 'body_html',
      hasAttachments: 'has_attachments',
      attachmentCount: 'attachment_count',
      status: 'status',
      errorMessage: 'error_message',
      messageId: 'message_id',
      sentAt: 'sent_at',
      createdAt: 'created_at'
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
      emailSettingsId: dbData.email_settings_id,
      toAddresses: dbData.to_addresses || [],
      ccAddresses: dbData.cc_addresses || [],
      bccAddresses: dbData.bcc_addresses || [],
      subject: dbData.subject,
      bodyText: dbData.body_text,
      bodyHtml: dbData.body_html,
      hasAttachments: dbData.has_attachments || false,
      attachmentCount: dbData.attachment_count || 0,
      status: dbData.status,
      errorMessage: dbData.error_message,
      messageId: dbData.message_id,
      sentAt: dbData.sent_at,
      createdAt: dbData.created_at
    };
  }

  /**
   * Create email log entry
   */
  static async create(logData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(logData);

    const { data, error } = await supabase
      .from('email_logs')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating email log: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find email logs by user ID with filtering
   */
  static async findByUserId(userId, options = {}) {
    const supabase = getSupabase();
    const {
      limit = 50,
      offset = 0,
      status,
      startDate,
      endDate
    } = options;

    let query = supabase
      .from('email_logs')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (startDate) {
      query = query.gte('sent_at', startDate);
    }

    if (endDate) {
      query = query.lte('sent_at', endDate);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Error finding email logs: ${error.message}`);
    }

    return {
      logs: data.map(item => this._toModel(item)),
      count: data.length,
      total: count
    };
  }

  /**
   * Find log by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('email_logs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding email log: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get email statistics for a user
   */
  static async getStatistics(userId, days = 30) {
    const supabase = getSupabase();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('email_logs')
      .select('status')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString());

    if (error) {
      throw new Error(`Error getting statistics: ${error.message}`);
    }

    const stats = {
      total: data.length,
      sent: data.filter(log => log.status === 'sent').length,
      failed: data.filter(log => log.status === 'failed').length,
      queued: data.filter(log => log.status === 'queued').length,
      period: `Last ${days} days`
    };

    return stats;
  }
}

module.exports = EmailLog;
