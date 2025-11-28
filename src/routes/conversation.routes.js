/**
 * Conversation API Routes
 * Endpoints for managing conversations in chat system
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { getSupabase } = require('../config/database');
const { emitNewConversation, emitConversationDeleted } = require('../config/socket');
const {
  Conversation,
  ConversationParticipant,
  Message,
  User
} = require('../models/supabase');

const router = express.Router();

/**
 * @route   GET /api/conversations
 * @desc    Get all conversations for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  // Get all conversations where user is a participant
  const conversations = await Conversation.findByUserId(userId);

  // Enrich each conversation with participants, last message, and unread count
  const enrichedConversations = await Promise.all(conversations.map(async (conversation) => {
    // Get participants
    const participants = await ConversationParticipant.findByConversationId(conversation.id);

    // Get participant user details
    const participantDetails = await Promise.all(
      participants.map(async (p) => {
        const user = await User.findById(p.userId);
        return user ? {
          id: user.id,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          email: user.email,
          role: p.role
        } : null;
      })
    );

    // Get last message
    const lastMessage = await Message.getLastMessage(conversation.id);
    const lastMessageData = lastMessage ? {
      content: lastMessage.content,
      timestamp: lastMessage.createdAt,
      senderName: lastMessage.senderName || 'Unknown'
    } : null;

    // Get unread count
    const unreadCount = await ConversationParticipant.getUnreadCount(conversation.id, userId);

    return {
      ...conversation,
      participants: participantDetails.filter(p => p !== null),
      lastMessage: lastMessageData,
      unreadCount
    };
  }));

  res.status(200).json({
    success: true,
    count: enrichedConversations.length,
    data: enrichedConversations
  });
}));

/**
 * @route   GET /api/conversations/:id
 * @desc    Get single conversation by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid conversation ID format');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(id, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  const conversation = await Conversation.findById(id);
  validate(conversation, 'Conversation not found');

  // Get participants
  const participants = await ConversationParticipant.findByConversationId(id);

  // Get participant user details
  const participantDetails = await Promise.all(
    participants.map(async (p) => {
      const user = await User.findById(p.userId);
      return user ? {
        id: user.id,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        email: user.email,
        role: p.role
      } : null;
    })
  );

  res.status(200).json({
    success: true,
    data: {
      ...conversation,
      participants: participantDetails.filter(p => p !== null)
    }
  });
}));

/**
 * @route   POST /api/conversations
 * @desc    Create a new conversation
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { title, participantIds, type } = req.body;

  // Validate required fields
  validate(Array.isArray(participantIds) && participantIds.length > 0, 'At least one participant is required');
  validate(['direct', 'group', 'support'].includes(type || 'direct'), 'Invalid conversation type');

  // Validate participant IDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  participantIds.forEach(id => {
    validate(uuidRegex.test(id), `Invalid participant ID format: ${id}`);
  });

  // Combine all participant IDs including the creator
  const allParticipantIds = [...new Set([userId, ...participantIds])];

  // Validate all participants exist in the users table
  const supabase = getSupabase();
  const { data: existingUsers, error: userCheckError } = await supabase
    .from('users')
    .select('id')
    .in('id', allParticipantIds);

  if (userCheckError) {
    throw new Error(`Error validating participants: ${userCheckError.message}`);
  }

  const existingUserIds = new Set(existingUsers.map(u => u.id));
  const invalidIds = allParticipantIds.filter(id => !existingUserIds.has(id));

  validate(invalidIds.length === 0, `The following user IDs do not exist: ${invalidIds.join(', ')}`);

  // Create conversation
  const conversation = await Conversation.create({
    title: title || 'New Conversation',
    type: type || 'direct',
    createdBy: userId
  });

  // Add creator as admin participant
  const participantsToAdd = [
    {
      conversationId: conversation.id,
      userId: userId,
      role: 'admin'
    }
  ];

  // Add other participants
  participantIds.forEach(participantId => {
    if (participantId !== userId) { // Don't add creator twice
      participantsToAdd.push({
        conversationId: conversation.id,
        userId: participantId,
        role: 'participant'
      });
    }
  });

  await ConversationParticipant.createMany(participantsToAdd);

  // Get participant details for response
  const participantDetails = await Promise.all(
    participantsToAdd.map(async (p) => {
      const user = await User.findById(p.userId);
      return user ? {
        id: user.id,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        email: user.email,
        role: p.role
      } : null;
    })
  );

  // Prepare conversation data with participants
  const conversationData = {
    ...conversation,
    participants: participantDetails.filter(p => p !== null)
  };

  // Emit socket notification to all participants (including creator)
  emitNewConversation(allParticipantIds, conversationData);

  res.status(201).json({
    success: true,
    message: 'Conversation created successfully',
    data: conversationData
  });
}));

/**
 * @route   PUT /api/conversations/:conversationId/read
 * @desc    Mark all messages in conversation as read
 * @access  Private (requires authentication)
 */
router.put('/:conversationId/read', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { conversationId } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(conversationId), 'Invalid conversation ID format');

  // Check if user is participant
  const isParticipant = await ConversationParticipant.isParticipant(conversationId, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  // Update last_read_at timestamp
  await ConversationParticipant.updateLastRead(conversationId, userId);

  res.status(200).json({
    success: true,
    message: 'Conversation marked as read'
  });
}));

/**
 * @route   DELETE /api/conversations/:id
 * @desc    Delete a conversation by ID
 * @access  Private (requires authentication, only admin/creator can delete)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  validate(uuidRegex.test(id), 'Invalid conversation ID format');

  // Check if conversation exists
  const conversation = await Conversation.findById(id);
  validate(conversation, 'Conversation not found');

  // Check if user is a participant in the conversation
  const isParticipant = await ConversationParticipant.isParticipant(id, userId);
  validate(isParticipant, 'You are not a participant in this conversation');

  // Get participant role
  const participant = await ConversationParticipant.findByConversationAndUser(id, userId);

  // Only admin or creator can delete
  const canDelete = conversation.createdBy === userId || participant?.role === 'admin';
  validate(canDelete, 'Only the conversation creator or admin can delete this conversation');

  // Get all participants before deleting (for socket notification)
  const participants = await ConversationParticipant.findByConversationId(id);
  const participantIds = participants.map(p => p.userId);

  // Delete the conversation (cascade will delete participants and messages)
  await Conversation.findByIdAndDelete(id);

  // Emit socket notification to all participants
  emitConversationDeleted(participantIds, id);

  res.status(200).json({
    success: true,
    message: 'Conversation deleted successfully'
  });
}));

/**
 * @route   GET /api/conversations/health
 * @desc    Health check for Conversation API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Conversation API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
