/**
 * ApprovalHistory Supabase Model
 * Handles approval audit trail for capital calls, distributions, and other transactions
 */

const { getSupabase } = require('../../config/database');

class ApprovalHistory {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      entityType: 'item_type',             // 'capital_call', 'distribution', 'payment' - maps to item_type in DB
      entityId: 'item_id',                 // ID of the capital call, distribution, etc. - maps to item_id in DB
      action: 'action',                    // 'created', 'submitted', 'reviewed', 'approved', 'rejected', 'changes_requested', 'cfo_submitted', 'cfo_approved'
      fromStatus: 'from_status',
      toStatus: 'to_status',
      userId: 'user_id',
      userName: 'user_name',
      notes: 'notes',
      metadata: 'metadata',                // JSON for additional data
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
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
      entityType: dbData.item_type,        // Read from item_type column
      entityId: dbData.item_id,            // Read from item_id column
      action: dbData.action,
      fromStatus: dbData.from_status,
      toStatus: dbData.to_status,
      userId: dbData.user_id,
      userName: dbData.user_name,
      notes: dbData.notes,
      metadata: dbData.metadata,
      ipAddress: dbData.ip_address,
      userAgent: dbData.user_agent,
      timestamp: dbData.created_at,
      createdAt: dbData.created_at
    };
  }

  /**
   * Create a new approval history entry
   */
  static async create(data) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(data);

    const { data: result, error } = await supabase
      .from('approval_history')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating approval history: ${error.message}`);
    }

    return this._toModel(result);
  }

  /**
   * Find approval history by entity (capital call, distribution, etc.)
   */
  static async findByEntity(entityType, entityId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('approval_history')
      .select('*')
      .eq('item_type', entityType)
      .eq('item_id', entityId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding approval history: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find approval history by entity ID only
   */
  static async findByEntityId(entityId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('approval_history')
      .select('*')
      .eq('item_id', entityId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding approval history: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('approval_history')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Error finding approval history: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find by user ID (all approvals/actions by a user)
   */
  static async findByUserId(userId, options = {}) {
    const supabase = getSupabase();
    const { limit = 50, offset = 0, entityType } = options;

    let query = supabase
      .from('approval_history')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (entityType) {
      query = query.eq('item_type', entityType);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Error finding approval history: ${error.message}`);
    }

    return {
      history: data.map(item => this._toModel(item)),
      total: count,
      limit,
      offset
    };
  }

  /**
   * Log an approval action
   * Convenience method that creates a history entry with common defaults
   */
  static async logAction(options) {
    const {
      entityType,
      entityId,
      action,
      fromStatus,
      toStatus,
      userId,
      userName,
      notes,
      metadata,
      ipAddress,
      userAgent
    } = options;

    return this.create({
      entityType,
      entityId,
      action,
      fromStatus,
      toStatus,
      userId,
      userName,
      notes,
      metadata,
      ipAddress,
      userAgent
    });
  }

  /**
   * Get summary statistics for approvals
   */
  static async getStatistics(options = {}) {
    const supabase = getSupabase();
    const { entityType, startDate, endDate, userId } = options;

    let query = supabase
      .from('approval_history')
      .select('action, to_status', { count: 'exact' });

    if (entityType) {
      query = query.eq('item_type', entityType);
    }

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Error getting approval statistics: ${error.message}`);
    }

    // Calculate statistics
    const stats = {
      total: count || 0,
      byAction: {},
      byStatus: {}
    };

    data?.forEach(item => {
      // Count by action
      stats.byAction[item.action] = (stats.byAction[item.action] || 0) + 1;

      // Count by resulting status
      if (item.to_status) {
        stats.byStatus[item.to_status] = (stats.byStatus[item.to_status] || 0) + 1;
      }
    });

    return stats;
  }

  /**
   * Delete approval history for an entity
   * Used when deleting the parent entity
   */
  static async deleteByEntity(entityType, entityId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('approval_history')
      .delete()
      .eq('item_type', entityType)
      .eq('item_id', entityId)
      .select();

    if (error) {
      throw new Error(`Error deleting approval history: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }
}

module.exports = ApprovalHistory;
