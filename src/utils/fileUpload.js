/**
 * File Upload Utility
 * Handles file uploads to Supabase Storage
 */

const { getSupabase } = require('../config/database');
const path = require('path');

/**
 * Upload file to Supabase Storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} originalName - Original file name
 * @param {string} mimeType - File MIME type
 * @param {string} folder - Folder path in storage (e.g., 'documents', 'invoices')
 * @returns {Object} - Upload result with public URL
 */
async function uploadToSupabase(fileBuffer, originalName, mimeType, folder = 'documents') {
  const supabase = getSupabase();

  // Generate unique filename with timestamp
  const timestamp = Date.now();
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');
  const fileName = `${sanitizedBaseName}_${timestamp}${ext}`;
  const filePath = `${folder}/${fileName}`;

  // Upload file to Supabase Storage
  const { data, error } = await supabase.storage
    .from('documents') // Bucket name
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: false
    });

  if (error) {
    throw new Error(`Error uploading file to storage: ${error.message}`);
  }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('documents')
    .getPublicUrl(filePath);

  return {
    path: filePath,
    publicUrl,
    fileName,
    size: fileBuffer.length
  };
}

/**
 * Delete file from Supabase Storage
 * @param {string} filePath - File path in storage
 * @returns {boolean} - Success status
 */
async function deleteFromSupabase(filePath) {
  const supabase = getSupabase();

  const { error } = await supabase.storage
    .from('documents')
    .remove([filePath]);

  if (error) {
    throw new Error(`Error deleting file from storage: ${error.message}`);
  }

  return true;
}

/**
 * Get file public URL
 * @param {string} filePath - File path in storage
 * @returns {string} - Public URL
 */
function getFilePublicUrl(filePath) {
  const supabase = getSupabase();

  const { data: { publicUrl } } = supabase.storage
    .from('documents')
    .getPublicUrl(filePath);

  return publicUrl;
}

module.exports = {
  uploadToSupabase,
  deleteFromSupabase,
  getFilePublicUrl
};
