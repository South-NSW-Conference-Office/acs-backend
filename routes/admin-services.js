const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Service = require('../models/Service');
const ServiceEvent = require('../models/ServiceEvent');
const VolunteerRole = require('../models/VolunteerRole');
const Story = require('../models/Story');
// const Organization = require('../models/Organization'); // REMOVED - Using hierarchical models
const { authenticateToken } = require('../middleware/auth');
const {
  canManageService,
  requireServicePermission,
} = require('../middleware/serviceAuth');

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

/**
 * Admin-specific routes for service management
 * All routes require authentication
 */
router.use(authenticateToken);

/**
 * GET /api/admin/services/permissions
 * Get user's service permissions for all their organizations
 */
router.get('/permissions', async (req, res) => {
  try {
    // For super admin, give full permissions
    if (req.user.isSuperAdmin) {
      return res.json({
        success: true,
        permissions: {
          canCreateServices: true,
          canUpdateServices: true,
          canDeleteServices: true,
          canManageServices: true,
          canCreateStories: true,
          canManageStories: true,
        },
      });
    }

    // For non-super admin users, return basic permissions
    res.json({
      success: true,
      permissions: {
        canCreateServices: false,
        canUpdateServices: false,
        canDeleteServices: false,
        canManageServices: false,
        canCreateStories: false,
        canManageStories: false,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

/**
 * GET /api/admin/services/dashboard-stats
 * Get service statistics for the dashboard
 */
router.get('/dashboard-stats', async (req, res) => {
  try {
    // For super admin, show all services
    const query = req.user.isSuperAdmin ? {} : { teamId: { $exists: false } }; // No services for non-super admin

    const [
      totalServices,
      activeServices,
      upcomingEvents,
      openVolunteerRoles,
      publishedStories,
    ] = await Promise.all([
      Service.countDocuments(query),
      Service.countDocuments({
        ...query,
        status: 'active',
      }),
      // ServiceEvent.countDocuments({
      //   start: { $gt: new Date() },
      //   status: 'published',
      // }),
      Promise.resolve(0), // Placeholder for events
      // VolunteerRole.countDocuments({
      //   status: 'open',
      //   $expr: { $lt: ['$positionsFilled', '$numberOfPositions'] },
      // }),
      Promise.resolve(0), // Placeholder for volunteer roles
      Story.countDocuments({
        status: 'published',
      }),
    ]);

    res.json({
      success: true,
      stats: {
        totalServices,
        activeServices,
        upcomingEvents,
        openVolunteerRoles,
        publishedStories,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' });
  }
});

/**
 * GET /api/admin/services
 * Get all services the user can manage with filters
 */
router.get('/', async (req, res) => {
  try {
    const {
      organization,
      type,
      status,
      search,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Check if user is super admin
    const isSuperAdmin = req.user.isSuperAdmin;

    // Query all services for super admin, no services for non-super admin (for now)
    const query = isSuperAdmin ? {} : { teamId: { $exists: false } }; // Empty result for non-super admin

    if (organization && isSuperAdmin) {
      query.teamId = organization;
    }

    if (type) query.type = type;
    if (status) {
      query.status = status;
    } else {
      // By default, exclude archived services unless explicitly requested
      query.status = { $ne: 'archived' };
    }

    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [services, total] = await Promise.all([
      Service.find(query)
        .populate('teamId', 'name category')
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Service.countDocuments(query),
    ]);

    // Handle case when no services are found
    if (!services || services.length === 0) {
      return res.json({
        success: true,
        services: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total || 0,
          pages: Math.ceil((total || 0) / limit),
        },
      });
    }

    // Add permission info for each service (simplified for super admin)
    const servicesWithPermissions = services.map((service) => {
      const serviceObj = service.toObject();
      return {
        ...serviceObj,
        permissions: {
          canUpdate: isSuperAdmin,
          canDelete: isSuperAdmin,
          canManage: isSuperAdmin,
        },
      };
    });

    res.json({
      success: true,
      services: servicesWithPermissions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    // Return empty result instead of error when no services exist
    res.json({
      success: true,
      services: [],
      pagination: {
        page: parseInt(req.query.page || 1),
        limit: parseInt(req.query.limit || 10),
        total: 0,
        pages: 0,
      },
    });
  }
});

/**
 * GET /api/admin/services/:id/full
 * Get complete service details including events, roles, and stories
 */
router.get('/:id/full', validateObjectId('id'), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id)
      .populate('teamId', 'name category')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Check if user can view this service (super admin only for now)
    if (!req.user.isSuperAdmin) {
      return res
        .status(403)
        .json({ error: 'Insufficient permissions to view this service' });
    }

    // Fetch related data
    const [events, roles, stories] = await Promise.all([
      ServiceEvent.find({ service: service._id }).sort('-start').limit(10),
      VolunteerRole.find({ service: service._id }).sort('-createdAt').limit(10),
      Story.find({ service: service._id }).sort('-publishedAt').limit(10),
    ]);

    // Check permissions (simplified for super admin)
    const permissions = {
      canUpdate: req.user.isSuperAdmin,
      canDelete: req.user.isSuperAdmin,
      canManage: req.user.isSuperAdmin,
      canCreateStories: req.user.isSuperAdmin,
    };

    res.json({
      success: true,
      service: service.toObject(),
      events,
      roles,
      stories,
      permissions,
    });
  } catch (error) {
    // Error fetching service details
    res.status(500).json({ error: 'Failed to fetch service details' });
  }
});

/**
 * GET /api/admin/services/types
 * Get available service types
 */
router.get('/types', async (req, res) => {
  try {
    const ServiceType = require('../models/ServiceType');

    const types = await ServiceType.findActive();

    const formattedTypes = types.map((type) => ({
      value: type.value,
      label: type.name,
      description: type.description,
    }));

    res.json({
      success: true,
      types: formattedTypes,
    });
  } catch (error) {
    // Silently handle service types fetch error
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service types',
    });
  }
});

/**
 * GET /api/admin/services/organizations
 * Get teams where user can create services (replaces organizations)
 */
router.get('/organizations', async (req, res) => {
  try {
    // For super admin, get all teams
    if (!req.user.isSuperAdmin) {
      return res.json({
        success: true,
        organizations: [], // Non-super admin gets no teams for now
      });
    }

    const Team = require('../models/Team');
    const teams = await Team.find({ status: 'active' })
      .select('name category')
      .limit(50);

    // Format teams as organizations for compatibility with frontend
    const organizations = teams.map((team) => ({
      _id: team._id,
      name: team.name,
      type: 'team',
      category: team.category,
      parent: null,
    }));

    res.json({
      success: true,
      organizations,
    });
  } catch (error) {
    res.json({
      success: true,
      organizations: [],
    });
  }
});

/**
 * POST /api/admin/services
 * Create a new service
 */
router.post(
  '/',
  requireServicePermission('services.create'),
  async (req, res) => {
    try {
      // Remove all _id and id fields from the request body to avoid ObjectId errors
      const cleanData = (obj) => {
        if (Array.isArray(obj)) {
          return obj.map(cleanData);
        } else if (obj && typeof obj === 'object') {
          const cleaned = {};
          for (const [key, value] of Object.entries(obj)) {
            if (key !== '_id' && key !== 'id') {
              // Remove all _id and id fields
              cleaned[key] = cleanData(value);
            }
          }
          return cleaned;
        }
        return obj;
      };

      const serviceData = cleanData(req.body);

      const service = new Service(serviceData);
      await service.save();

      await service.populate('teamId', 'name category');

      res.status(201).json({
        success: true,
        message: 'Service created successfully',
        service: service.toObject(),
      });
    } catch (error) {
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Validation error',
          details: Object.values(error.errors).map((e) => e.message),
        });
      }

      res.status(500).json({ error: 'Failed to create service' });
    }
  }
);

/**
 * PUT /api/admin/services/:id
 * Update a service
 */
router.put(
  '/:id',
  validateObjectId('id'),
  requireServicePermission('services.update'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Update service — whitelist allowed fields
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
        'primaryImage',
        'gallery',
      ];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          service[field] = req.body[field];
        }
      }
      service.updatedBy = req.user._id;
      await service.save();

      // Populate the teamId for the response
      await service.populate('teamId', 'name category');

      res.json({
        success: true,
        message: 'Service updated successfully',
        service: service.toObject(),
      });
    } catch (error) {
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Validation error',
          details: Object.values(error.errors).map((e) => e.message),
        });
      }

      res.status(500).json({ error: 'Failed to update service' });
    }
  }
);

/**
 * DELETE /api/admin/services/:id
 * Delete a service permanently from the database
 */
router.delete(
  '/:id',
  validateObjectId('id'),
  requireServicePermission('services.delete'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Store service info for response before deletion
      const serviceName = service.name;
      const serviceId = service._id;

      // Clean up related data
      // Delete related service events
      if (typeof ServiceEvent !== 'undefined') {
        await ServiceEvent.deleteMany({ service: serviceId });
      }

      // Delete related volunteer roles
      if (typeof VolunteerRole !== 'undefined') {
        await VolunteerRole.deleteMany({ service: serviceId });
      }

      // Delete related stories
      await Story.deleteMany({ service: serviceId });

      // Actually delete the service from the database
      await Service.findByIdAndDelete(req.params.id);

      res.json({
        success: true,
        message: 'Service deleted successfully',
        deletedService: {
          _id: serviceId,
          name: serviceName,
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete service' });
    }
  }
);

/**
 * PUT /api/admin/services/:id/banner
 * Update service banner image
 */
router.put(
  '/:id/banner',
  validateObjectId('id'),
  requireServicePermission('services.update'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Verify permission for this specific service
      const hasPermission = await canManageService(
        req.user,
        service.teamId,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      // Handle media file selection (when selecting existing image)
      if (req.body.mediaFileId) {
        const MediaFile = require('../models/MediaFile');
        const mediaFile = await MediaFile.findById(req.body.mediaFileId);

        if (!mediaFile) {
          return res.status(404).json({ error: 'Media file not found' });
        }

        // Delete old primary image if exists
        if (service.primaryImage?.key) {
          const storageService = require('../services/storageService');
          await storageService.deleteImage(service.primaryImage.key);
        }

        // Update service with selected media file
        service.primaryImage = {
          url: mediaFile.url,
          key: mediaFile.key,
          alt: req.body.alt || mediaFile.alt || '',
        };
        service.updatedBy = req.user._id;
        await service.save();

        return res.json({
          success: true,
          message: 'Primary image updated successfully',
          image: service.primaryImage,
        });
      }

      // If no media file ID, this endpoint requires file upload to be handled by /services/:id/banner
      // Redirect to main services route for file uploads
      return res.status(400).json({
        error: 'For file uploads, use the main /services/:id/banner endpoint',
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update primary image' });
    }
  }
);

/**
 * POST /api/admin/services/:id/toggle-status
 * Toggle service status between active and paused
 */
router.post(
  '/:id/toggle-status',
  validateObjectId('id'),
  requireServicePermission('services.update'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Toggle between active and paused
      service.status = service.status === 'active' ? 'paused' : 'active';
      service.updatedBy = req.user._id;
      await service.save();

      res.json({
        success: true,
        message: `Service ${service.status === 'active' ? 'activated' : 'paused'}`,
        service,
      });
    } catch (error) {
      // Error toggling service status
      res.status(500).json({ error: 'Failed to toggle service status' });
    }
  }
);

/**
 * GET /api/admin/stories
 * Get stories for admin management
 */
router.get('/stories', async (req, res) => {
  try {
    const {
      organization,
      service,
      status = 'all',
      page = 1,
      limit = 10,
    } = req.query;

    // For super admin, show all stories
    const query = req.user.isSuperAdmin ? {} : { teamId: { $exists: false } }; // Empty result for non-super admin

    if (organization && req.user.isSuperAdmin) {
      query.teamId = organization;
    }

    if (service) query.service = service;
    if (status !== 'all') query.status = status;

    const skip = (page - 1) * limit;

    const [stories, total] = await Promise.all([
      Story.find(query)
        .populate('service', 'name')
        .populate('teamId', 'name')
        .populate('createdBy', 'name')
        .sort('-createdAt')
        .skip(skip)
        .limit(parseInt(limit)),
      Story.countDocuments(query),
    ]);

    res.json({
      success: true,
      stories,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    // Error fetching stories
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

module.exports = router;
