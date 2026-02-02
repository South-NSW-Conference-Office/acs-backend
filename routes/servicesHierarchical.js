const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Service = require('../models/Service');
// const Team = require('../models/Team');
const {
  authenticateToken,
  authorizeHierarchical,
  authorizeServiceAccess,
  // requireSuperAdmin
} = require('../middleware/hierarchicalAuth');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

/** Middleware: reject invalid ObjectId params early with a clean 400 */
function validateObjectId(paramName) {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (value && !mongoose.Types.ObjectId.isValid(value)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName} format`,
      });
    }
    next();
  };
}

/** Convert nested objects to dot-notation for safe MongoDB $set */
function toDotNotation(obj, prefix = '') {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !mongoose.Types.ObjectId.isValid(value)
    ) {
      Object.assign(result, toDotNotation(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/** Pick only allowed fields from an object */
function pickAllowedFields(obj, allowedFields) {
  const result = {};
  for (const field of allowedFields) {
    if (obj[field] !== undefined) {
      result[field] = obj[field];
    }
  }
  return result;
}

// ============================================
// HIERARCHICAL SERVICE ROUTES
// Services are bound to teams, teams to churches
// ============================================

/**
 * GET /services/accessible
 * Get all services accessible to user based on hierarchy
 */
router.get('/accessible', authenticateToken, async (req, res) => {
  try {
    const userHierarchyPath =
      await hierarchicalAuthService.getUserHierarchyPath(req.user);

    if (!userHierarchyPath) {
      return res.status(403).json({
        success: false,
        message: 'No hierarchy access found',
      });
    }

    // Get accessible services using hierarchical path
    const services = await Service.findAccessibleServices(userHierarchyPath);

    res.json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch accessible services',
    });
  }
});

/**
 * GET /services/team/:teamId
 * Get all services for a specific team
 */
router.get(
  '/team/:teamId',
  validateObjectId('teamId'),
  authenticateToken,
  authorizeHierarchical('read', 'team'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { includeArchived } = req.query;

      const services = await Service.findByTeam(
        teamId,
        includeArchived === 'true'
      );

      res.json({
        success: true,
        count: services.length,
        data: services,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

/**
 * GET /services/church/:churchId
 * Get all services for a specific church (across all teams)
 */
router.get(
  '/church/:churchId',
  validateObjectId('churchId'),
  authenticateToken,
  authorizeHierarchical('read', 'organization'),
  async (req, res) => {
    try {
      const { churchId } = req.params;
      const { includeArchived } = req.query;

      const services = await Service.findByChurch(
        churchId,
        includeArchived === 'true'
      );

      res.json({
        success: true,
        count: services.length,
        data: services,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// ============================================
// PUBLIC ROUTES (No authentication required)
// These must be defined BEFORE /:id to prevent matching 'public' as an ID
// ============================================

/**
 * GET /services/public/:id
 * Get single service by ID (public view)
 */
router.get('/public/:id', validateObjectId('id'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id)
      .populate('teamId', 'name type')
      .populate('churchId', 'name');

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    // Only return active services publicly
    if (service.status !== 'active') {
      return res.status(404).json({
        success: false,
        message: 'Service not available',
      });
    }

    res.json({
      success: true,
      data: service,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service',
    });
  }
});

/**
 * GET /services/public
 * Get all active services (public view)
 */
router.get('/public', async (req, res) => {
  try {
    const { type, church, search, lat, lng, radius } = req.query;

    const query = { status: 'active' };

    if (type) query.type = type;
    if (church) query.churchId = church;

    let services;

    if (lat && lng) {
      // Geographic search
      services = await Service.findNearby(
        { lat: parseFloat(lat), lng: parseFloat(lng) },
        radius ? parseFloat(radius) * 1000 : 50000
      );
    } else if (search) {
      // Text search
      services = await Service.find({
        ...query,
        $text: { $search: search },
      }).score({ score: { $meta: 'textScore' } });
    } else {
      // Standard query
      services = await Service.find(query);
    }

    // Populate minimal data for public view
    await Service.populate(services, [
      { path: 'teamId', select: 'name type' },
      { path: 'churchId', select: 'name' },
    ]);

    res.json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services',
    });
  }
});

/**
 * GET /services/:id
 * Get specific service details
 */
router.get(
  '/:id',
  validateObjectId('id'),
  authenticateToken,
  authorizeServiceAccess('read'),
  async (req, res) => {
    try {
      const service = req.serviceContext; // Set by authorizeServiceAccess middleware

      res.json({
        success: true,
        data: service,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

/**
 * POST /services
 * Create new service (HIERARCHICAL - must be under team)
 */
router.post(
  '/',
  authenticateToken,
  authorizeHierarchical('create', 'service'),
  auditLog('service.create'),
  async (req, res) => {
    try {
      const {
        name,
        teamId,
        type,
        descriptionShort,
        descriptionLong,
        tags,
        locations,
        contactInfo,
        eligibility,
        capacity,
      } = req.body;

      if (!name || !teamId) {
        return res.status(400).json({
          success: false,
          message: 'Service name and team are required',
        });
      }

      // Validate team exists and user can access it
      const team = await hierarchicalAuthService.getEntity('team', teamId);

      if (!team || !team.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Team not found or inactive',
        });
      }

      // Validate user can create service in this team
      const canCreate = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        team.hierarchyPath,
        'create'
      );

      if (!canCreate) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to create service in this team',
        });
      }

      // Create service with team binding
      const service = new Service({
        name,
        teamId,
        type: type || 'community_service',
        descriptionShort,
        descriptionLong,
        tags: tags || [],
        locations: locations || [],
        contactInfo: contactInfo || {},
        eligibility: eligibility || {},
        capacity: capacity || {},
        status: 'active',
        createdBy: req.user._id,
      });

      await service.save();

      // Populate related data for response
      await service.populate('teamId churchId');

      res.status(201).json({
        success: true,
        data: service,
        message: 'Service created successfully',
      });
    } catch (error) {
      res.status(error.message.includes('permission') ? 403 : 400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

/**
 * PUT /services/:id
 * Update service
 */
router.put(
  '/:id',
  validateObjectId('id'),
  authenticateToken,
  authorizeServiceAccess('update'),
  auditLog('service.update'),
  async (req, res) => {
    try {
      const service = req.serviceContext; // Set by authorizeServiceAccess middleware

      // Whitelist allowed update fields
      const allowedFields = [
        'name',
        'type',
        'descriptionShort',
        'descriptionLong',
        'tags',
        'locations',
        'contactInfo',
        'eligibility',
        'capacity',
        'scheduling',
        'status',
        'settings',
      ];
      const filtered = pickAllowedFields(req.body, allowedFields);

      // Use dot-notation for nested objects to avoid wiping siblings
      const dotUpdates = toDotNotation(filtered);
      dotUpdates.updatedBy = req.user._id;

      await Service.findByIdAndUpdate(service._id, { $set: dotUpdates });
      const updated = await Service.findById(service._id)
        .populate('teamId', 'name type')
        .populate('churchId', 'name');

      // Replace service reference for response
      Object.assign(service, updated.toObject());

      res.json({
        success: true,
        data: service,
        message: 'Service updated successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

/**
 * DELETE /services/:id
 * Archive service (soft delete)
 */
router.delete(
  '/:id',
  validateObjectId('id'),
  authenticateToken,
  authorizeServiceAccess('delete'),
  auditLog('service.delete'),
  async (req, res) => {
    try {
      const service = req.serviceContext; // Set by authorizeServiceAccess middleware

      // Soft delete
      service.status = 'archived';
      service.updatedBy = req.user._id;

      await service.save();

      res.json({
        success: true,
        message: 'Service archived successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

/**
 * POST /services/:id/restore
 * Restore archived service
 */
router.post(
  '/:id/restore',
  validateObjectId('id'),
  authenticateToken,
  authorizeServiceAccess('update'),
  auditLog('service.restore'),
  async (req, res) => {
    try {
      const service = req.serviceContext; // Set by authorizeServiceAccess middleware

      service.status = 'active';
      service.updatedBy = req.user._id;

      await service.save();

      res.json({
        success: true,
        data: service,
        message: 'Service restored successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

/**
 * GET /services/:id/images
 * Get all service images (public endpoint - no auth required)
 */
router.get('/:id/images', validateObjectId('id'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id).select(
      'primaryImage gallery'
    );

    if (!service) {
      return res.status(404).json({
        success: false,
        error: 'Service not found',
      });
    }

    res.json({
      success: true,
      banner: service.primaryImage,
      gallery: service.gallery || [],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch service images',
    });
  }
});

module.exports = router;
