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
      noticeDate: 'notice_date',
      deadlineDate: 'deadline_date',
      totalCallAmount: 'total_call_amount',
      totalPaidAmount: 'total_paid_amount',
      totalUnpaidAmount: 'total_unpaid_amount',
      status: 'status',
      purpose: 'purpose',
      notes: 'notes',
      investmentId: 'investment_id',
      sentDate: 'sent_date',
      // ILPA Fee Configuration
      managementFeeBase: 'management_fee_base',
      managementFeeRate: 'management_fee_rate',
      vatRate: 'vat_rate',
      vatApplicable: 'vat_applicable',
      feePeriod: 'fee_period',
      approvalStatus: 'approval_status',
      // Proximity Dual-Rate Fee Fields
      feeRateOnNic: 'fee_rate_on_nic',
      feeRateOnUnfunded: 'fee_rate_on_unfunded',
      // ProximityParks Breakdown Fields (header totals)
      totalInvestments: 'total_investments',
      totalFundExpenses: 'total_fund_expenses',
      totalReserves: 'total_reserves',
      totalDrawdown: 'total_drawdown',
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
      callNumber: dbData.call_number,
      callDate: dbData.call_date,
      dueDate: dbData.due_date,
      noticeDate: dbData.notice_date,
      deadlineDate: dbData.deadline_date,
      totalCallAmount: dbData.total_call_amount,
      totalPaidAmount: dbData.total_paid_amount,
      totalUnpaidAmount: dbData.total_unpaid_amount,
      totalOutstandingAmount: dbData.total_unpaid_amount, // Alias for frontend compatibility
      status: dbData.status,
      purpose: dbData.purpose,
      notes: dbData.notes,
      investmentId: dbData.investment_id,
      sentDate: dbData.sent_date,
      // ILPA Fee Configuration
      managementFeeBase: dbData.management_fee_base,
      managementFeeRate: dbData.management_fee_rate,
      vatRate: dbData.vat_rate,
      vatApplicable: dbData.vat_applicable,
      feePeriod: dbData.fee_period,
      approvalStatus: dbData.approval_status,
      // Proximity Dual-Rate Fee Fields
      feeRateOnNic: dbData.fee_rate_on_nic,
      feeRateOnUnfunded: dbData.fee_rate_on_unfunded,
      // ProximityParks Breakdown Fields (header totals)
      totalInvestments: dbData.total_investments,
      totalFundExpenses: dbData.total_fund_expenses,
      totalReserves: dbData.total_reserves,
      totalDrawdown: dbData.total_drawdown,
      createdBy: dbData.created_by,
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

    // Include structure data and allocations with user info for breakdown in the query
    let query = supabase.from('capital_calls').select(`
      *,
      structures:structure_id (
        id,
        name,
        type
      ),
      capital_call_allocations (
        id,
        user_id,
        principal_amount,
        management_fee_net,
        vat_amount,
        total_due,
        total_drawdown,
        allocated_amount,
        paid_amount,
        capital_paid,
        fees_paid,
        vat_paid,
        status,
        users:user_id (
          id,
          email,
          first_name,
          last_name
        )
      )
    `);

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

    // Map to model format and include structure with payment breakdown
    return data.map(item => {
      const allocations = item.capital_call_allocations || [];

      // Calculate breakdown aggregates from allocations
      const totalPrincipal = allocations.reduce((sum, a) => sum + (parseFloat(a.principal_amount) || 0), 0);
      const totalFees = allocations.reduce((sum, a) => sum + (parseFloat(a.management_fee_net) || 0), 0);
      const totalVat = allocations.reduce((sum, a) => sum + (parseFloat(a.vat_amount) || 0), 0);
      const totalDue = allocations.reduce((sum, a) => sum + (parseFloat(a.total_due) || 0), 0);

      // Payment breakdown
      const capitalPaid = allocations.reduce((sum, a) => sum + (parseFloat(a.capital_paid) || 0), 0);
      const feesPaid = allocations.reduce((sum, a) => sum + (parseFloat(a.fees_paid) || 0), 0);
      const vatPaid = allocations.reduce((sum, a) => sum + (parseFloat(a.vat_paid) || 0), 0);
      const totalPaid = allocations.reduce((sum, a) => sum + (parseFloat(a.paid_amount) || 0), 0);

      // Map allocations to investorAllocations format for frontend
      const investorAllocations = allocations.map(a => ({
        id: a.id,
        investorId: a.user_id,
        email: a.users?.email || null,
        investorName: a.users ? `${a.users.first_name || ''} ${a.users.last_name || ''}`.trim() : null,
        // Call amounts
        callAmount: parseFloat(a.allocated_amount) || 0,
        principalAmount: parseFloat(a.principal_amount) || 0,
        managementFee: parseFloat(a.management_fee_net) || 0,
        vatAmount: parseFloat(a.vat_amount) || 0,
        totalDue: parseFloat(a.total_due) || 0,
        // Paid amounts
        amountPaid: parseFloat(a.paid_amount) || 0,
        capitalPaid: parseFloat(a.capital_paid) || 0,
        feesPaid: parseFloat(a.fees_paid) || 0,
        vatPaid: parseFloat(a.vat_paid) || 0,
        // Status
        status: a.status || 'Pending'
      }));

      return {
        ...this._toModel(item),
        structure: item.structures ? {
          id: item.structures.id,
          name: item.structures.name,
          type: item.structures.type
        } : null,
        // Per-investor allocations for commitment tracking
        investorAllocations,
        // Payment breakdown fields (aggregate totals)
        breakdown: {
          principal: totalPrincipal,
          fees: totalFees,
          vat: totalVat,
          totalDue: totalDue || (totalPrincipal + totalFees + totalVat),
          // Paid breakdown
          capitalPaid,
          feesPaid,
          vatPaid,
          totalPaid,
          // Outstanding breakdown
          capitalOutstanding: totalPrincipal - capitalPaid,
          feesOutstanding: totalFees - feesPaid,
          vatOutstanding: totalVat - vatPaid,
          totalOutstanding: (totalDue || (totalPrincipal + totalFees + totalVat)) - totalPaid
        }
      };
    });
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
    return this.find({ createdBy: userId });
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
   * Find capital calls by approval status (for approval workflow)
   * Supports filtering by single status, array of statuses, or with user filter
   */
  static async findByApprovalStatus(filter = {}) {
    const supabase = getSupabase();

    let query = supabase
      .from('capital_calls')
      .select(`
        *,
        structures:structure_id (
          id,
          name,
          type
        )
      `);

    // Filter by single approval status
    if (filter.approvalStatus) {
      query = query.eq('approval_status', filter.approvalStatus);
    }

    // Filter by array of approval statuses (IN clause)
    if (filter.approvalStatusIn && Array.isArray(filter.approvalStatusIn)) {
      query = query.in('approval_status', filter.approvalStatusIn);
    }

    // Filter by creator
    if (filter.createdBy) {
      query = query.eq('created_by', filter.createdBy);
    }

    // Filter by structure
    if (filter.structureId) {
      query = query.eq('structure_id', filter.structureId);
    }

    // Order by creation date, newest first
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding capital calls by approval status: ${error.message}`);
    }

    return data.map(item => ({
      ...this._toModel(item),
      structure: item.structures ? {
        id: item.structures.id,
        name: item.structures.name,
        type: item.structures.type
      } : null
    }));
  }

  /**
   * Find capital calls by user ID (investor)
   * Gets all capital calls that have allocations for the specified user
   */
  static async findByInvestorId(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('capital_calls')
      .select(`
        *,
        capital_call_allocations!inner (
          user_id
        )
      `)
      .eq('capital_call_allocations.user_id', userId)
      .order('call_date', { ascending: false });

    if (error) {
      throw new Error(`Error finding capital calls by user: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
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
        structures:structure_id (
          id,
          name,
          type,
          base_currency
        ),
        capital_call_allocations (
          id,
          user_id,
          allocated_amount,
          principal_amount,
          management_fee_net,
          vat_amount,
          total_due,
          paid_amount,
          capital_paid,
          fees_paid,
          vat_paid,
          ownership_percent,
          status,
          notice_sent,
          users:user_id (
            id,
            email,
            first_name,
            last_name,
            type
          )
        )
      `)
      .eq('id', capitalCallId)
      .single();

    if (error) {
      throw new Error(`Error finding capital call with allocations: ${error.message}`);
    }

    // Get the base model
    const capitalCall = this._toModel(data);

    // Add structure info
    capitalCall.structure = data.structures ? {
      id: data.structures.id,
      name: data.structures.name,
      type: data.structures.type,
      baseCurrency: data.structures.base_currency
    } : null;

    // Map allocations to investorAllocations format
    const allocations = data.capital_call_allocations || [];
    capitalCall.capital_call_allocations = allocations.map(a => ({
      id: a.id,
      user_id: a.user_id,
      investorId: a.user_id,
      investorName: a.users ? `${a.users.first_name || ''} ${a.users.last_name || ''}`.trim() || a.users.email : 'Unknown',
      investorType: a.users?.type || 'Individual',
      email: a.users?.email || null,
      // Call amounts
      allocated_amount: parseFloat(a.allocated_amount) || 0,
      call_amount: parseFloat(a.allocated_amount) || 0,
      callAmount: parseFloat(a.allocated_amount) || 0,
      principal_amount: parseFloat(a.principal_amount) || 0,
      principalAmount: parseFloat(a.principal_amount) || 0,
      management_fee_net: parseFloat(a.management_fee_net) || 0,
      managementFee: parseFloat(a.management_fee_net) || 0,
      vat_amount: parseFloat(a.vat_amount) || 0,
      vatAmount: parseFloat(a.vat_amount) || 0,
      total_due: parseFloat(a.total_due) || 0,
      totalDue: parseFloat(a.total_due) || 0,
      // Paid amounts
      paid_amount: parseFloat(a.paid_amount) || 0,
      amount_paid: parseFloat(a.paid_amount) || 0,
      amountPaid: parseFloat(a.paid_amount) || 0,
      capital_paid: parseFloat(a.capital_paid) || 0,
      capitalPaid: parseFloat(a.capital_paid) || 0,
      fees_paid: parseFloat(a.fees_paid) || 0,
      feesPaid: parseFloat(a.fees_paid) || 0,
      vat_paid: parseFloat(a.vat_paid) || 0,
      vatPaid: parseFloat(a.vat_paid) || 0,
      // Outstanding
      amount_outstanding: (parseFloat(a.total_due) || 0) - (parseFloat(a.paid_amount) || 0),
      amountOutstanding: (parseFloat(a.total_due) || 0) - (parseFloat(a.paid_amount) || 0),
      // Ownership and status
      ownership_percent: parseFloat(a.ownership_percent) || 0,
      ownershipPercent: parseFloat(a.ownership_percent) || 0,
      status: a.status || 'Pending',
      notice_sent: a.notice_sent || false,
      noticeSent: a.notice_sent || false,
      // User data for reference
      user: a.users ? {
        id: a.users.id,
        email: a.users.email,
        name: `${a.users.first_name || ''} ${a.users.last_name || ''}`.trim(),
        type: a.users.type
      } : null
    }));

    return capitalCall;
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
   * Uses the investors table (LP commitments) to find investors assigned to the structure
   */
  static async createAllocationsForStructure(capitalCallId, structureId) {
    const supabase = getSupabase();

    // Get all investors for this structure from structure_investors table (LP commitments + fee settings)
    const { data: investors, error: invError } = await supabase
      .from('structure_investors')
      .select('user_id, ownership_percent, commitment, fee_discount, vat_exempt')
      .eq('structure_id', structureId);

    if (invError) {
      throw new Error(`Error fetching structure investors: ${invError.message}`);
    }

    // Get unique investors with their ownership percentages and fee settings
    const investorMap = new Map();
    investors?.forEach(inv => {
      const userId = inv.user_id;
      const ownershipPercent = inv.ownership_percent || 0;
      const commitmentAmount = inv.commitment || 0;
      const feeDiscount = inv.fee_discount || 0;
      const vatExempt = inv.vat_exempt || false;

      if (!investorMap.has(userId)) {
        investorMap.set(userId, { ownershipPercent, commitment: commitmentAmount, feeDiscount, vatExempt });
      } else {
        // Sum up ownership if multiple investor records for same user
        const existing = investorMap.get(userId);
        investorMap.set(userId, {
          ownershipPercent: existing.ownershipPercent + ownershipPercent,
          commitment: existing.commitment + commitmentAmount,
          feeDiscount,
          vatExempt
        });
      }
    });

    const structureInvestors = Array.from(investorMap.entries()).map(([userId, data]) => ({
      user_id: userId,
      structure_id: structureId,
      ownership_percent: data.ownershipPercent,
      commitment: data.commitment,
      fee_discount: data.feeDiscount,
      vat_exempt: data.vatExempt
    }));

    // Get capital call details
    const capitalCall = await this.findById(capitalCallId);

    if (!capitalCall) {
      throw new Error('Capital call not found');
    }

    // Determine if we should use dual-rate mode (Proximity Parks)
    const isDualRateMode = capitalCall.managementFeeBase === 'nic_plus_unfunded' &&
      (capitalCall.feeRateOnNic != null || capitalCall.feeRateOnUnfunded != null);

    // Get structure for GP percentage (needed for fee offset in dual-rate mode)
    let structure = null;
    if (isDualRateMode) {
      const { data: structureData } = await supabase
        .from('structures')
        .select('gp_percentage')
        .eq('id', structureId)
        .single();
      structure = structureData;
    }

    // Calculate period fraction based on fee period
    let periodFraction = 1.0;
    if (capitalCall.feePeriod === 'quarterly') {
      periodFraction = 0.25;
    } else if (capitalCall.feePeriod === 'semi-annual') {
      periodFraction = 0.5;
    }

    let allocations;

    if (isDualRateMode) {
      // ===== PROXIMITY DUAL-RATE MODE =====
      const nicRate = capitalCall.feeRateOnNic || 0;
      const unfundedRate = capitalCall.feeRateOnUnfunded || 0;
      const gpPercentage = structure?.gp_percentage || 0;

      // Pass 1: Calculate each investor's NIC fee and Unfunded fee
      const investorFees = structureInvestors.map((si) => {
        const principalAmount = capitalCall.totalCallAmount * (si.ownership_percent / 100);
        const feeDiscount = si.fee_discount || 0;
        const vatExempt = si.vat_exempt || false;
        const commitment = si.commitment || 0;

        // NIC = calledCapital (commitment - unfunded). For unfunded, use commitment minus what's been called.
        // unfundedCommitment is the investor's remaining unfunded capital before this call
        const unfundedCommitment = commitment; // pre-call unfunded (simplified: full commitment for first call)
        const nicBase = commitment - unfundedCommitment; // prior NIC (0 for first call)

        // Calculate individual fees at full rates (before discount)
        const nicFeeGross = nicBase * periodFraction * (nicRate / 100);
        const unfundedFeeGross = unfundedCommitment * periodFraction * (unfundedRate / 100);
        const managementFeeGross = nicFeeGross + unfundedFeeGross;

        // Apply fee discount as multiplicative percentage: netFees = grossFees × (1 - discount/100)
        const investorDiscountAmount = managementFeeGross * (feeDiscount / 100);
        const nicFee = nicFeeGross * (1 - feeDiscount / 100);
        const unfundedFee = unfundedFeeGross * (1 - feeDiscount / 100);

        return {
          si,
          principalAmount,
          feeDiscount,
          investorDiscountAmount,
          vatExempt,
          nicFee,
          unfundedFee,
          managementFeeGross
        };
      });

      // Pass 2: Calculate fee offset (GP contribution)
      const totalFundFeeGross = investorFees.reduce((sum, f) => sum + f.managementFeeGross, 0);

      allocations = investorFees.map((f) => {
        // Management fee after investor discount (before GP offset)
        const managementFeeAfterDiscount = f.managementFeeGross - f.investorDiscountAmount;

        // Fee offset: proportional share of GP fee offset (applied after investor discount)
        let feeOffset = 0;
        let deemedGpContribution = 0;
        if (gpPercentage > 0 && totalFundFeeGross > 0) {
          // GP offset = investor's pro-rata share of fees * GP ownership percentage
          feeOffset = managementFeeAfterDiscount * (gpPercentage / 100);
          deemedGpContribution = -feeOffset;
        }

        const managementFeeNet = managementFeeAfterDiscount - feeOffset;

        // Calculate VAT if applicable
        let vatAmount = 0;
        if (capitalCall.vatApplicable && !f.vatExempt && capitalCall.vatRate) {
          vatAmount = managementFeeNet * (capitalCall.vatRate / 100);
        }

        const totalDue = f.principalAmount + managementFeeNet + vatAmount;

        // ProximityParks breakdown: investments = principal (when not explicitly set)
        // Fund expenses and reserves come from the capital call header if set
        const investmentsAmount = capitalCall.totalInvestments
          ? (capitalCall.totalInvestments * (f.si.ownership_percent / 100))
          : f.principalAmount;
        const fundExpensesAmount = capitalCall.totalFundExpenses
          ? (capitalCall.totalFundExpenses * (f.si.ownership_percent / 100))
          : 0;
        const reservesAmount = capitalCall.totalReserves
          ? (capitalCall.totalReserves * (f.si.ownership_percent / 100))
          : 0;
        // Total drawdown = investments + expenses + reserves + fees + VAT (counts toward commitment)
        const totalDrawdown = investmentsAmount + fundExpensesAmount + reservesAmount + managementFeeNet + vatAmount;

        return {
          capital_call_id: capitalCallId,
          user_id: f.si.user_id,
          allocated_amount: totalDue,
          paid_amount: 0,
          remaining_amount: totalDue,
          status: 'Pending',
          due_date: capitalCall.dueDate,
          // ILPA Fee Breakdown
          principal_amount: f.principalAmount,
          management_fee_gross: f.managementFeeGross,
          management_fee_discount: f.investorDiscountAmount,
          management_fee_net: managementFeeNet,
          vat_amount: vatAmount,
          total_due: totalDue,
          // Payment breakdown (separate tracking for commitment vs fees)
          capital_paid: 0,
          fees_paid: 0,
          vat_paid: 0,
          // Dual-rate breakdown columns
          nic_fee_amount: f.nicFee,
          unfunded_fee_amount: f.unfundedFee,
          fee_offset_amount: feeOffset,
          deemed_gp_contribution: deemedGpContribution,
          // ProximityParks breakdown fields
          investments_amount: investmentsAmount,
          fund_expenses_amount: fundExpensesAmount,
          reserves_amount: reservesAmount,
          total_drawdown: totalDrawdown
        };
      });
    } else {
      // ===== LEGACY SINGLE-RATE MODE (unchanged) =====
      allocations = structureInvestors.map((si) => {
        const principalAmount = capitalCall.totalCallAmount * (si.ownership_percent / 100);

        // Fee settings from the investor-structure record (per-structure)
        const feeDiscount = si.fee_discount || 0;
        const vatExempt = si.vat_exempt || false;

        // Calculate management fee if ILPA fee config is set
        let managementFeeGross = 0;
        let managementFeeDiscountAmount = 0;
        let managementFeeNet = 0;
        let vatAmount = 0;

        if (capitalCall.managementFeeRate) {
          // Calculate based on fee period
          let periodRate = capitalCall.managementFeeRate;
          if (capitalCall.feePeriod === 'quarterly') {
            periodRate = capitalCall.managementFeeRate / 4;
          } else if (capitalCall.feePeriod === 'semi-annual') {
            periodRate = capitalCall.managementFeeRate / 2;
          }

          // Fee base is the principal amount for this investor
          managementFeeGross = principalAmount * (periodRate / 100);
          managementFeeDiscountAmount = managementFeeGross * (feeDiscount / 100);
          managementFeeNet = managementFeeGross - managementFeeDiscountAmount;

          // Calculate VAT if applicable
          if (capitalCall.vatApplicable && !vatExempt && capitalCall.vatRate) {
            vatAmount = managementFeeNet * (capitalCall.vatRate / 100);
          }
        }

        const totalDue = principalAmount + managementFeeNet + vatAmount;

        // ProximityParks breakdown: investments = principal (when not explicitly set)
        // Fund expenses and reserves come from the capital call header if set
        const investmentsAmount = capitalCall.totalInvestments
          ? (capitalCall.totalInvestments * (si.ownership_percent / 100))
          : principalAmount;
        const fundExpensesAmount = capitalCall.totalFundExpenses
          ? (capitalCall.totalFundExpenses * (si.ownership_percent / 100))
          : 0;
        const reservesAmount = capitalCall.totalReserves
          ? (capitalCall.totalReserves * (si.ownership_percent / 100))
          : 0;
        // Total drawdown = investments + expenses + reserves + fees + VAT (counts toward commitment)
        const totalDrawdown = investmentsAmount + fundExpensesAmount + reservesAmount + managementFeeNet + vatAmount;

        return {
          capital_call_id: capitalCallId,
          user_id: si.user_id,
          allocated_amount: totalDue,
          paid_amount: 0,
          remaining_amount: totalDue,
          status: 'Pending',
          due_date: capitalCall.dueDate,
          // ILPA Fee Breakdown
          principal_amount: principalAmount,
          management_fee_gross: managementFeeGross,
          management_fee_discount: managementFeeDiscountAmount,
          management_fee_net: managementFeeNet,
          vat_amount: vatAmount,
          total_due: totalDue,
          // Payment breakdown (separate tracking for commitment vs fees)
          capital_paid: 0,
          fees_paid: 0,
          vat_paid: 0,
          // ProximityParks breakdown fields
          investments_amount: investmentsAmount,
          fund_expenses_amount: fundExpensesAmount,
          reserves_amount: reservesAmount,
          total_drawdown: totalDrawdown
        };
      });
    }

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

  /**
   * Find capital calls where notice should be sent today
   * Returns calls where noticeDate = today and status is 'Draft'
   */
  static async findCallsToNotifyToday() {
    const supabase = getSupabase();
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('capital_calls')
      .select(`
        *,
        structures:structure_id (
          id,
          name,
          type,
          base_currency
        )
      `)
      .eq('notice_date', today)
      .eq('status', 'Draft');

    if (error) {
      throw new Error(`Error finding calls to notify: ${error.message}`);
    }

    return data.map(item => ({
      ...this._toModel(item),
      structure: item.structures ? {
        id: item.structures.id,
        name: item.structures.name,
        type: item.structures.type,
        baseCurrency: item.structures.base_currency
      } : null
    }));
  }

  /**
   * Find capital calls where deadline reminders should be sent
   * @param {number} daysBeforeDeadline - Number of days before deadline (e.g., 3, 1, 0)
   */
  static async findCallsForDeadlineReminder(daysBeforeDeadline) {
    const supabase = getSupabase();
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysBeforeDeadline);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('capital_calls')
      .select(`
        *,
        structures:structure_id (
          id,
          name,
          type,
          base_currency
        )
      `)
      .eq('deadline_date', targetDateStr)
      .in('status', ['Sent', 'Partially Paid']);

    if (error) {
      throw new Error(`Error finding calls for reminder: ${error.message}`);
    }

    return data.map(item => ({
      ...this._toModel(item),
      structure: item.structures ? {
        id: item.structures.id,
        name: item.structures.name,
        type: item.structures.type,
        baseCurrency: item.structures.base_currency
      } : null
    }));
  }

  /**
   * Get unpaid allocations for a capital call
   * Returns allocations where paid_amount < allocated_amount
   */
  static async getUnpaidAllocations(capitalCallId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('capital_call_allocations')
      .select(`
        *,
        users:user_id (
          id,
          email,
          first_name,
          last_name
        )
      `)
      .eq('capital_call_id', capitalCallId)
      .neq('status', 'Paid');

    if (error) {
      throw new Error(`Error getting unpaid allocations: ${error.message}`);
    }

    return data.map(item => ({
      id: item.id,
      capitalCallId: item.capital_call_id,
      userId: item.user_id,
      allocatedAmount: item.allocated_amount,
      paidAmount: item.paid_amount,
      remainingAmount: item.remaining_amount,
      status: item.status,
      dueDate: item.due_date,
      principalAmount: item.principal_amount,
      managementFeeNet: item.management_fee_net,
      vatAmount: item.vat_amount,
      totalDue: item.total_due,
      user: item.users ? {
        id: item.users.id,
        email: item.users.email,
        firstName: item.users.first_name,
        lastName: item.users.last_name
      } : null
    }));
  }

  /**
   * Get all allocations for a capital call (for initial notice)
   */
  static async getAllocationsWithUsers(capitalCallId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('capital_call_allocations')
      .select(`
        *,
        users:user_id (
          id,
          email,
          first_name,
          last_name
        )
      `)
      .eq('capital_call_id', capitalCallId);

    if (error) {
      throw new Error(`Error getting allocations: ${error.message}`);
    }

    return data.map(item => ({
      id: item.id,
      capitalCallId: item.capital_call_id,
      userId: item.user_id,
      allocatedAmount: item.allocated_amount,
      paidAmount: item.paid_amount,
      remainingAmount: item.remaining_amount,
      status: item.status,
      dueDate: item.due_date,
      principalAmount: item.principal_amount,
      managementFeeNet: item.management_fee_net,
      vatAmount: item.vat_amount,
      totalDue: item.total_due,
      user: item.users ? {
        id: item.users.id,
        email: item.users.email,
        firstName: item.users.first_name,
        lastName: item.users.last_name
      } : null
    }));
  }

  /**
   * Get cumulative called amount for an investor in a structure
   * @param {string} structureId - The structure ID
   * @param {string} userId - The investor's user ID
   * @param {string} excludeCallId - Optional capital call ID to exclude (for editing)
   * @returns {number} Total amount previously called from this investor
   */
  static async getCumulativeCalledByInvestor(structureId, userId, excludeCallId = null) {
    const supabase = getSupabase();

    // Get all capital calls for this structure that are not drafts
    let query = supabase
      .from('capital_calls')
      .select('id')
      .eq('structure_id', structureId)
      .in('status', ['Sent', 'Paid', 'Fully Paid', 'Partially Paid']);

    if (excludeCallId) {
      query = query.neq('id', excludeCallId);
    }

    const { data: calls, error: callsError } = await query;

    if (callsError) {
      throw new Error(`Error fetching capital calls: ${callsError.message}`);
    }

    if (!calls || calls.length === 0) {
      return 0;
    }

    const callIds = calls.map(c => c.id);

    // Get all allocations for this investor across these calls
    // Use total_drawdown for ProximityParks methodology (counts toward commitment)
    const { data: allocations, error: allocError } = await supabase
      .from('capital_call_allocations')
      .select('total_drawdown, total_due, principal_amount')
      .eq('user_id', userId)
      .in('capital_call_id', callIds);

    if (allocError) {
      throw new Error(`Error fetching allocations: ${allocError.message}`);
    }

    // Sum using total_drawdown (ProximityParks methodology)
    // Fallback chain: total_drawdown > total_due > principal_amount
    const cumulativeCalled = allocations?.reduce((sum, a) => {
      return sum + (a.total_drawdown || a.total_due || a.principal_amount || 0);
    }, 0) || 0;

    return cumulativeCalled;
  }

  /**
   * Get historical capital calls for a structure with investor-level details
   * @param {string} structureId - The structure ID
   * @returns {Array} Array of historical capital calls with allocations
   */
  static async getHistoryByStructure(structureId) {
    const supabase = getSupabase();

    // Get all capital calls for this structure (not drafts)
    const { data: calls, error: callsError } = await supabase
      .from('capital_calls')
      .select(`
        *,
        capital_call_allocations (
          id,
          user_id,
          principal_amount,
          management_fee_gross,
          management_fee_discount,
          management_fee_net,
          vat_amount,
          total_due,
          paid_amount,
          remaining_amount,
          status,
          nic_fee_amount,
          unfunded_fee_amount,
          fee_offset_amount,
          investments_amount,
          fund_expenses_amount,
          reserves_amount,
          total_drawdown,
          users:user_id (
            first_name,
            last_name,
            email
          )
        )
      `)
      .eq('structure_id', structureId)
      .in('status', ['Sent', 'Paid', 'Fully Paid', 'Partially Paid'])
      .order('call_date', { ascending: true });

    if (callsError) {
      throw new Error(`Error fetching capital call history: ${callsError.message}`);
    }

    // Transform to model format
    return calls.map(call => ({
      id: call.id,
      callNumber: call.call_number,
      callDate: call.call_date,
      deadlineDate: call.deadline_date,
      totalCallAmount: call.total_call_amount,
      totalPaidAmount: call.total_paid_amount,
      totalUnpaidAmount: call.total_unpaid_amount,
      status: call.status,
      purpose: call.purpose,
      allocations: (call.capital_call_allocations || []).map(a => ({
        id: a.id,
        userId: a.user_id,
        investorName: a.users
          ? `${a.users.first_name || ''} ${a.users.last_name || ''}`.trim() || a.users.email
          : 'Unknown',
        principalAmount: a.principal_amount,
        managementFeeGross: a.management_fee_gross,
        managementFeeDiscount: a.management_fee_discount,
        managementFeeNet: a.management_fee_net,
        vatAmount: a.vat_amount,
        totalDue: a.total_due,
        paidAmount: a.paid_amount,
        remainingAmount: a.remaining_amount,
        status: a.status,
        nicFeeAmount: a.nic_fee_amount,
        unfundedFeeAmount: a.unfunded_fee_amount,
        feeOffsetAmount: a.fee_offset_amount,
        // ProximityParks breakdown fields
        investmentsAmount: a.investments_amount,
        fundExpensesAmount: a.fund_expenses_amount,
        reservesAmount: a.reserves_amount,
        totalDrawdown: a.total_drawdown
      }))
    }));
  }

  /**
   * Get cumulative called amounts for all investors in a structure
   * @param {string} structureId - The structure ID
   * @param {string} excludeCallId - Optional capital call ID to exclude
   * @returns {Object} Map of userId -> cumulativeCalled
   */
  static async getCumulativeCalledByStructure(structureId, excludeCallId = null) {
    const supabase = getSupabase();

    // Get all capital calls for this structure that are not drafts
    let query = supabase
      .from('capital_calls')
      .select('id')
      .eq('structure_id', structureId)
      .in('status', ['Sent', 'Paid', 'Fully Paid', 'Partially Paid']);

    if (excludeCallId) {
      query = query.neq('id', excludeCallId);
    }

    const { data: calls, error: callsError } = await query;

    if (callsError) {
      throw new Error(`Error fetching capital calls: ${callsError.message}`);
    }

    if (!calls || calls.length === 0) {
      return {};
    }

    const callIds = calls.map(c => c.id);

    // Get all allocations across these calls
    // Use total_drawdown for ProximityParks methodology (counts toward commitment)
    const { data: allocations, error: allocError } = await supabase
      .from('capital_call_allocations')
      .select('user_id, total_drawdown, total_due, principal_amount')
      .in('capital_call_id', callIds);

    if (allocError) {
      throw new Error(`Error fetching allocations: ${allocError.message}`);
    }

    // Aggregate by user using total_drawdown (ProximityParks methodology)
    // Fallback chain: total_drawdown > total_due > principal_amount
    const cumulativeMap = {};
    allocations?.forEach(a => {
      const userId = a.user_id;
      if (!cumulativeMap[userId]) {
        cumulativeMap[userId] = 0;
      }
      // ProximityParks: use total_drawdown which includes investments + expenses + reserves + fees + VAT
      cumulativeMap[userId] += a.total_drawdown || a.total_due || a.principal_amount || 0;
    });

    return cumulativeMap;
  }
}

module.exports = CapitalCall;
