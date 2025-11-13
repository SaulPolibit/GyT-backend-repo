/**
 * Document API Routes
 * Endpoints for managing polymorphic documents across all entities
 */
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { catchAsync, validate } = require('../middleware/errorHandler');
const { handleDocumentUpload } = require('../middleware/upload');
const { uploadToSupabase } = require('../utils/fileUpload');
const { Document, Structure, Investor, Investment, CapitalCall, Distribution } = require('../models/supabase');

const router = express.Router();

/**
 * Validate entity exists and belongs to user
 */
async function validateEntity(entityType, entityId, userId) {
  let entity = null;

  switch (entityType) {
    case 'Structure':
      entity = await Structure.findById(entityId);
      break;
    case 'Investor':
      entity = await Investor.findById(entityId);
      break;
    case 'Investment':
      entity = await Investment.findById(entityId);
      break;
    case 'CapitalCall':
      entity = await CapitalCall.findById(entityId);
      break;
    case 'Distribution':
      entity = await Distribution.findById(entityId);
      break;
    default:
      throw new Error('Invalid entity type');
  }

  validate(entity, `${entityType} not found`);
  validate(entity.userId === userId, `Unauthorized access to ${entityType}`);

  return entity;
}

/**
 * @route   POST /api/documents
 * @desc    Create a new document with file upload
 * @access  Private (requires authentication)
 */
router.post('/', authenticate, handleDocumentUpload, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;

  // Validate file upload
  validate(req.file, 'File is required');

  const {
    entityType,
    entityId,
    documentType,
    documentName,
    tags,
    metadata,
    notes
  } = req.body;

  // Validate required fields
  validate(entityType, 'Entity type is required');
  validate(entityId, 'Entity ID is required');
  validate(documentType, 'Document type is required');
  validate(documentName, 'Document name is required');

  const validEntityTypes = ['Structure', 'Investor', 'Investment', 'CapitalCall', 'Distribution'];
  validate(validEntityTypes.includes(entityType), `Entity type must be one of: ${validEntityTypes.join(', ')}`);

  // Validate entity exists and belongs to user
  await validateEntity(entityType, entityId, userId);

  // Upload file to Supabase Storage
  const folder = `${entityType.toLowerCase()}s/${entityId}`;
  const uploadResult = await uploadToSupabase(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    folder
  );

  // Parse tags and metadata if they're strings
  let parsedTags = [];
  let parsedMetadata = {};

  if (tags) {
    parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
  }

  if (metadata) {
    parsedMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
  }

  // Create document
  const documentData = {
    entityType,
    entityId,
    documentType: documentType.trim(),
    documentName: documentName.trim(),
    filePath: uploadResult.publicUrl,
    fileSize: uploadResult.size,
    mimeType: req.file.mimetype,
    uploadedBy: userId,
    version: 1,
    isActive: true,
    tags: parsedTags,
    metadata: parsedMetadata,
    notes: notes?.trim() || '',
    userId
  };

  const document = await Document.create(documentData);

  res.status(201).json({
    success: true,
    message: 'Document created successfully',
    data: {
      ...document,
      uploadDetails: {
        storagePath: uploadResult.path,
        fileName: uploadResult.fileName
      }
    }
  });
}));

/**
 * @route   GET /api/documents/all
 * @desc    Get all documents from all entities and all users (admin access)
 * @access  Private (requires authentication)
 * @note    This endpoint returns documents across all users - use with caution
 */
router.get('/all', authenticate, catchAsync(async (req, res) => {
  const { entityType, documentType, isActive, entityId } = req.query;

  let filter = {};

  if (entityType) filter.entityType = entityType;
  if (documentType) filter.documentType = documentType;
  if (entityId) filter.entityId = entityId;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const documents = await Document.find(filter);

  res.status(200).json({
    success: true,
    count: documents.length,
    data: documents
  });
}));

/**
 * @route   GET /api/documents
 * @desc    Get all documents for authenticated user
 * @access  Private (requires authentication)
 */
router.get('/', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { entityType, documentType, isActive } = req.query;

  let filter = { userId };

  if (entityType) filter.entityType = entityType;
  if (documentType) filter.documentType = documentType;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const documents = await Document.find(filter);

  res.status(200).json({
    success: true,
    count: documents.length,
    data: documents
  });
}));

/**
 * @route   GET /api/documents/search
 * @desc    Search documents by name or tags
 * @access  Private (requires authentication)
 */
router.get('/search', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { q, entityType } = req.query;

  validate(q, 'Search query is required');
  validate(q.length >= 2, 'Search query must be at least 2 characters');

  const documents = await Document.search(q, entityType, userId);

  res.status(200).json({
    success: true,
    count: documents.length,
    data: documents
  });
}));

/**
 * @route   GET /api/documents/entity/:entityType/:entityId
 * @desc    Get all documents for a specific entity
 * @access  Private (requires authentication)
 */
router.get('/entity/:entityType/:entityId', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { entityType, entityId } = req.params;

  // Validate entity exists and belongs to user
  await validateEntity(entityType, entityId, userId);

  const documents = await Document.findByEntity(entityType, entityId);

  res.status(200).json({
    success: true,
    count: documents.length,
    data: documents
  });
}));

/**
 * @route   GET /api/documents/entity/:entityType/:entityId/count
 * @desc    Get document count for an entity
 * @access  Private (requires authentication)
 */
router.get('/entity/:entityType/:entityId/count', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { entityType, entityId } = req.params;

  // Validate entity exists and belongs to user
  await validateEntity(entityType, entityId, userId);

  const count = await Document.getCountByEntity(entityType, entityId);

  res.status(200).json({
    success: true,
    data: { count }
  });
}));

/**
 * @route   GET /api/documents/:id
 * @desc    Get a single document by ID
 * @access  Private (requires authentication)
 */
router.get('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const document = await Document.findById(id);

  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  res.status(200).json({
    success: true,
    data: document
  });
}));

/**
 * @route   GET /api/documents/latest/:entityType/:entityId/:documentType
 * @desc    Get latest version of a document
 * @access  Private (requires authentication)
 */
router.get('/latest/:entityType/:entityId/:documentType', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { entityType, entityId, documentType } = req.params;

  // Validate entity exists and belongs to user
  await validateEntity(entityType, entityId, userId);

  const document = await Document.getLatestVersion(entityType, entityId, documentType);

  validate(document, 'Document not found');

  res.status(200).json({
    success: true,
    data: document
  });
}));

/**
 * @route   GET /api/documents/versions/:entityType/:entityId/:documentType
 * @desc    Get all versions of a document
 * @access  Private (requires authentication)
 */
router.get('/versions/:entityType/:entityId/:documentType', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { entityType, entityId, documentType } = req.params;

  // Validate entity exists and belongs to user
  await validateEntity(entityType, entityId, userId);

  const versions = await Document.getAllVersions(entityType, entityId, documentType);

  res.status(200).json({
    success: true,
    count: versions.length,
    data: versions
  });
}));

/**
 * @route   PUT /api/documents/:id
 * @desc    Update a document
 * @access  Private (requires authentication)
 */
router.put('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const document = await Document.findById(id);
  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  const updateData = {};
  const allowedFields = [
    'documentName', 'documentType', 'notes', 'isActive'
  ];

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  validate(Object.keys(updateData).length > 0, 'No valid fields provided for update');

  const updatedDocument = await Document.findByIdAndUpdate(id, updateData);

  res.status(200).json({
    success: true,
    message: 'Document updated successfully',
    data: updatedDocument
  });
}));

/**
 * @route   POST /api/documents/:id/new-version
 * @desc    Create a new version of a document with file upload
 * @access  Private (requires authentication)
 */
router.post('/:id/new-version', authenticate, handleDocumentUpload, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  // Validate file upload
  validate(req.file, 'File is required');

  const document = await Document.findById(id);
  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  // Upload file to Supabase Storage
  const folder = `${document.entityType.toLowerCase()}s/${document.entityId}`;
  const uploadResult = await uploadToSupabase(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    folder
  );

  const newVersion = await Document.createNewVersion(id, uploadResult.publicUrl, userId);

  res.status(201).json({
    success: true,
    message: 'New document version created successfully',
    data: {
      ...newVersion,
      uploadDetails: {
        storagePath: uploadResult.path,
        fileName: uploadResult.fileName,
        fileSize: uploadResult.size
      }
    }
  });
}));

/**
 * @route   PATCH /api/documents/:id/tags
 * @desc    Add tags to a document
 * @access  Private (requires authentication)
 */
router.patch('/:id/tags', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;
  const { tags } = req.body;

  validate(Array.isArray(tags), 'Tags must be an array');
  validate(tags.length > 0, 'At least one tag must be provided');

  const document = await Document.findById(id);
  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  const updatedDocument = await Document.addTags(id, tags);

  res.status(200).json({
    success: true,
    message: 'Tags added successfully',
    data: updatedDocument
  });
}));

/**
 * @route   DELETE /api/documents/:id/tags
 * @desc    Remove tags from a document
 * @access  Private (requires authentication)
 */
router.delete('/:id/tags', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;
  const { tags } = req.body;

  validate(Array.isArray(tags), 'Tags must be an array');
  validate(tags.length > 0, 'At least one tag must be provided');

  const document = await Document.findById(id);
  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  const updatedDocument = await Document.removeTags(id, tags);

  res.status(200).json({
    success: true,
    message: 'Tags removed successfully',
    data: updatedDocument
  });
}));

/**
 * @route   PATCH /api/documents/:id/metadata
 * @desc    Update document metadata
 * @access  Private (requires authentication)
 */
router.patch('/:id/metadata', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;
  const { metadata } = req.body;

  validate(metadata && typeof metadata === 'object', 'Metadata must be an object');

  const document = await Document.findById(id);
  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  const updatedDocument = await Document.updateMetadata(id, metadata);

  res.status(200).json({
    success: true,
    message: 'Metadata updated successfully',
    data: updatedDocument
  });
}));

/**
 * @route   DELETE /api/documents/:id/soft
 * @desc    Soft delete a document (mark as inactive)
 * @access  Private (requires authentication)
 */
router.delete('/:id/soft', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const document = await Document.findById(id);
  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  await Document.softDelete(id);

  res.status(200).json({
    success: true,
    message: 'Document soft deleted successfully'
  });
}));

/**
 * @route   DELETE /api/documents/:id
 * @desc    Hard delete a document
 * @access  Private (requires authentication)
 */
router.delete('/:id', authenticate, catchAsync(async (req, res) => {
  const userId = req.auth.userId || req.user.id;
  const { id } = req.params;

  const document = await Document.findById(id);
  validate(document, 'Document not found');
  validate(document.userId === userId, 'Unauthorized access to document');

  await Document.findByIdAndDelete(id);

  res.status(200).json({
    success: true,
    message: 'Document deleted successfully'
  });
}));

/**
 * @route   GET /api/documents/health
 * @desc    Health check for Document API routes
 * @access  Public
 */
router.get('/health', (_req, res) => {
  res.json({
    service: 'Document API',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
