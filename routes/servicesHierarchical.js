const express = require('express');
const router = express.Router();
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
      error: error.message,
    });
  }
});

/**
 * GET /services/team/:teamId
 * Get all services for a specific team
 */
router.get(
  '/team/:teamId',
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

/**
 * GET /services/:id
 * Get specific service details
 */
router.get(
  '/:id',
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
  authenticateToken,
  authorizeServiceAccess('update'),
  auditLog('service.update'),
  async (req, res) => {
    try {
      const service = req.serviceContext; // Set by authorizeServiceAccess middleware
      const updates = req.body;

      // Prevent changing teamId (services are bound to teams)
      delete updates.teamId;
      delete updates.churchId;
      delete updates.hierarchyPath;

      // Update service
      Object.assign(service, updates);
      service.updatedBy = req.user._id;

      await service.save();

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

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

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
      error: error.message,
    });
  }
});

module.exports = router;
