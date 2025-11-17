/**
 * Investor Supabase Model
 * Handles Individual, Institution, Fund of Funds, and Family Office investors
 */

const { getSupabase } = require('../../config/database');

class Investor {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      investorType: 'investor_type',
      email: 'email',
      phoneNumber: 'phone_number',
      country: 'country',
      taxId: 'tax_id',
      kycStatus: 'kyc_status',
      accreditedInvestor: 'accredited_investor',
      riskTolerance: 'risk_tolerance',
      investmentPreferences: 'investment_preferences',
      // Individual fields
      fullName: 'full_name',
      dateOfBirth: 'date_of_birth',
      nationality: 'nationality',
      passportNumber: 'passport_number',
      addressLine1: 'address_line1',
      addressLine2: 'address_line2',
      city: 'city',
      state: 'state',
      postalCode: 'postal_code',
      // Institution fields
      institutionName: 'institution_name',
      institutionType: 'institution_type',
      registrationNumber: 'registration_number',
      legalRepresentative: 'legal_representative',
      // Fund of Funds fields
      fundName: 'fund_name',
      fundManager: 'fund_manager',
      aum: 'aum',
      // Family Office fields
      officeName: 'office_name',
      familyName: 'family_name',
      principalContact: 'principal_contact',
      assetsUnderManagement: 'assets_under_management',
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
      investorType: dbData.investor_type,
      email: dbData.email,
      phoneNumber: dbData.phone_number,
      country: dbData.country,
      taxId: dbData.tax_id,
      kycStatus: dbData.kyc_status,
      accreditedInvestor: dbData.accredited_investor,
      riskTolerance: dbData.risk_tolerance,
      investmentPreferences: dbData.investment_preferences,
      // Individual fields
      fullName: dbData.full_name,
      dateOfBirth: dbData.date_of_birth,
      nationality: dbData.nationality,
      passportNumber: dbData.passport_number,
      addressLine1: dbData.address_line1,
      addressLine2: dbData.address_line2,
      city: dbData.city,
      state: dbData.state,
      postalCode: dbData.postal_code,
      // Institution fields
      institutionName: dbData.institution_name,
      institutionType: dbData.institution_type,
      registrationNumber: dbData.registration_number,
      legalRepresentative: dbData.legal_representative,
      // Fund of Funds fields
      fundName: dbData.fund_name,
      fundManager: dbData.fund_manager,
      aum: dbData.aum,
      // Family Office fields
      officeName: dbData.office_name,
      familyName: dbData.family_name,
      principalContact: dbData.principal_contact,
      assetsUnderManagement: dbData.assets_under_management,
      createdBy: dbData.created_by,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new investor
   */
  static async create(investorData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(investorData);

    const { data, error } = await supabase
      .from('investors')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating investor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find investor by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('investors')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding investor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find investor by email
   */
  static async findByEmail(email) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('investors')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding investor by email: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find investors by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('investors').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding investors: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find investors by user ID
   */
  static async findByUserId(userId) {
    return this.find({ createdBy: userId });
  }

  /**
   * Find investors by type
   */
  static async findByType(investorType, userId) {
    const filter = { investorType };
    if (userId) filter.createdBy = userId;
    return this.find(filter);
  }

  /**
   * Update investor by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    console.log('=== MODEL UPDATE DEBUG ===');
    console.log('DB Data (snake_case):', JSON.stringify(dbData, null, 2));

    const { data, error } = await supabase
      .from('investors')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.log('Supabase Error:', error);
      throw new Error(`Error updating investor: ${error.message}`);
    }

    console.log('Supabase Response Data:', JSON.stringify(data, null, 2));
    console.log('==========================');

    return this._toModel(data);
  }

  /**
   * Delete investor by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('investors')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting investor: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get investor with all structures
   */
  static async findWithStructures(investorId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('investors')
      .select(`
        *,
        structure_investors (
          *,
          structure:structures (*)
        )
      `)
      .eq('id', investorId)
      .single();

    if (error) {
      throw new Error(`Error finding investor with structures: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Get investor portfolio summary
   */
  static async getPortfolioSummary(investorId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_investor_portfolio_summary', {
      investor_id: investorId
    });

    if (error) {
      throw new Error(`Error getting investor portfolio: ${error.message}`);
    }

    return data;
  }

  /**
   * Search investors by name or email
   */
  static async search(searchTerm, userId) {
    const supabase = getSupabase();

    let query = supabase
      .from('investors')
      .select('*');

    if (userId) {
      query = query.eq('created_by', userId);
    }

    // Search across multiple fields depending on investor type
    query = query.or(`email.ilike.*${searchTerm}*,full_name.ilike.*${searchTerm}*,institution_name.ilike.*${searchTerm}*,fund_name.ilike.*${searchTerm}*,office_name.ilike.*${searchTerm}*`);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error searching investors: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Get display name based on investor type
   */
  static getDisplayName(investor) {
    switch (investor.investorType) {
      case 'Individual':
        return investor.fullName;
      case 'Institution':
        return investor.institutionName;
      case 'Fund of Funds':
        return investor.fundName;
      case 'Family Office':
        return investor.officeName;
      default:
        return investor.email;
    }
  }
}

module.exports = Investor;
