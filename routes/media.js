const express = require('express');
const { query, param, validationResult } = require('express-validator');
const MediaFile = require('../models/MediaFile');
const {
  authenticateToken,
  requireSuperAdmin,
  authorize,
} = require('../middleware/auth');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const storageService = require('../services/storageService');
const { upload, requireFile } = require('../middleware/uploadMiddleware');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/media - Get media files for current user or all (if super admin)
router.get(
  '/',
  authorize('media.read'),
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
      .toInt(),
    query('type')
      .optional()
      .isIn(['banner', 'gallery', 'thumbnail', 'avatar', 'document'])
      .withMessage('Invalid file type'),
    query('category')
      .optional()
      .isIn([
        'service',
        'union',
        'conference',
        'church',
        'team',
        'user',
        'general',
      ])
      .withMessage('Invalid category'),
    query('search')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 100 })
      .withMessage('Search query must be 100 characters or less'),
    query('sortBy')
      .optional()
      .isIn(['createdAt', 'size', 'originalName', 'usageCount'])
      .withMessage('Invalid sort field'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('Sort order must be asc or desc'),
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

      const {
        page = 1,
        limit = 20,
        type,
        category,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;

      const skip = (page - 1) * limit;
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      let mediaFiles;
      let total;

      // Check if user is super admin
      const isCurrentUserSuperAdmin = req.user.isSuperAdmin === true;

      if (isCurrentUserSuperAdmin) {
        // Super admin sees all files

        const queryFilter = { isActive: true };
        if (type) queryFilter.type = type;
        if (category) queryFilter.category = category;
        if (search) {
          queryFilter.$text = { $search: search };
        }

        [mediaFiles, total] = await Promise.all([
          MediaFile.find(queryFilter)
            .sort(search ? { score: { $meta: 'textScore' } } : sort)
            .limit(limit)
            .skip(skip)
            .populate('uploadedBy', 'name email'),
          MediaFile.countDocuments(queryFilter),
        ]);
      } else {
        // Regular user sees only their files

        const queryFilter = { uploadedBy: req.user.id, isActive: true };
        if (type) queryFilter.type = type;
        if (category) queryFilter.category = category;
        if (search) {
          queryFilter.$text = { $search: search };
        }

        [mediaFiles, total] = await Promise.all([
          MediaFile.find(queryFilter)
            .sort(search ? { score: { $meta: 'textScore' } } : sort)
            .limit(limit)
            .skip(skip)
            .populate('uploadedBy', 'name email'),
          MediaFile.countDocuments(queryFilter),
        ]);
      }

      const totalPages = Math.ceil(total / limit);

      res.json({
        success: true,
        message: 'Media files retrieved successfully',
        data: {
          files: mediaFiles,
          pagination: {
            currentPage: page,
            totalPages,
            totalFiles: total,
            filesPerPage: limit,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
          isAdminView: isCurrentUserSuperAdmin,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch media files',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/media/stats - Get storage statistics
router.get('/stats', authorize('media.read'), async (req, res) => {
  try {
    const isCurrentUserSuperAdmin = req.user.isSuperAdmin === true;

    // Get stats for current user or all files (if super admin)
    const userId = isCurrentUserSuperAdmin ? null : req.user.id;
    const stats = await MediaFile.getStorageStats(userId);

    res.json({
      success: true,
      message: 'Storage statistics retrieved successfully',
      data: stats[0] || {
        totalFiles: 0,
        totalSize: 0,
        formattedTotalSize: '0 B',
        byType: [],
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch storage statistics',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// GET /api/media/:id - Get specific media file details
router.get(
  '/:id',
  authorize('media.read'),
  [param('id').isMongoId().withMessage('Invalid media file ID')],
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
      const mediaFile = await MediaFile.findById(id).populate(
        'uploadedBy',
        'name email'
      );

      if (!mediaFile) {
        return res.status(404).json({
          success: false,
          message: 'Media file not found',
        });
      }

      // Check access permissions
      const isCurrentUserSuperAdmin = req.user.isSuperAdmin === true;
      const isOwner = mediaFile.uploadedBy._id.toString() === req.user.id;

      if (!isCurrentUserSuperAdmin && !isOwner) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this media file',
        });
      }

      // Increment usage count if accessed by owner or admin
      if (isOwner || isCurrentUserSuperAdmin) {
        await mediaFile.incrementUsage();
      }

      res.json({
        success: true,
        message: 'Media file details retrieved successfully',
        data: mediaFile,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch media file',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// PUT /api/media/:id - Update media file metadata
router.put(
  '/:id',
  authorize('media.update'),
  auditLog('media.update'),
  [param('id').isMongoId().withMessage('Invalid media file ID')],
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
      const { alt, caption, tags } = req.body;

      const mediaFile = await MediaFile.findById(id);

      if (!mediaFile) {
        return res.status(404).json({
          success: false,
          message: 'Media file not found',
        });
      }

      // Check access permissions
      const isCurrentUserSuperAdmin = req.user.isSuperAdmin === true;
      const isOwner = mediaFile.uploadedBy.toString() === req.user.id;

      if (!isCurrentUserSuperAdmin && !isOwner) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this media file',
        });
      }

      // Update allowed fields
      if (alt !== undefined) mediaFile.alt = alt;
      if (caption !== undefined) mediaFile.caption = caption;
      if (tags !== undefined && Array.isArray(tags)) {
        mediaFile.tags = tags
          .map((tag) => tag.toLowerCase().trim())
          .filter(Boolean);
      }

      await mediaFile.save();

      res.json({
        success: true,
        message: 'Media file updated successfully',
        data: mediaFile,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update media file',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// DELETE /api/media/:id - Delete media file
router.delete(
  '/:id',
  authorize('media.delete'),
  auditLog('media.delete'),
  [param('id').isMongoId().withMessage('Invalid media file ID')],
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

      // Use storage service delete method which includes permission checks
      const isCurrentUserSuperAdmin = req.user.isSuperAdmin === true;

      if (isCurrentUserSuperAdmin) {
        // Super admin can delete any file
        const mediaFile = await MediaFile.findById(id);

        if (!mediaFile) {
          return res.status(404).json({
            success: false,
            message: 'Media file not found',
          });
        }

        // Delete storage files
        if (mediaFile.key) {
          await storageService.deleteImage(mediaFile.key, false);
        }

        if (mediaFile.thumbnail && mediaFile.thumbnail.key) {
          await storageService.deleteImage(mediaFile.thumbnail.key, false);
        }

        // Delete database record
        await MediaFile.deleteOne({ _id: id });
      } else {
        // Regular user - use permission-checked delete
        await storageService.deleteMediaFile(id, req.user.id);
      }

      res.json({
        success: true,
        message: 'Media file deleted successfully',
      });
    } catch (error) {
      let statusCode = 500;
      let message = 'Failed to delete media file';

      if (error.message.includes('not found')) {
        statusCode = 404;
        message = 'Media file not found';
      } else if (error.message.includes('Permission denied')) {
        statusCode = 403;
        message = error.message;
      }

      res.status(statusCode).json({
        success: false,
        message,
        error:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
);

// POST /api/media/bulk-delete - Delete multiple media files
router.post(
  '/bulk-delete',
  authorize('media.manage'),
  auditLog('media.bulk_delete'),
  async (req, res) => {
    try {
      const { fileIds } = req.body;

      if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'File IDs array is required',
        });
      }

      if (fileIds.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete more than 50 files at once',
        });
      }

      const isCurrentUserSuperAdmin = req.user.isSuperAdmin === true;
      const results = {
        deleted: [],
        failed: [],
      };

      for (const fileId of fileIds) {
        try {
          if (isCurrentUserSuperAdmin) {
            const mediaFile = await MediaFile.findById(fileId);

            if (mediaFile) {
              // Delete storage files
              if (mediaFile.key) {
                await storageService.deleteImage(mediaFile.key, false);
              }

              if (mediaFile.thumbnail && mediaFile.thumbnail.key) {
                await storageService.deleteImage(
                  mediaFile.thumbnail.key,
                  false
                );
              }

              await MediaFile.deleteOne({ _id: fileId });
              results.deleted.push(fileId);
            } else {
              results.failed.push({ fileId, reason: 'File not found' });
            }
          } else {
            await storageService.deleteMediaFile(fileId, req.user.id);
            results.deleted.push(fileId);
          }
        } catch (error) {
          results.failed.push({
            fileId,
            reason: error.message.includes('Permission denied')
              ? 'Permission denied'
              : 'Delete failed',
          });
        }
      }

      res.json({
        success: true,
        message: `Bulk delete completed. ${results.deleted.length} files deleted, ${results.failed.length} failed.`,
        data: results,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Bulk delete operation failed',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// POST /api/media/upload - Upload media file directly
router.post(
  '/upload',
  authorize('media.upload'),
  auditLog('media.upload'),
  upload.single,
  requireFile('image'),
  async (req, res) => {
    try {
      const { type = 'gallery', category = 'general', alt = '' } = req.body;

      // Upload image with tracking
      const uploadResult = await storageService.uploadImageWithTracking(
        req.file.buffer,
        {
          originalName: req.file.originalname,
          type,
          category,
          uploadedBy: req.user.id,
          alt,
          mimeType: req.file.mimetype,
          dimensions: await storageService.getImageDimensions(req.file.buffer),
          userAgent: req.get('User-Agent'),
          uploadedFrom: req.ip,
        }
      );

      res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          file: uploadResult.mediaFile,
          url: uploadResult.url,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to upload file',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/media/test-bucket - Test bucket access and credentials
router.get('/test-bucket', requireSuperAdmin, async (req, res) => {
  try {
    const result = await storageService.testBucketAccess();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bucket test failed',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

module.exports = router;
