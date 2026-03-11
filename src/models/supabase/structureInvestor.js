/**
 * StructureInvestor Supabase Model
 * Junction table linking users to structures with commitment and ownership data
 *
 * This replaces the deprecated Investor model for tracking user-structure relationships.
 */

const { getSupabase } = require('../../config/database');

class StructureInvestor {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      userId: 'user_id',
      structureId: 'structure_id',
      commitment: 'commitment',
      ownershipPercent: 'ownership_percent',
      feeDiscount: 'fee_discount',
      vatExempt: 'vat_exempt',
      customTerms: 'custom_terms',
      status: 'status',
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
      userId: dbData.user_id,
      structureId: dbData.structure_id,
      commitment: dbData.commitment,
      ownershipPercent: dbData.ownership_percent,
      feeDiscount: dbData.fee_discount,
      vatExempt: dbData.vat_exempt,
      customTerms: dbData.custom_terms,
      status: dbData.status,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at,
      // Include joined data if present
      user: dbData.user || dbData.users || null,
      structure: dbData.structure || dbData.structures || null
    };
  }

  /**
   * Create a new structure investor relationship
   */
  static async create(data) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(data);

    const { data: result, error } = await supabase
      .from('structure_investors')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating structure investor: ${error.message}`);
    }

    return this._toModel(result);
  }

  /**
   * Find structure investor by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_investors')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding structure investor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find structure investors by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('structure_investors').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding structure investors: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find by user ID and structure ID (unique combination)
   */
  static async findByUserAndStructure(userId, structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_investors')
      .select('*')
      .eq('user_id', userId)
      .eq('structure_id', structureId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding structure investor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find all structures for a user
   */
  static async findByUserId(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_investors')
      .select(`
        *,
        structures:structure_id (
          id, name, type, status, base_currency, total_commitment,
          management_fee, performance_fee, hurdle_rate, preferred_return,
          enable_capital_calls
        )
      `)
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Error finding user structures: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find all investors for a structure
   */
  static async findByStructureId(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_investors')
      .select(`
        *,
        users:user_id (
          id, email, first_name, last_name, role
        )
      `)
      .eq('structure_id', structureId);

    if (error) {
      throw new Error(`Error finding structure investors: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Update structure investor by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);
    dbData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('structure_investors')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating structure investor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Upsert - Create or update based on user_id + structure_id
   */
  static async upsert(data) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(data);

    const { data: result, error } = await supabase
      .from('structure_investors')
      .upsert(dbData, {
        onConflict: 'user_id,structure_id',
        ignoreDuplicates: false
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Error upserting structure investor: ${error.message}`);
    }

    return this._toModel(result);
  }

  /**
   * Delete structure investor by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_investors')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting structure investor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Calculate total commitment for a structure
   */
  static async getTotalCommitment(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structure_investors')
      .select('commitment')
      .eq('structure_id', structureId);

    if (error) {
      throw new Error(`Error calculating total commitment: ${error.message}`);
    }

    return data.reduce((sum, item) => sum + (item.commitment || 0), 0);
  }

  /**
   * Recalculate ownership percentages for all investors in a structure
   */
  static async recalculateOwnership(structureId) {
    const supabase = getSupabase();

    // Get all investors and total commitment
    const investors = await this.findByStructureId(structureId);
    const totalCommitment = investors.reduce((sum, inv) => sum + (inv.commitment || 0), 0);

    if (totalCommitment === 0) return;

    // Update each investor's ownership percentage
    for (const investor of investors) {
      const ownershipPercent = (investor.commitment / totalCommitment) * 100;
      await this.findByIdAndUpdate(investor.id, { ownershipPercent });
    }
  }
}

module.exports = StructureInvestor;
