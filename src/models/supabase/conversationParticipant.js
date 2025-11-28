/**
 * ConversationParticipant Supabase Model
 * Handles participants in conversations
 */

const { getSupabase } = require('../../config/database');

class ConversationParticipant {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      conversationId: 'conversation_id',
      userId: 'user_id',
      role: 'role',
      joinedAt: 'joined_at',
      lastReadAt: 'last_read_at'
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
      conversationId: dbData.conversation_id,
      userId: dbData.user_id,
      role: dbData.role,
      joinedAt: dbData.joined_at,
      lastReadAt: dbData.last_read_at
    };
  }

  /**
   * Create a new conversation participant
   */
  static async create(participantData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(participantData);

    const { data, error } = await supabase
      .from('conversation_participants')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating conversation participant: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Create multiple participants
   */
  static async createMany(participantsData) {
    const supabase = getSupabase();
    const dbData = participantsData.map(p => this._toDbFields(p));

    const { data, error } = await supabase
      .from('conversation_participants')
      .insert(dbData)
      .select();

    if (error) {
      throw new Error(`Error creating conversation participants: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find participants by conversation ID
   */
  static async findByConversationId(conversationId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('conversation_participants')
      .select('*')
      .eq('conversation_id', conversationId);

    if (error) {
      throw new Error(`Error finding participants: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Check if user is participant in conversation
   */
  static async isParticipant(conversationId, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false; // Not found
      throw new Error(`Error checking participant: ${error.message}`);
    }

    return !!data;
  }

  /**
   * Find participant by conversation ID and user ID
   */
  static async findByConversationAndUser(conversationId, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('conversation_participants')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding participant: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Update last read timestamp
   */
  static async updateLastRead(conversationId, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating last read: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get unread count for user in conversation
   */
  static async getUnreadCount(conversationId, userId) {
    const supabase = getSupabase();

    // Get participant's last read timestamp
    const { data: participant, error: participantError } = await supabase
      .from('conversation_participants')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .single();

    if (participantError) {
      throw new Error(`Error getting participant: ${participantError.message}`);
    }

    // Count messages created after last read
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .neq('sender_id', userId) // Don't count own messages
      .is('deleted_at', null);

    if (participant.last_read_at) {
      const query = supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .is('deleted_at', null)
        .gt('created_at', participant.last_read_at);

      const { count: unreadCount, error: countError } = await query;

      if (countError) {
        throw new Error(`Error counting unread messages: ${countError.message}`);
      }

      return unreadCount;
    }

    if (error) {
      throw new Error(`Error counting messages: ${error.message}`);
    }

    return count;
  }
}

module.exports = ConversationParticipant;
