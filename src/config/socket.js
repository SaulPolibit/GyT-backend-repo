/**
 * Socket.IO Configuration
 * Real-time WebSocket communication setup for chat messaging
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { ConversationParticipant } = require('../models/supabase');

let io = null;

/**
 * Initialize Socket.IO server
 * @param {http.Server} server - HTTP server instance
 * @returns {Server} Socket.IO server instance
 */
function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, etc.)
        if (!origin) return callback(null, true);

        // In development, allow all origins
        if (process.env.NODE_ENV !== 'production') {
          return callback(null, true);
        }

        // In production, check against whitelist
        const whitelist = process.env.CORS_WHITELIST
          ? process.env.CORS_WHITELIST.split(',')
          : [];

        if (whitelist.indexOf(origin) !== -1 || whitelist.includes('*')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId || decoded.id;
      socket.userEmail = decoded.email;

      console.log(`✅ Socket authenticated: User ${socket.userId} (${socket.userEmail})`);
      next();
    } catch (error) {
      console.error('Socket authentication error:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id} (User: ${socket.userId})`);

    // Join user to their personal room
    socket.join(`user:${socket.userId}`);
    console.log(`📍 User ${socket.userId} joined room: user:${socket.userId}`);

    // Join conversation room
    socket.on('join_conversation', async (conversationId) => {
      try {
        // Verify user is a participant in this conversation
        const isParticipant = await ConversationParticipant.isParticipant(conversationId, socket.userId);

        if (isParticipant) {
          socket.join(`conversation:${conversationId}`);
          console.log(`📍 User ${socket.userId} joined conversation: ${conversationId}`);

          socket.emit('joined_conversation', { conversationId });
        } else {
          socket.emit('error', { message: 'Not authorized to join this conversation' });
        }
      } catch (error) {
        console.error('Error joining conversation:', error);
        socket.emit('error', { message: 'Failed to join conversation' });
      }
    });

    // Leave conversation room
    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation:${conversationId}`);
      console.log(`📍 User ${socket.userId} left conversation: ${conversationId}`);
    });

    // Typing indicator
    socket.on('typing_start', (conversationId) => {
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId: socket.userId,
        conversationId
      });
    });

    socket.on('typing_stop', (conversationId) => {
      socket.to(`conversation:${conversationId}`).emit('user_stopped_typing', {
        userId: socket.userId,
        conversationId
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.id} (User: ${socket.userId})`);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  console.log('✅ Socket.IO initialized successfully');
  return io;
}

/**
 * Get Socket.IO instance
 * @returns {Server} Socket.IO server instance
 */
function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return io;
}

/**
 * Emit new message event to conversation participants
 * @param {string} conversationId - Conversation ID
 * @param {object} message - Message object
 */
function emitNewMessage(conversationId, message) {
  if (io) {
    io.to(`conversation:${conversationId}`).emit('new_message', message);
    console.log(`📨 Emitted new_message to conversation:${conversationId}`);
  }
}

/**
 * Emit message read event
 * @param {string} conversationId - Conversation ID
 * @param {string} messageId - Message ID
 * @param {string} userId - User ID who read the message
 */
function emitMessageRead(conversationId, messageId, userId) {
  if (io) {
    io.to(`conversation:${conversationId}`).emit('message_read', {
      messageId,
      userId,
      readAt: new Date().toISOString()
    });
    console.log(`✅ Emitted message_read for message:${messageId}`);
  }
}

/**
 * Emit message deleted event
 * @param {string} conversationId - Conversation ID
 * @param {string} messageId - Message ID
 */
function emitMessageDeleted(conversationId, messageId) {
  if (io) {
    io.to(`conversation:${conversationId}`).emit('message_deleted', {
      messageId,
      deletedAt: new Date().toISOString()
    });
    console.log(`🗑️ Emitted message_deleted for message:${messageId}`);
  }
}

/**
 * Emit notification to specific user
 * @param {string} userId - User ID
 * @param {object} notification - Notification object
 */
function emitUserNotification(userId, notification) {
  if (io) {
    io.to(`user:${userId}`).emit('notification', notification);
    console.log(`🔔 Emitted notification to user:${userId}`);
  }
}

/**
 * Emit new conversation event to all participants
 * @param {Array<string>} participantIds - Array of participant user IDs
 * @param {object} conversation - Conversation object with full details
 */
function emitNewConversation(participantIds, conversation) {
  if (io) {
    participantIds.forEach(userId => {
      io.to(`user:${userId}`).emit('new_conversation', conversation);
      console.log(`💬 Emitted new_conversation to user:${userId}`);
    });
  }
}

/**
 * Emit conversation deleted event to all participants
 * @param {Array<string>} participantIds - Array of participant user IDs
 * @param {string} conversationId - Conversation ID that was deleted
 */
function emitConversationDeleted(participantIds, conversationId) {
  if (io) {
    participantIds.forEach(userId => {
      io.to(`user:${userId}`).emit('conversation_deleted', {
        conversationId,
        deletedAt: new Date().toISOString()
      });
      console.log(`🗑️ Emitted conversation_deleted to user:${userId}`);
    });
  }
}

module.exports = {
  initializeSocket,
  getIO,
  emitNewMessage,
  emitMessageRead,
  emitMessageDeleted,
  emitUserNotification,
  emitNewConversation,
  emitConversationDeleted
};
