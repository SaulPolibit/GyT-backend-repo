/**
 * MessageRead Supabase Model
 * Handles read status of messages
 */

const { getSupabase } = require('../../config/database');

class MessageRead {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      messageId: 'message_id',
      userId: 'user_id',
      readAt: 'read_at'
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
      messageId: dbData.message_id,
      userId: dbData.user_id,
      readAt: dbData.read_at
    };
  }

  /**
   * Mark message as read by user (idempotent)
   */
  static async markAsRead(messageId, userId) {
    const supabase = getSupabase();

    // Use upsert to make it idempotent
    const { data, error } = await supabase
      .from('message_reads')
      .upsert([{
        message_id: messageId,
        user_id: userId,
        read_at: new Date().toISOString()
      }], {
        onConflict: 'message_id,user_id',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error marking message as read: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Check if message was read by user
   */
  static async isRead(messageId, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('message_reads')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false; // Not found
      throw new Error(`Error checking read status: ${error.message}`);
    }

    return !!data;
  }

  /**
   * Get all users who read a message
   */
  static async getReadBy(messageId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('message_reads')
      .select('user_id')
      .eq('message_id', messageId);

    if (error) {
      throw new Error(`Error getting read status: ${error.message}`);
    }

    return data.map(item => item.user_id);
  }
}

module.exports = MessageRead;
