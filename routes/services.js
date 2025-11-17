const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const ServiceEvent = require('../models/ServiceEvent');
const VolunteerRole = require('../models/VolunteerRole');
const Story = require('../models/Story');
const {
  requireServicePermission,
  requireStoryPermission,
  filterServicesByPermission,
  getManageableOrganizations,
  canManageService,
} = require('../middleware/serviceAuth');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ dest: 'uploads/temp/' });

// ============================================
// AUTHENTICATED ROUTES (specific paths first)
// ============================================

/**
 * GET /services/manageable
 * Get all services the user can manage
 */
router.get('/manageable', authenticateToken, async (req, res) => {
  try {
    const manageableOrgIds = await getManageableOrganizations(req.user);

    const services = await Service.find({
      organization: { $in: manageableOrgIds },
    })
      .populate('organization', 'name type')
      .sort('-createdAt');

    res.json({
      success: true,
      count: services.length,
      services,
      organizations: manageableOrgIds,
    });
  } catch (error) {
    console.error('Error fetching manageable services:', error);
    res.status(500).json({ error: 'Failed to fetch manageable services' });
  }
});

/**
 * GET /services/organizations
 * Get organizations where user can create services
 */
router.get('/organizations', authenticateToken, async (req, res) => {
  try {
    const organizations = await getManageableOrganizations(
      req.user,
      'services.create'
    );

    res.json({
      success: true,
      organizations,
    });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

/**
 * GET /services
 * Get all active services (public view)
 */
router.get('/', async (req, res) => {
  try {
    const { type, organization, search, lat, lng, radius } = req.query;

    const query = { status: 'active' };

    if (type) query.type = type;
    if (organization) query.organization = organization;

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
      })
        .populate('organization', 'name type')
        .sort({ score: { $meta: 'textScore' } });
    } else {
      // Standard query
      services = await Service.findActiveServices(query);
    }

    res.json({
      success: true,
      count: services.length,
      services,
    });
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

/**
 * GET /services/:id
 * Get a single service (public view)
 */
router.get('/:id', async (req, res) => {
  try {
    const service = await Service.findById(req.params.id)
      .populate('organization', 'name type parent')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Check if service can be viewed
    if (!service.canBeViewedBy(req.user)) {
      return res.status(403).json({ error: 'Service not publicly available' });
    }

    res.json({
      success: true,
      service,
    });
  } catch (error) {
    console.error('Error fetching service:', error);
    res.status(500).json({ error: 'Failed to fetch service' });
  }
});

/**
 * GET /services/:id/events
 * Get upcoming events for a service
 */
router.get('/:id/events', async (req, res) => {
  try {
    const events = await ServiceEvent.findUpcoming({
      service: req.params.id,
      visibility: 'public',
    });

    res.json({
      success: true,
      count: events.length,
      events,
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/**
 * GET /services/:id/volunteer-roles
 * Get open volunteer roles for a service
 */
router.get('/:id/volunteer-roles', async (req, res) => {
  try {
    const roles = await VolunteerRole.findOpenRoles({
      service: req.params.id,
      visibility: 'public',
    });

    res.json({
      success: true,
      count: roles.length,
      roles,
    });
  } catch (error) {
    console.error('Error fetching volunteer roles:', error);
    res.status(500).json({ error: 'Failed to fetch volunteer roles' });
  }
});

/**
 * GET /services/:id/stories
 * Get published stories for a service
 */
router.get('/:id/stories', async (req, res) => {
  try {
    const stories = await Story.findPublished({
      service: req.params.id,
      visibility: 'public',
    });

    res.json({
      success: true,
      count: stories.length,
      stories,
    });
  } catch (error) {
    console.error('Error fetching stories:', error);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});

// ============================================
// PROTECTED ROUTES (Require specific permissions)
// ============================================

/**
 * POST /services
 * Create a new service
 */
router.post(
  '/',
  authenticateToken,
  requireServicePermission('services.create'),
  async (req, res) => {
    try {
      const serviceData = {
        ...req.body,
        organization: req.authorizedOrgId,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      };

      const service = new Service(serviceData);
      await service.save();

      await service.populate('organization', 'name type');

      res.status(201).json({
        success: true,
        service,
      });
    } catch (error) {
      console.error('Error creating service:', error);
      res.status(500).json({ error: 'Failed to create service' });
    }
  }
);

/**
 * PUT /services/:id
 * Update a service
 */
router.put(
  '/:id',
  authenticateToken,
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
        service.organization,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      // Prevent changing organization
      delete req.body.organization;
      delete req.body.createdBy;

      Object.assign(service, req.body);
      service.updatedBy = req.user._id;

      await service.save();
      await service.populate('organization', 'name type');

      res.json({
        success: true,
        service,
      });
    } catch (error) {
      console.error('Error updating service:', error);
      res.status(500).json({ error: 'Failed to update service' });
    }
  }
);

/**
 * DELETE /services/:id
 * Delete (archive) a service
 */
router.delete(
  '/:id',
  authenticateToken,
  requireServicePermission('services.delete'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Verify permission for this specific service
      const hasPermission = await canManageService(
        req.user,
        service.organization,
        'services.delete'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot delete this service' });
      }

      // Archive instead of hard delete
      service.status = 'archived';
      service.updatedBy = req.user._id;
      await service.save();

      res.json({
        success: true,
        message: 'Service archived successfully',
      });
    } catch (error) {
      console.error('Error deleting service:', error);
      res.status(500).json({ error: 'Failed to delete service' });
    }
  }
);

/**
 * POST /services/:id/upload-image
 * Upload service image
 */
router.post(
  '/:id/upload-image',
  authenticateToken,
  requireServicePermission('services.update'),
  upload.single('image'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Verify permission
      const hasPermission = await canManageService(
        req.user,
        service.organization,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      // TODO: Process and store image (S3, Cloudinary, etc.)
      // For now, just return a placeholder
      const imageUrl = `/uploads/services/${req.file.filename}`;

      if (req.body.imageType === 'primary') {
        service.primaryImage = {
          url: imageUrl,
          alt: req.body.alt || '',
        };
      } else {
        service.gallery.push({
          url: imageUrl,
          alt: req.body.alt || '',
          caption: req.body.caption || '',
        });
      }

      service.updatedBy = req.user._id;
      await service.save();

      res.json({
        success: true,
        imageUrl,
        service,
      });
    } catch (error) {
      console.error('Error uploading image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    }
  }
);

/**
 * POST /services/:id/events
 * Create an event for a service
 */
router.post(
  '/:id/events',
  authenticateToken,
  requireServicePermission('services.manage'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      const hasPermission = await canManageService(
        req.user,
        service.organization,
        'services.manage'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot manage this service' });
      }

      const eventData = {
        ...req.body,
        service: service._id,
        organization: service.organization,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      };

      const event = new ServiceEvent(eventData);
      await event.save();

      await event.populate('service', 'name type');

      res.status(201).json({
        success: true,
        event,
      });
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(500).json({ error: 'Failed to create event' });
    }
  }
);

// ============================================
// STORY ROUTES
// ============================================

/**
 * POST /services/stories
 * Create a new story
 */
router.post(
  '/stories',
  authenticateToken,
  requireStoryPermission('stories.create'),
  async (req, res) => {
    try {
      const storyData = {
        ...req.body,
        organization: req.authorizedOrgId,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      };

      const story = new Story(storyData);
      await story.save();

      await story.populate('organization', 'name type');
      if (story.service) {
        await story.populate('service', 'name type');
      }

      res.status(201).json({
        success: true,
        story,
      });
    } catch (error) {
      console.error('Error creating story:', error);
      res.status(500).json({ error: 'Failed to create story' });
    }
  }
);

/**
 * PUT /services/stories/:id
 * Update a story
 */
router.put(
  '/stories/:id',
  authenticateToken,
  requireStoryPermission('stories.update'),
  async (req, res) => {
    try {
      const story = await Story.findById(req.params.id);

      if (!story) {
        return res.status(404).json({ error: 'Story not found' });
      }

      // Verify permission for this specific story
      const hasPermission = await canManageService(
        req.user,
        story.organization,
        'stories.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this story' });
      }

      // Prevent changing organization
      delete req.body.organization;
      delete req.body.createdBy;

      Object.assign(story, req.body);
      story.updatedBy = req.user._id;

      await story.save();
      await story.populate('organization', 'name type');

      res.json({
        success: true,
        story,
      });
    } catch (error) {
      console.error('Error updating story:', error);
      res.status(500).json({ error: 'Failed to update story' });
    }
  }
);

/**
 * POST /services/stories/:id/publish
 * Publish a story
 */
router.post(
  '/stories/:id/publish',
  authenticateToken,
  requireStoryPermission('stories.manage'),
  async (req, res) => {
    try {
      const story = await Story.findById(req.params.id);

      if (!story) {
        return res.status(404).json({ error: 'Story not found' });
      }

      const hasPermission = await canManageService(
        req.user,
        story.organization,
        'stories.manage'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot publish this story' });
      }

      await story.publish(req.user._id);

      res.json({
        success: true,
        story,
      });
    } catch (error) {
      console.error('Error publishing story:', error);
      res.status(500).json({ error: 'Failed to publish story' });
    }
  }
);

module.exports = router;
