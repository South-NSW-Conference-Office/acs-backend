const express = require('express');
const { body, validationResult, query } = require('express-validator');
// const mongoose = require('mongoose');
const Union = require('../models/Union');
const MediaFile = require('../models/MediaFile');
const {
  authenticateToken,
  authorizeHierarchical,
  requireSuperAdmin,
} = require('../middleware/hierarchicalAuth');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');
const storageService = require('../services/storageService');
const {
  upload,
  // handleUploadError,
  requireFile,
  validateImageDimensions,
} = require('../middleware/uploadMiddleware');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/unions - Get all unions
router.get(
  '/',
  authorizeHierarchical('read', 'union'),
  [
    query('includeInactive')
      .optional()
      .isBoolean()
      .withMessage('includeInactive must be a boolean'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { includeInactive } = req.query;
      const query = {};

      if (!includeInactive || includeInactive !== 'true') {
        query.isActive = true;
      }

      const unions = await Union.find(query)
        .select('name territory headquarters contact isActive primaryImage')
        .sort('name');

      // Enhance unions with thumbnail URLs if MediaFile is linked
      const enhancedUnions = await Promise.all(
        unions.map(async (union) => {
          const unionObj = union.toObject();

          // If there's a primaryImage with mediaFileId, get the thumbnail
          if (unionObj.primaryImage?.mediaFileId) {
            try {
              const mediaFile = await MediaFile.findById(
                unionObj.primaryImage.mediaFileId
              ).select('thumbnail url');

              if (mediaFile) {
                // Use thumbnail URL if available, otherwise use the main image URL
                unionObj.primaryImage.thumbnailUrl =
                  mediaFile.thumbnail?.url || mediaFile.url;
              }
            } catch (error) {
              // Failed to fetch media file for union
            }
          }

          return unionObj;
        })
      );

      res.json({
        success: true,
        message: 'Unions retrieved successfully',
        data: enhancedUnions,
        count: enhancedUnions.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch unions',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/unions/:id - Get specific union
router.get('/:id', authorizeHierarchical('read', 'union'), async (req, res) => {
  try {
    const { id } = req.params;

    // Verify user has access to this union
    const hasAccess = await hierarchicalAuthService.canUserManageEntity(
      req.user,
      id,
      'read'
    );

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this union',
      });
    }

    const union = await Union.findById(id).populate('conferences');

    if (!union) {
      return res.status(404).json({
        success: false,
        message: 'Union not found',
      });
    }

    // Enhance union with thumbnail URL if MediaFile is linked
    const unionObj = union.toObject();
    if (unionObj.primaryImage?.mediaFileId) {
      try {
        const mediaFile = await MediaFile.findById(
          unionObj.primaryImage.mediaFileId
        ).select('thumbnail url');

        if (mediaFile) {
          // Use thumbnail URL if available, otherwise use the main image URL
          unionObj.primaryImage.thumbnailUrl =
            mediaFile.thumbnail?.url || mediaFile.url;
        }
      } catch (error) {
        // Failed to fetch media file for union
      }
    }

    res.json({
      success: true,
      message: 'Union retrieved successfully',
      data: unionObj,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch union',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// POST /api/unions - Create new union (Super Admin only)
router.post(
  '/',
  requireSuperAdmin,
  auditLog('union.create'),
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Union name must be at least 2 characters'),
    body('headquarters.country')
      .optional()
      .isString()
      .withMessage('Headquarters country must be a string'),
    body('contact.email')
      .optional()
      .isEmail()
      .withMessage('Valid email required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      // Check if code already exists
      if (req.body.code) {
        const existingUnion = await Union.findOne({
          code: req.body.code.toUpperCase(),
        });
        if (existingUnion) {
          return res.status(409).json({
            success: false,
            message: 'Union code already exists',
          });
        }
      }

      // Create the union document first to get an ID
      const union = new Union({
        ...req.body,
        ...(req.body.code && { code: req.body.code.toUpperCase() }),
        createdBy: req.user.id,
      });

      // Set hierarchyPath before validation
      union.hierarchyPath = union._id.toString();

      // Save the union
      await union.save();

      res.status(201).json({
        success: true,
        message: 'Union created successfully',
        data: union,
      });
    } catch (error) {
      const statusCode = error.name === 'ValidationError' ? 400 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to create union',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

// PUT /api/unions/:id - Update union
router.put(
  '/:id',
  authorizeHierarchical('update', 'union'),
  auditLog('union.update'),
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Union name must be at least 2 characters'),
    body('contact.email')
      .optional()
      .isEmail()
      .withMessage('Valid email required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { id } = req.params;

      // Verify user has access to update this union
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'update'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this union',
        });
      }

      // Check if code already exists (if being updated)
      if (req.body.code) {
        const existingUnion = await Union.findOne({
          code: req.body.code.toUpperCase(),
          _id: { $ne: id },
        });
        if (existingUnion) {
          return res.status(409).json({
            success: false,
            message: 'Union code already exists',
          });
        }
        req.body.code = req.body.code.toUpperCase();
      }

      const union = await Union.findByIdAndUpdate(
        id,
        {
          ...req.body,
          'metadata.lastUpdated': new Date(),
        },
        { new: true, runValidators: true }
      );

      if (!union) {
        return res.status(404).json({
          success: false,
          message: 'Union not found',
        });
      }

      res.json({
        success: true,
        message: 'Union updated successfully',
        data: union,
      });
    } catch (error) {
      const statusCode = error.name === 'ValidationError' ? 400 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to update union',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

// DELETE /api/unions/:id - Soft delete union
router.delete(
  '/:id',
  requireSuperAdmin,
  auditLog('union.delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const union = await Union.findById(id);
      if (!union) {
        return res.status(404).json({
          success: false,
          message: 'Union not found',
        });
      }

      // Check if union has conferences
      const Conference = require('../models/Conference');
      const conferenceCount = await Conference.countDocuments({
        unionId: id,
        isActive: true,
      });

      if (conferenceCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete union: ${conferenceCount} active conferences still exist`,
        });
      }

      // Soft delete
      union.isActive = false;
      union.metadata.lastUpdated = new Date();
      await union.save();

      res.json({
        success: true,
        message: 'Union deactivated successfully',
        data: union,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete union',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/unions/:id/statistics - Get union statistics
router.get(
  '/:id/statistics',
  authorizeHierarchical('read', 'union'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const union = await Union.findById(id);
      if (!union) {
        return res.status(404).json({
          success: false,
          message: 'Union not found',
        });
      }

      const statistics = await union.getStatistics();

      res.json({
        success: true,
        message: 'Union statistics retrieved successfully',
        data: {
          union: {
            id: union._id,
            name: union.name,
            code: union.code,
          },
          statistics,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get union statistics',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/unions/:id/hierarchy - Get full union hierarchy
router.get(
  '/:id/hierarchy',
  authorizeHierarchical('read', 'union'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const union = await Union.findById(id);
      if (!union) {
        return res.status(404).json({
          success: false,
          message: 'Union not found',
        });
      }

      const hierarchy = await union.getFullHierarchy();

      res.json({
        success: true,
        message: 'Union hierarchy retrieved successfully',
        data: hierarchy,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get union hierarchy',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// PUT /api/unions/:id/banner - Upload/update union banner image
router.put(
  '/:id/banner',
  authorizeHierarchical('update', 'union'),
  auditLog('union.banner.update'),
  upload.banner,
  requireFile('banner'),
  validateImageDimensions({ minWidth: 800, minHeight: 200 }),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Verify user has access to update this union
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'update'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this union',
        });
      }

      const union = await Union.findById(id);
      if (!union) {
        return res.status(404).json({
          success: false,
          message: 'Union not found',
        });
      }

      // Delete old banner if exists
      if (union.primaryImage?.key) {
        await storageService.deleteImage(union.primaryImage.key);
      }

      // Upload new banner with tracking
      const uploadResult = await storageService.uploadImageWithTracking(
        req.file.buffer,
        {
          originalName: req.file.originalname,
          type: 'banner',
          entityId: union._id,
          entityType: 'union',
          uploadedBy: req.user.id,
          alt: req.body.alt || '',
          mimeType: req.file.mimetype,
          dimensions: await storageService.getImageDimensions(req.file.buffer),
          userAgent: req.get('User-Agent'),
          uploadedFrom: req.ip,
        }
      );

      // Update union
      union.primaryImage = {
        url: uploadResult.url,
        key: uploadResult.key,
        alt: req.body.alt || '',
      };
      union.metadata.lastUpdated = new Date();
      await union.save();

      res.json({
        success: true,
        message: 'Banner image uploaded successfully',
        data: {
          image: union.primaryImage,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to upload banner image',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

/**
 * PUT /api/unions/:id/banner/media
 * Set union banner from existing media file in the media library
 *
 * @route PUT /api/unions/:id/banner/media
 * @param {string} id - Union ID
 * @body {string} mediaFileId - ID of the media file to use as banner
 * @body {string} [alt] - Optional alt text for the image
 * @access Union Update Permission Required
 * @returns {Object} Success response with updated banner information
 */
router.put(
  '/:id/banner/media',
  authorizeHierarchical('update', 'union'),
  auditLog('union.banner.update_from_media'),
  [
    body('mediaFileId')
      .isMongoId()
      .withMessage('Valid media file ID is required'),
    body('alt')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Alt text must be a string with max 255 characters'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { id } = req.params;
      const { mediaFileId, alt = '' } = req.body;

      // Verify user has access to update this union
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'update'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this union',
        });
      }

      // Check if union exists
      const union = await Union.findById(id);
      if (!union) {
        return res.status(404).json({
          success: false,
          message: 'Union not found',
        });
      }

      // Check if media file exists and user has access to it
      const mediaFile = await MediaFile.findById(mediaFileId).populate(
        'uploadedBy',
        'name email'
      );
      if (!mediaFile || !mediaFile.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Media file not found or inactive',
        });
      }

      // Check if user has access to this media file
      const isCurrentUserSuperAdmin = req.user.isSuperAdmin === true;
      const isOwner = mediaFile.uploadedBy._id.toString() === req.user.id;

      if (!isCurrentUserSuperAdmin && !isOwner) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to use this media file',
        });
      }

      // Validate that it's an image file
      if (!mediaFile.mimeType.startsWith('image/')) {
        return res.status(400).json({
          success: false,
          message: 'Selected media file is not an image',
        });
      }

      // Update union banner
      union.primaryImage = {
        url: mediaFile.url,
        key: mediaFile.key,
        alt: alt || mediaFile.alt || '',
        mediaFileId: mediaFile._id,
      };
      union.metadata.lastUpdated = new Date();
      await union.save();

      // Increment usage count for the media file
      await mediaFile.incrementUsage();

      res.json({
        success: true,
        message: 'Banner image set successfully from media library',
        data: {
          image: union.primaryImage,
        },
      });
    } catch (error) {
      // Error setting union banner from media
      res.status(500).json({
        success: false,
        message: 'Failed to set banner image from media',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

module.exports = router;
