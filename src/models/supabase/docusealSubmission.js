/**
 * DocusealSubmission Supabase Model
 * Handles DocuSeal submission tracking
 */

const { getSupabase } = require('../../config/database');

class DocusealSubmission {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      email: 'email',
      submissionId: 'submission_id',
      submissionURL: 'submission_url',
      auditLogUrl: 'audit_log_url',
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
      email: dbData.email,
      submissionId: dbData.submission_id,
      submissionURL: dbData.submission_url,
      auditLogUrl: dbData.audit_log_url,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new DocuSeal submission record
   * @param {Object} data - Submission data
   * @returns {Promise<Object>} Created submission
   */
  static async create(data) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(data);

    const { data: result, error } = await supabase
      .from('docuseal_submissions')
      .insert([dbData])
      .select()
      .single();

    if (error) throw error;

    return this._toModel(result);
  }

  /**
   * Find submission by ID
   * @param {string} id - Submission ID
   * @returns {Promise<Object|null>} Submission or null
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('docuseal_submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find submission by submission ID
   * @param {number} submissionId - DocuSeal submission ID
   * @returns {Promise<Object|null>} Submission or null
   */
  static async findBySubmissionId(submissionId) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('docuseal_submissions')
      .select('*')
      .eq('submission_id', submissionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }

    return this._toModel(data);
  }

  /**
   * Find submissions by email
   * @param {string} email - Email address
   * @returns {Promise<Array>} Array of submissions
   */
  static async findByEmail(email) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('docuseal_submissions')
      .select('*')
      .eq('email', email.toLowerCase());

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Find submissions by criteria
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array>} Array of submissions
   */
  static async find(criteria = {}) {
    const supabase = getSupabase();
    const dbCriteria = this._toDbFields(criteria);

    let query = supabase.from('docuseal_submissions').select('*');

    Object.entries(dbCriteria).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query;

    if (error) throw error;

    return data.map(item => this._toModel(item));
  }

  /**
   * Update submission by ID
   * @param {string} id - Submission ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated submission
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('docuseal_submissions')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }

  /**
   * Delete submission by ID
   * @param {string} id - Submission ID
   * @returns {Promise<Object>} Deleted submission
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('docuseal_submissions')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return this._toModel(data);
  }
}

module.exports = DocusealSubmission;
