// models/supabase/user.js
const bcrypt = require('bcrypt');
const { getSupabase } = require('../../config/database');

// Role constants
const ROLES = {
  ROOT: 0,
  ADMIN: 1,
  SUPPORT: 2,
  INVESTOR: 3,
  GUEST: 4
};

// Role names for display
const ROLE_NAMES = {
  0: 'root',
  1: 'admin',
  2: 'support',
  3: 'investor',
  4: 'guest'
};

class User {
  /**
   * Validate role value
   * @param {number} role - Role value to validate
   * @returns {boolean} True if valid role
   */
  static isValidRole(role) {
    return role === 0 || role === 1 || role === 2 || role === 3 || role === 4;
  }

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @returns {Promise<Object>} Created user
   */
  static async create(userData) {
    const supabase = getSupabase();

    // Validate role is required
    if (userData.role === undefined || userData.role === null) {
      throw new Error('Role is required. Must be 0 (root), 1 (admin), 2 (support), 3 (investor), or 4 (guest)');
    }

    // Validate role value
    if (!this.isValidRole(userData.role)) {
      throw new Error('Invalid role. Must be 0 (root), 1 (admin), 2 (support), 3 (investor), or 4 (guest)');
    }

    // Hash password before storing
    // For OAuth users, generate a random secure password they'll never use
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
    } else {
      // Generate random password for OAuth users (64 random characters)
      const crypto = require('crypto');
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(randomPassword, salt);
      console.log('[User Model] Generated random password for OAuth user');
    }

    // Convert camelCase to snake_case for database
    const dbData = {
      email: userData.email?.toLowerCase(),
      password: userData.password,
      first_name: userData.firstName,
      last_name: userData.lastName || '',
      app_language: userData.appLanguage || 'en',
      profile_image: userData.profileImage || null,
      role: userData.role,
      is_active: userData.isActive !== undefined ? userData.isActive : true,
      is_email_verified: userData.isEmailVerified || false,
      last_login: userData.lastLogin || null,
      password_reset_token: userData.passwordResetToken || null,
      password_reset_expires: userData.passwordResetExpires || null,
      email_verification_token: userData.emailVerificationToken || null,
      email_verification_expires: userData.emailVerificationExpires || null,
      kyc_id: userData.kycId || null,
      kyc_status: userData.kycStatus || null,
      kyc_url: userData.kycUrl || null,
      address: userData.addressLine1 || userData.address || null,
      country: userData.country || null,
      address_line2: userData.addressLine2 || null,
      city: userData.city || null,
      state: userData.state || null,
      postal_code: userData.postalCode || null,
      // Investor fields
      investor_type: userData.investorType || null,
      phone_number: userData.phoneNumber || null,
      tax_id: userData.taxId || null,
      accredited_investor: userData.accreditedInvestor || false,
      risk_tolerance: userData.riskTolerance || null,
      investment_preferences: userData.investmentPreferences || null,
      // Individual investor fields
      full_name: userData.fullName || null,
      date_of_birth: userData.dateOfBirth || null,
      nationality: userData.nationality || null,
      passport_number: userData.passportNumber || null,
      // Prospera profile fields
      country_of_birth: userData.countryOfBirth || null,
      citizenships: userData.citizenships || null,
      sex: userData.sex || null,
      entity_type: userData.entityType || 'individual',
      // Institution investor fields
      institution_name: userData.institutionName || null,
      institution_type: userData.institutionType || null,
      registration_number: userData.registrationNumber || null,
      legal_representative: userData.legalRepresentative || null,
      // Fund of Funds investor fields
      fund_name: userData.fundName || null,
      fund_manager: userData.fundManager || null,
      aum: userData.aum || null,
      // Family Office investor fields
      office_name: userData.officeName || null,
      family_name: userData.familyName || null,
      principal_contact: userData.principalContact || null,
      assets_under_management: userData.assetsUnderManagement || null,
      // OAuth provider fields
      prospera_id: userData.prosperaId || null,
      // Blockchain wallet
      wallet_address: userData.walletAddress || null,
      // Tax fields
      tax_classification: userData.taxClassification || null,
      w9_form: userData.w9Form || null,
    };

    // Include ID if provided (for Supabase Auth integration)
    if (userData.id) {
      dbData.id = userData.id;
    }

    const { data, error } = await supabase
      .from('users')
      .insert([dbData])
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Find user by ID
   * @param {string} id - User ID
   * @returns {Promise<Object|null>} User or null
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found

      // Handle "Cannot coerce result to single JSON object" error (duplicate rows)
      if (error.message && error.message.includes('JSON object')) {
        console.error('⚠️  [User.findById] Multiple users found with same ID! This should not happen.');
        console.error('⚠️  [User.findById] Falling back to first result. Please run fix_duplicate_users.sql migration!');

        // Fallback: Get first result instead of using .single()
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('users')
          .select('*')
          .eq('id', id)
          .order('created_at', { ascending: true })
          .limit(1);

        if (fallbackError) throw fallbackError;
        if (!fallbackData || fallbackData.length === 0) return null;

        return this._toModel(fallbackData[0]);
      }

      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find user by email
   * @param {string} email - User email
   * @returns {Promise<Object|null>} User or null
   */
  static async findByEmail(email) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found

      // Handle "Cannot coerce result to single JSON object" error (duplicate rows)
      if (error.message && error.message.includes('JSON object')) {
        console.error('⚠️  [User.findByEmail] Multiple users found with same email! This should not happen.');
        console.error('⚠️  [User.findByEmail] Falling back to first result. Please run fix_duplicate_users.sql migration!');

        // Fallback: Get first result instead of using .single()
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('users')
          .select('*')
          .eq('email', email.toLowerCase())
          .order('created_at', { ascending: true })
          .limit(1);

        if (fallbackError) throw fallbackError;
        if (!fallbackData || fallbackData.length === 0) return null;

        return this._toModel(fallbackData[0]);
      }

      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find user by Prospera ID
   * @param {string} prosperaId - Prospera user ID
   * @returns {Promise<Object|null>} User or null
   */
  static async findByProsperapId(prosperaId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('prospera_id', prosperaId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find one user by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object|null>} User or null
   */
  static async findOne(criteria) {
    const supabase = getSupabase();

    let query = supabase.from('users').select('*');

    // Convert camelCase criteria to snake_case
    const dbCriteria = this._toDbFields(criteria);

    // Apply filters
    Object.entries(dbCriteria).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find users by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array>} Array of users
   */
  static async find(criteria = {}) {
    const supabase = getSupabase();

    let query = supabase.from('users').select('*');

    // Convert camelCase criteria to snake_case
    const dbCriteria = this._toDbFields(criteria);

    // Apply filters
    Object.entries(dbCriteria).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query;

    if (error) throw error;

    return data.map(user => this._toModel(user));
  }

  /**
   * Update user by ID
   * @param {string} id - User ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated user
   */
  static async findByIdAndUpdate(id, updateData, options = {}) {
    const supabase = getSupabase();

    // Validate role if being updated
    if (updateData.role !== undefined && updateData.role !== null) {
      if (!this.isValidRole(updateData.role)) {
        throw new Error('Invalid role. Must be 0 (root), 1 (admin), 2 (support), 3 (investor), or 4 (guest)');
      }
    }

    // Hash password if being updated
    if (updateData.password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(updateData.password, salt);
    }

    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('users')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Delete user by ID
   * @param {string} id - User ID
   * @returns {Promise<Object>} Deleted user
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('users')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Compare password with stored hash
   * @param {string} userId - User ID
   * @param {string} candidatePassword - Password to compare
   * @returns {Promise<boolean>} True if password matches
   */
  static async comparePassword(userId, candidatePassword) {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');

    return await bcrypt.compare(candidatePassword, user.password);
  }

  /**
   * Add refresh token to user
   * @param {string} userId - User ID
   * @param {string} token - Refresh token
   * @returns {Promise<Object>} Created token record
   */
  static async addRefreshToken(userId, token) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('refresh_tokens')
      .insert([{ user_id: userId, token }])
      .select()
      .single();

    if (error) throw error;

    return data;
  }

  /**
   * Get user's refresh tokens
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of refresh tokens
   */
  static async getRefreshTokens(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('refresh_tokens')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;

    return data;
  }

  /**
   * Remove refresh token
   * @param {string} token - Token to remove
   * @returns {Promise<void>}
   */
  static async removeRefreshToken(token) {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('refresh_tokens')
      .delete()
      .eq('token', token);

    if (error) throw error;
  }

  /**
   * Search users by investor fields (name or email)
   * @param {string} searchTerm - Search term
   * @param {string} userId - Optional user ID to filter by (for role-based access)
   * @returns {Promise<Array>} Array of users matching the search
   */
  static async searchInvestors(searchTerm) {
    const supabase = getSupabase();

    const query = supabase
      .from('users')
      .select('*')
      .eq('role', ROLES.INVESTOR)
      .or(`email.ilike.*${searchTerm}*,first_name.ilike.*${searchTerm}*,last_name.ilike.*${searchTerm}*`);

    const { data, error } = await query;

    if (error) throw error;

    return data.map(user => this._toModel(user));
  }

  /**
   * Get user with all structures (for investors)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User with structures
   */
  static async findWithStructures(userId) {
    const supabase = getSupabase();

    // Get the user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError) {
      if (userError.code === 'PGRST116') {
        // User not found
        throw new Error('User not found');
      }
      throw userError;
    }

    // Get all investments for this user with structure details
    const { data: investments, error: invError } = await supabase
      .from('investments')
      .select(`
        structure_id,
        ownership_percentage,
        equity_ownership_percent,
        structures:structure_id (*)
      `)
      .eq('user_id', userId);

    if (invError) {
      throw new Error(`Error finding user structures: ${invError.message}`);
    }

    // Get unique structures from investments
    const uniqueStructures = new Map();
    investments?.forEach(inv => {
      if (inv.structures && !uniqueStructures.has(inv.structure_id)) {
        const ownershipPercent = inv.ownership_percentage || inv.equity_ownership_percent || 0;
        uniqueStructures.set(inv.structure_id, {
          structure_id: inv.structure_id,
          user_id: userId,
          ownership_percent: ownershipPercent,
          structure: inv.structures
        });
      }
    });

    // Attach structures to user
    user.structure_investors = Array.from(uniqueStructures.values());

    return this._toModel(user);
  }

  /**
   * Get user portfolio summary (for investors)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Portfolio summary
   */
  static async getPortfolioSummary(userId) {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('get_investor_portfolio_summary', {
      p_user_id: userId
    });

    if (error) throw error;

    return data;
  }

  /**
   * Get display name based on investor type
   * @param {Object} user - User object
   * @returns {string} Display name
   */
  static getDisplayName(user) {
    if (user.role !== ROLES.INVESTOR) {
      return `${user.firstName} ${user.lastName}`.trim() || user.email;
    }

    switch (user.investorType) {
      case 'Individual':
        return user.fullName || `${user.firstName} ${user.lastName}`.trim() || user.email;
      case 'Institution':
        return user.institutionName || user.email;
      case 'Fund of Funds':
        return user.fundName || user.email;
      case 'Family Office':
        return user.officeName || user.email;
      default:
        return user.email;
    }
  }

  /**
   * Get user commitments summary
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Commitments summary with structures
   */
  static async getCommitmentsSummary(userId) {
    const supabase = getSupabase();

    // Get all investments for this user with structure details
    const { data: investments, error: invError } = await supabase
      .from('investments')
      .select(`
        structure_id,
        ownership_percentage,
        equity_ownership_percent,
        structures:structure_id (
          id,
          name,
          type,
          status,
          total_commitment,
          base_currency
        )
      `)
      .eq('user_id', userId);

    if (invError) throw invError;

    // Get unique structures from investments
    const uniqueStructures = new Map();
    investments?.forEach(inv => {
      if (inv.structures && !uniqueStructures.has(inv.structure_id)) {
        const ownershipPercent = inv.ownership_percentage || inv.equity_ownership_percent || 0;
        uniqueStructures.set(inv.structure_id, {
          structure_id: inv.structure_id,
          user_id: userId,
          ownership_percent: ownershipPercent,
          structure: inv.structures
        });
      }
    });

    const structureInvestors = Array.from(uniqueStructures.values());

    if (!structureInvestors || structureInvestors.length === 0) {
      return {
        totalCommitment: 0,
        calledCapital: 0,
        uncalledCapital: 0,
        activeFunds: 0,
        structures: []
      };
    }

    // Get all capital call allocations for this user with structure info
    const { data: allocations, error: allocError } = await supabase
      .from('capital_call_allocations')
      .select(`
        allocated_amount,
        paid_amount,
        capital_call:capital_calls (
          structure_id
        )
      `)
      .eq('user_id', userId);

    if (allocError) throw allocError;

    // Calculate total called capital (sum of allocated amounts)
    const calledCapital = allocations?.reduce((sum, alloc) =>
      sum + (parseFloat(alloc.allocated_amount) || 0), 0) || 0;

    // Process structures
    const structures = structureInvestors.map(si => {
      // Filter allocations for this specific structure
      const structureAllocations = allocations?.filter(a =>
        a.capital_call?.structure_id === si.structure_id
      ) || [];

      const structureCalledCapital = structureAllocations.reduce((sum, alloc) =>
        sum + (parseFloat(alloc.allocated_amount) || 0), 0);

      const commitment = parseFloat(si.commitment_amount) || 0;
      const uncalledCapital = commitment - structureCalledCapital;

      return {
        id: si.structure.id,
        name: si.structure.name,
        type: si.structure.type,
        commitment: commitment,
        calledCapital: structureCalledCapital,
        uncalledCapital: uncalledCapital > 0 ? uncalledCapital : 0,
        ownershipPercent: parseFloat(si.ownership_percent) || 0,
        status: si.structure.status,
        investedDate: si.invested_at,
        onboardingStatus: 'Complete',
        currency: si.structure.base_currency || 'USD'
      };
    });

    // Calculate totals
    const totalCommitment = structures.reduce((sum, s) => sum + s.commitment, 0);
    const totalUncalledCapital = totalCommitment - calledCapital;
    const activeFunds = structures.filter(s => s.status === 'Active').length;

    return {
      totalCommitment,
      calledCapital,
      uncalledCapital: totalUncalledCapital > 0 ? totalUncalledCapital : 0,
      activeFunds,
      structures: structures.filter(s => s.status === 'Active')
    };
  }

  /**
   * Get capital calls summary for an investor
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Capital calls summary with structures and calls
   */
  static async getCapitalCallsSummary(userId) {
    const supabase = getSupabase();

    // Get all structures for this user from investments
    const { data: investments, error: invError } = await supabase
      .from('investments')
      .select(`
        structure_id,
        structures:structure_id (
          id,
          name,
          type,
          status
        )
      `)
      .eq('user_id', userId);

    if (invError) throw invError;

    // Get unique structures from investments
    const uniqueStructuresMap = new Map();
    (investments || []).forEach(inv => {
      if (inv.structures && !uniqueStructuresMap.has(inv.structure_id)) {
        uniqueStructuresMap.set(inv.structure_id, inv.structures);
      }
    });

    const structures = Array.from(uniqueStructuresMap.values()).map(structure => ({
      id: structure.id,
      name: structure.name,
      type: structure.type,
      status: structure.status
    }));

    // Get all capital call allocations for this user with capital call details
    const { data: allocations, error: allocError } = await supabase
      .from('capital_call_allocations')
      .select(`
        id,
        allocated_amount,
        paid_amount,
        status,
        capital_call:capital_calls (
          id,
          structure_id,
          call_number,
          call_date,
          due_date,
          status,
          purpose
        )
      `)
      .eq('user_id', userId);

    if (allocError) throw allocError;

    // Process capital calls and sort by call_date
    const capitalCalls = (allocations || [])
      .filter(alloc => alloc.capital_call)
      .sort((a, b) => {
        const dateA = new Date(a.capital_call.call_date);
        const dateB = new Date(b.capital_call.call_date);
        return dateB - dateA; // Sort descending (newest first)
      })
      .map(alloc => {
        const structure = structures.find(s => s.id === alloc.capital_call.structure_id);
        return {
          id: alloc.capital_call.id,
          structureId: alloc.capital_call.structure_id,
          structureName: structure?.name || 'Unknown Structure',
          callNumber: alloc.capital_call.call_number,
          callDate: alloc.capital_call.call_date,
          dueDate: alloc.capital_call.due_date,
          allocatedAmount: parseFloat(alloc.allocated_amount) || 0,
          paidAmount: parseFloat(alloc.paid_amount) || 0,
          outstanding: (parseFloat(alloc.allocated_amount) || 0) - (parseFloat(alloc.paid_amount) || 0),
          status: alloc.status || alloc.capital_call.status,
          purpose: alloc.capital_call.purpose
        };
      });

    // Calculate summary
    const totalCalled = capitalCalls.reduce((sum, call) => sum + call.allocatedAmount, 0);
    const totalPaid = capitalCalls.reduce((sum, call) => sum + call.paidAmount, 0);
    const outstanding = totalCalled - totalPaid;
    const totalCalls = capitalCalls.length;

    return {
      summary: {
        totalCalled,
        totalPaid,
        outstanding: outstanding > 0 ? outstanding : 0,
        totalCalls
      },
      structures: structures.filter(s => s.status === 'Active'),
      capitalCalls
    };
  }

  /**
   * Convert database fields to model fields (snake_case to camelCase)
   * @param {Object} dbUser - User from database
   * @returns {Object} User model
   * @private
   */
  static _toModel(dbUser) {
    if (!dbUser) return null;

    return {
      id: dbUser.id,
      email: dbUser.email,
      password: dbUser.password,
      firstName: dbUser.first_name,
      lastName: dbUser.last_name,
      appLanguage: dbUser.app_language,
      profileImage: dbUser.profile_image,
      role: dbUser.role,
      isActive: dbUser.is_active,
      isEmailVerified: dbUser.is_email_verified,
      lastLogin: dbUser.last_login,
      passwordResetToken: dbUser.password_reset_token,
      passwordResetExpires: dbUser.password_reset_expires,
      emailVerificationToken: dbUser.email_verification_token,
      emailVerificationExpires: dbUser.email_verification_expires,
      kycId: dbUser.kyc_id,
      kycStatus: dbUser.kyc_status,
      kycUrl: dbUser.kyc_url,
      addressLine1: dbUser.address,
      addressLine2: dbUser.address_line2,
      city: dbUser.city,
      state: dbUser.state,
      postalCode: dbUser.postal_code,
      country: dbUser.country,
      // Investor fields
      investorType: dbUser.investor_type,
      phoneNumber: dbUser.phone_number,
      taxId: dbUser.tax_id,
      accreditedInvestor: dbUser.accredited_investor,
      riskTolerance: dbUser.risk_tolerance,
      investmentPreferences: dbUser.investment_preferences,
      // Individual investor fields
      fullName: dbUser.full_name,
      dateOfBirth: dbUser.date_of_birth,
      nationality: dbUser.nationality,
      passportNumber: dbUser.passport_number,
      // Prospera profile fields
      countryOfBirth: dbUser.country_of_birth,
      citizenships: dbUser.citizenships,
      sex: dbUser.sex,
      entityType: dbUser.entity_type,
      // Institution investor fields
      institutionName: dbUser.institution_name,
      institutionType: dbUser.institution_type,
      registrationNumber: dbUser.registration_number,
      legalRepresentative: dbUser.legal_representative,
      // Fund of Funds investor fields
      fundName: dbUser.fund_name,
      fundManager: dbUser.fund_manager,
      aum: dbUser.aum,
      // Family Office investor fields
      officeName: dbUser.office_name,
      familyName: dbUser.family_name,
      principalContact: dbUser.principal_contact,
      assetsUnderManagement: dbUser.assets_under_management,
      // OAuth provider fields
      prosperaId: dbUser.prospera_id,
      // Blockchain wallet
      walletAddress: dbUser.wallet_address,
      // Tax fields
      taxClassification: dbUser.tax_classification,
      w9Form: dbUser.w9_form,
      // MFA
      mfaFactorId: dbUser.mfa_factor_id,
      // Stripe subscription fields
      stripeCustomerId: dbUser.stripe_customer_id,
      stripeSubscriptionId: dbUser.stripe_subscription_id,
      subscriptionStatus: dbUser.subscription_status,
      // Stripe Connect fields (for investors)
      stripeAccountId: dbUser.stripe_account_id,
      stripeOnboardingComplete: dbUser.stripe_onboarding_complete,
      stripeAccountStatus: dbUser.stripe_account_status,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,

      // Method to get JSON without sensitive data
      toJSON() {
        const user = { ...this };
        delete user.password;
        delete user.passwordResetToken;
        delete user.passwordResetExpires;
        delete user.emailVerificationToken;
        delete user.emailVerificationExpires;
        delete user.toJSON;
        return user;
      }
    };
  }

  /**
   * Convert model fields to database fields (camelCase to snake_case)
   * @param {Object} modelData - Data in camelCase
   * @returns {Object} Data in snake_case
   * @private
   */
  static _toDbFields(modelData) {
    const dbData = {};

    const fieldMap = {
      firstName: 'first_name',
      lastName: 'last_name',
      appLanguage: 'app_language',
      profileImage: 'profile_image',
      isActive: 'is_active',
      isEmailVerified: 'is_email_verified',
      lastLogin: 'last_login',
      passwordResetToken: 'password_reset_token',
      passwordResetExpires: 'password_reset_expires',
      emailVerificationToken: 'email_verification_token',
      emailVerificationExpires: 'email_verification_expires',
      kycId: 'kyc_id',
      kycStatus: 'kyc_status',
      kycUrl: 'kyc_url',
      addressLine1: 'address',
      addressLine2: 'address_line2',
      city: 'city',
      state: 'state',
      postalCode: 'postal_code',
      country: 'country',
      // Investor fields
      investorType: 'investor_type',
      phoneNumber: 'phone_number',
      taxId: 'tax_id',
      accreditedInvestor: 'accredited_investor',
      riskTolerance: 'risk_tolerance',
      investmentPreferences: 'investment_preferences',
      // Individual investor fields
      fullName: 'full_name',
      dateOfBirth: 'date_of_birth',
      nationality: 'nationality',
      passportNumber: 'passport_number',
      // Prospera profile fields
      countryOfBirth: 'country_of_birth',
      citizenships: 'citizenships',
      sex: 'sex',
      entityType: 'entity_type',
      // Institution investor fields
      institutionName: 'institution_name',
      institutionType: 'institution_type',
      registrationNumber: 'registration_number',
      legalRepresentative: 'legal_representative',
      // Fund of Funds investor fields
      fundName: 'fund_name',
      fundManager: 'fund_manager',
      aum: 'aum',
      // Family Office investor fields
      officeName: 'office_name',
      familyName: 'family_name',
      principalContact: 'principal_contact',
      assetsUnderManagement: 'assets_under_management',
      // OAuth provider fields
      prosperaId: 'prospera_id',
      // Blockchain wallet
      walletAddress: 'wallet_address',
      // Tax fields
      taxClassification: 'tax_classification',
      w9Form: 'w9_form',
      // MFA
      mfaFactorId: 'mfa_factor_id',
      // Stripe subscription fields
      stripeCustomerId: 'stripe_customer_id',
      stripeSubscriptionId: 'stripe_subscription_id',
      subscriptionStatus: 'subscription_status',
      // Stripe Connect fields (for investors)
      stripeAccountId: 'stripe_account_id',
      stripeOnboardingComplete: 'stripe_onboarding_complete',
      stripeAccountStatus: 'stripe_account_status',
    };

    Object.entries(modelData).forEach(([key, value]) => {
      const dbKey = fieldMap[key] || key;
      dbData[dbKey] = value;
    });

    return dbData;
  }
}

// Export User class and role constants
module.exports = User;
module.exports.ROLES = ROLES;
module.exports.ROLE_NAMES = ROLE_NAMES;
