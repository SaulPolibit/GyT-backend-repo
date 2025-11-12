/**
 * Structure Supabase Model
 * Handles Fund, SA/LLC, Fideicomiso, and Private Debt structures with hierarchy support
 */

const { getSupabase } = require('../../config/database');

class Structure {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      name: 'name',
      type: 'type',
      description: 'description',
      status: 'status',
      parentStructureId: 'parent_structure_id',
      hierarchyLevel: 'hierarchy_level',
      totalCommitment: 'total_commitment',
      totalCalled: 'total_called',
      totalDistributed: 'total_distributed',
      totalInvested: 'total_invested',
      managementFee: 'management_fee',
      carriedInterest: 'carried_interest',
      hurdleRate: 'hurdle_rate',
      waterfallType: 'waterfall_type',
      inceptionDate: 'inception_date',
      termYears: 'term_years',
      extensionYears: 'extension_years',
      finalDate: 'final_date',
      gp: 'gp',
      fundAdmin: 'fund_admin',
      legalCounsel: 'legal_counsel',
      auditor: 'auditor',
      taxAdvisor: 'tax_advisor',
      bankAccounts: 'bank_accounts',
      baseCurrency: 'base_currency',
      taxJurisdiction: 'tax_jurisdiction',
      regulatoryStatus: 'regulatory_status',
      investmentStrategy: 'investment_strategy',
      targetReturns: 'target_returns',
      riskProfile: 'risk_profile',
      userId: 'user_id',
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
      name: dbData.name,
      type: dbData.type,
      description: dbData.description,
      status: dbData.status,
      parentStructureId: dbData.parent_structure_id,
      hierarchyLevel: dbData.hierarchy_level,
      totalCommitment: dbData.total_commitment,
      totalCalled: dbData.total_called,
      totalDistributed: dbData.total_distributed,
      totalInvested: dbData.total_invested,
      managementFee: dbData.management_fee,
      carriedInterest: dbData.carried_interest,
      hurdleRate: dbData.hurdle_rate,
      waterfallType: dbData.waterfall_type,
      inceptionDate: dbData.inception_date,
      termYears: dbData.term_years,
      extensionYears: dbData.extension_years,
      finalDate: dbData.final_date,
      gp: dbData.gp,
      fundAdmin: dbData.fund_admin,
      legalCounsel: dbData.legal_counsel,
      auditor: dbData.auditor,
      taxAdvisor: dbData.tax_advisor,
      bankAccounts: dbData.bank_accounts,
      baseCurrency: dbData.base_currency,
      taxJurisdiction: dbData.tax_jurisdiction,
      regulatoryStatus: dbData.regulatory_status,
      investmentStrategy: dbData.investment_strategy,
      targetReturns: dbData.target_returns,
      riskProfile: dbData.risk_profile,
      userId: dbData.user_id,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new structure
   */
  static async create(structureData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(structureData);

    const { data, error } = await supabase
      .from('structures')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating structure: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find structure by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structures')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding structure: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find structures by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('structures').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding structures: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find structures by user ID
   */
  static async findByUserId(userId) {
    return this.find({ userId });
  }

  /**
   * Find child structures (direct children only)
   */
  static async findChildStructures(parentId) {
    return this.find({ parentStructureId: parentId });
  }

  /**
   * Find all structures in hierarchy tree (recursive)
   */
  static async findStructureTree(rootId) {
    const supabase = getSupabase();

    // Use recursive CTE to get entire tree
    const { data, error } = await supabase.rpc('get_structure_tree', {
      root_structure_id: rootId
    });

    if (error) {
      throw new Error(`Error fetching structure tree: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find root structures (no parent)
   */
  static async findRootStructures(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structures')
      .select('*')
      .eq('user_id', userId)
      .is('parent_structure_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding root structures: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Update structure by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('structures')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating structure: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete structure by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structures')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting structure: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get structure with all investors
   */
  static async findWithInvestors(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structures')
      .select(`
        *,
        structure_investors (
          *,
          investor:investors (*)
        )
      `)
      .eq('id', structureId)
      .single();

    if (error) {
      throw new Error(`Error finding structure with investors: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get structure statistics
   */
  static async getStatistics(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_structure_statistics', {
      structure_id: structureId
    });

    if (error) {
      throw new Error(`Error getting structure statistics: ${error.message}`);
    }

    return data;
  }

  /**
   * Update financial totals
   */
  static async updateFinancials(structureId, financials) {
    const updateData = {};

    if (financials.totalCalled !== undefined) updateData.totalCalled = financials.totalCalled;
    if (financials.totalDistributed !== undefined) updateData.totalDistributed = financials.totalDistributed;
    if (financials.totalInvested !== undefined) updateData.totalInvested = financials.totalInvested;

    return this.findByIdAndUpdate(structureId, updateData);
  }
}

module.exports = Structure;
