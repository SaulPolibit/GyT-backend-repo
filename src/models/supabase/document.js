/**
 * Document Supabase Model
 * Handles polymorphic document storage for various entities
 */

const { getSupabase } = require('../../config/database');

class Document {
  /**
   * Convert camelCase fields to snake_case for database
   */
  static _toDbFields(data) {
    const dbData = {};
    const fieldMap = {
      id: 'id',
      entityType: 'entity_type',
      entityId: 'entity_id',
      documentType: 'document_type',
      documentName: 'document_name',
      filePath: 'file_path',
      fileSize: 'file_size',
      mimeType: 'mime_type',
      uploadedBy: 'uploaded_by',
      version: 'version',
      isActive: 'is_active',
      tags: 'tags',
      metadata: 'metadata',
      notes: 'notes',
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
      entityType: dbData.entity_type,
      entityId: dbData.entity_id,
      documentType: dbData.document_type,
      documentName: dbData.document_name,
      filePath: dbData.file_path,
      fileSize: dbData.file_size,
      mimeType: dbData.mime_type,
      uploadedBy: dbData.uploaded_by,
      version: dbData.version,
      isActive: dbData.is_active,
      tags: dbData.tags,
      metadata: dbData.metadata,
      notes: dbData.notes,
      userId: dbData.user_id,
      createdAt: dbData.created_at,
      updatedAt: dbData.updated_at
    };
  }

  /**
   * Create a new document
   */
  static async create(documentData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(documentData);

    const { data, error } = await supabase
      .from('documents')
      .insert([dbData])
      .select()
      .single();

    if (error) {
      throw new Error(`Error creating document: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find document by ID
   */
  static async findById(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding document: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Find documents by filter
   */
  static async find(filter = {}) {
    const supabase = getSupabase();
    const dbFilter = this._toDbFields(filter);

    let query = supabase.from('documents').select('*');

    // Apply filters
    for (const [key, value] of Object.entries(dbFilter)) {
      if (value !== undefined) {
        query = query.eq(key, value);
      }
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error finding documents: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Find documents by entity
   */
  static async findByEntity(entityType, entityId) {
    return this.find({ entityType, entityId, isActive: true });
  }

  /**
   * Find documents by structure
   */
  static async findByStructure(structureId) {
    return this.findByEntity('Structure', structureId);
  }

  /**
   * Find documents by investor
   */
  static async findByInvestor(investorId) {
    return this.findByEntity('Investor', investorId);
  }

  /**
   * Find documents by investment
   */
  static async findByInvestment(investmentId) {
    return this.findByEntity('Investment', investmentId);
  }

  /**
   * Find documents by capital call
   */
  static async findByCapitalCall(capitalCallId) {
    return this.findByEntity('CapitalCall', capitalCallId);
  }

  /**
   * Find documents by distribution
   */
  static async findByDistribution(distributionId) {
    return this.findByEntity('Distribution', distributionId);
  }

  /**
   * Find documents by type
   */
  static async findByDocumentType(documentType, entityType, entityId) {
    const filter = { documentType };
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = entityId;
    filter.isActive = true;
    return this.find(filter);
  }

  /**
   * Find documents by user ID
   */
  static async findByUserId(userId) {
    return this.find({ userId, isActive: true });
  }

  /**
   * Update document by ID
   */
  static async findByIdAndUpdate(id, updateData) {
    const supabase = getSupabase();
    const dbData = this._toDbFields(updateData);

    const { data, error } = await supabase
      .from('documents')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error updating document: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Soft delete document by ID (mark as inactive)
   */
  static async softDelete(id) {
    return this.findByIdAndUpdate(id, { isActive: false });
  }

  /**
   * Hard delete document by ID
   */
  static async findByIdAndDelete(id) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('documents')
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Error deleting document: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Search documents by name or tags
   */
  static async search(searchTerm, entityType, userId) {
    const supabase = getSupabase();

    let query = supabase
      .from('documents')
      .select('*')
      .eq('is_active', true);

    if (userId) {
      query = query.eq('user_id', userId);
    }

    if (entityType) {
      query = query.eq('entity_type', entityType);
    }

    // Search in document name, document type, or tags (JSONB array contains)
    query = query.or(`document_name.ilike.*${searchTerm}*,document_type.ilike.*${searchTerm}*,tags.cs.["${searchTerm}"]`);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error searching documents: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Get document count by entity
   */
  static async getCountByEntity(entityType, entityId) {
    const supabase = getSupabase();

    const { count, error } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('is_active', true);

    if (error) {
      throw new Error(`Error counting documents: ${error.message}`);
    }

    return count;
  }

  /**
   * Get latest document version
   */
  static async getLatestVersion(entityType, entityId, documentType) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('document_type', documentType)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Error finding latest version: ${error.message}`);
    }

    return this._toModel(data);
  }

  /**
   * Create new version of a document
   */
  static async createNewVersion(documentId, newFilePath, uploadedBy) {
    // Get current document
    const currentDoc = await this.findById(documentId);

    if (!currentDoc) {
      throw new Error('Document not found');
    }

    // Deactivate current version
    await this.softDelete(documentId);

    // Create new version
    const newVersion = {
      entityType: currentDoc.entityType,
      entityId: currentDoc.entityId,
      documentType: currentDoc.documentType,
      documentName: currentDoc.documentName,
      filePath: newFilePath,
      uploadedBy: uploadedBy,
      version: currentDoc.version + 1,
      isActive: true,
      tags: currentDoc.tags,
      metadata: currentDoc.metadata,
      notes: currentDoc.notes,
      userId: currentDoc.userId
    };

    return this.create(newVersion);
  }

  /**
   * Get all versions of a document
   */
  static async getAllVersions(entityType, entityId, documentType) {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .eq('document_type', documentType)
      .order('version', { ascending: false });

    if (error) {
      throw new Error(`Error finding document versions: ${error.message}`);
    }

    return data.map(item => this._toModel(item));
  }

  /**
   * Add tags to a document
   */
  static async addTags(documentId, newTags) {
    const document = await this.findById(documentId);

    if (!document) {
      throw new Error('Document not found');
    }

    const existingTags = document.tags || [];
    const updatedTags = [...new Set([...existingTags, ...newTags])];

    return this.findByIdAndUpdate(documentId, { tags: updatedTags });
  }

  /**
   * Remove tags from a document
   */
  static async removeTags(documentId, tagsToRemove) {
    const document = await this.findById(documentId);

    if (!document) {
      throw new Error('Document not found');
    }

    const existingTags = document.tags || [];
    const updatedTags = existingTags.filter(tag => !tagsToRemove.includes(tag));

    return this.findByIdAndUpdate(documentId, { tags: updatedTags });
  }

  /**
   * Update document metadata
   */
  static async updateMetadata(documentId, metadata) {
    const document = await this.findById(documentId);

    if (!document) {
      throw new Error('Document not found');
    }

    const updatedMetadata = { ...document.metadata, ...metadata };

    return this.findByIdAndUpdate(documentId, { metadata: updatedMetadata });
  }
}

module.exports = Document;
