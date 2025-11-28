// models/supabase/user.js
const bcrypt = require('bcrypt');
const { getSupabase } = require('../../config/database');

// Role constants
const ROLES = {
  ROOT: 0,
  ADMIN: 1,
  SUPPORT: 2,
  INVESTOR: 3
};

// Role names for display
const ROLE_NAMES = {
  0: 'root',
  1: 'admin',
  2: 'support',
  3: 'investor'
};

class User {
  /**
   * Validate role value
   * @param {number} role - Role value to validate
   * @returns {boolean} True if valid role
   */
  static isValidRole(role) {
    return role === 0 || role === 1 || role === 2 || role === 3;
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
      throw new Error('Role is required. Must be 0 (root), 1 (admin), 2 (support), or 3 (investor)');
    }

    // Validate role value
    if (!this.isValidRole(userData.role)) {
      throw new Error('Invalid role. Must be 0 (root), 1 (admin), 2 (support), or 3 (investor)');
    }

    // Hash password before storing
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
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
      address: userData.address || null,
      country: userData.country || null,
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
        throw new Error('Invalid role. Must be 0 (root), 1 (admin), 2 (support), or 3 (investor)');
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
      address: dbUser.address,
      country: dbUser.country,
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
      address: 'address',
      country: 'country',
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
