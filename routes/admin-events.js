const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const ServiceEvent = require('../models/ServiceEvent');
const Service = require('../models/Service');
const { authenticateToken, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// Validation middleware
const validateEvent = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Event name is required')
    .isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  body('start').isISO8601().withMessage('Valid start date is required'),
  body('end').isISO8601().withMessage('Valid end date is required'),
  body('locationText').optional().trim().isLength({ max: 500 }),
  body('serviceId').isMongoId().withMessage('Valid service ID is required'),
  body('capacity.maximum')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Capacity must be a positive number'),
];

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  next();
};

// GET /api/admin/events - List all events with filtering
router.get(
  '/',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const { search, serviceId, dateFrom, dateTo, organizationId } = req.query;
    const user = req.user;

    // Build query
    const query = {};

    // Organization filtering based on user permissions
    // Check if user is super admin by looking at their role assignments
    const isSuperAdmin =
      user.organizations &&
      user.organizations.some(
        (org) =>
          org.role && (org.role.name === 'super_admin' || org.role.isSuperAdmin)
      );

    if (isSuperAdmin) {
      // Super admin can see all events
      if (organizationId) {
        query.organization = organizationId;
      }
    } else {
      // Other users can only see events from their organizations
      const userOrgs = user.organizations || [];

      if (userOrgs.length > 0) {
        // Extract organization IDs from the user.organizations array
        const orgIds = userOrgs.map((org) => org.organization._id);
        query.organization = { $in: orgIds };
      } else {
        // User has no organizations, return empty result
        return res.json([]);
      }
    }

    // Service filtering
    if (serviceId) {
      query.service = serviceId;
    }

    // Date filtering
    if (dateFrom || dateTo) {
      query.start = {};
      if (dateFrom) {
        query.start.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        query.start.$lte = new Date(dateTo);
      }
    }

    // Search filtering
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { locationText: { $regex: search, $options: 'i' } },
      ];
    }

    const events = await ServiceEvent.find(query)
      .populate({
        path: 'service',
        select: 'name type organization',
        populate: {
          path: 'organization',
          select: 'name type',
        },
      })
      .populate('organization', 'name type')
      .populate('createdBy', 'name email')
      .sort({ start: 1 }) // Sort by start date, upcoming first
      .limit(1000); // Reasonable limit

    res.json(events);
  })
);

// GET /api/admin/events/services - Get services for dropdown
router.get(
  '/services',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const user = req.user;
    const query = { deletedAt: null, status: 'active' };

    // Filter by user's organizations
    // Check if user is super admin by looking at their role assignments
    const isSuperAdmin =
      user.organizations &&
      user.organizations.some(
        (org) =>
          org.role && (org.role.name === 'super_admin' || org.role.isSuperAdmin)
      );

    if (!isSuperAdmin) {
      const userOrgs = user.organizations || [];
      if (userOrgs.length > 0) {
        // Extract organization IDs from the user.organizations array
        const orgIds = userOrgs.map((org) => org.organization._id);
        query.organization = { $in: orgIds };
      } else {
        return res.json([]);
      }
    }

    const services = await Service.find(query)
      .select('name type organization')
      .populate('organization', 'name type')
      .sort({ name: 1 });

    res.json(services);
  })
);

// GET /api/admin/events/:id - Get single event
router.get(
  '/:id',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const event = await ServiceEvent.findById(req.params.id)
      .populate({
        path: 'service',
        select: 'name type organization',
        populate: {
          path: 'organization',
          select: 'name type',
        },
      })
      .populate('organization', 'name type')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  })
);

// POST /api/admin/events - Create new event
router.post(
  '/',
  authenticateToken,
  authorize('services.manage'),
  validateEvent,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const eventData = req.body;
    const { serviceId } = req.body;

    // Verify service exists and user has access
    const service = await Service.findOne({ _id: serviceId, deletedAt: null });
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Check if user has permission to manage this service's organization
    const user = req.user;
    // Check if user is super admin by looking at their role assignments
    const isSuperAdmin =
      user.organizations &&
      user.organizations.some(
        (org) =>
          org.role && (org.role.name === 'super_admin' || org.role.isSuperAdmin)
      );

    if (!isSuperAdmin) {
      const userOrgs = user.organizations || [];
      const orgIds = userOrgs.map((org) => org.organization._id.toString());
      if (!orgIds.includes(service.organization.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this service' });
      }
    }

    // Validate dates
    const startDate = new Date(eventData.start);
    const endDate = new Date(eventData.end);

    if (endDate <= startDate) {
      return res
        .status(400)
        .json({ error: 'End date must be after start date' });
    }

    // Create event
    const event = new ServiceEvent({
      ...eventData,
      service: service._id,
      organization: service.organization,
      createdBy: user._id,
      updatedBy: user._id,
    });

    await event.save();

    // Populate the created event for response
    await event.populate({
      path: 'service',
      select: 'name type organization',
      populate: {
        path: 'organization',
        select: 'name type',
      },
    });
    await event.populate('organization', 'name type');
    await event.populate('createdBy', 'name email');

    res.status(201).json(event);
  })
);

// PUT /api/admin/events/:id - Update event
router.put(
  '/:id',
  authenticateToken,
  authorize('services.manage'),
  validateEvent,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const eventData = req.body;

    // Find existing event
    const event = await ServiceEvent.findById(req.params.id).populate(
      'service'
    );

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check permissions
    const user = req.user;
    // Check if user is super admin by looking at their role assignments
    const isSuperAdmin =
      user.organizations &&
      user.organizations.some(
        (org) =>
          org.role && (org.role.name === 'super_admin' || org.role.isSuperAdmin)
      );

    if (!isSuperAdmin) {
      const userOrgs = user.organizations || [];
      const orgIds = userOrgs.map((org) => org.organization._id.toString());
      if (!orgIds.includes(event.organization.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this event' });
      }
    }

    // Validate dates
    const startDate = new Date(eventData.start);
    const endDate = new Date(eventData.end);

    if (endDate <= startDate) {
      return res
        .status(400)
        .json({ error: 'End date must be after start date' });
    }

    // Update event (service cannot be changed)
    Object.assign(event, {
      name: eventData.name,
      description: eventData.description,
      start: eventData.start,
      end: eventData.end,
      locationText: eventData.locationText,
      capacity: eventData.capacity,
      updatedBy: user._id,
    });

    await event.save();

    // Populate the updated event for response
    await event.populate({
      path: 'service',
      select: 'name type organization',
      populate: {
        path: 'organization',
        select: 'name type',
      },
    });
    await event.populate('organization', 'name type');
    await event.populate('updatedBy', 'name email');

    res.json(event);
  })
);

// DELETE /api/admin/events/:id - Delete event (hard delete)
router.delete(
  '/:id',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const event = await ServiceEvent.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check permissions
    const user = req.user;
    // Check if user is super admin by looking at their role assignments
    const isSuperAdmin =
      user.organizations &&
      user.organizations.some(
        (org) =>
          org.role && (org.role.name === 'super_admin' || org.role.isSuperAdmin)
      );

    if (!isSuperAdmin) {
      const userOrgs = user.organizations || [];
      const orgIds = userOrgs.map((org) => org.organization._id.toString());
      if (!orgIds.includes(event.organization.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this event' });
      }
    }

    // Hard delete - permanently remove from database
    await ServiceEvent.findByIdAndDelete(req.params.id);

    res.json({ message: 'Event deleted successfully' });
  })
);

module.exports = router;
