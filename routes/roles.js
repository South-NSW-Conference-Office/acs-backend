const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Role = require('../models/Role');
const {
  authenticateToken,
  authorize,
  rateLimit,
} = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/roles - Get all roles
router.get(
  '/',
  [
    query('includeSystem')
      .optional()
      .isBoolean()
      .withMessage('includeSystem must be a boolean'),
    query('isSystemRole')
      .optional()
      .isBoolean()
      .withMessage('isSystemRole must be a boolean'),
    query('level')
      .optional()
      .isIn(['union', 'conference', 'church'])
      .withMessage('level must be union, conference, or church'),
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

      const query = { isActive: true };

      // Handle legacy parameter name
      const includeSystem =
        req.query.includeSystem === 'true' || req.query.isSystemRole === 'true';
      const level = req.query.level;

      // Filter by system roles if specified
      if (req.query.isSystemRole !== undefined) {
        query.isSystem = req.query.isSystemRole === 'true';
      } else if (!includeSystem) {
        query.isSystem = false;
      }

      // Filter by level if specified
      if (level) {
        query.level = level;
      }

      const roles = await Role.find(query).sort({
        isSystem: -1,
        level: 1,
        displayName: 1,
      });

      // Return roles in the format expected by frontend
      const responseData = roles.length > 0 ? roles : [];

      res.json({
        data: responseData,
        success: true,
      });
    } catch (error) {
      console.error('Error fetching roles:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// GET /api/roles/:id - Get specific role
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const role = await Role.findById(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    res.json(role);
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// POST /api/roles - Create new role
router.post(
  '/',
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Role name must be at least 2 characters'),
    body('displayName')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Display name must be at least 2 characters'),
    body('level')
      .isIn(['union', 'conference', 'church'])
      .withMessage('Level must be union, conference, or church'),
    body('permissions')
      .optional()
      .isArray()
      .withMessage('Permissions must be an array'),
    body('description').optional().isString().trim(),
    body('isSystem')
      .optional()
      .isBoolean()
      .withMessage('isSystem must be a boolean'),
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

      const { name, displayName, level, permissions, description, isSystem } =
        req.body;

      // Check for duplicate role name
      const existingRole = await Role.findOne({ name: name.toLowerCase() });
      if (existingRole) {
        return res.status(400).json({
          success: false,
          message: 'Role with this name already exists',
          error: 'Duplicate role name',
        });
      }

      const role = new Role({
        name: name.toLowerCase(),
        displayName,
        level,
        permissions: permissions || [],
        description: description || '',
        isSystem: isSystem || false,
      });

      await role.save();

      res.status(201).json(role);
    } catch (error) {
      console.error('Error creating role:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// PUT /api/roles/:id - Update role
router.put(
  '/:id',
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Role name must be at least 2 characters'),
    body('displayName')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Display name must be at least 2 characters'),
    body('level')
      .optional()
      .isIn(['union', 'conference', 'church'])
      .withMessage('Level must be union, conference, or church'),
    body('permissions')
      .optional()
      .isArray()
      .withMessage('Permissions must be an array'),
    body('description').optional().isString().trim(),
    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive must be a boolean'),
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

      const { id } = req.params;
      const updates = req.body;

      const role = await Role.findById(id);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: 'Role not found',
        });
      }

      // Prevent modification of system roles
      if (
        role.isSystem &&
        Object.keys(updates).some((key) => key !== 'isActive')
      ) {
        return res.status(403).json({
          success: false,
          message: 'System roles cannot be modified',
          error: 'Cannot modify system role',
        });
      }

      // Check for duplicate role name if name is being updated
      if (updates.name && updates.name.toLowerCase() !== role.name) {
        const existingRole = await Role.findOne({
          name: updates.name.toLowerCase(),
        });
        if (existingRole) {
          return res.status(400).json({
            success: false,
            message: 'Role with this name already exists',
            error: 'Duplicate role name',
          });
        }
        updates.name = updates.name.toLowerCase();
      }

      // Update role
      Object.assign(role, updates);
      await role.save();

      res.json(role);
    } catch (error) {
      console.error('Error updating role:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// DELETE /api/roles/:id - Delete role
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Prevent deletion of system roles
    if (role.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'System roles cannot be deleted',
        error: 'Cannot delete system role',
      });
    }

    // Check if role is assigned to any users
    const User = require('../models/User');
    const usersWithRole = await User.find({ 'organizations.role': id });

    if (usersWithRole.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete role that is assigned to users',
        error: 'Role is currently in use',
      });
    }

    // Soft delete by marking as inactive
    role.isActive = false;
    await role.save();

    res.json({
      success: true,
      message: 'Role deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// GET /api/roles/permissions/available - Get available permissions
router.get('/permissions/available', async (req, res) => {
  try {
    const permissions = {
      resources: [
        'organizations',
        'users',
        'roles',
        'reports',
        'services',
        'settings',
        'audit',
        'notifications',
      ],
      actions: [
        'create',
        'read',
        'update',
        'delete',
        'assign_role',
        'revoke_role',
        'export',
        'manage',
      ],
      scopes: [
        'self',
        'own',
        'subordinate',
        'all',
        'assigned',
        'acs_team',
        'acs',
        'public',
      ],
    };

    res.json(permissions);
  } catch (error) {
    console.error('Error fetching available permissions:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;
