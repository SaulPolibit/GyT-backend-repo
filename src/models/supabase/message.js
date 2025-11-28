/**
 * Message Supabase Model
 * Handles messages in conversations
 */

const { getSupabase } = require('../../config/database');

class Message {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      conversationId: 'conversation_id',
      senderId: 'sender_id',
      content: 'content',
      type: 'type',
      createdAt: 'created_at',
      editedAt: 'edited_at',
      deletedAt: 'deleted_at'
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
      senderId: dbData.sender_id,
      content: dbData.content,
      type: dbData.type,
      createdAt: dbData.created_at,
      editedAt: dbData.edited_at,
      deletedAt: dbData.deleted_at
    };
  }

  /**
   * Enrich messages with sender and attachment information
   */
  static async _enrichWithDetails(messages) {
    if (!messages) return messages;

    const isArray = Array.isArray(messages);
    const msgs = isArray ? messages : [messages];
    const validMsgs = msgs.filter(msg => msg !== null && msg !== undefined);

    if (validMsgs.length === 0) return messages;

    const supabase = getSupabase();

    // Collect unique sender IDs
    const senderIds = new Set();
    validMsgs.forEach(msg => {
      if (msg.senderId) senderIds.add(msg.senderId);
    });

    // Fetch all senders at once
    const { data: senders, error: senderError } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .in('id', Array.from(senderIds));

    if (senderError) {
      console.error('Error fetching senders:', senderError.message);
    }

    const senderMap = new Map(senders ? senders.map(u => [u.id, u]) : []);

    // Fetch attachments for all messages
    const messageIds = validMsgs.map(msg => msg.id);
    const { data: attachments, error: attachmentError } = await supabase
      .from('message_attachments')
      .select('*')
      .in('message_id', messageIds);

    if (attachmentError) {
      console.error('Error fetching attachments:', attachmentError.message);
    }

    const attachmentMap = new Map();
    if (attachments) {
      attachments.forEach(att => {
        if (!attachmentMap.has(att.message_id)) {
          attachmentMap.set(att.message_id, []);
        }
        attachmentMap.get(att.message_id).push({
          id: att.id,
          fileName: att.file_name,
          fileSize: att.file_size,
          filePath: att.file_path,
          mimeType: att.mime_type,
          createdAt: att.created_at
        });
      });
    }

    // Fetch read status for all messages
    const { data: reads, error: readsError } = await supabase
      .from('message_reads')
      .select('message_id, user_id')
      .in('message_id', messageIds);

    if (readsError) {
      console.error('Error fetching read status:', readsError.message);
    }

    const readsMap = new Map();
    if (reads) {
      reads.forEach(read => {
        if (!readsMap.has(read.message_id)) {
          readsMap.set(read.message_id, []);
        }
        readsMap.get(read.message_id).push(read.user_id);
      });
    }

    // Enrich messages
    validMsgs.forEach(msg => {
      // Add sender info
      if (msg.senderId && senderMap.has(msg.senderId)) {
        const sender = senderMap.get(msg.senderId);
        msg.senderName = `${sender.first_name || ''} ${sender.last_name || ''}`.trim();
        msg.senderEmail = sender.email;
      }

      // Add attachments
      msg.attachments = attachmentMap.get(msg.id) || [];

      // Add read by
      msg.readBy = readsMap.get(msg.id) || [];
    });

    return isArray ? msgs : msgs[0];
  }

  /**
   * Create a new message
   */
  static async create(messageData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(messageData);

    const { data, error } = await supabase
      .from('messages')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating message: ${error.message}`);
    }

    const message = this._toModel(data);
    return await this._enrichWithDetails(message);
  }

  /**
   * Find message by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding message: ${error.message}`);
    }

    const message = this._toModel(data);
    return await this._enrichWithDetails(message);
  }

  /**
   * Find messages by conversation ID with pagination
   */
  static async findByConversationId(conversationId, options = {}) {
    const supabase = getSupabase();
    const limit = options.limit || 50;
    const before = options.before; // Message ID to fetch before

    let query = supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit + 1); // Fetch one extra to check if there's more

    if (before) {
      // Get the timestamp of the 'before' message
      const { data: beforeMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('id', before)
        .single();

      if (beforeMsg) {
        query = query.lt('created_at', beforeMsg.created_at);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding messages: ${error.message}`);
    }

    const hasMore = data.length > limit;
    const messages = data.slice(0, limit).map(item => this._toModel(item));
    const enrichedMessages = await this._enrichWithDetails(messages);

    return {
      messages: enrichedMessages,
      hasMore
    };
  }

  /**
   * Search messages in a conversation
   */
  static async search(conversationId, searchTerm) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .ilike('content', `%${searchTerm}%`)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Error searching messages: ${error.message}`);
    }

    const messages = data.map(item => this._toModel(item));
    return await this._enrichWithDetails(messages);
  }

  /**
   * Update message by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);
    dbData.edited_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('messages')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating message: ${error.message}`);
    }

    const message = this._toModel(data);
    return await this._enrichWithDetails(message);
  }

  /**
   * Soft delete message by ID
   */
  static async softDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting message: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get last message for a conversation
   */
  static async getLastMessage(conversationId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error getting last message: ${error.message}`);
    }

    const message = this._toModel(data);
    return await this._enrichWithDetails(message);
  }
}

module.exports = Message;
