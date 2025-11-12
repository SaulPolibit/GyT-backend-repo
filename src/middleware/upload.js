/**
 * File Upload Middleware
 * Handles file uploads using multer
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '../../uploads');
const profilesDir = path.join(uploadDir, 'profiles');
const companyLogosDir = path.join(uploadDir, 'company-logos');
const projectImagesDir = path.join(uploadDir, 'project-images');
const documentsDir = path.join(uploadDir, 'documents');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(profilesDir)) {
  fs.mkdirSync(profilesDir, { recursive: true });
}

if (!fs.existsSync(companyLogosDir)) {
  fs.mkdirSync(companyLogosDir, { recursive: true });
}

if (!fs.existsSync(projectImagesDir)) {
  fs.mkdirSync(projectImagesDir, { recursive: true });
}

if (!fs.existsSync(documentsDir)) {
  fs.mkdirSync(documentsDir, { recursive: true });
}

// Configure storage for profile images
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, profilesDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: userId_timestamp.extension
    const userId = req.auth?.userId || req.user?.id || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `profile_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

// File filter to accept only images
const imageFilter = (req, file, cb) => {
  // Accept only image files
  const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
  }
};

// Configure multer for profile image upload
const uploadProfileImage = multer({
  storage: profileStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  }
});

// Configure storage for company logos
const companyLogoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, companyLogosDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: userId_timestamp.extension
    const userId = req.auth?.userId || req.user?.id || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `company_logo_${userId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

// Configure multer for company logo upload
const uploadCompanyLogo = multer({
  storage: companyLogoStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  }
});

// Helper function to delete old profile image
const deleteOldProfileImage = (imagePath) => {
  if (!imagePath) return;

  const fullPath = path.join(__dirname, '../..', imagePath);

  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log('Old profile image deleted:', fullPath);
    } catch (error) {
      console.error('Error deleting old profile image:', error);
    }
  }
};

// Helper function to delete old company logo
const deleteOldCompanyLogo = (logoPath) => {
  if (!logoPath) return;

  const fullPath = path.join(__dirname, '../..', logoPath);

  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log('Old company logo deleted:', fullPath);
    } catch (error) {
      console.error('Error deleting old company logo:', error);
    }
  }
};

// Configure storage for project images
const projectImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, projectImagesDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: projectId_timestamp.extension
    const projectId = req.params.id || 'unknown';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const filename = `project_${projectId}_${timestamp}${ext}`;
    cb(null, filename);
  }
});

// Configure multer for project image upload
const uploadProjectImage = multer({
  storage: projectImageStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  }
});

// Helper function to delete old project image
const deleteOldProjectImage = (imagePath) => {
  if (!imagePath) return;

  const fullPath = path.join(__dirname, '../..', imagePath);

  if (fs.existsSync(fullPath)) {
    try {
      fs.unlinkSync(fullPath);
      console.log('Old project image deleted:', fullPath);
    } catch (error) {
      console.error('Error deleting old project image:', error);
    }
  }
};

// Configure multer for document uploads (to Supabase Storage)
// Use memory storage since we'll upload to Supabase
const documentStorage = multer.memoryStorage();

// Document file filter - allow various document types
const documentFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // Archives
    'application/zip',
    'application/x-rar-compressed',
    'application/x-7z-compressed'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed.`), false);
  }
};

// Configure multer for document upload
const uploadDocument = multer({
  storage: documentStorage,
  fileFilter: documentFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  }
});

// Middleware to handle document upload with error handling
const handleDocumentUpload = (req, res, next) => {
  const upload = uploadDocument.single('file');

  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum file size is 10MB'
        });
      }
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    next();
  });
};

module.exports = {
  uploadProfileImage,
  deleteOldProfileImage,
  uploadCompanyLogo,
  deleteOldCompanyLogo,
  uploadProjectImage,
  deleteOldProjectImage,
  uploadDocument,
  handleDocumentUpload
};
