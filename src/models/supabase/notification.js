// models/supabase/notification.js
const { getSupabase } = require('../../config/database');

// Valid notification types (must match database ENUM)
const NOTIFICATION_TYPES = [
  'capital_call_notice',
  'distribution_notice',
  'quarterly_report',
  'k1_tax_form',
  'document_upload',
  'general_announcement',
  'urgent_capital_call',
  'payment_confirmation',
  'security_alert',
  'investor_activity',
  'system_update',
  'mfa_enabled',
  'mfa_disabled',
  'profile_updated',
  'stripe_onboarding',
  'stripe_payout',
  'approval_required',
  'approval_completed',
  'new_investment',
  'investment_update'
];

// Valid channels (must match database ENUM)
const NOTIFICATION_CHANNELS = ['email', 'sms', 'portal'];

// Valid statuses (must match database ENUM)
const NOTIFICATION_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed', 'cancelled'];

// Valid priorities (must match database ENUM)
const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

class Notification {
  /**
   * Create a notification
   * @param {Object} notificationData - Notification data
   * @returns {Promise<Object>} Created notification
   */
  static async create(notificationData) {
    const supabase = getSupabase();

    const dbData = this._toDbFields(notificationData);

    const { data, error } = await supabase
      .from('notifications')
      .insert([dbData])
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Create multiple notifications (bulk insert)
   * @param {Array<Object>} notificationsData - Array of notification data
   * @returns {Promise<Array<Object>>} Created notifications
   */
  static async createMany(notificationsData) {
    const supabase = getSupabase();

    const dbDataArray = notificationsData.map(data => this._toDbFields(data));

    const { data, error } = await supabase
      .from('notifications')
      .insert(dbDataArray)
      .select();

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Find notification by ID
   * @param {string} id - Notification ID
   * @returns {Promise<Object|null>} Notification or null
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notifications')
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
   * Find notifications by user ID
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array<Object>>} Notifications
   */
  static async findByUserId(userId, options = {}) {
    const supabase = getSupabase();

    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId);

    // Filter by status
    if (options.status) {
      query = query.eq('status', options.status);
    }

    // Filter by channel
    if (options.channel) {
      query = query.eq('channel', options.channel);
    }

    // Filter by notification type
    if (options.notificationType) {
      query = query.eq('notification_type', options.notificationType);
    }

    // Filter unread only
    if (options.unreadOnly) {
      query = query.is('read_at', null);
    }

    // Exclude expired
    if (options.excludeExpired !== false) {
      query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    }

    // Ordering
    query = query.order(options.orderBy || 'created_at', {
      ascending: options.ascending || false
    });

    // Pagination
    if (options.limit) {
      query = query.limit(options.limit);
    }
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Find unread notifications for a user
   * @param {string} userId - User ID
   * @param {number} limit - Max number to return
   * @returns {Promise<Array<Object>>} Unread notifications
   */
  static async findUnreadByUserId(userId, limit = 50) {
    return this.findByUserId(userId, {
      unreadOnly: true,
      limit
    });
  }

  /**
   * Get unread count for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Unread count
   */
  static async getUnreadCount(userId) {
    const supabase = getSupabase();

    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (error) throw error;

    return count || 0;
  }

  /**
   * Find notifications by criteria
   * @param {Object} criteria - Search criteria
   * @param {Object} options - Query options
   * @returns {Promise<Array<Object>>} Notifications
   */
  static async find(criteria, options = {}) {
    const supabase = getSupabase();

    let query = supabase.from('notifications').select('*');

    const dbCriteria = this._toDbFields(criteria);

    Object.entries(dbCriteria).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    });

    // Ordering
    query = query.order(options.orderBy || 'created_at', {
      ascending: options.ascending || false
    });

    // Pagination
    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Update notification by ID
   * @param {string} id - Notification ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>} Updated notification
   */
  static async findByIdAndUpdate(id, updates) {
    const supabase = getSupabase();

    const dbUpdates = this._toDbFields(updates);

    const { data, error } = await supabase
      .from('notifications')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Mark notification as read
   * @param {string} id - Notification ID
   * @param {string} userId - User ID (for validation)
   * @returns {Promise<Object>} Updated notification
   */
  static async markAsRead(id, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .update({
        status: 'read',
        read_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Mark all notifications as read for a user
   * @param {string} userId - User ID
   * @returns {Promise<number>} Number of notifications marked as read
   */
  static async markAllAsRead(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .update({
        status: 'read',
        read_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .is('read_at', null)
      .select();

    if (error) throw error;

    return data.length;
  }

  /**
   * Mark notification as sent
   * @param {string} id - Notification ID
   * @returns {Promise<Object>} Updated notification
   */
  static async markAsSent(id) {
    return this.findByIdAndUpdate(id, {
      status: 'sent',
      sentAt: new Date().toISOString()
    });
  }

  /**
   * Mark notification as delivered
   * @param {string} id - Notification ID
   * @returns {Promise<Object>} Updated notification
   */
  static async markAsDelivered(id) {
    return this.findByIdAndUpdate(id, {
      status: 'delivered',
      deliveredAt: new Date().toISOString()
    });
  }

  /**
   * Mark notification as failed
   * @param {string} id - Notification ID
   * @param {string} errorMessage - Error message
   * @returns {Promise<Object>} Updated notification
   */
  static async markAsFailed(id, errorMessage) {
    const supabase = getSupabase();

    // First get the current notification to check retry count
    const notification = await this.findById(id);

    if (!notification) {
      throw new Error('Notification not found');
    }

    const updates = {
      status: 'failed',
      failed_at: new Date().toISOString(),
      error_message: errorMessage,
      retry_count: (notification.retryCount || 0) + 1
    };

    // Schedule retry if under max retries
    if (updates.retry_count < (notification.maxRetries || 3)) {
      // Exponential backoff: 5min, 15min, 45min
      const retryDelayMinutes = 5 * Math.pow(3, updates.retry_count - 1);
      const nextRetry = new Date();
      nextRetry.setMinutes(nextRetry.getMinutes() + retryDelayMinutes);
      updates.next_retry_at = nextRetry.toISOString();
      updates.status = 'pending'; // Reset to pending for retry
    }

    const { data, error } = await supabase
      .from('notifications')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Get pending notifications for retry
   * @returns {Promise<Array<Object>>} Pending notifications ready for retry
   */
  static async getPendingForRetry() {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .in('status', ['pending', 'failed'])
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(100);

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Delete notification by ID
   * @param {string} id - Notification ID
   * @returns {Promise<Object>} Deleted notification
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Delete old read notifications
   * @param {number} daysOld - Delete notifications older than this many days
   * @returns {Promise<number>} Number of deleted notifications
   */
  static async deleteOldRead(daysOld = 30) {
    const supabase = getSupabase();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .eq('status', 'read')
      .lt('read_at', cutoffDate.toISOString())
      .select();

    if (error) throw error;

    return data.length;
  }

  /**
   * Delete expired notifications
   * @returns {Promise<number>} Number of deleted notifications
   */
  static async deleteExpired() {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .not('status', 'in', '("read", "delivered")')
      .select();

    if (error) throw error;

    return data.length;
  }

  /**
   * Convert database fields to model fields
   * @param {Object} dbNotification - Notification from database
   * @returns {Object} Notification model
   * @private
   */
  static _toModel(dbNotification) {
    if (!dbNotification) return null;

    const model = {
      id: dbNotification.id,
      userId: dbNotification.user_id,
      notificationType: dbNotification.notification_type,
      channel: dbNotification.channel,
      title: dbNotification.title,
      message: dbNotification.message,
      status: dbNotification.status,
      priority: dbNotification.priority,
      relatedEntityType: dbNotification.related_entity_type,
      relatedEntityId: dbNotification.related_entity_id,
      metadata: dbNotification.metadata,
      actionUrl: dbNotification.action_url,
      senderId: dbNotification.sender_id,
      senderName: dbNotification.sender_name,
      emailSubject: dbNotification.email_subject,
      emailTemplate: dbNotification.email_template,
      smsPhoneNumber: dbNotification.sms_phone_number,
      createdAt: dbNotification.created_at,
      updatedAt: dbNotification.updated_at,
      sentAt: dbNotification.sent_at,
      deliveredAt: dbNotification.delivered_at,
      readAt: dbNotification.read_at,
      failedAt: dbNotification.failed_at,
      errorMessage: dbNotification.error_message,
      retryCount: dbNotification.retry_count,
      maxRetries: dbNotification.max_retries,
      nextRetryAt: dbNotification.next_retry_at,
      expiresAt: dbNotification.expires_at,

      // Instance method to check if read
      isRead() {
        return this.readAt !== null;
      },

      // Instance method to check if expired
      isExpired() {
        return this.expiresAt && new Date(this.expiresAt) < new Date();
      },

      // Instance method to mark as read
      async markAsRead() {
        return Notification.markAsRead(this.id, this.userId);
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
      notificationType: 'notification_type',
      relatedEntityType: 'related_entity_type',
      relatedEntityId: 'related_entity_id',
      actionUrl: 'action_url',
      senderId: 'sender_id',
      senderName: 'sender_name',
      emailSubject: 'email_subject',
      emailTemplate: 'email_template',
      smsPhoneNumber: 'sms_phone_number',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      sentAt: 'sent_at',
      deliveredAt: 'delivered_at',
      readAt: 'read_at',
      failedAt: 'failed_at',
      errorMessage: 'error_message',
      retryCount: 'retry_count',
      maxRetries: 'max_retries',
      nextRetryAt: 'next_retry_at',
      expiresAt: 'expires_at'
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

// Export constants for external use
Notification.TYPES = NOTIFICATION_TYPES;
Notification.CHANNELS = NOTIFICATION_CHANNELS;
Notification.STATUSES = NOTIFICATION_STATUSES;
Notification.PRIORITIES = NOTIFICATION_PRIORITIES;

module.exports = Notification;
