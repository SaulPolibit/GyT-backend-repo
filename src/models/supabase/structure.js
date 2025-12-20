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
      subtype: 'subtype',
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
      stage: 'stage',
      performanceFee: 'performance_fee',
      performanceMethodology: 'performance_methodology',
      preferredReturn: 'preferred_return',
      plannedInvestments: 'planned_investments',
      investors: 'investors',
      bannerImage: 'banner_image',
      managementControl: 'management_control',
      capitalContributions: 'capital_contributions',
      allocationsDistributions: 'allocations_distributions',
      limitedPartnerObligations: 'limited_partner_obligations',
      limitedPartnerRights: 'limited_partner_rights',
      lockUpPeriod: 'lock_up_period',
      withdrawalConditions: 'withdrawal_conditions',
      withdrawalProcess: 'withdrawal_process',
      generalProhibition: 'general_prohibition',
      permittedTransfers: 'permitted_transfers',
      transferRequirements: 'transfer_requirements',
      quarterlyReports: 'quarterly_reports',
      annualReports: 'annual_reports',
      taxForms: 'tax_forms',
      capitalCallDistributionsNotices: 'capital_call_distributions_notices',
      additionalCommunications: 'additional_communications',
      limitedLiability: 'limited_liability',
      exceptionsLiability: 'exceptions_liability',
      maximumExposure: 'maximum_exposure',
      indemnifiesPartnership: 'indemnifies_partnership',
      lpIndemnifiesPartnership: 'lp_indemnifies_partnership',
      indemnifiesProcedures: 'indemnifies_procedures',
      amendments: 'amendments',
      dissolution: 'dissolution',
      disputesResolution: 'disputes_resolution',
      governingLaw: 'governing_law',
      additionalProvisions: 'additional_provisions',
      minimumTicket: 'minimum_ticket',
      maximumTicket: 'maximum_ticket',
      strategyInstrumentType: 'strategy_instrument_type',
      localBankName: 'local_bank_name',
      localAccountBank: 'local_account_bank',
      localRoutingBank: 'local_routing_bank',
      localAccountHolder: 'local_account_holder',
      localBankAddress: 'local_bank_address',
      internationalBankName: 'international_bank_name',
      internationalAccountBank: 'international_account_bank',
      internationalSwift: 'international_swift',
      internationalHolderName: 'international_holder_name',
      internationalBankAddress: 'international_bank_address',
      blockchainNetwork: 'blockchain_network',
      walletAddress: 'wallet_address',
      debtGrossInterestRate: 'debt_gross_interest_rate',
      debtInterestRate: 'debt_interest_rate',
      parentStructureOwnershipPercentage: 'parent_structure_ownership_percentage',
      capitalCallNoticePeriod: 'capital_call_notice_period',
      capitalCallPaymentDeadline: 'capital_call_payment_deadline',
      distributionFrequency: 'distribution_frequency',
      witholdingDividendTaxRateNaturalPersons: 'witholding_dividend_tax_rate_natural_persons',
      witholdingDividendTaxRateLegalEntities: 'witholding_dividend_tax_rate_legal_entities',
      incomeDebtTaxRateNaturalPersons: 'income_debt_tax_rate_natural_persons',
      incomeEquityTaxRateNaturalPersons: 'income_equity_tax_rate_natural_persons',
      incomeDebtTaxRateLegalEntities: 'income_debt_tax_rate_legal_entities',
      incomeEquityTaxRateLegalEntities: 'income_equity_tax_rate_legal_entities',
      walletOwnerAddress: 'wallet_owner_address',
      operatingAgreementHash: 'operating_agreement_hash',
      incomeFlowTarget: 'income_flow_target',
      vatRate: 'vat_rate',
      vatRateNaturalPersons: 'vat_rate_natural_persons',
      vatRateLegalEntities: 'vat_rate_legal_entities',
      defaultTaxRate: 'default_tax_rate',
      determinedTier: 'determined_tier',
      calculatedIssuances: 'calculated_issuances',
      capitalCallDefaultPercentage: 'capital_call_default_percentage',
      fundType: 'fund_type',
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
      name: dbData.name,
      type: dbData.type,
      subtype: dbData.subtype,
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
      stage: dbData.stage,
      performanceFee: dbData.performance_fee,
      performanceMethodology: dbData.performance_methodology,
      preferredReturn: dbData.preferred_return,
      plannedInvestments: dbData.planned_investments,
      investors: dbData.investors,
      bannerImage: dbData.banner_image,
      managementControl: dbData.management_control,
      capitalContributions: dbData.capital_contributions,
      allocationsDistributions: dbData.allocations_distributions,
      limitedPartnerObligations: dbData.limited_partner_obligations,
      limitedPartnerRights: dbData.limited_partner_rights,
      lockUpPeriod: dbData.lock_up_period,
      withdrawalConditions: dbData.withdrawal_conditions,
      withdrawalProcess: dbData.withdrawal_process,
      generalProhibition: dbData.general_prohibition,
      permittedTransfers: dbData.permitted_transfers,
      transferRequirements: dbData.transfer_requirements,
      quarterlyReports: dbData.quarterly_reports,
      annualReports: dbData.annual_reports,
      taxForms: dbData.tax_forms,
      capitalCallDistributionsNotices: dbData.capital_call_distributions_notices,
      additionalCommunications: dbData.additional_communications,
      limitedLiability: dbData.limited_liability,
      exceptionsLiability: dbData.exceptions_liability,
      maximumExposure: dbData.maximum_exposure,
      indemnifiesPartnership: dbData.indemnifies_partnership,
      lpIndemnifiesPartnership: dbData.lp_indemnifies_partnership,
      indemnifiesProcedures: dbData.indemnifies_procedures,
      amendments: dbData.amendments,
      dissolution: dbData.dissolution,
      disputesResolution: dbData.disputes_resolution,
      governingLaw: dbData.governing_law,
      additionalProvisions: dbData.additional_provisions,
      minimumTicket: dbData.minimum_ticket,
      maximumTicket: dbData.maximum_ticket,
      strategyInstrumentType: dbData.strategy_instrument_type,
      localBankName: dbData.local_bank_name,
      localAccountBank: dbData.local_account_bank,
      localRoutingBank: dbData.local_routing_bank,
      localAccountHolder: dbData.local_account_holder,
      localBankAddress: dbData.local_bank_address,
      internationalBankName: dbData.international_bank_name,
      internationalAccountBank: dbData.international_account_bank,
      internationalSwift: dbData.international_swift,
      internationalHolderName: dbData.international_holder_name,
      internationalBankAddress: dbData.international_bank_address,
      blockchainNetwork: dbData.blockchain_network,
      walletAddress: dbData.wallet_address,
      debtGrossInterestRate: dbData.debt_gross_interest_rate,
      debtInterestRate: dbData.debt_interest_rate,
      parentStructureOwnershipPercentage: dbData.parent_structure_ownership_percentage,
      capitalCallNoticePeriod: dbData.capital_call_notice_period,
      capitalCallPaymentDeadline: dbData.capital_call_payment_deadline,
      distributionFrequency: dbData.distribution_frequency,
      witholdingDividendTaxRateNaturalPersons: dbData.witholding_dividend_tax_rate_natural_persons,
      witholdingDividendTaxRateLegalEntities: dbData.witholding_dividend_tax_rate_legal_entities,
      incomeDebtTaxRateNaturalPersons: dbData.income_debt_tax_rate_natural_persons,
      incomeEquityTaxRateNaturalPersons: dbData.income_equity_tax_rate_natural_persons,
      incomeDebtTaxRateLegalEntities: dbData.income_debt_tax_rate_legal_entities,
      incomeEquityTaxRateLegalEntities: dbData.income_equity_tax_rate_legal_entities,
      walletOwnerAddress: dbData.wallet_owner_address,
      operatingAgreementHash: dbData.operating_agreement_hash,
      incomeFlowTarget: dbData.income_flow_target,
      vatRate: dbData.vat_rate,
      vatRateNaturalPersons: dbData.vat_rate_natural_persons,
      vatRateLegalEntities: dbData.vat_rate_legal_entities,
      defaultTaxRate: dbData.default_tax_rate,
      determinedTier: dbData.determined_tier,
      calculatedIssuances: dbData.calculated_issuances,
      capitalCallDefaultPercentage: dbData.capital_call_default_percentage,
      fundType: dbData.fund_type,
      createdBy: dbData.created_by,
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

    const structure = this._toModel(data);

    // New structures have no investors or investments yet
    structure.currentInvestors = 0;
    structure.currentInvestments = 0;

    return structure;
  }

  /**
   * Get actual investor count for a structure (count unique users from investments)
   */
  static async getInvestorCount(structureId) {
    const supabase = getSupabase();

    // Get all investments for this structure
    const { data, error } = await supabase
      .from('investments')
      .select('*')
      .eq('structure_id', structureId);

    if (error) {
      console.error(`Error counting investors: ${error.message}`);
      return 0;
    }

    // Count unique user IDs (investors) - support both old and new column names
    const uniqueInvestors = new Set(
      data.map(inv => inv.user_id || inv.created_by).filter(id => id !== null)
    );
    return uniqueInvestors.size;
  }

  /**
   * Get total investment count for a structure (count all investment rows)
   */
  static async getInvestmentCount(structureId) {
    const supabase = getSupabase();

    // Get all investments for this structure
    const { data, error } = await supabase
      .from('investments')
      .select('*')
      .eq('structure_id', structureId);

    if (error) {
      console.error(`Error counting investments: ${error.message}`);
      return 0;
    }

    return data ? data.length : 0;
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

    const structure = this._toModel(data);

    // Get current investor count and investment count from investments table
    structure.currentInvestors = await this.getInvestorCount(id);
    structure.currentInvestments = await this.getInvestmentCount(id);

    return structure;
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

    // Get current investor counts and investment counts for all structures
    const structures = await Promise.all(
      data.map(async (item) => {
        const structure = this._toModel(item);
        structure.currentInvestors = await this.getInvestorCount(item.id);
        structure.currentInvestments = await this.getInvestmentCount(item.id);
        return structure;
      })
    );

    return structures;
  }

  /**
   * Find structures by user ID
   */
  static async findByUserId(userId) {
    return this.find({ createdBy: userId });
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

    // Get current investor counts and investment counts for all structures
    const structures = await Promise.all(
      data.map(async (item) => {
        const structure = this._toModel(item);
        structure.currentInvestors = await this.getInvestorCount(item.id);
        structure.currentInvestments = await this.getInvestmentCount(item.id);
        return structure;
      })
    );

    return structures;
  }

  /**
   * Find root structures (no parent)
   */
  static async findRootStructures(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('structures')
      .select('*')
      .eq('created_by', userId)
      .is('parent_structure_id', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Error finding root structures: ${error.message}`);
    }

    // Get current investor counts and investment counts for all structures
    const structures = await Promise.all(
      data.map(async (item) => {
        const structure = this._toModel(item);
        structure.currentInvestors = await this.getInvestorCount(item.id);
        structure.currentInvestments = await this.getInvestmentCount(item.id);
        return structure;
      })
    );

    return structures;
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

    const structure = this._toModel(data);

    // Get current investor count and investment count from investments table
    structure.currentInvestors = await this.getInvestorCount(id);
    structure.currentInvestments = await this.getInvestmentCount(id);

    return structure;
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

    // Get structure
    const { data: structureData, error: structureError } = await supabase
      .from('structures')
      .select('*')
      .eq('id', structureId)
      .single();

    if (structureError) {
      throw new Error(`Error finding structure: ${structureError.message}`);
    }

    // Get investments for this structure
    const { data: investments, error: investmentsError } = await supabase
      .from('investments')
      .select('*')
      .eq('structure_id', structureId);

    if (investmentsError) {
      throw new Error(`Error finding investments: ${investmentsError.message}`);
    }

    const structure = this._toModel(structureData);

    // Count unique investors from investments (current investors)
    const uniqueInvestors = new Set(
      investments
        ?.map(inv => inv.user_id || inv.created_by) // Support both old and new column names
        .filter(id => id !== null) || []
    );
    structure.currentInvestors = uniqueInvestors.size;

    // Count total investments
    structure.currentInvestments = investments ? investments.length : 0;

    // Attach investments data
    structure.investments = investments;

    return structure;
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
