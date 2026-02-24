/**
 * Message API Routes
 * Endpoints for managing messages in conversations
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { handleChatAttachmentUpload } = require('../middleware/upload');
const { uploadToSupabase } = require('../utils/fileUpload');
const {
  Message,
  MessageRead,
  MessageAttachment,
  Conversation,
  ConversationParticipant
} = require('../models/supabase');
const { getSupabase, getSupabaseRealtime } = require('../config/database');

const router = express.Router();

const { ROLES } = require('../models/supabase/user');

/**
 * Broadcast a new message to all connected clients via Supabase Realtime
 */
async function broadcastNewMessage(message) {
  try {
    // Use the Realtime-specific client (ANON_KEY) for WebSocket connections
    const supabase = getSupabaseRealtime();

    // Use the same channel name as the frontend
    const channelName = 'messages:broadcast';
    console.log('[Realtime] Creating channel:', channelName);

    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { ack: true }, // Wait for server acknowledgment
      },
    });

    // Subscribe first, then send
    channel.subscribe(async (status) => {
      console.log('[Realtime] Backend channel status:', status);

      if (status === 'SUBSCRIBED') {
        const payload = {
          id: message.id,
          conversation_id: message.conversationId,
          sender_id: message.senderId,
          content: message.content,
          type: message.type,
          created_at: message.createdAt,
        };

        console.log('[Realtime] Sending broadcast with payload:', JSON.stringify(payload));

        try {
          const result = await channel.send({
            type: 'broadcast',
            event: 'new_message',
            payload
          });

          console.log('[Realtime] Broadcast result:', result);
          console.log('[Realtime] Broadcast sent successfully for message:', message.id);
        } catch (sendError) {
          console.error('[Realtime] Error sending broadcast:', sendError);
        }

        // Clean up after a short delay
        setTimeout(() => {
          console.log('[Realtime] Cleaning up channel');
          supabase.removeChannel(channel);
        }, 2000);
      } else if (status === 'CHANNEL_ERROR') {
        console.error('[Realtime] Channel error');
      } else if (status === 'TIMED_OUT') {
        console.error('[Realtime] Channel timed out');
      }
    });
  } catch (error) {
    console.error('[Realtime] Error in broadcastNewMessage:', error);
  }
}

/**
 * @route   GET /api/conversations/:conversationId/messages
 * @desc    Get messages for a conversation with pagination
 * @access  Private (requires authentication)
 *
 * @param {string} conversationId - UUID of the conversation (URL parameter)
 *
 * @query {number} [limit=50] - Maximum number of messages to return (optional)
 * @query {string} [before] - Message ID to fetch messages before (for pagination, optional)
 *
 * @success {200} Success Response
 * {
 *   "success": true,
 *   "count": 25,
 *   "data": [
 *     {
 *       "id": "msg-uuid",
 *       "conversationId": "conv-uuid",
 *       "senderId": "user-uuid",
 *       "content": "Hello!",
 *       "type": "text",
 *       "createdAt": "2025-12-05T10:30:00Z",
 *       "updatedAt": "2025-12-05T10:30:00Z",
 *       "deletedAt": null,
 *       "attachments": []
 *     }
 *   ],
 *   "hasMore": true
 * }
 *
 * @error {400} Bad Request - Invalid conversation ID format
 * {
 *   "success": false,
 *   "message": "Invalid conversation ID format"
 * }
 *
 * @error {403} Forbidden - Not a participant
 * {
 *   "success": false,
 *   "message": "You are not a participant in this conversation"
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 */
router.get('/:conversationId/messages', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { conversationId } = req.params;
  const { limit, before } = req.query;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(conversationId), 'Invalid conversation ID format');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(conversationId, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  // Get messages with pagination
  const result = await Message.findByConversationId(conversationId, {
    limit: limit ? parseInt(limit) : 50,
    before: before
  });

  res.status(200).json({
    success: true,
    count: result.messages.length,
    data: result.messages,
    hasMore: result.hasMore
  });
}));

/**
 * @route   POST /api/conversations/:conversationId/messages
 * @desc    Send a message (text or file) to a conversation
 * @access  Private (requires authentication)
 *
 * @param {string} conversationId - UUID of the conversation (URL parameter)
 *
 * @body For text messages (application/json):
 * {
 *   "content": "Hello, how are you?",
 *   "type": "text"  // Optional: "text" or "system", defaults to "text"
 * }
 *
 * @body For file messages (multipart/form-data):
 * {
 *   "file": <binary file data>,
 *   "content": "Optional message caption"  // Optional
 * }
 *
 * @success {201} Success Response (text message)
 * {
 *   "success": true,
 *   "message": "Message sent successfully",
 *   "data": {
 *     "id": "msg-uuid",
 *     "conversationId": "conv-uuid",
 *     "senderId": "user-uuid",
 *     "content": "Hello, how are you?",
 *     "type": "text",
 *     "createdAt": "2025-12-05T10:30:00Z",
 *     "updatedAt": "2025-12-05T10:30:00Z",
 *     "deletedAt": null,
 *     "attachments": []
 *   }
 * }
 *
 * @success {201} Success Response (file message)
 * {
 *   "success": true,
 *   "message": "Message sent successfully",
 *   "data": {
 *     "id": "msg-uuid",
 *     "conversationId": "conv-uuid",
 *     "senderId": "user-uuid",
 *     "content": "Sent a file",
 *     "type": "file",
 *     "createdAt": "2025-12-05T10:30:00Z",
 *     "updatedAt": "2025-12-05T10:30:00Z",
 *     "deletedAt": null,
 *     "attachments": [
 *       {
 *         "id": "attachment-uuid",
 *         "messageId": "msg-uuid",
 *         "filePath": "https://storage.url/file.pdf",
 *         "fileName": "document.pdf",
 *         "fileSize": 1024567,
 *         "mimeType": "application/pdf"
 *       }
 *     ]
 *   }
 * }
 *
 * @error {400} Bad Request - Invalid conversation ID or missing content
 * {
 *   "success": false,
 *   "message": "Invalid conversation ID format" // or "Message content is required"
 * }
 *
 * @error {403} Forbidden - Not a participant
 * {
 *   "success": false,
 *   "message": "You are not a participant in this conversation"
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 */
router.post('/:conversationId/messages', authenticate, handleChatAttachmentUpload, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { conversationId } = req.params;
  const { content, type } = req.body;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(conversationId), 'Invalid conversation ID format');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(conversationId, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  let message;

  // Check if this is a file message
  if (req.file) {
    // File message
    // Upload file to Supabase Storage
    const folder = `chat-attachments/${conversationId}`;
    const uploadResult = await uploadToSupabase(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder
    );

    // Create message
    message = await Message.create({
      conversationId,
      senderId: userId,
      content: content || 'Sent a file',
      type: 'file'
    });

    // Create attachment record
    await MessageAttachment.create({
      messageId: message.id,
      filePath: uploadResult.publicUrl,
      fileName: req.file.originalname,
      fileSize: uploadResult.size,
      mimeType: req.file.mimetype
    });

    // Refetch message with attachments
    message = await Message.findById(message.id);
  } else {
    // Text message
    validate(content, 'Message content is required');
    validate(['text', 'system'].includes(type || 'text'), 'Invalid message type');

    message = await Message.create({
      conversationId,
      senderId: userId,
      content: content.trim(),
      type: type || 'text'
    });
  }

  // Automatically mark as read by sender
  await MessageRead.markAsRead(message.id, userId);

  // Update conversation updated_at
  await Conversation.findByIdAndUpdate(conversationId, {
    updatedAt: new Date().toISOString()
  });

  // Broadcast message to all connected clients
  broadcastNewMessage(message);

  res.status(201).json({
    success: true,
    message: 'Message sent successfully',
    data: message
  });
}));

/**
 * @route   POST /api/conversations/:conversationId/messages/file
 * @desc    Send a message with file attachment
 * @access  Private (requires authentication)
 *
 * @param {string} conversationId - UUID of the conversation (URL parameter)
 *
 * @body (multipart/form-data):
 * {
 *   "file": <binary file data> (required),
 *   "content": "Optional message caption"  // Optional, defaults to "Sent a file"
 * }
 *
 * @success {201} Success Response
 * {
 *   "success": true,
 *   "message": "Message sent successfully",
 *   "data": {
 *     "id": "msg-uuid",
 *     "conversationId": "conv-uuid",
 *     "senderId": "user-uuid",
 *     "content": "Sent a file",
 *     "type": "file",
 *     "createdAt": "2025-12-05T10:30:00Z",
 *     "updatedAt": "2025-12-05T10:30:00Z",
 *     "deletedAt": null,
 *     "attachments": [
 *       {
 *         "id": "attachment-uuid",
 *         "messageId": "msg-uuid",
 *         "filePath": "https://storage.url/chat-attachments/conv-uuid/file.pdf",
 *         "fileName": "document.pdf",
 *         "fileSize": 1024567,
 *         "mimeType": "application/pdf"
 *       }
 *     ]
 *   }
 * }
 *
 * @error {400} Bad Request - Invalid conversation ID or missing file
 * {
 *   "success": false,
 *   "message": "File is required" // or "Invalid conversation ID format"
 * }
 *
 * @error {403} Forbidden - Not a participant
 * {
 *   "success": false,
 *   "message": "You are not a participant in this conversation"
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 */
router.post('/:conversationId/messages/file', authenticate, handleChatAttachmentUpload, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { conversationId } = req.params;
  const { content } = req.body;

  // Validate file upload
  validate(req.file, 'File is required');

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(conversationId), 'Invalid conversation ID format');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(conversationId, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  // Upload file to Supabase Storage
  const folder = `chat-attachments/${conversationId}`;
  const uploadResult = await uploadToSupabase(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    folder
  );

  // Create message
  const message = await Message.create({
    conversationId,
    senderId: userId,
    content: content || 'Sent a file',
    type: 'file'
  });

  // Create attachment record
  await MessageAttachment.create({
    messageId: message.id,
    filePath: uploadResult.publicUrl,
    fileName: req.file.originalname,
    fileSize: uploadResult.size,
    mimeType: req.file.mimetype
  });

  // Automatically mark as read by sender
  await MessageRead.markAsRead(message.id, userId);

  // Update conversation updated_at
  await Conversation.findByIdAndUpdate(conversationId, {
    updatedAt: new Date().toISOString()
  });

  // Refetch message with attachments
  const enrichedMessage = await Message.findById(message.id);

  // Broadcast message to all connected clients
  broadcastNewMessage(enrichedMessage);

  res.status(201).json({
    success: true,
    message: 'Message sent successfully',
    data: enrichedMessage
  });
}));

/**
 * @route   GET /api/conversations/:conversationId/messages/search
 * @desc    Search messages in a conversation
 * @access  Private (requires authentication)
 *
 * @param {string} conversationId - UUID of the conversation (URL parameter)
 *
 * @query {string} q - Search query (required, minimum 2 characters)
 *
 * @success {200} Success Response
 * {
 *   "success": true,
 *   "count": 5,
 *   "data": [
 *     {
 *       "id": "msg-uuid",
 *       "conversationId": "conv-uuid",
 *       "senderId": "user-uuid",
 *       "content": "Hello, how are you?",
 *       "type": "text",
 *       "createdAt": "2025-12-05T10:30:00Z",
 *       "updatedAt": "2025-12-05T10:30:00Z",
 *       "deletedAt": null,
 *       "attachments": []
 *     }
 *   ]
 * }
 *
 * @error {400} Bad Request - Invalid conversation ID or search query
 * {
 *   "success": false,
 *   "message": "Search query is required" // or "Search query must be at least 2 characters"
 * }
 *
 * @error {403} Forbidden - Not a participant
 * {
 *   "success": false,
 *   "message": "You are not a participant in this conversation"
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 */
router.get('/:conversationId/messages/search', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { conversationId } = req.params;
  const { q } = req.query;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(conversationId), 'Invalid conversation ID format');

  // Validate search query
  validate(q, 'Search query is required');
  validate(q.length >= 2, 'Search query must be at least 2 characters');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(conversationId, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  // Search messages
  const messages = await Message.search(conversationId, q);

  res.status(200).json({
    success: true,
    count: messages.length,
    data: messages
  });
}));

/**
 * @route   PUT /api/messages/:messageId/read
 * @desc    Mark a message as read
 * @access  Private (requires authentication)
 *
 * @param {string} messageId - UUID of the message to mark as read (URL parameter)
 *
 * @body No request body required
 *
 * @success {200} Success Response
 * {
 *   "success": true,
 *   "message": "Message marked as read"
 * }
 *
 * @error {400} Bad Request - Invalid message ID format
 * {
 *   "success": false,
 *   "message": "Invalid message ID format"
 * }
 *
 * @error {404} Not Found - Message not found
 * {
 *   "success": false,
 *   "message": "Message not found"
 * }
 *
 * @error {403} Forbidden - Not a participant in conversation
 * {
 *   "success": false,
 *   "message": "You are not a participant in this conversation"
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 */
router.put('/messages/:messageId/read', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { messageId } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(messageId), 'Invalid message ID format');

  // Get message to verify conversation access
  const message = await Message.findById(messageId);
  validate(message, 'Message not found');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(message.conversationId, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  // Mark as read
  await MessageRead.markAsRead(messageId, userId);

  // TODO: Emit Socket.IO event to notify other participants when Socket.IO is implemented
  // emitMessageRead(message.conversationId, messageId, userId);

  res.status(200).json({
    success: true,
    message: 'Message marked as read'
  });
}));

/**
 * @route   DELETE /api/messages/:messageId
 * @desc    Delete a message (soft delete)
 * @access  Private (requires authentication)
 *
 * @param {string} messageId - UUID of the message to delete (URL parameter)
 *
 * @body No request body required
 *
 * @note Only the message sender or conversation admin can delete messages
 *
 * @success {200} Success Response
 * {
 *   "success": true,
 *   "message": "Message deleted successfully"
 * }
 *
 * @error {400} Bad Request - Invalid message ID format
 * {
 *   "success": false,
 *   "message": "Invalid message ID format"
 * }
 *
 * @error {404} Not Found - Message not found
 * {
 *   "success": false,
 *   "message": "Message not found"
 * }
 *
 * @error {403} Forbidden - Not a participant or not authorized to delete
 * {
 *   "success": false,
 *   "message": "You are not a participant in this conversation"
 *   // or "You can only delete your own messages or you must be an admin"
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 */
router.delete('/messages/:messageId', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { messageId } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(messageId), 'Invalid message ID format');

  // Get message
  const message = await Message.findById(messageId);
  validate(message, 'Message not found');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(message.conversationId, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  // Only sender or admin can delete
  const participant = await ConversationParticipant.findByConversationId(message.conversationId);
  const userParticipant = participant.find(p => p.userId === userId);

  const canDelete = message.senderId === userId || (userParticipant && userParticipant.role === 'admin');
  validate(canDelete, 'You can only delete your own messages or you must be an admin');

  // Soft delete message
  await Message.softDelete(messageId);

  // TODO: Emit Socket.IO event to notify other participants when Socket.IO is implemented
  // emitMessageDeleted(message.conversationId, messageId);

  res.status(200).json({
    success: true,
    message: 'Message deleted successfully'
  });
}));

/**
 * @route   GET /api/messages/available-users
 * @desc    Get users available to send messages (Admin and Support roles)
 * @access  Private (requires authentication)
 *
 * @body No request body required
 *
 * @success {200} Success Response
 * {
 *   "success": true,
 *   "count": 5,
 *   "data": [
 *     {
 *       "id": "user-uuid",
 *       "firstName": "John",
 *       "lastName": "Doe",
 *       "email": "john.doe@example.com",
 *       "profileImage": "https://storage.url/profile.jpg",
 *       "role": 1,
 *       "roleName": "admin"
 *     },
 *     {
 *       "id": "user-uuid-2",
 *       "firstName": "Jane",
 *       "lastName": "Smith",
 *       "email": "jane.smith@example.com",
 *       "profileImage": null,
 *       "role": 2,
 *       "roleName": "support"
 *     }
 *   ]
 * }
 *
 * @error {401} Unauthorized - No authentication token
 * {
 *   "success": false,
 *   "message": "Authentication required"
 * }
 */
router.get('/messages/available-users', authenticate, catchAsync(async (req, res) => {
  // Get all users with role 1 (ADMIN) or 2 (SUPPORT)
  const supabase = require('../config/database').getSupabase();

  const { data: users, error } = await supabase
    .from('users')
    .select('id, first_name, last_name, email, profile_image, role')
    .in('role', [ROLES.ADMIN, ROLES.SUPPORT])
    .eq('is_active', true)
    .order('first_name', { ascending: true });

  if (error) {
    throw new Error(`Error fetching users: ${error.message}`);
  }

  // Format response with only necessary fields
  const formattedUsers = users.map(user => ({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    profileImage: user.profile_image,
    role: user.role,
    roleName: user.role === ROLES.ADMIN ? 'admin' : 'support'
  }));

  res.status(200).json({
    success: true,
    count: formattedUsers.length,
    data: formattedUsers
  });
}));

/**
 * @route   GET /api/messages/health
 * @desc    Health check for Message API routes
 * @access  Public (no authentication required)
 *
 * @body No request body required
 *
 * @success {200} Success Response
 * {
 *   "service": "Message API",
 *   "status": "operational",
 *   "timestamp": "2025-12-05T10:30:00.000Z"
 * }
 */
router.get('/messages/health', (_req, res) => {
  res.json({
    service: 'Message API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
