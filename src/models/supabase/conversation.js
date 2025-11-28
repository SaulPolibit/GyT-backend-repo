/**
 * Conversation Supabase Model
 * Handles conversations for chat system
 */

const { getSupabase } = require('../../config/database');

class Conversation {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      title: 'title',
      type: 'type',
      createdBy: 'created_by',
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
      title: dbData.title,
      type: dbData.type,
      createdBy: dbData.created_by,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new conversation
   */
  static async create(conversationData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(conversationData);

    const { data, error } = await supabase
      .from('conversations')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating conversation: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find conversation by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding conversation: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find conversations by user ID (where user is a participant)
   */
  static async findByUserId(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        conversation_participants!inner(user_id)
      `)
      .eq('conversation_participants.user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding conversations: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Update conversation by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('conversations')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating conversation: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete conversation by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting conversation: ${error.message}`);
    }

    return this._toModel(data);
  }
}

module.exports = Conversation;
