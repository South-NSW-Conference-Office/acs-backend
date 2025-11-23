const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Conference = require('../models/Conference');
const Union = require('../models/Union');
const {
  authenticateToken,
  authorizeHierarchical,
} = require('../middleware/hierarchicalAuth');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/conferences - Get all conferences
router.get(
  '/',
  authorizeHierarchical('read', 'conference'),
  [
    query('unionId')
      .optional()
      .isMongoId()
      .withMessage('Valid union ID required'),
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

      const { unionId, includeInactive } = req.query;
      const query = {};

      if (unionId) query.unionId = unionId;
      if (!includeInactive || includeInactive !== 'true') {
        query.isActive = true;
      }

      // Filter based on user's hierarchy access
      const userLevel = await hierarchicalAuthService.getUserHighestLevel(
        req.user
      );
      const userPath = await hierarchicalAuthService.getUserHierarchyPath(
        req.user
      );

      if (userLevel > 0 && userPath) {
        // Non-super admin users can only see conferences in their subtree
        query.hierarchyPath = { $regex: `^${userPath}` };
      }

      const conferences = await Conference.find(query)
        .populate('unionId', 'name')
        .select(
          'name territory headquarters contact isActive unionId primaryImage'
        )
        .sort('name');

      res.json({
        success: true,
        message: 'Conferences retrieved successfully',
        data: conferences,
        count: conferences.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch conferences',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/conferences/:id - Get specific conference
router.get(
  '/:id',
  authorizeHierarchical('read', 'conference'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Verify user has access to this conference
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'read'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this conference',
        });
      }

      const conference = await Conference.findById(id)
        .populate('unionId', 'name')
        .populate('churches');

      if (!conference) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found',
        });
      }

      res.json({
        success: true,
        message: 'Conference retrieved successfully',
        data: conference,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch conference',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// POST /api/conferences - Create new conference
router.post(
  '/',
  authorizeHierarchical('create', 'conference'),
  auditLog('conference.create'),
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Conference name must be at least 2 characters'),
    body('unionId').isMongoId().withMessage('Valid union ID required'),
    body('contact.email')
      .optional({ nullable: true, checkFalsy: true })
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

      // Verify union exists
      const union = await Union.findById(req.body.unionId);
      if (!union || !union.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Union not found or inactive',
        });
      }

      const conferenceData = {
        ...req.body,
        createdBy: req.user.id,
      };

      const conference = await Conference.create(conferenceData);
      await conference.populate('unionId', 'name');

      res.status(201).json({
        success: true,
        message: 'Conference created successfully',
        data: conference,
      });
    } catch (error) {
      const statusCode = error.name === 'ValidationError' ? 400 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to create conference',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

// PUT /api/conferences/:id - Update conference
router.put(
  '/:id',
  authorizeHierarchical('update', 'conference'),
  auditLog('conference.update'),
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Conference name must be at least 2 characters'),
    body('contact.email')
      .optional({ nullable: true, checkFalsy: true })
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

      // Get current conference for validation
      const currentConference = await Conference.findById(id);
      if (!currentConference) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found',
        });
      }

      // Verify user has access to update this conference
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'update'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this conference',
        });
      }

      const conference = await Conference.findByIdAndUpdate(
        id,
        {
          ...req.body,
          'metadata.lastUpdated': new Date(),
        },
        { new: true, runValidators: true }
      ).populate('unionId', 'name');

      res.json({
        success: true,
        message: 'Conference updated successfully',
        data: conference,
      });
    } catch (error) {
      const statusCode = error.name === 'ValidationError' ? 400 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to update conference',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

// DELETE /api/conferences/:id - Soft delete conference
router.delete(
  '/:id',
  authorizeHierarchical('delete', 'conference'),
  auditLog('conference.delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const conference = await Conference.findById(id);
      if (!conference) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found',
        });
      }

      // Verify user has access to delete this conference
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'delete'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this conference',
        });
      }

      // Check if conference has churches
      const Church = require('../models/Church');
      const churchCount = await Church.countDocuments({
        conferenceId: id,
        isActive: true,
      });

      if (churchCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete conference: ${churchCount} active churches still exist`,
        });
      }

      // Soft delete
      conference.isActive = false;
      conference.metadata.lastUpdated = new Date();
      await conference.save();

      res.json({
        success: true,
        message: 'Conference deactivated successfully',
        data: conference,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete conference',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/conferences/:id/statistics - Get conference statistics
router.get(
  '/:id/statistics',
  authorizeHierarchical('read', 'conference'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const conference = await Conference.findById(id).populate(
        'unionId',
        'name'
      );
      if (!conference) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found',
        });
      }

      const statistics = await conference.getStatistics();

      res.json({
        success: true,
        message: 'Conference statistics retrieved successfully',
        data: {
          conference: {
            id: conference._id,
            name: conference.name,
            union: conference.unionId,
          },
          statistics,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get conference statistics',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/conferences/:id/hierarchy - Get conference hierarchy
router.get(
  '/:id/hierarchy',
  authorizeHierarchical('read', 'conference'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const conference = await Conference.findById(id);
      if (!conference) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found',
        });
      }

      const hierarchy = await conference.getFullHierarchy();

      res.json({
        success: true,
        message: 'Conference hierarchy retrieved successfully',
        data: hierarchy,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get conference hierarchy',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// PUT /api/conferences/:id/banner - Upload/update conference banner image
router.put(
  '/:id/banner',
  authorizeHierarchical('update', 'conference'),
  auditLog('conference.banner.update'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Verify user has access to update this conference
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'update'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message:
            'You do not have permission to update this conference banner',
        });
      }

      const conference = await Conference.findById(id);
      if (!conference) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found',
        });
      }

      // Implementation would be similar to union banner upload
      // For now, return a placeholder response
      res.json({
        success: true,
        message: 'Banner upload endpoint ready for implementation',
        data: {
          image: {
            url: 'placeholder-url',
            key: 'placeholder-key',
            alt: req.body.alt || '',
          },
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

// PUT /api/conferences/:id/banner/media - Set conference banner from existing media file
router.put(
  '/:id/banner/media',
  authorizeHierarchical('update', 'conference'),
  auditLog('conference.banner.update_from_media'),
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
      const { mediaFileId, alt } = req.body;

      // Verify user has access to update this conference
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'update'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message:
            'You do not have permission to update this conference banner',
        });
      }

      const conference = await Conference.findById(id);
      if (!conference) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found',
        });
      }

      // Get the media file
      const MediaFile = require('../models/MediaFile');
      const mediaFile = await MediaFile.findById(mediaFileId);
      if (!mediaFile) {
        return res.status(404).json({
          success: false,
          message: 'Media file not found',
        });
      }

      // Update conference banner
      conference.primaryImage = {
        url: mediaFile.url,
        key: mediaFile.key,
        alt: alt || mediaFile.alt || '',
        mediaFileId: mediaFile._id,
      };
      conference.metadata.lastUpdated = new Date();
      await conference.save();

      // Increment usage count for the media file
      await MediaFile.findByIdAndUpdate(mediaFileId, {
        $inc: { 'usage.total': 1 },
        $set: { 'usage.lastUsed': new Date() },
      });

      res.json({
        success: true,
        message: 'Conference banner updated successfully',
        data: {
          image: conference.primaryImage,
        },
      });
    } catch (error) {
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
