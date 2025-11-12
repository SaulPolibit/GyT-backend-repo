/**
 * WaterfallTier Supabase Model
 * Handles waterfall distribution tier configurations for structures
 */

const { getSupabase } = require('../../config/database');

class WaterfallTier {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      structureId: 'structure_id',
      tierNumber: 'tier_number',
      tierName: 'tier_name',
      lpSharePercent: 'lp_share_percent',
      gpSharePercent: 'gp_share_percent',
      thresholdAmount: 'threshold_amount',
      thresholdIrr: 'threshold_irr',
      description: 'description',
      isActive: 'is_active',
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
      structureId: dbData.structure_id,
      tierNumber: dbData.tier_number,
      tierName: dbData.tier_name,
      lpSharePercent: dbData.lp_share_percent,
      gpSharePercent: dbData.gp_share_percent,
      thresholdAmount: dbData.threshold_amount,
      thresholdIrr: dbData.threshold_irr,
      description: dbData.description,
      isActive: dbData.is_active,
      userId: dbData.user_id,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new waterfall tier
   */
  static async create(tierData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(tierData);

    const { data, error } = await supabase
      .from('waterfall_tiers')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating waterfall tier: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find waterfall tier by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('waterfall_tiers')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding waterfall tier: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find waterfall tiers by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('waterfall_tiers').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    query = query.order('tier_number', { ascending: true });

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding waterfall tiers: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find waterfall tiers by structure ID
   */
  static async findByStructureId(structureId) {
    return this.find({ structureId });
  }

  /**
   * Find active waterfall tiers by structure ID
   */
  static async findActiveByStructureId(structureId) {
    return this.find({ structureId, isActive: true });
  }

  /**
   * Find waterfall tiers by user ID
   */
  static async findByUserId(userId) {
    return this.find({ userId });
  }

  /**
   * Update waterfall tier by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();

    // Remove fields that shouldn't be updated
    const { id: _id, structureId, userId, createdAt, ...cleanUpdateData } = updateData;
    const dbData = this._toDbFields(cleanUpdateData);

    // Check if tier exists first
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error('Waterfall tier not found');
    }

    const { data, error } = await supabase
      .from('waterfall_tiers')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating waterfall tier: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete waterfall tier by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('waterfall_tiers')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting waterfall tier: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Create default waterfall tiers for a structure
   * Tier 1: Return of Capital (100% LP)
   * Tier 2: Preferred Return/Hurdle (100% LP until hurdle met)
   * Tier 3: Catch-up (typically 100% GP)
   * Tier 4: Carried Interest split (e.g., 80% LP, 20% GP)
   */
  static async createDefaultTiers(structureId, hurdleRate = 8, carriedInterest = 20, userId) {
    // Check if tiers already exist for this structure
    const existingTiers = await this.findByStructureId(structureId);

    if (existingTiers.length > 0) {
      throw new Error('Waterfall tiers already exist for this structure. Please delete existing tiers first or update them individually.');
    }

    const defaultTiers = [
      {
        structureId,
        tierNumber: 1,
        tierName: 'Return of Capital',
        lpSharePercent: 100,
        gpSharePercent: 0,
        thresholdAmount: null,
        thresholdIrr: null,
        description: '100% of distributions go to LPs until they receive their invested capital back',
        isActive: true,
        userId
      },
      {
        structureId,
        tierNumber: 2,
        tierName: 'Preferred Return',
        lpSharePercent: 100,
        gpSharePercent: 0,
        thresholdAmount: null,
        thresholdIrr: hurdleRate,
        description: `100% of remaining distributions go to LPs until they achieve ${hurdleRate}% IRR`,
        isActive: true,
        userId
      },
      {
        structureId,
        tierNumber: 3,
        tierName: 'GP Catch-up',
        lpSharePercent: 0,
        gpSharePercent: 100,
        thresholdAmount: null,
        thresholdIrr: null,
        description: `100% of remaining distributions go to GP until GP receives ${carriedInterest}% of total profits`,
        isActive: true,
        userId
      },
      {
        structureId,
        tierNumber: 4,
        tierName: 'Carried Interest',
        lpSharePercent: 100 - carriedInterest,
        gpSharePercent: carriedInterest,
        thresholdAmount: null,
        thresholdIrr: null,
        description: `Remaining distributions split ${100 - carriedInterest}% LP / ${carriedInterest}% GP`,
        isActive: true,
        userId
      }
    ];

    const createdTiers = [];
    for (const tierData of defaultTiers) {
      const tier = await this.create(tierData);
      createdTiers.push(tier);
    }

    return createdTiers;
  }

  /**
   * Validate waterfall tier configuration
   */
  static validateTier(tier) {
    const errors = [];

    // Validate tier number
    if (tier.tierNumber < 1 || tier.tierNumber > 4) {
      errors.push('Tier number must be between 1 and 4');
    }

    // Validate percentages
    const totalPercent = tier.lpSharePercent + tier.gpSharePercent;
    if (totalPercent !== 100) {
      errors.push('LP share and GP share must sum to 100%');
    }

    if (tier.lpSharePercent < 0 || tier.lpSharePercent > 100) {
      errors.push('LP share must be between 0 and 100');
    }

    if (tier.gpSharePercent < 0 || tier.gpSharePercent > 100) {
      errors.push('GP share must be between 0 and 100');
    }

    // Validate thresholds
    if (tier.thresholdIrr !== null && (tier.thresholdIrr < 0 || tier.thresholdIrr > 100)) {
      errors.push('Threshold IRR must be between 0 and 100');
    }

    if (tier.thresholdAmount !== null && tier.thresholdAmount < 0) {
      errors.push('Threshold amount must be positive');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get waterfall configuration summary for structure
   */
  static async getWaterfallSummary(structureId) {
    const tiers = await this.findActiveByStructureId(structureId);

    return {
      structureId,
      totalTiers: tiers.length,
      tiers: tiers.map(tier => ({
        tierNumber: tier.tierNumber,
        tierName: tier.tierName,
        lpShare: tier.lpSharePercent,
        gpShare: tier.gpSharePercent,
        threshold: tier.thresholdIrr ? `${tier.thresholdIrr}% IRR` : tier.thresholdAmount ? `$${tier.thresholdAmount}` : 'None'
      }))
    };
  }

  /**
   * Deactivate all tiers for a structure
   */
  static async deactivateAllTiers(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('waterfall_tiers')
      .update({ is_active: false })
      .eq('structure_id', structureId)
      .select();

    if (error) {
      throw new Error(`Error deactivating tiers: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Bulk update tiers for a structure
   */
  static async bulkUpdateTiers(structureId, tiersData, userId) {
    const updatedTiers = [];

    for (const tierData of tiersData) {
      if (tierData.id) {
        // Update existing tier
        const tier = await this.findByIdAndUpdate(tierData.id, tierData);
        updatedTiers.push(tier);
      } else {
        // Create new tier
        // Validate required fields for new tiers
        if (!tierData.tierNumber) {
          throw new Error('tierNumber is required for new tiers');
        }
        if (tierData.lpSharePercent === undefined || tierData.gpSharePercent === undefined) {
          throw new Error('lpSharePercent and gpSharePercent are required for new tiers');
        }

        const tier = await this.create({
          ...tierData,
          structureId,
          userId,
          isActive: tierData.isActive !== undefined ? tierData.isActive : true
        });
        updatedTiers.push(tier);
      }
    }

    return updatedTiers;
  }
}

module.exports = WaterfallTier;
