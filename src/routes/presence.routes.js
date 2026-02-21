const express = require('express');
const router = express.Router();
const { Presence, STATUSES } = require('../models/supabase/presence');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/presence/heartbeat
 * Update user's presence (heartbeat)
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const userId = req.auth.userId || req.user.id;
    const { status = STATUSES.ONLINE } = req.body;

    const presence = await Presence.updatePresence(userId, status);

    res.json({
      success: true,
      data: presence
    });
  } catch (error) {
    console.error('Error updating presence:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating presence',
      error: error.message
    });
  }
});

/**
 * POST /api/presence/offline
 * Mark user as offline (called on logout or window close)
 */
router.post('/offline', async (req, res) => {
  try {
    const userId = req.auth.userId || req.user.id;

    await Presence.markOffline(userId);

    res.json({
      success: true,
      message: 'User marked as offline'
    });
  } catch (error) {
    console.error('Error marking user offline:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking user offline',
      error: error.message
    });
  }
});

/**
 * GET /api/presence/status/:userId
 * Get presence status for a specific user
 */
router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const presence = await Presence.getPresence(userId);

    res.json({
      success: true,
      data: presence || {
        user_id: userId,
        is_online: false,
        status: STATUSES.OFFLINE,
        last_seen_at: null
      }
    });
  } catch (error) {
    console.error('Error getting presence:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting presence',
      error: error.message
    });
  }
});

/**
 * POST /api/presence/status/bulk
 * Get presence status for multiple users
 */
router.post('/status/bulk', async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds)) {
      return res.status(400).json({
        success: false,
        message: 'userIds array is required'
      });
    }

    const presenceList = await Presence.getPresenceForUsers(userIds);

    // Create a map for easy lookup
    const presenceMap = {};
    presenceList.forEach(p => {
      presenceMap[p.user_id] = p;
    });

    // Return status for all requested users (including those not found)
    const result = userIds.map(userId => ({
      user_id: userId,
      is_online: presenceMap[userId]?.is_online || false,
      status: presenceMap[userId]?.status || STATUSES.OFFLINE,
      last_seen_at: presenceMap[userId]?.last_seen_at || null
    }));

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting bulk presence:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting presence',
      error: error.message
    });
  }
});

/**
 * GET /api/presence/online
 * Get all currently online users
 */
router.get('/online', async (req, res) => {
  try {
    const onlineUsers = await Presence.getOnlineUsers();

    res.json({
      success: true,
      data: onlineUsers
    });
  } catch (error) {
    console.error('Error getting online users:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting online users',
      error: error.message
    });
  }
});

module.exports = router;
