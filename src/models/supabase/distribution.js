/**
 * Distribution Supabase Model
 * Handles profit distributions with waterfall calculations
 */

const { getSupabase } = require('../../config/database');

class Distribution {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      structureId: 'structure_id',
      distributionNumber: 'distribution_number',
      distributionDate: 'distribution_date',
      totalAmount: 'total_amount',
      status: 'status',
      source: 'source',
      notes: 'notes',
      investmentId: 'investment_id',
      // Source breakdown
      sourceEquityGain: 'source_equity_gain',
      sourceDebtInterest: 'source_debt_interest',
      sourceDebtPrincipal: 'source_debt_principal',
      sourceOther: 'source_other',
      // Waterfall
      waterfallApplied: 'waterfall_applied',
      tier1Amount: 'tier1_amount',
      tier2Amount: 'tier2_amount',
      tier3Amount: 'tier3_amount',
      tier4Amount: 'tier4_amount',
      // LP/GP splits
      lpTotalAmount: 'lp_total_amount',
      gpTotalAmount: 'gp_total_amount',
      managementFeeAmount: 'management_fee_amount',
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
      distributionNumber: dbData.distribution_number,
      distributionDate: dbData.distribution_date,
      totalAmount: dbData.total_amount,
      status: dbData.status,
      source: dbData.source,
      notes: dbData.notes,
      investmentId: dbData.investment_id,
      // Source breakdown
      sourceEquityGain: dbData.source_equity_gain,
      sourceDebtInterest: dbData.source_debt_interest,
      sourceDebtPrincipal: dbData.source_debt_principal,
      sourceOther: dbData.source_other,
      // Waterfall
      waterfallApplied: dbData.waterfall_applied,
      tier1Amount: dbData.tier1_amount,
      tier2Amount: dbData.tier2_amount,
      tier3Amount: dbData.tier3_amount,
      tier4Amount: dbData.tier4_amount,
      // LP/GP splits
      lpTotalAmount: dbData.lp_total_amount,
      gpTotalAmount: dbData.gp_total_amount,
      managementFeeAmount: dbData.management_fee_amount,
      createdBy: dbData.created_by,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new distribution
   */
  static async create(distributionData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(distributionData);

    const { data, error } = await supabase
      .from('distributions')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating distribution: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find distribution by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('distributions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding distribution: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find distributions by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('distributions').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    query = query.order('distribution_date', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding distributions: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find distributions by structure ID
   */
  static async findByStructureId(structureId) {
    return this.find({ structureId });
  }

  /**
   * Find distributions by user ID
   */
  static async findByUserId(userId) {
    return this.find({ createdBy: userId });
  }

  /**
   * Find distributions by status
   */
  static async findByStatus(status, structureId) {
    const filter = { status };
    if (structureId) filter.structureId = structureId;
    return this.find(filter);
  }

  /**
   * Update distribution by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('distributions')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating distribution: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete distribution by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('distributions')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting distribution: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get distribution with allocations
   */
  static async findWithAllocations(distributionId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('distributions')
      .select(`
        *,
        distribution_allocations (
          *,
          investor:investors (*)
        )
      `)
      .eq('id', distributionId)
      .single();

    if (error) {
      throw new Error(`Error finding distribution with allocations: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Apply waterfall calculation
   */
  static async applyWaterfall(distributionId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('apply_waterfall_distribution', {
      distribution_id: distributionId
    });

    if (error) {
      throw new Error(`Error applying waterfall: ${error.message}`);
    }

    return data;
  }

  /**
   * Mark distribution as paid
   */
  static async markAsPaid(distributionId) {
    return this.findByIdAndUpdate(distributionId, {
      status: 'Paid'
    });
  }

  /**
   * Get distribution summary for structure
   */
  static async getSummary(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_distribution_summary', {
      structure_id: structureId
    });

    if (error) {
      throw new Error(`Error getting distribution summary: ${error.message}`);
    }

    return data;
  }

  /**
   * Create allocations for all investors in structure
   */
  static async createAllocationsForStructure(distributionId, structureId) {
    const supabase = getSupabase();

    // Get all structure_investors for this structure
    const { data: structureInvestors, error: siError } = await supabase
      .from('structure_investors')
      .select('*')
      .eq('structure_id', structureId);

    if (siError) {
      throw new Error(`Error fetching structure investors: ${siError.message}`);
    }

    // Get distribution details
    const distribution = await this.findById(distributionId);

    if (!distribution) {
      throw new Error('Distribution not found');
    }

    // If waterfall is applied, use waterfall-calculated amounts
    // Otherwise, distribute based on ownership percentage
    let allocations;

    if (distribution.waterfallApplied) {
      // Get waterfall calculation results
      const { data: waterfallData, error: wfError } = await supabase.rpc(
        'calculate_waterfall_allocations',
        {
          p_distribution_id: distributionId,
          p_structure_id: structureId
        }
      );

      if (wfError) {
        throw new Error(`Error calculating waterfall allocations: ${wfError.message}`);
      }

      allocations = waterfallData;

      // Insert waterfall-calculated allocations
      const { data, error } = await supabase
        .from('distribution_allocations')
        .insert(allocations)
        .select();

      if (error) {
        throw new Error(`Error creating waterfall allocations: ${error.message}`);
      }

      return data;
    } else {
      // Simple pro-rata distribution based on ownership
      allocations = structureInvestors.map(si => {
        const allocationAmount = distribution.lpTotalAmount * (si.ownership_percent / 100);

        return {
          distribution_id: distributionId,
          investor_id: si.investor_id,
          allocated_amount: allocationAmount,
          paid_amount: 0,
          status: 'Pending',
          payment_date: distribution.distributionDate
        };
      });

      // Insert allocations
      const { data, error } = await supabase
        .from('distribution_allocations')
        .insert(allocations)
        .select();

      if (error) {
        throw new Error(`Error creating allocations: ${error.message}`);
      }

      return data;
    }
  }

  /**
   * Calculate total distributions for investors
   */
  static async getInvestorDistributionTotal(investorId, structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_investor_distribution_total', {
      p_investor_id: investorId,
      p_structure_id: structureId
    });

    if (error) {
      throw new Error(`Error getting investor distribution total: ${error.message}`);
    }

    return data;
  }
}

module.exports = Distribution;
