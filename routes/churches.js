const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Church = require('../models/Church');
const Conference = require('../models/Conference');
const {
  authenticateToken,
  authorizeHierarchical,
} = require('../middleware/hierarchicalAuth');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/churches - Get all churches
router.get(
  '/',
  authorizeHierarchical('read', 'church'),
  [
    query('conferenceId')
      .optional()
      .isMongoId()
      .withMessage('Valid conference ID required'),
    query('city')
      .optional()
      .isString()
      .withMessage('City must be a string'),
    query('state')
      .optional()
      .isString()
      .withMessage('State must be a string'),
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

      const { conferenceId, city, state, includeInactive } = req.query;
      let query = {};
      
      if (conferenceId) query.conferenceId = conferenceId;
      if (city) query['location.address.city'] = new RegExp(city, 'i');
      if (state) query['location.address.state'] = new RegExp(state, 'i');
      if (!includeInactive || includeInactive !== 'true') {
        query.isActive = true;
      }

      // Filter based on user's hierarchy access
      const userLevel = await hierarchicalAuthService.getUserHighestLevel(req.user);
      const userPath = await hierarchicalAuthService.getUserHierarchyPath(req.user);

      if (userLevel > 1 && userPath) {
        // Users below conference level can only see churches in their subtree
        query.hierarchyPath = { $regex: `^${userPath}` };
      }

      const churches = await Church.find(query)
        .populate('conferenceId', 'name code')
        .select('name code location contact leadership demographics isActive establishedDate conferenceId')
        .sort('name');

      res.json({
        success: true,
        message: 'Churches retrieved successfully',
        data: churches,
        count: churches.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch churches',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

// GET /api/churches/search - Search churches by location
router.get(
  '/search',
  authorizeHierarchical('read', 'church'),
  [
    query('lat')
      .optional()
      .isFloat()
      .withMessage('Latitude must be a number'),
    query('lng')
      .optional()
      .isFloat()
      .withMessage('Longitude must be a number'),
    query('radius')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Radius must be a positive integer'),
    query('city')
      .optional()
      .isString()
      .withMessage('City must be a string'),
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

      const { lat, lng, radius = 50, city } = req.query;
      let churches = [];

      if (lat && lng) {
        // Geographic search
        churches = await Church.findNearLocation(
          parseFloat(lat), 
          parseFloat(lng), 
          parseInt(radius)
        );
      } else if (city) {
        // City search
        churches = await Church.findByLocation(city);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Either coordinates (lat, lng) or city must be provided',
        });
      }

      // Filter based on user's hierarchy access
      const userLevel = await hierarchicalAuthService.getUserHighestLevel(req.user);
      const userPath = await hierarchicalAuthService.getUserHierarchyPath(req.user);

      if (userLevel > 1 && userPath) {
        churches = churches.filter(church => 
          church.hierarchyPath && church.hierarchyPath.startsWith(userPath)
        );
      }

      res.json({
        success: true,
        message: 'Church search completed successfully',
        data: churches,
        count: churches.length,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to search churches',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

// GET /api/churches/:id - Get specific church
router.get(
  '/:id',
  authorizeHierarchical('read', 'church'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Verify user has access to this church
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'read'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this church',
        });
      }

      const church = await Church.findById(id)
        .populate('conferenceId', 'name code unionId')
        .populate('teams');

      if (!church) {
        return res.status(404).json({
          success: false,
          message: 'Church not found',
        });
      }

      res.json({
        success: true,
        message: 'Church retrieved successfully',
        data: church,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch church',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

// POST /api/churches - Create new church
router.post(
  '/',
  authorizeHierarchical('create', 'church'),
  auditLog('church.create'),
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Church name must be at least 2 characters'),
    body('conferenceId')
      .isMongoId()
      .withMessage('Valid conference ID required'),
    body('code')
      .optional()
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage('Church code must be 2-20 characters')
      .matches(/^[A-Z0-9]+$/)
      .withMessage('Church code must be uppercase letters/numbers only'),
    body('contact.email')
      .optional()
      .isEmail()
      .withMessage('Valid email required'),
    body('location.address.city')
      .optional()
      .isString()
      .withMessage('City must be a string'),
    body('location.coordinates.latitude')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitude must be between -90 and 90'),
    body('location.coordinates.longitude')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitude must be between -180 and 180'),
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

      // Verify conference exists
      const conference = await Conference.findById(req.body.conferenceId);
      if (!conference || !conference.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Conference not found or inactive',
        });
      }

      // Check if code already exists within the conference (if provided)
      if (req.body.code) {
        const existingChurch = await Church.findOne({ 
          conferenceId: req.body.conferenceId,
          code: req.body.code.toUpperCase() 
        });
        if (existingChurch) {
          return res.status(409).json({
            success: false,
            message: 'Church code already exists in this conference',
          });
        }
        req.body.code = req.body.code.toUpperCase();
      }

      const churchData = {
        ...req.body,
        createdBy: req.user.id,
      };

      const church = await Church.create(churchData);
      await church.populate('conferenceId', 'name code');

      res.status(201).json({
        success: true,
        message: 'Church created successfully',
        data: church,
      });
    } catch (error) {
      const statusCode = error.name === 'ValidationError' ? 400 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to create church',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

// PUT /api/churches/:id - Update church
router.put(
  '/:id',
  authorizeHierarchical('update', 'church'),
  auditLog('church.update'),
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Church name must be at least 2 characters'),
    body('code')
      .optional()
      .trim()
      .isLength({ min: 2, max: 20 })
      .withMessage('Church code must be 2-20 characters')
      .matches(/^[A-Z0-9]+$/)
      .withMessage('Church code must be uppercase letters/numbers only'),
    body('contact.email')
      .optional()
      .isEmail()
      .withMessage('Valid email required'),
    body('location.coordinates.latitude')
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitude must be between -90 and 90'),
    body('location.coordinates.longitude')
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitude must be between -180 and 180'),
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

      // Get current church for validation
      const currentChurch = await Church.findById(id);
      if (!currentChurch) {
        return res.status(404).json({
          success: false,
          message: 'Church not found',
        });
      }

      // Verify user has access to update this church
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'update'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to update this church',
        });
      }

      // Check if code already exists in conference (if being updated)
      if (req.body.code) {
        const existingChurch = await Church.findOne({ 
          conferenceId: currentChurch.conferenceId,
          code: req.body.code.toUpperCase(),
          _id: { $ne: id }
        });
        if (existingChurch) {
          return res.status(409).json({
            success: false,
            message: 'Church code already exists in this conference',
          });
        }
        req.body.code = req.body.code.toUpperCase();
      }

      const church = await Church.findByIdAndUpdate(
        id,
        { 
          ...req.body,
          'metadata.lastUpdated': new Date()
        },
        { new: true, runValidators: true }
      ).populate('conferenceId', 'name code');

      res.json({
        success: true,
        message: 'Church updated successfully',
        data: church,
      });
    } catch (error) {
      const statusCode = error.name === 'ValidationError' ? 400 : 500;
      res.status(statusCode).json({
        success: false,
        message: error.message || 'Failed to update church',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

// DELETE /api/churches/:id - Soft delete church
router.delete(
  '/:id',
  authorizeHierarchical('delete', 'church'),
  auditLog('church.delete'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const church = await Church.findById(id);
      if (!church) {
        return res.status(404).json({
          success: false,
          message: 'Church not found',
        });
      }

      // Verify user has access to delete this church
      const hasAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        id,
        'delete'
      );

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to delete this church',
        });
      }

      // Check if church has teams
      const Team = require('../models/Team');
      const teamCount = await Team.countDocuments({ churchId: id, isActive: true });
      
      if (teamCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete church: ${teamCount} active teams still exist`,
        });
      }

      // Soft delete
      church.isActive = false;
      church.metadata.lastUpdated = new Date();
      await church.save();

      res.json({
        success: true,
        message: 'Church deactivated successfully',
        data: church,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete church',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

// GET /api/churches/:id/statistics - Get church statistics
router.get(
  '/:id/statistics',
  authorizeHierarchical('read', 'church'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const church = await Church.findById(id).populate('conferenceId', 'name code');
      if (!church) {
        return res.status(404).json({
          success: false,
          message: 'Church not found',
        });
      }

      const statistics = await church.getStatistics();

      res.json({
        success: true,
        message: 'Church statistics retrieved successfully',
        data: {
          church: {
            id: church._id,
            name: church.name,
            code: church.code,
            conference: church.conferenceId,
          },
          statistics
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get church statistics',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

// GET /api/churches/:id/hierarchy - Get church hierarchy
router.get(
  '/:id/hierarchy',
  authorizeHierarchical('read', 'church'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const church = await Church.findById(id);
      if (!church) {
        return res.status(404).json({
          success: false,
          message: 'Church not found',
        });
      }

      const hierarchy = await church.getFullHierarchy();

      res.json({
        success: true,
        message: 'Church hierarchy retrieved successfully',
        data: hierarchy,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get church hierarchy',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  }
);

module.exports = router;