/**
 * MessageAttachment Supabase Model
 * Handles file attachments for messages
 */

const { getSupabase } = require('../../config/database');

class MessageAttachment {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      messageId: 'message_id',
      filePath: 'file_path',
      fileName: 'file_name',
      fileSize: 'file_size',
      mimeType: 'mime_type',
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
      messageId: dbData.message_id,
      filePath: dbData.file_path,
      fileName: dbData.file_name,
      fileSize: dbData.file_size,
      mimeType: dbData.mime_type,
      createdAt: dbData.created_at
    };
  }

  /**
   * Create a new message attachment
   */
  static async create(attachmentData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(attachmentData);

    const { data, error } = await supabase
      .from('message_attachments')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating message attachment: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find attachments by message ID
   */
  static async findByMessageId(messageId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('message_attachments')
      .select('*')
      .eq('message_id', messageId);

    if (error) {
      throw new Error(`Error finding attachments: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Delete attachment by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('message_attachments')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting attachment: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete all attachments for a message
   */
  static async deleteByMessageId(messageId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('message_attachments')
      .delete()
      .eq('message_id', messageId)
      .select();

    if (error) {
      throw new Error(`Error deleting attachments: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }
}

module.exports = MessageAttachment;
