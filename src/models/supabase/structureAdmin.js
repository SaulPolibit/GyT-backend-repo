/**
 * Structure Admin Supabase Model
 * Manages relationships between structures and admin/support users
 */

const { getSupabase } = require('../../config/database');

class StructureAdmin {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      structureId: 'structure_id',
      userId: 'user_id',
      role: 'role',
      canEdit: 'can_edit',
      canDelete: 'can_delete',
      canManageInvestors: 'can_manage_investors',
      canManageDocuments: 'can_manage_documents',
      addedBy: 'added_by',
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
      structureId: dbData.structure_id,
      userId: dbData.user_id,
      role: dbData.role,
      canEdit: dbData.can_edit,
      canDelete: dbData.can_delete,
      canManageInvestors: dbData.can_manage_investors,
      canManageDocuments: dbData.can_manage_documents,
      addedBy: dbData.added_by,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Add admin or support user to structure
   */
  static async create(data) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(data);

    const { data: result, error } = await supabase
      .from('structure_admins')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error adding user to structure: ${error.message}`);
    }

    return this._toModel(result);
  }

  /**
   * Find relationship by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_admins')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding structure admin: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find all admins/support for a structure
   */
  static async findByStructureId(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_admins')
      .select(`
        *,
        user:users (
          id,
          email,
          first_name,
          last_name,
          role
        )
      `)
      .eq('structure_id', structureId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding structure admins: ${error.message}`);
    }

    return data.map(item => ({
      ...this._toModel(item),
      user: item.user ? {
        id: item.user.id,
        email: item.user.email,
        firstName: item.user.first_name,
        lastName: item.user.last_name,
        role: item.user.role
      } : null
    }));
  }

  /**
   * Find all structures for a user
   */
  static async findByUserId(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_admins')
      .select(`
        *,
        structure:structures (
          id,
          name,
          type,
          status
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding user structures: ${error.message}`);
    }

    return data.map(item => ({
      ...this._toModel(item),
      structure: item.structure ? {
        id: item.structure.id,
        name: item.structure.name,
        type: item.structure.type,
        status: item.structure.status
      } : null
    }));
  }

  /**
   * Check if user has access to structure
   */
  static async hasAccess(structureId, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_admins')
      .select('id')
      .eq('structure_id', structureId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return false; // Not found
      throw new Error(`Error checking access: ${error.message}`);
    }

    return !!data;
  }

  /**
   * Get user's role and permissions for a structure
   */
  static async getUserPermissions(structureId, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_admins')
      .select('role, can_edit, can_delete, can_manage_investors, can_manage_documents')
      .eq('structure_id', structureId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error getting permissions: ${error.message}`);
    }

    return {
      role: data.role,
      canEdit: data.can_edit,
      canDelete: data.can_delete,
      canManageInvestors: data.can_manage_investors,
      canManageDocuments: data.can_manage_documents
    };
  }

  /**
   * Update permissions
   */
  static async updatePermissions(id, permissions) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(permissions);

    const { data, error } = await supabase
      .from('structure_admins')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating permissions: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Remove user from structure
   */
  static async delete(structureId, userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_admins')
      .delete()
      .eq('structure_id', structureId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Error removing user from structure: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete by ID
   */
  static async deleteById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_admins')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting structure admin: ${error.message}`);
    }

    return this._toModel(data);
  }
}

module.exports = StructureAdmin;
