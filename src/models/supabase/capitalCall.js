/**
 * CapitalCall Supabase Model
 * Handles capital call requests and investor allocations
 */

const { getSupabase } = require('../../config/database');

class CapitalCall {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      structureId: 'structure_id',
      callNumber: 'call_number',
      callDate: 'call_date',
      dueDate: 'due_date',
      totalCallAmount: 'total_call_amount',
      totalPaidAmount: 'total_paid_amount',
      totalUnpaidAmount: 'total_unpaid_amount',
      status: 'status',
      purpose: 'purpose',
      notes: 'notes',
      investmentId: 'investment_id',
      sentDate: 'sent_date',
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
      callNumber: dbData.call_number,
      callDate: dbData.call_date,
      dueDate: dbData.due_date,
      totalCallAmount: dbData.total_call_amount,
      totalPaidAmount: dbData.total_paid_amount,
      totalUnpaidAmount: dbData.total_unpaid_amount,
      status: dbData.status,
      purpose: dbData.purpose,
      notes: dbData.notes,
      investmentId: dbData.investment_id,
      sentDate: dbData.sent_date,
      userId: dbData.user_id,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new capital call
   */
  static async create(capitalCallData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(capitalCallData);

    const { data, error } = await supabase
      .from('capital_calls')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating capital call: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find capital call by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('capital_calls')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding capital call: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find capital calls by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('capital_calls').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    query = query.order('call_date', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding capital calls: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find capital calls by structure ID
   */
  static async findByStructureId(structureId) {
    return this.find({ structureId });
  }

  /**
   * Find capital calls by user ID
   */
  static async findByUserId(userId) {
    return this.find({ userId });
  }

  /**
   * Find capital calls by status
   */
  static async findByStatus(status, structureId) {
    const filter = { status };
    if (structureId) filter.structureId = structureId;
    return this.find(filter);
  }

  /**
   * Update capital call by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('capital_calls')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating capital call: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Delete capital call by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('capital_calls')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting capital call: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get capital call with allocations
   */
  static async findWithAllocations(capitalCallId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('capital_calls')
      .select(`
        *,
        capital_call_allocations (
          *,
          investor:investors (*)
        )
      `)
      .eq('id', capitalCallId)
      .single();

    if (error) {
      throw new Error(`Error finding capital call with allocations: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Mark capital call as sent
   */
  static async markAsSent(capitalCallId) {
    return this.findByIdAndUpdate(capitalCallId, {
      status: 'Sent',
      sentDate: new Date().toISOString()
    });
  }

  /**
   * Mark capital call as fully paid
   */
  static async markAsPaid(capitalCallId) {
    return this.findByIdAndUpdate(capitalCallId, {
      status: 'Paid'
    });
  }

  /**
   * Update payment amounts
   */
  static async updatePaymentAmounts(capitalCallId, paidAmount) {
    const capitalCall = await this.findById(capitalCallId);

    if (!capitalCall) {
      throw new Error('Capital call not found');
    }

    const totalPaid = (capitalCall.totalPaidAmount || 0) + paidAmount;
    const totalUnpaid = capitalCall.totalCallAmount - totalPaid;

    const updateData = {
      totalPaidAmount: totalPaid,
      totalUnpaidAmount: totalUnpaid
    };

    // Update status if fully paid
    if (totalUnpaid <= 0) {
      updateData.status = 'Paid';
    } else if (totalPaid > 0 && capitalCall.status === 'Draft') {
      updateData.status = 'Partially Paid';
    }

    return this.findByIdAndUpdate(capitalCallId, updateData);
  }

  /**
   * Get capital call summary for structure
   */
  static async getSummary(structureId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_capital_call_summary', {
      structure_id: structureId
    });

    if (error) {
      throw new Error(`Error getting capital call summary: ${error.message}`);
    }

    return data;
  }

  /**
   * Create allocations for all investors in structure
   */
  static async createAllocationsForStructure(capitalCallId, structureId) {
    const supabase = getSupabase();

    // Get all structure_investors for this structure
    const { data: structureInvestors, error: siError } = await supabase
      .from('structure_investors')
      .select('*')
      .eq('structure_id', structureId);

    if (siError) {
      throw new Error(`Error fetching structure investors: ${siError.message}`);
    }

    // Get capital call details
    const capitalCall = await this.findById(capitalCallId);

    if (!capitalCall) {
      throw new Error('Capital call not found');
    }

    // Create allocations based on ownership percentage
    const allocations = structureInvestors.map(si => {
      const allocationAmount = capitalCall.totalCallAmount * (si.ownership_percent / 100);

      return {
        capital_call_id: capitalCallId,
        investor_id: si.investor_id,
        allocated_amount: allocationAmount,
        paid_amount: 0,
        remaining_amount: allocationAmount,
        status: 'Pending',
        due_date: capitalCall.dueDate
      };
    });

    // Insert all allocations
    const { data, error } = await supabase
      .from('capital_call_allocations')
      .insert(allocations)
      .select();

    if (error) {
      throw new Error(`Error creating allocations: ${error.message}`);
    }

    return data;
  }
}

module.exports = CapitalCall;
