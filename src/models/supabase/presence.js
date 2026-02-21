const { getSupabase } = require('../../config/database');

// Presence status constants
const STATUSES = {
  ONLINE: 'online',
  AWAY: 'away',
  OFFLINE: 'offline'
};

// Threshold for considering a user online (in minutes)
const ONLINE_THRESHOLD_MINUTES = 2;

const Presence = {
  /**
   * Update user presence (heartbeat)
   * @param {string} userId - User ID
   * @param {string} status - Status (online, away, offline)
   * @returns {Promise<Object>} Presence record
   */
  async updatePresence(userId, status = STATUSES.ONLINE) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_presence')
      .upsert({
        user_id: userId,
        status: status,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get presence for a single user
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Presence record with is_online flag
   */
  async getPresence(userId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_presence')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) return null;

    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000);
    return {
      ...data,
      is_online: new Date(data.last_seen_at) > threshold && data.status === STATUSES.ONLINE
    };
  },

  /**
   * Get presence for multiple users
   * @param {string[]} userIds - Array of user IDs
   * @returns {Promise<Object[]>} Array of presence records with is_online flag
   */
  async getPresenceForUsers(userIds) {
    if (!userIds || userIds.length === 0) return [];

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_presence')
      .select('*')
      .in('user_id', userIds);

    if (error) throw error;

    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000);
    return (data || []).map(record => ({
      ...record,
      is_online: new Date(record.last_seen_at) > threshold && record.status === STATUSES.ONLINE
    }));
  },

  /**
   * Get all online users
   * @returns {Promise<Object[]>} Array of online presence records
   */
  async getOnlineUsers() {
    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000);

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_presence')
      .select('*')
      .eq('status', STATUSES.ONLINE)
      .gte('last_seen_at', threshold.toISOString());

    if (error) throw error;
    return (data || []).map(record => ({
      ...record,
      is_online: true
    }));
  },

  /**
   * Mark user as offline
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async markOffline(userId) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('user_presence')
      .update({
        status: STATUSES.OFFLINE,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) throw error;
  },

  /**
   * Cleanup stale presence records (mark as offline if not seen for 5 minutes)
   * @returns {Promise<number>} Number of records updated
   */
  async cleanupStalePresence() {
    const threshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_presence')
      .update({
        status: STATUSES.OFFLINE,
        updated_at: new Date().toISOString()
      })
      .neq('status', STATUSES.OFFLINE)
      .lt('last_seen_at', threshold.toISOString())
      .select();

    if (error) throw error;
    return data?.length || 0;
  },

  /**
   * Delete presence record for a user
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  async deletePresence(userId) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('user_presence')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
  }
};

module.exports = {
  Presence,
  STATUSES
};
