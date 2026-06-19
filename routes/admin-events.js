const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const ServiceEvent = require('../models/ServiceEvent');
const Service = require('../models/Service');
const { authenticateToken, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

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

    const isSuperAdmin = user.isSuperAdmin === true;

    if (!isSuperAdmin) {
      const churchIds = (user.teamAssignments || [])
        .filter((a) => a.teamId && a.teamId.churchId)
        .map((a) => a.teamId.churchId._id);

      if (churchIds.length === 0) return res.json([]);

      const serviceFilter = { churchId: { $in: churchIds }, status: 'active' };
      if (organizationId) serviceFilter.churchId = organizationId;
      const serviceIds = await Service.find(serviceFilter).select('_id');
      query.service = { $in: serviceIds.map((s) => s._id) };
    } else if (organizationId) {
      const serviceIds = await Service.find({ churchId: organizationId }).select('_id');
      query.service = { $in: serviceIds.map((s) => s._id) };
    }

    if (serviceId) {
      query.service = serviceId;
    }

    if (dateFrom || dateTo) {
      query.start = {};
      if (dateFrom) query.start.$gte = new Date(dateFrom);
      if (dateTo) query.start.$lte = new Date(dateTo);
    }

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
        select: 'name type churchId',
        populate: { path: 'churchId', select: 'name' },
      })
      .populate('createdBy', 'name email')
      .sort({ start: 1 })
      .limit(1000);

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
    const query = { status: 'active' };
    const isSuperAdmin = user.isSuperAdmin === true;

    if (!isSuperAdmin) {
      const churchIds = (user.teamAssignments || [])
        .filter((a) => a.teamId && a.teamId.churchId)
        .map((a) => a.teamId.churchId._id);

      if (churchIds.length > 0) {
        query.churchId = { $in: churchIds };
      } else {
        return res.json([]);
      }
    }

    const services = await Service.find(query)
      .select('name type churchId')
      .populate('churchId', 'name')
      .sort({ name: 1 });

    res.json(services);
  })
);

// GET /api/admin/events/:id - Get single event
router.get(
  '/:id',
  validateObjectId('id'),
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const event = await ServiceEvent.findById(req.params.id)
      .populate({
        path: 'service',
        select: 'name type churchId',
        populate: { path: 'churchId', select: 'name' },
      })
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
    const service = await Service.findOne({ _id: serviceId, status: 'active' });
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const user = req.user;
    const isSuperAdmin = user.isSuperAdmin === true;

    if (!isSuperAdmin) {
      const churchIds = (user.teamAssignments || [])
        .filter((a) => a.teamId && a.teamId.churchId)
        .map((a) => a.teamId.churchId._id.toString());
      if (!churchIds.includes(service.churchId.toString())) {
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

    const event = new ServiceEvent({
      name: eventData.name,
      description: eventData.description,
      start: eventData.start,
      end: eventData.end,
      locationText: eventData.locationText,
      capacity: eventData.capacity,
      service: service._id,
      createdBy: user._id,
      updatedBy: user._id,
    });

    await event.save();

    await event.populate({
      path: 'service',
      select: 'name type churchId',
      populate: { path: 'churchId', select: 'name' },
    });
    await event.populate('createdBy', 'name email');

    res.status(201).json(event);
  })
);

// PUT /api/admin/events/:id - Update event
router.put(
  '/:id',
  validateObjectId('id'),
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

    const user = req.user;
    const isSuperAdmin = user.isSuperAdmin === true;

    if (!isSuperAdmin) {
      const churchIds = (user.teamAssignments || [])
        .filter((a) => a.teamId && a.teamId.churchId)
        .map((a) => a.teamId.churchId._id.toString());
      if (!churchIds.includes(event.service.churchId.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this event' });
      }
    }

    const startDate = new Date(eventData.start);
    const endDate = new Date(eventData.end);

    if (endDate <= startDate) {
      return res
        .status(400)
        .json({ error: 'End date must be after start date' });
    }

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

    await event.populate({
      path: 'service',
      select: 'name type churchId',
      populate: { path: 'churchId', select: 'name' },
    });
    await event.populate('updatedBy', 'name email');

    res.json(event);
  })
);

// DELETE /api/admin/events/:id - Delete event (hard delete)
router.delete(
  '/:id',
  validateObjectId('id'),
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const event = await ServiceEvent.findById(req.params.id)
      .populate({ path: 'service', select: 'churchId' });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const user = req.user;
    const isSuperAdmin = user.isSuperAdmin === true;

    if (!isSuperAdmin) {
      const churchIds = (user.teamAssignments || [])
        .filter((a) => a.teamId && a.teamId.churchId)
        .map((a) => a.teamId.churchId._id.toString());
      if (!churchIds.includes(event.service.churchId.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this event' });
      }
    }

    await ServiceEvent.findByIdAndDelete(req.params.id);

    res.json({ message: 'Event deleted successfully' });
  })
);

module.exports = router;
