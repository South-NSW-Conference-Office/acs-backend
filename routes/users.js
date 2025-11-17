const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Role = require('../models/Role');
const Organization = require('../models/Organization');
const {
  authenticateToken,
  authorize,
  rateLimit,
} = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/users - Get all users with pagination
router.get(
  '/',
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('skip')
      .optional()
      .isInt({ min: 0 })
      .withMessage('Skip must be a non-negative integer'),
    query('search').optional().isString().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const limit = parseInt(req.query.limit) || 50;
      const skip = parseInt(req.query.skip) || 0;
      const search = req.query.search;

      const query = { isActive: true };

      // Add search functionality
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
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
        success: true,
        message: 'Users retrieved successfully',
        users: users.map((user) => ({
          ...user.toJSON(),
          id: user._id,
        })),
        pagination: {
          total,
          limit,
          skip,
          hasMore: skip + limit < total,
        },
      });
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

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
        message: 'User not found',
      });
    }

    res.json(user.organizations);
  } catch (error) {
    console.error('Error fetching user roles:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message,
    });
  }
});

// POST /api/users/:userId/roles - Assign role to user
router.post(
  '/:userId/roles',
  [
    body('organizationId')
      .isMongoId()
      .withMessage('Valid organization ID is required'),
    body('roleName').isString().trim().withMessage('Role name is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { userId } = req.params;
      const { organizationId, roleName } = req.body;

      // Find user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Find organization
      const organization = await Organization.findById(organizationId);
      if (!organization) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found',
        });
      }

      // Find role
      const role = await Role.findOne({ name: roleName, isActive: true });
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Role not found',
        });
      }

      // Check if user already has a role in this organization
      const existingAssignment = user.organizations.find(
        (org) => org.organization.toString() === organizationId
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
          assignedBy: req.user._id,
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
        data: user.organizations,
      });
    } catch (error) {
      console.error('Error assigning role:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// DELETE /api/users/:userId/roles/:organizationId - Revoke user role
router.delete('/:userId/roles/:organizationId', async (req, res) => {
  try {
    const { userId, organizationId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Remove organization assignment
    user.organizations = user.organizations.filter(
      (org) => org.organization.toString() !== organizationId
    );

    // Clear primary organization if it was removed
    if (user.primaryOrganization?.toString() === organizationId) {
      user.primaryOrganization =
        user.organizations.length > 0
          ? user.organizations[0].organization
          : null;
    }

    await user.save();

    res.json({
      success: true,
      message: 'Role revoked successfully',
      data: user.organizations,
    });
  } catch (error) {
    console.error('Error revoking role:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message,
    });
  }
});

// POST /api/users - Create new user
router.post(
  '/',
  [
    body('name')
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .optional()
      .isString()
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('phone')
      .optional()
      .isString()
      .trim()
      .withMessage('Phone must be a string'),
    body('address')
      .optional()
      .isString()
      .trim()
      .withMessage('Address must be a string'),
    body('city')
      .optional()
      .isString()
      .trim()
      .withMessage('City must be a string'),
    body('state')
      .optional()
      .isString()
      .trim()
      .withMessage('State must be a string'),
    body('country')
      .optional()
      .isString()
      .trim()
      .withMessage('Country must be a string'),
    body('verified')
      .optional()
      .isBoolean()
      .withMessage('Verified must be boolean'),
    body('primaryOrganization')
      .optional()
      .isMongoId()
      .withMessage('Valid organization ID required'),
    body('organizations')
      .optional()
      .isArray()
      .withMessage('Organizations must be an array'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const {
        name,
        email,
        password,
        phone,
        address,
        city,
        state,
        country,
        verified,
        primaryOrganization,
        organizations,
      } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists',
        });
      }

      // Generate default password if not provided
      const userPassword =
        password || `temp${Math.random().toString(36).slice(2)}!`;

      // Create new user
      const userData = {
        name,
        email,
        password: userPassword,
        phone,
        address,
        city,
        state,
        country,
        verified: verified ?? false,
        primaryOrganization,
        organizations: organizations || [],
        createdBy: req.user._id,
      };

      // Remove undefined fields
      Object.keys(userData).forEach(
        (key) => userData[key] === undefined && delete userData[key]
      );

      const user = new User(userData);
      await user.save();

      // Populate and return user data
      await user.populate(
        'organizations.organization organizations.role primaryOrganization'
      );

      const userResponse = user.toJSON();
      delete userResponse.password;

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: {
          ...userResponse,
          id: user._id,
        },
      });
    } catch (error) {
      console.error('Error creating user:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// PUT /api/users/:userId - Update user
router.put(
  '/:userId',
  [
    body('name')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1 })
      .withMessage('Name must be valid'),
    body('email').optional().isEmail().withMessage('Valid email is required'),
    body('phone')
      .optional()
      .isString()
      .trim()
      .withMessage('Phone must be a string'),
    body('address')
      .optional()
      .isString()
      .trim()
      .withMessage('Address must be a string'),
    body('city')
      .optional()
      .isString()
      .trim()
      .withMessage('City must be a string'),
    body('state')
      .optional()
      .isString()
      .trim()
      .withMessage('State must be a string'),
    body('country')
      .optional()
      .isString()
      .trim()
      .withMessage('Country must be a string'),
    body('verified')
      .optional()
      .isBoolean()
      .withMessage('Verified must be boolean'),
    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive must be boolean'),
    body('primaryOrganization')
      .optional()
      .isMongoId()
      .withMessage('Valid organization ID required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { userId } = req.params;
      const updates = req.body;

      // If email is being updated, check if it's already taken
      if (updates.email) {
        const existingUser = await User.findOne({
          email: updates.email,
          _id: { $ne: userId },
        });
        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Email is already in use by another user',
          });
        }
      }

      // Remove fields that shouldn't be updated directly
      delete updates.password;
      delete updates.organizations;
      delete updates._id;
      delete updates.id;

      // Add update metadata
      updates.updatedAt = new Date();
      updates.updatedBy = req.user._id;

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true, runValidators: true }
      )
        .populate(
          'organizations.organization organizations.role primaryOrganization'
        )
        .select('-password');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.json({
        success: true,
        message: 'User updated successfully',
        data: {
          ...user.toJSON(),
          id: user._id,
        },
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// GET /api/users/:userId/permissions - Get user permissions for organization
router.get(
  '/:userId/permissions',
  [
    query('organizationId')
      .optional()
      .isMongoId()
      .withMessage('Valid organization ID required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { userId } = req.params;
      const organizationId =
        req.query.organizationId || req.headers['x-organization-id'];

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      const permissions =
        await user.getPermissionsForOrganization(organizationId);

      res.json(permissions);
    } catch (error) {
      console.error('Error fetching user permissions:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

module.exports = router;
