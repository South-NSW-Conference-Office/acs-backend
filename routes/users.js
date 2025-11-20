const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const Role = require('../models/Role');
const Organization = require('../models/Organization');
const UserService = require('../services/userService');
const {
  authenticateToken,
  authorize,
  validateOrganizationContext,
} = require('../middleware/auth');
const authorizationService = require('../services/authorizationService');
const secureQueryBuilder = require('../utils/secureQueryBuilder');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);
router.use(validateOrganizationContext);

// GET /api/users - Get all users with pagination
router.get(
  '/',
  authorize('users.read'),
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

      // Build base query with search
      const searchConditions = search
        ? secureQueryBuilder.buildSearchConditions(search, ['name', 'email'])
        : {};

      // Build secure query with organization filtering
      const query = await secureQueryBuilder.buildUserQuery(
        req.user,
        searchConditions,
        { includeOwnData: false } // Don't include own data in user list
      );

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
      // Error fetching users
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// GET /api/users/:userId/roles - Get user roles
router.get('/:userId/roles', authorize('users.read'), async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if requesting user can access this user's data
    const canAccess = await authorizationService.canAccessUser(
      req.user,
      userId
    );
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this user',
      });
    }

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
    // Error fetching user roles
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
  authorize('users.assign_role'),
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

      // Check if requesting user can manage this user
      const canAccess = await authorizationService.canAccessUser(
        req.user,
        userId
      );
      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to manage this user',
        });
      }

      // Check if requesting user can manage the target organization
      const canManageOrg =
        await authorizationService.validateOrganizationAccess(
          req.user,
          organizationId
        );
      if (!canManageOrg) {
        return res.status(403).json({
          success: false,
          message:
            'You do not have permission to assign roles in this organization',
        });
      }

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
      // Error assigning role
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// DELETE /api/users/:userId/roles/:organizationId - Revoke user role
router.delete(
  '/:userId/roles/:organizationId',
  authorize('users.assign_role'),
  async (req, res) => {
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
      // Error revoking role
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// POST /api/users - Create new user
router.post(
  '/',
  authorize('users.create'),
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
    body('requirePasswordSetup')
      .optional()
      .isBoolean()
      .withMessage('requirePasswordSetup must be boolean'),
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
    body('organizationId')
      .optional()
      .isMongoId()
      .withMessage('Valid organization ID required'),
    body('role')
      .optional()
      .isString()
      .trim()
      .withMessage('Role must be a string'),
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
        requirePasswordSetup,
        phone,
        address,
        city,
        state,
        country,
        verified,
        organizations,
        organizationId,
        role,
      } = req.body;

      // Prepare organizations array if role assignment is provided
      let organizationsArray = organizations || [];

      // If organizationId and role are provided, add to organizations array
      if (organizationId && role) {
        // Verify the role exists
        const roleDoc = await Role.findOne({ name: role });
        if (!roleDoc) {
          return res.status(400).json({
            success: false,
            message: 'Invalid role specified',
          });
        }

        // Add to organizations array
        organizationsArray = [
          {
            organizationId,
            roleName: role,
          },
        ];
      }

      // Create user data object
      const userData = {
        name,
        email,
        requirePasswordSetup,
        phone,
        address,
        city,
        state,
        country,
        verified: verified ?? false,
        organizations: organizationsArray,
      };

      // Only add password if explicitly provided
      // Users created without passwords will need to set them via email verification
      if (password) {
        userData.password = password;
      }

      // Use UserService to create user with proper validation and role assignment
      const user = await UserService.createUser(userData, req.user._id);

      res.status(201).json({
        success: true,
        message: 'User created successfully',
        data: user,
      });
    } catch (error) {
      // Error creating user
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
  authorize('users.update'),
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
      // Error updating user
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
  authorize('users.read'),
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

      // Only allow users to query their own permissions or if they have user.manage permission
      if (userId !== req.user._id.toString()) {
        const hasPermission =
          req.userPermissions?.permissions?.includes('users.manage') ||
          req.userPermissions?.permissions?.includes('users.*') ||
          req.userPermissions?.permissions?.includes('*');

        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            message: 'You can only view your own permissions',
          });
        }

        // Even with permission, verify they can access this user
        const canAccess = await authorizationService.canAccessUser(
          req.user,
          userId
        );
        if (!canAccess) {
          return res.status(403).json({
            success: false,
            message:
              "You do not have permission to view this user's permissions",
          });
        }
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
      // Error fetching user permissions
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// DELETE /api/users/:userId - Delete user (soft delete)
router.delete('/:userId', authorize('users.delete'), async (req, res) => {
  try {
    const { userId } = req.params;

    // Check if requesting user can delete this user
    const canAccess = await authorizationService.canAccessUser(
      req.user,
      userId
    );
    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this user',
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent self-deletion
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete your own account',
      });
    }

    // Prevent deletion of users with higher-level roles
    const userHasHigherRole = user.organizations.some((org) => {
      return (
        org.role?.name === 'super_admin' &&
        !req.user.organizations.some(
          (reqOrg) => reqOrg.role?.name === 'super_admin'
        )
      );
    });

    if (userHasHigherRole) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete users with higher-level roles',
      });
    }

    // Hard delete the user (permanent removal)
    await User.findByIdAndDelete(userId);

    res.json({
      success: true,
      message: 'User deleted successfully',
      data: {
        id: userId,
        name: user.name,
        email: user.email,
        deleted: true,
      },
    });
  } catch (error) {
    // Error deleting user
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message,
    });
  }
});

module.exports = router;
