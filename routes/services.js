const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const ServiceEvent = require('../models/ServiceEvent');
const VolunteerRole = require('../models/VolunteerRole');
const Story = require('../models/Story');
const {
  requireServicePermission,
  requireStoryPermission,
  getManageableOrganizations,
  canManageService,
} = require('../middleware/serviceAuth');
const { authenticateToken } = require('../middleware/auth');
const storageService = require('../services/storageService');
const {
  upload,
  handleUploadError,
  requireFile,
  validateImageDimensions,
} = require('../middleware/uploadMiddleware');

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
      teamId: { $in: manageableOrgIds },
    })
      .populate('teamId', 'name category')
      .sort('-createdAt');

    res.json({
      success: true,
      count: services.length,
      services,
      teams: manageableOrgIds,
    });
  } catch (error) {
    // Error fetching manageable services
    res.status(500).json({ error: 'Failed to fetch manageable services' });
  }
});

/**
 * GET /services/teams
 * Get teams where user can create services
 */
router.get('/teams', authenticateToken, async (req, res) => {
  try {
    const teams = await getManageableOrganizations(req.user, 'services.create');

    res.json({
      success: true,
      teams,
    });
  } catch (error) {
    // Error fetching teams
    res.status(500).json({ error: 'Failed to fetch teams' });
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
    const { type, team, search, lat, lng, radius } = req.query;

    const query = { status: 'active' };

    if (type) query.type = type;
    if (team) query.teamId = team;

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
        .populate('teamId', 'name category')
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
    // Error fetching services
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
      .populate('teamId', 'name category')
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
    // Error fetching service
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
    // Error fetching events
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
    // Error fetching volunteer roles
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
    // Error fetching stories
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
      // Validate scheduling data if present
      if (req.body.scheduling) {
        // Set lastUpdated for scheduling
        req.body.scheduling.lastUpdated = new Date();

        // Basic validation for events
        if (req.body.scheduling.events) {
          for (const event of req.body.scheduling.events) {
            if (event.startDateTime && event.endDateTime) {
              const startDate = new Date(event.startDateTime);
              const endDate = new Date(event.endDateTime);
              if (startDate >= endDate) {
                return res.status(400).json({
                  error: 'Event end time must be after start time',
                });
              }
            }
          }
        }
      }

      const serviceData = {
        ...req.body,
        teamId: req.authorizedOrgId,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      };

      const service = new Service(serviceData);
      await service.save();

      await service.populate('teamId', 'name category');

      res.status(201).json({
        success: true,
        service,
      });
    } catch (error) {
      // Error creating service
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
        service.teamId,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      // Prevent changing team
      delete req.body.teamId;
      delete req.body.createdBy;

      // Validate scheduling data if present
      if (req.body.scheduling) {
        // Set lastUpdated for scheduling
        req.body.scheduling.lastUpdated = new Date();

        // Basic validation for events
        if (req.body.scheduling.events) {
          for (const event of req.body.scheduling.events) {
            if (event.startDateTime && event.endDateTime) {
              const startDate = new Date(event.startDateTime);
              const endDate = new Date(event.endDateTime);
              if (startDate >= endDate) {
                return res.status(400).json({
                  error: 'Event end time must be after start time',
                });
              }
            }
          }
        }
      }

      Object.assign(service, req.body);
      service.updatedBy = req.user._id;

      await service.save();
      await service.populate('teamId', 'name category');

      res.json({
        success: true,
        service,
      });
    } catch (error) {
      // Error updating service
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
        service.teamId,
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
      // Error deleting service
      res.status(500).json({ error: 'Failed to delete service' });
    }
  }
);

/**
 * PUT /services/:id/banner
 * Upload or update service banner image
 */
router.put(
  '/:id/banner',
  authenticateToken,
  requireServicePermission('services.update'),
  upload.banner,
  requireFile('banner'),
  validateImageDimensions({ minWidth: 800, minHeight: 200 }),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Verify permission
      const hasPermission = await canManageService(
        req.user,
        service.teamId,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      // Delete old primary image if exists
      if (service.primaryImage?.key) {
        await storageService.deleteImage(service.primaryImage.key);
      }

      // Upload new banner
      const uploadResult = await storageService.uploadImage(req.file.buffer, {
        originalName: req.file.originalname,
        type: 'banner',
        serviceId: service._id,
      });

      // Update service
      service.primaryImage = {
        url: uploadResult.url,
        key: uploadResult.key,
        alt: req.body.alt || '',
      };
      service.updatedBy = req.user._id;
      await service.save();

      res.json({
        success: true,
        message: 'Primary image uploaded successfully',
        image: service.primaryImage,
      });
    } catch (error) {
      // Banner upload error occurred
      res.status(500).json({
        error: 'Failed to upload primary image',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
);

/**
 * PUT /services/:id/banner/media
 * Set service banner using existing media file
 */
router.put(
  '/:id/banner/media',
  authenticateToken,
  requireServicePermission('services.update'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Verify permission
      const hasPermission = await canManageService(
        req.user,
        service.teamId,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      const { mediaFileId, alt } = req.body;

      if (!mediaFileId) {
        return res.status(400).json({ error: 'Media file ID is required' });
      }

      // Get media file details
      const MediaFile = require('../models/MediaFile');
      const mediaFile = await MediaFile.findById(mediaFileId);

      if (!mediaFile) {
        return res.status(404).json({ error: 'Media file not found' });
      }

      // Delete old primary image if exists
      if (service.primaryImage?.key) {
        await storageService.deleteImage(service.primaryImage.key);
      }

      // Update service with media file
      service.primaryImage = {
        url: mediaFile.url,
        key: mediaFile.key,
        alt: alt || mediaFile.alt || '',
      };
      service.updatedBy = req.user._id;
      await service.save();

      res.json({
        success: true,
        message: 'Primary image updated successfully',
        image: service.primaryImage,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to update primary image with media file',
        details:
          process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
);

/**
 * POST /services/:id/gallery
 * Add images to service gallery
 */
router.post(
  '/:id/gallery',
  authenticateToken,
  requireServicePermission('services.update'),
  upload.gallery,
  requireFile('images'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Verify permission
      const hasPermission = await canManageService(
        req.user,
        service.teamId,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      // Check gallery limit
      const currentGallerySize = service.gallery?.length || 0;
      const newImagesCount = req.files.length;
      if (currentGallerySize + newImagesCount > 20) {
        return res.status(400).json({
          error: `Gallery limit exceeded. Maximum 20 images allowed. Current: ${currentGallerySize}`,
        });
      }

      // Upload all images
      const uploadPromises = req.files.map(async (file, index) => {
        const uploadResult = await storageService.uploadImage(file.buffer, {
          originalName: file.originalname,
          type: 'gallery',
          serviceId: service._id,
          generateThumbnail: true,
        });

        return {
          url: uploadResult.url,
          key: uploadResult.key,
          thumbnailUrl: uploadResult.thumbnail?.url,
          thumbnailKey: uploadResult.thumbnail?.key,
          alt: req.body[`alt_${index}`] || '',
          caption: req.body[`caption_${index}`] || '',
        };
      });

      const uploadedImages = await Promise.all(uploadPromises);

      // Add to gallery
      service.gallery.push(...uploadedImages);
      service.updatedBy = req.user._id;
      await service.save();

      res.json({
        success: true,
        message: `${uploadedImages.length} images added to gallery`,
        images: uploadedImages,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to upload gallery images' });
    }
  }
);

/**
 * DELETE /services/:id/gallery/:imageId
 * Remove an image from service gallery
 */
router.delete(
  '/:id/gallery/:imageId',
  authenticateToken,
  requireServicePermission('services.update'),
  async (req, res) => {
    try {
      const service = await Service.findById(req.params.id);

      if (!service) {
        return res.status(404).json({ error: 'Service not found' });
      }

      // Verify permission
      const hasPermission = await canManageService(
        req.user,
        service.teamId,
        'services.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this service' });
      }

      // Find image in gallery
      const imageIndex = service.gallery.findIndex(
        (img) => img._id.toString() === req.params.imageId
      );

      if (imageIndex === -1) {
        return res.status(404).json({ error: 'Image not found in gallery' });
      }

      // Delete from storage
      const image = service.gallery[imageIndex];
      if (image.key) {
        await storageService.deleteImage(image.key);
      }
      if (image.thumbnailKey) {
        await storageService.deleteImage(image.thumbnailKey);
      }

      // Remove from gallery
      service.gallery.splice(imageIndex, 1);
      service.updatedBy = req.user._id;
      await service.save();

      res.json({
        success: true,
        message: 'Image removed from gallery',
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete gallery image' });
    }
  }
);

/**
 * GET /services/:id/images
 * Get all service images
 */
router.get('/:id/images', async (req, res) => {
  try {
    const service = await Service.findById(req.params.id).select(
      'primaryImage gallery'
    );

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json({
      success: true,
      banner: service.primaryImage,
      gallery: service.gallery || [],
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch service images' });
  }
});

// Add error handling middleware at the end for upload errors
router.use(handleUploadError);

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
        service.teamId,
        'services.manage'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot manage this service' });
      }

      const eventData = {
        ...req.body,
        service: service._id,
        teamId: service.teamId,
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
      // Error creating event
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
        teamId: req.authorizedOrgId,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      };

      const story = new Story(storyData);
      await story.save();

      await story.populate('teamId', 'name category');
      if (story.service) {
        await story.populate('service', 'name type');
      }

      res.status(201).json({
        success: true,
        story,
      });
    } catch (error) {
      // Error creating story
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
        story.teamId,
        'stories.update'
      );
      if (!hasPermission) {
        return res.status(403).json({ error: 'Cannot update this story' });
      }

      // Prevent changing team
      delete req.body.teamId;
      delete req.body.createdBy;

      Object.assign(story, req.body);
      story.updatedBy = req.user._id;

      await story.save();
      await story.populate('teamId', 'name category');

      res.json({
        success: true,
        story,
      });
    } catch (error) {
      // Error updating story
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
        story.teamId,
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
      // Error publishing story
      res.status(500).json({ error: 'Failed to publish story' });
    }
  }
);

module.exports = router;
