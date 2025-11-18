const multer = require('multer');
const path = require('path');

// Configure multer for memory storage
const storage = multer.memoryStorage();

// File filter for images
const imageFileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
  }
};

// Create different upload configurations
const uploadConfigs = {
  // Single banner image upload
  banner: multer({
    storage: storage,
    limits: {
      fileSize: 2 * 1024 * 1024, // 2MB limit for banners
    },
    fileFilter: imageFileFilter,
  }).single('banner'),

  // Multiple gallery images upload
  gallery: multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit per gallery image
      files: 10, // Maximum 10 files at once
    },
    fileFilter: imageFileFilter,
  }).array('images', 10),

  // Single image upload (generic)
  single: multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: imageFileFilter,
  }).single('image'),
};

// Error handling middleware
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message:
          'File too large. Maximum size allowed is ' +
          (error.field === 'banner' ? '2MB' : '5MB'),
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 10 files allowed at once.',
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message:
          'Unexpected field name. Use "banner" for banner images or "images" for gallery.',
      });
    }
  }

  if (error.message) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  // Pass to general error handler
  next(error);
};

// Validation middleware to check if files were uploaded
const requireFile = (fieldName = 'image') => {
  return (req, res, next) => {
    if (fieldName === 'images' && (!req.files || req.files.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'No images uploaded. Please select at least one image.',
      });
    }

    if (fieldName !== 'images' && !req.file) {
      return res.status(400).json({
        success: false,
        message: `No ${fieldName} uploaded. Please select an image.`,
      });
    }

    next();
  };
};

// Middleware to validate image dimensions (optional)
const validateImageDimensions = (requirements) => {
  return async (req, res, next) => {
    const sharp = require('sharp');

    try {
      const files = req.files || [req.file];

      for (const file of files) {
        if (!file) continue;

        const metadata = await sharp(file.buffer).metadata();

        if (requirements.minWidth && metadata.width < requirements.minWidth) {
          return res.status(400).json({
            success: false,
            message: `Image width must be at least ${requirements.minWidth}px`,
          });
        }

        if (
          requirements.minHeight &&
          metadata.height < requirements.minHeight
        ) {
          return res.status(400).json({
            success: false,
            message: `Image height must be at least ${requirements.minHeight}px`,
          });
        }

        if (requirements.aspectRatio) {
          const aspectRatio = metadata.width / metadata.height;
          const targetRatio = requirements.aspectRatio;
          const tolerance = 0.1;

          if (Math.abs(aspectRatio - targetRatio) > tolerance) {
            return res.status(400).json({
              success: false,
              message: `Image aspect ratio should be approximately ${targetRatio}:1`,
            });
          }
        }
      }

      next();
    } catch (error) {
      return res.status(400).json({
        success: false,
        message:
          'Failed to process image. Please ensure the file is a valid image.',
      });
    }
  };
};

module.exports = {
  upload: uploadConfigs,
  handleUploadError,
  requireFile,
  validateImageDimensions,
};
