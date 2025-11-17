/**
 * Investment Supabase Model
 * Handles EQUITY, DEBT, and MIXED investment types
 */

const { getSupabase } = require('../../config/database');

class Investment {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      structureId: 'structure_id',
      projectId: 'project_id',
      investmentName: 'investment_name',
      investmentType: 'investment_type',
      investmentDate: 'investment_date',
      exitDate: 'exit_date',
      status: 'status',
      // Equity fields
      equityInvested: 'equity_invested',
      equityOwnershipPercent: 'equity_ownership_percent',
      equityCurrentValue: 'equity_current_value',
      equityExitValue: 'equity_exit_value',
      equityRealizedGain: 'equity_realized_gain',
      // Debt fields
      principalProvided: 'principal_provided',
      interestRate: 'interest_rate',
      maturityDate: 'maturity_date',
      principalRepaid: 'principal_repaid',
      interestReceived: 'interest_received',
      outstandingPrincipal: 'outstanding_principal',
      // Performance metrics
      irrPercent: 'irr_percent',
      moic: 'moic',
      totalReturns: 'total_returns',
      // Additional information
      sector: 'sector',
      geography: 'geography',
      currency: 'currency',
      notes: 'notes',
      createdBy: 'created_by',
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
      projectId: dbData.project_id,
      investmentName: dbData.investment_name,
      investmentType: dbData.investment_type,
      investmentDate: dbData.investment_date,
      exitDate: dbData.exit_date,
      status: dbData.status,
      // Equity fields
      equityInvested: dbData.equity_invested,
      equityOwnershipPercent: dbData.equity_ownership_percent,
      equityCurrentValue: dbData.equity_current_value,
      equityExitValue: dbData.equity_exit_value,
      equityRealizedGain: dbData.equity_realized_gain,
      // Debt fields
      principalProvided: dbData.principal_provided,
      interestRate: dbData.interest_rate,
      maturityDate: dbData.maturity_date,
      principalRepaid: dbData.principal_repaid,
      interestReceived: dbData.interest_received,
      outstandingPrincipal: dbData.outstanding_principal,
      // Performance metrics
      irrPercent: dbData.irr_percent,
      moic: dbData.moic,
      totalReturns: dbData.total_returns,
      // Additional information
      sector: dbData.sector,
      geography: dbData.geography,
      currency: dbData.currency,
      notes: dbData.notes,
      createdBy: dbData.created_by,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new investment
   */
  static async create(investmentData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(investmentData);

    const { data, error } = await supabase
      .from('investments')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating investment: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find investment by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('investments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding investment: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find investments by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('investments').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding investments: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find investments by structure ID
   */
  static async findByStructureId(structureId) {
    return this.find({ structureId });
  }

  /**
   * Find investments by project ID
   */
  static async findByProjectId(projectId) {
    return this.find({ projectId });
  }

  /**
   * Find investments by user ID
   */
  static async findByUserId(userId) {
    return this.find({ createdBy: userId });
  }

  /**
   * Find active investments
   */
  static async findActive(structureId) {
    const supabase = getSupabase();

    let query = supabase
      .from('investments')
      .select('*')
      .eq('status', 'Active');

    if (structureId) {
      query = query.eq('structure_id', structureId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding active investments: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Update investment by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('investments')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating investment: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete investment by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('investments')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting investment: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get investment with structure details
   */
  static async findWithStructure(investmentId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('investments')
      .select(`
        *,
        structure:structures (*)
      `)
      .eq('id', investmentId)
      .single();

    if (error) {
      throw new Error(`Error finding investment with structure: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Calculate and update performance metrics
   */
  static async updatePerformanceMetrics(investmentId, metrics) {
    const updateData = {};

    if (metrics.irrPercent !== undefined) updateData.irrPercent = metrics.irrPercent;
    if (metrics.moic !== undefined) updateData.moic = metrics.moic;
    if (metrics.totalReturns !== undefined) updateData.totalReturns = metrics.totalReturns;
    if (metrics.equityCurrentValue !== undefined) updateData.equityCurrentValue = metrics.equityCurrentValue;
    if (metrics.outstandingPrincipal !== undefined) updateData.outstandingPrincipal = metrics.outstandingPrincipal;

    return this.findByIdAndUpdate(investmentId, updateData);
  }

  /**
   * Get portfolio summary for a structure
   */
  static async getPortfolioSummary(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_investment_portfolio_summary', {
      structure_id: structureId
    });

    if (error) {
      throw new Error(`Error getting portfolio summary: ${error.message}`);
    }

    return data;
  }

  /**
   * Mark investment as exited
   */
  static async markAsExited(investmentId, exitData) {
    const updateData = {
      status: 'Exited',
      exitDate: exitData.exitDate || new Date().toISOString()
    };

    if (exitData.equityExitValue !== undefined) {
      updateData.equityExitValue = exitData.equityExitValue;

      // Calculate realized gain if equity invested is known
      const investment = await this.findById(investmentId);
      if (investment && investment.equityInvested) {
        updateData.equityRealizedGain = exitData.equityExitValue - investment.equityInvested;
      }
    }

    return this.findByIdAndUpdate(investmentId, updateData);
  }
}

module.exports = Investment;
