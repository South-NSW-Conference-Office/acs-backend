const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Role = require('../models/Role');
const Organization = require('../models/Organization');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/users - Get all users with pagination
router.get('/', [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('skip').optional().isInt({ min: 0 }).withMessage('Skip must be a non-negative integer'),
  query('search').optional().isString().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    const search = req.query.search;

    let query = { isActive: true };
    
    // Add search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .populate('organizations.organization', 'name type')
      .populate('organizations.role', 'name displayName level')
      .populate('primaryOrganization', 'name type')
      .select('-password')
      .limit(limit)
      .skip(skip)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(query);

    res.json({
      users: users.map(user => ({
        ...user.toJSON(),
        id: user._id
      })),
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + limit < total
      }
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

// GET /api/users/:userId/roles - Get user roles
router.get('/:userId/roles', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .populate('organizations.organization')
      .populate('organizations.role')
      .select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json(user.organizations);

  } catch (error) {
    console.error('Error fetching user roles:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

// POST /api/users/:userId/roles - Assign role to user
router.post('/:userId/roles', [
  body('organizationId').isMongoId().withMessage('Valid organization ID is required'),
  body('roleName').isString().trim().withMessage('Role name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.params;
    const { organizationId, roleName } = req.body;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Find organization
    const organization = await Organization.findById(organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    // Find role
    const role = await Role.findOne({ name: roleName, isActive: true });
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    // Check if user already has a role in this organization
    const existingAssignment = user.organizations.find(
      org => org.organization.toString() === organizationId
    );

    if (existingAssignment) {
      // Update existing assignment
      existingAssignment.role = role._id;
      existingAssignment.assignedAt = new Date();
      existingAssignment.assignedBy = req.user._id;
    } else {
      // Add new assignment
      user.organizations.push({
        organization: organizationId,
        role: role._id,
        assignedAt: new Date(),
        assignedBy: req.user._id
      });
    }

    // Set as primary organization if user doesn't have one
    if (!user.primaryOrganization) {
      user.primaryOrganization = organizationId;
    }

    await user.save();

    // Populate and return updated user
    await user.populate('organizations.organization organizations.role');

    res.json({
      success: true,
      message: 'Role assigned successfully',
      data: user.organizations
    });

  } catch (error) {
    console.error('Error assigning role:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

// DELETE /api/users/:userId/roles/:organizationId - Revoke user role
router.delete('/:userId/roles/:organizationId', async (req, res) => {
  try {
    const { userId, organizationId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove organization assignment
    user.organizations = user.organizations.filter(
      org => org.organization.toString() !== organizationId
    );

    // Clear primary organization if it was removed
    if (user.primaryOrganization?.toString() === organizationId) {
      user.primaryOrganization = user.organizations.length > 0 ? user.organizations[0].organization : null;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Role revoked successfully',
      data: user.organizations
    });

  } catch (error) {
    console.error('Error revoking role:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

// GET /api/users/:userId/permissions - Get user permissions for organization
router.get('/:userId/permissions', [
  query('organizationId').optional().isMongoId().withMessage('Valid organization ID required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.params;
    const organizationId = req.query.organizationId || req.headers['x-organization-id'];

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'Organization context required'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const permissions = await user.getPermissionsForOrganization(organizationId);

    res.json(permissions);

  } catch (error) {
    console.error('Error fetching user permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message
    });
  }
});

module.exports = router;