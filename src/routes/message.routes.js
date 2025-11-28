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
const {
  emitNewMessage,
  emitMessageRead,
  emitMessageDeleted
} = require('../config/socket');

const router = express.Router();

/**
 * @route   GET /api/conversations/:conversationId/messages
 * @desc    Get messages for a conversation with pagination
 * @access  Private (requires authentication)
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

  // Emit Socket.IO event to notify other participants
  emitNewMessage(conversationId, message);

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

  // Emit Socket.IO event to notify other participants
  emitNewMessage(conversationId, enrichedMessage);

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

  // Emit Socket.IO event to notify other participants
  emitMessageRead(message.conversationId, messageId, userId);

  res.status(200).json({
    success: true,
    message: 'Message marked as read'
  });
}));

/**
 * @route   DELETE /api/messages/:messageId
 * @desc    Delete a message (soft delete)
 * @access  Private (requires authentication)
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

  // Emit Socket.IO event to notify other participants
  emitMessageDeleted(message.conversationId, messageId);

  res.status(200).json({
    success: true,
    message: 'Message deleted successfully'
  });
}));

/**
 * @route   GET /api/messages/health
 * @desc    Health check for Message API routes
 * @access  Public
 */
router.get('/messages/health', (_req, res) => {
  res.json({
    service: 'Message API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
