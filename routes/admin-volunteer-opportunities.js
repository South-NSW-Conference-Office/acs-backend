const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const VolunteerRole = require('../models/VolunteerRole');
const Service = require('../models/Service');
const { authenticateToken, authorize } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

// Validation middleware
const validateOpportunity = [
  body('title')
    .trim()
    .notEmpty()
    .withMessage('Title is required')
    .isLength({ max: 200 }),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ max: 2000 }),
  body('serviceId').isMongoId().withMessage('Valid service ID is required'),
  body('category').optional().isString().trim().isLength({ max: 100 }),
  body('numberOfPositions')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Number of positions must be at least 1'),
  body('requirements.minimumAge')
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage('Minimum age must be between 0 and 100'),
  body('timeCommitment.type')
    .optional()
    .isIn(['one_time', 'occasional', 'regular', 'flexible']),
  body('location.type').optional().isIn(['on_site', 'remote', 'hybrid']),
  body('status')
    .optional()
    .isIn(['draft', 'open', 'closed', 'filled', 'paused']),
  body('visibility').optional().isIn(['public', 'members_only', 'private']),
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

// GET /api/admin/volunteer-opportunities - List all volunteer opportunities with filtering
router.get(
  '/',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const { search, serviceId, status, category } = req.query;
    const user = req.user;

    // Build query
    const query = {};

    // Organization/Team filtering based on user permissions
    const isSuperAdmin = user.isSuperAdmin;

    if (!isSuperAdmin) {
      const userTeams = user.teamAssignments || [];
      if (userTeams.length > 0) {
        // Find all services belonging to user's teams
        const teamIds = userTeams.map((t) => t.teamId._id || t.teamId);
        const services = await Service.find({
          teamId: { $in: teamIds },
          status: { $ne: 'archived' }
        }).select('_id');

        const serviceIds = services.map(s => s._id);

        // If serviceId filter is provided, ensure it's in the allowed list
        if (serviceId) {
          if (!serviceIds.some(id => id.toString() === serviceId)) {
            return res.json([]);
          }
          query.service = serviceId;
        } else {
          query.service = { $in: serviceIds };
        }
      } else {
        // User has no teams, return empty result
        return res.json([]);
      }
    } else if (serviceId) {
      // Super admin filtering by serviceId
      query.service = serviceId;
    }

    // Status filtering
    if (status) {
      query.status = status;
    }

    // Category filtering
    if (category) {
      query.category = category;
    }

    // Search filtering
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'requirements.skills': { $regex: search, $options: 'i' } },
      ];
    }

    const opportunities = await VolunteerRole.find(query)
      .populate({
        path: 'service',
        select: 'name type teamId',
        populate: {
          path: 'teamId',
          select: 'name type',
        },
      })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 }) // Sort by newest first
      .limit(1000); // Reasonable limit

    res.json(opportunities);
  })
);

// GET /api/admin/volunteer-opportunities/services - Get services for dropdown
router.get(
  '/services',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const user = req.user;
    const isSuperAdmin = user.isSuperAdmin;
    const query = { status: 'active' };

    if (!isSuperAdmin) {
      const userTeams = user.teamAssignments || [];
      if (userTeams.length > 0) {
        // Extract team IDs from the user.teamAssignments array
        const teamIds = userTeams.map((t) => t.teamId._id || t.teamId);
        query.teamId = { $in: teamIds };
      } else {
        return res.json([]);
      }
    }

    const services = await Service.find(query)
      .select('name type teamId churchId')
      .populate('teamId', 'name type')
      .populate('churchId', 'name')
      .sort({ name: 1 });

    res.json(services);
  })
);

// GET /api/admin/volunteer-opportunities/:id - Get single volunteer opportunity
router.get(
  '/:id',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const opportunity = await VolunteerRole.findById(req.params.id)
      .populate({
        path: 'service',
        select: 'name type teamId',
        populate: {
          path: 'teamId',
          select: 'name type',
        },
      })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!opportunity) {
      return res.status(404).json({ error: 'Volunteer opportunity not found' });
    }

    res.json(opportunity);
  })
);

// POST /api/admin/volunteer-opportunities - Create new volunteer opportunity
router.post(
  '/',
  authenticateToken,
  authorize('services.manage'),
  validateOpportunity,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const opportunityData = req.body;
    const { serviceId } = req.body;

    // Verify service exists and user has access
    const service = await Service.findOne({ _id: serviceId, status: { $ne: 'archived' } });
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Check permissions
    const user = req.user;
    const isSuperAdmin = user.isSuperAdmin;

    if (!isSuperAdmin) {
      const userTeams = user.teamAssignments || [];
      const teamIds = userTeams.map((t) => (t.teamId._id || t.teamId).toString());

      if (!teamIds.includes(service.teamId.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this service' });
      }
    }

    // Create volunteer opportunity
    const opportunity = new VolunteerRole({
      ...opportunityData,
      service: service._id,
      createdBy: user._id,
      updatedBy: user._id,
    });

    await opportunity.save();

    // Populate the created opportunity for response
    await opportunity.populate({
      path: 'service',
      select: 'name type teamId',
      populate: {
        path: 'teamId',
        select: 'name type',
      },
    });
    await opportunity.populate('createdBy', 'name email');

    res.status(201).json(opportunity);
  })
);

// PUT /api/admin/volunteer-opportunities/:id - Update volunteer opportunity
router.put(
  '/:id',
  authenticateToken,
  authorize('services.manage'),
  validateOpportunity,
  handleValidationErrors,
  asyncHandler(async (req, res) => {
    const opportunityData = req.body;

    // Find existing opportunity
    const opportunity = await VolunteerRole.findById(req.params.id).populate(
      'service'
    );

    if (!opportunity) {
      return res.status(404).json({ error: 'Volunteer opportunity not found' });
    }

    // Check permissions
    const user = req.user;
    const isSuperAdmin = user.isSuperAdmin;

    if (!isSuperAdmin) {
      const userTeams = user.teamAssignments || [];
      const teamIds = userTeams.map((t) => (t.teamId._id || t.teamId).toString());

      if (!opportunity.service || !teamIds.includes(opportunity.service.teamId.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this opportunity' });
      }
    }

    // Update opportunity (service cannot be changed)
    Object.assign(opportunity, {
      title: opportunityData.title,
      description: opportunityData.description,
      category: opportunityData.category,
      requirements: opportunityData.requirements,
      training: opportunityData.training,
      timeCommitment: opportunityData.timeCommitment,
      location: opportunityData.location,
      benefits: opportunityData.benefits,
      numberOfPositions: opportunityData.numberOfPositions,
      status: opportunityData.status,
      visibility: opportunityData.visibility,
      applicationProcess: opportunityData.applicationProcess,
      startDate: opportunityData.startDate,
      endDate: opportunityData.endDate,
      tags: opportunityData.tags,
      updatedBy: user._id,
    });

    await opportunity.save();

    // Populate the updated opportunity for response
    await opportunity.populate({
      path: 'service',
      select: 'name type teamId',
      populate: {
        path: 'teamId',
        select: 'name type',
      },
    });
    await opportunity.populate('updatedBy', 'name email');

    res.json(opportunity);
  })
);

// DELETE /api/admin/volunteer-opportunities/:id - Delete volunteer opportunity (hard delete)
router.delete(
  '/:id',
  authenticateToken,
  authorize('services.manage'),
  asyncHandler(async (req, res) => {
    const opportunity = await VolunteerRole.findById(req.params.id).populate('service');

    if (!opportunity) {
      return res.status(404).json({ error: 'Volunteer opportunity not found' });
    }

    // Check permissions
    const user = req.user;
    const isSuperAdmin = user.isSuperAdmin;

    if (!isSuperAdmin) {
      const userTeams = user.teamAssignments || [];
      const teamIds = userTeams.map((t) => (t.teamId._id || t.teamId).toString());

      if (!opportunity.service || !teamIds.includes(opportunity.service.teamId.toString())) {
        return res
          .status(403)
          .json({ error: 'Insufficient permissions for this opportunity' });
      }
    }

    // Hard delete - permanently remove from database
    await VolunteerRole.findByIdAndDelete(req.params.id);

    res.json({ message: 'Volunteer opportunity deleted successfully' });
  })
);

module.exports = router;
