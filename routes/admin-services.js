const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const ServiceEvent = require('../models/ServiceEvent');
const VolunteerRole = require('../models/VolunteerRole');
const Story = require('../models/Story');
const Organization = require('../models/Organization');
const { authenticateToken } = require('../middleware/auth');
const {
  getManageableOrganizations,
  canManageService,
  requireServicePermission,
} = require('../middleware/serviceAuth');

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
    const permissions = {};

    for (const assignment of req.user.organizations) {
      const orgId = assignment.organization._id.toString();
      const role = assignment.role;

      permissions[orgId] = {
        organizationName: assignment.organization.name,
        organizationType: assignment.organization.type,
        role: role.name,
        canCreateServices: role.hasPermission('services.create'),
        canUpdateServices: role.hasPermission('services.update'),
        canDeleteServices: role.hasPermission('services.delete'),
        canManageServices: role.hasPermission('services.manage'),
        canCreateStories: role.hasPermission('stories.create'),
        canManageStories: role.hasPermission('stories.manage'),
        servicePermissions: role.permissions.filter(
          (p) => p.startsWith('services.') || p.startsWith('stories.')
        ),
      };
    }

    res.json({
      success: true,
      permissions,
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
});

/**
 * GET /api/admin/services/dashboard-stats
 * Get service statistics for the dashboard
 */
router.get('/dashboard-stats', async (req, res) => {
  try {
    const manageableOrgIds = await getManageableOrganizations(
      req.user,
      'services.read'
    );

    const [
      totalServices,
      activeServices,
      upcomingEvents,
      openVolunteerRoles,
      publishedStories,
    ] = await Promise.all([
      Service.countDocuments({ organization: { $in: manageableOrgIds } }),
      Service.countDocuments({
        organization: { $in: manageableOrgIds },
        status: 'active',
      }),
      ServiceEvent.countDocuments({
        organization: { $in: manageableOrgIds },
        start: { $gt: new Date() },
        status: 'published',
      }),
      VolunteerRole.countDocuments({
        organization: { $in: manageableOrgIds },
        status: 'open',
        $expr: { $lt: ['$positionsFilled', '$numberOfPositions'] },
      }),
      Story.countDocuments({
        organization: { $in: manageableOrgIds },
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
    console.error('Error fetching dashboard stats:', error);
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

    console.log(
      'Admin services GET / - User:',
      req.user ? req.user.email : 'No user'
    );
    console.log('User organizations:', req.user?.organizations?.length || 0);

    const manageableOrgIds = await getManageableOrganizations(req.user);

    const query = { organization: { $in: manageableOrgIds } };

    if (organization && manageableOrgIds.includes(organization)) {
      query.organization = organization;
    }

    if (type) query.type = type;
    if (status) query.status = status;

    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [services, total] = await Promise.all([
      Service.find(query)
        .populate('organization', 'name type parent')
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Service.countDocuments(query),
    ]);

    // Add permission info for each service
    const servicesWithPermissions = await Promise.all(
      services.map(async (service) => {
        const serviceObj = service.toObject();
        return {
          ...serviceObj,
          permissions: {
            canUpdate: await canManageService(
              req.user,
              service.organization._id,
              'services.update'
            ),
            canDelete: await canManageService(
              req.user,
              service.organization._id,
              'services.delete'
            ),
            canManage: await canManageService(
              req.user,
              service.organization._id,
              'services.manage'
            ),
          },
        };
      })
    );

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
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

/**
 * GET /api/admin/services/:id/full
 * Get complete service details including events, roles, and stories
 */
router.get('/:id/full', async (req, res) => {
  try {
    const service = await Service.findById(req.params.id)
      .populate('organization')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Check if user can view this service
    const canView = await canManageService(
      req.user,
      service.organization._id,
      'services.read'
    );
    if (!canView) {
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

    // Check permissions
    const permissions = {
      canUpdate: await canManageService(
        req.user,
        service.organization._id,
        'services.update'
      ),
      canDelete: await canManageService(
        req.user,
        service.organization._id,
        'services.delete'
      ),
      canManage: await canManageService(
        req.user,
        service.organization._id,
        'services.manage'
      ),
      canCreateStories: await canManageService(
        req.user,
        service.organization._id,
        'stories.create'
      ),
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
    console.error('Error fetching service details:', error);
    res.status(500).json({ error: 'Failed to fetch service details' });
  }
});

/**
 * GET /api/admin/services/types
 * Get available service types
 */
router.get('/types', (req, res) => {
  const types = [
    { value: 'op_shop', label: 'Op Shop' },
    { value: 'food_pantry', label: 'Food Pantry' },
    { value: 'soup_kitchen', label: 'Soup Kitchen' },
    { value: 'disaster_response', label: 'Disaster Response' },
    { value: 'health_program', label: 'Health Program' },
    { value: 'youth_outreach', label: 'Youth Outreach' },
    { value: 'emergency_shelter', label: 'Emergency Shelter' },
    { value: 'counseling_service', label: 'Counseling Service' },
    { value: 'education_program', label: 'Education Program' },
    { value: 'community_garden', label: 'Community Garden' },
    { value: 'other', label: 'Other' },
  ];

  res.json({
    success: true,
    types,
  });
});

/**
 * GET /api/admin/services/organizations
 * Get organizations where user can create services
 */
router.get('/organizations', async (req, res) => {
  try {
    console.log(
      'Organizations endpoint - User:',
      req.user ? req.user.email : 'No user'
    );
    console.log('User organizations:', req.user?.organizations);

    const orgIds = await getManageableOrganizations(
      req.user,
      'services.create'
    );

    const organizations = await Organization.find({
      _id: { $in: orgIds },
    }).select('name type parent');

    res.json({
      success: true,
      organizations,
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

/**
 * POST /api/admin/services/:id/toggle-status
 * Toggle service status between active and paused
 */
router.post(
  '/:id/toggle-status',
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
      console.error('Error toggling service status:', error);
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

    const manageableOrgIds = await getManageableOrganizations(
      req.user,
      'stories.read'
    );

    const query = { organization: { $in: manageableOrgIds } };

    if (organization && manageableOrgIds.includes(organization)) {
      query.organization = organization;
    }

    if (service) query.service = service;
    if (status !== 'all') query.status = status;

    const skip = (page - 1) * limit;

    const [stories, total] = await Promise.all([
      Story.find(query)
        .populate('service', 'name')
        .populate('organization', 'name')
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
    console.error('Error fetching stories:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

module.exports = router;
