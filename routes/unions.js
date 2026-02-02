const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult, query } = require('express-validator');
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
  requireFile,
  validateImageDimensions,
} = require('../middleware/uploadMiddleware');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// --- Helper Functions ---

/**
 * Validate that a string is a valid MongoDB ObjectId.
 * Returns a 400 response if invalid, or calls next() if valid.
 */
function validateObjectId(req, res, next) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid union ID format',
    });
  }
  next();
}

/**
 * Convert a nested object to MongoDB dot-notation for partial updates.
 * e.g. { headquarters: { city: "Manila" } } → { "headquarters.city": "Manila" }
 * Only goes one level deep (suitable for our schema's nested objects).
 */
function toDotNotation(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      Object.assign(result, toDotNotation(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * Whitelist fields from req.body for union creation.
 * Prevents mass assignment of isActive, metadata, hierarchyPath, etc.
 */
function pickAllowedFields(body) {
  const allowed = ['name', 'territory', 'headquarters', 'contact', 'settings'];
  const result = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      result[key] = body[key];
    }
  }
  return result;
}

/**
 * Build a safe $set update from req.body for union updates.
 * Nested objects (headquarters, contact, territory, settings) use dot notation
 * so partial updates don't wipe sibling fields.
 * Top-level scalar fields (name) are set directly.
 */
function buildUpdatePayload(body) {
  const nestedFields = ['headquarters', 'contact', 'territory', 'settings'];
  const allowedTopLevel = ['name'];
  const update = {};

  for (const key of allowedTopLevel) {
    if (body[key] !== undefined) {
      update[key] = body[key];
    }
  }

  for (const key of nestedFields) {
    if (body[key] !== undefined && typeof body[key] === 'object') {
      Object.assign(update, toDotNotation(body[key], key));
    }
  }

  update['metadata.lastUpdated'] = new Date();
  return { $set: update };
}

/**
 * Format error responses consistently.
 * Handles: duplicate key (E11000), validation errors, and generic errors.
 */
function handleUnionError(res, error, context = 'union operation') {
  // Duplicate key (unique constraint violation)
  if (
    error.code === 11000 ||
    (error.name === 'MongoServerError' && error.code === 11000)
  ) {
    return res.status(409).json({
      success: false,
      message: 'A union with this name already exists',
    });
  }

  // Mongoose validation error — extract clean field messages
  if (error.name === 'ValidationError') {
    const fieldErrors = Object.values(error.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: fieldErrors,
    });
  }

  // Generic server error
  return res.status(500).json({
    success: false,
    message: `Failed to ${context}`,
    error:
      process.env.NODE_ENV === 'development'
        ? error.message
        : 'Internal server error',
  });
}

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
router.get(
  '/:id',
  validateObjectId,
  authorizeHierarchical('read', 'union'),
  async (req, res) => {
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
  }
);

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

      // Whitelist allowed fields only (prevents mass assignment)
      const allowedData = pickAllowedFields(req.body);

      const union = new Union({
        ...allowedData,
        createdBy: req.user.id,
      });

      // Set hierarchyPath before save
      union.hierarchyPath = union._id.toString();

      await union.save();

      res.status(201).json({
        success: true,
        message: 'Union created successfully',
        data: union,
      });
    } catch (error) {
      return handleUnionError(res, error, 'create union');
    }
  }
);

// PUT /api/unions/:id - Update union
router.put(
  '/:id',
  validateObjectId,
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

      // Build dot-notation update to avoid wiping nested fields
      const updatePayload = buildUpdatePayload(req.body);

      const union = await Union.findByIdAndUpdate(id, updatePayload, {
        new: true,
        runValidators: true,
      });

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
      return handleUnionError(res, error, 'update union');
    }
  }
);

// DELETE /api/unions/:id - Soft delete union
router.delete(
  '/:id',
  validateObjectId,
  requireSuperAdmin,
  auditLog('union.delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const union = await Union.findById(id);

      // Treat missing or already-deleted unions as not found
      if (!union || !union.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Union not found',
        });
      }

      // Block deletion if subordinate entities exist
      const Conference = require('../models/Conference');
      const conferenceCount = await Conference.countDocuments({
        unionId: id,
        isActive: true,
      });

      if (conferenceCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete union: ${conferenceCount} active conferences still exist. Please delete all conferences first.`,
          details: {
            blockingEntities: {
              conferences: conferenceCount,
              level: 'conference',
              action: 'Delete all conferences in this union first',
            },
          },
        });
      }

      const Church = require('../models/Church');
      const churchCount = await Church.countDocuments({
        hierarchyPath: { $regex: `^${union.hierarchyPath}/` },
        isActive: true,
      });

      if (churchCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete union: ${churchCount} active churches still exist. Please delete all churches first.`,
          details: {
            blockingEntities: {
              churches: churchCount,
              level: 'church',
              action: 'Delete all churches in this union first',
            },
          },
        });
      }

      const Team = require('../models/Team');
      const teamCount = await Team.countDocuments({
        hierarchyPath: { $regex: `^${union.hierarchyPath}/` },
        isActive: true,
      });

      if (teamCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete union: ${teamCount} active teams still exist. Please delete all teams first.`,
          details: {
            blockingEntities: {
              teams: teamCount,
              level: 'team',
              action: 'Delete all teams in this union first',
            },
          },
        });
      }

      const Service = require('../models/Service');
      const serviceCount = await Service.countDocuments({
        hierarchyPath: { $regex: `^${union.hierarchyPath}/` },
        status: { $ne: 'archived' },
      });

      if (serviceCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete union: ${serviceCount} active services still exist. Please delete all services first.`,
          details: {
            blockingEntities: {
              services: serviceCount,
              level: 'service',
              action: 'Delete all services in this union first',
            },
          },
        });
      }

      // Soft delete
      union.isActive = false;
      union.metadata.lastUpdated = new Date();
      union.deletedAt = new Date();
      union.deletedBy = req.user.id;
      await union.save();

      res.json({
        success: true,
        message: `Union "${union.name}" has been successfully deleted.`,
        data: { union },
      });
    } catch (error) {
      return handleUnionError(res, error, 'delete union');
    }
  }
);

// GET /api/unions/:id/statistics - Get union statistics
router.get(
  '/:id/statistics',
  validateObjectId,
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
  validateObjectId,
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
  validateObjectId,
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
  validateObjectId,
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
