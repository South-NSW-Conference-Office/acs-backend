const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Role = require('../models/Role');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// POST /api/roles/:id/reset - Reset system role to defaults
router.post('/:id/reset', authorize('*'), async (req, res) => {
  try {
    const { id } = req.params;

    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Only allow resetting system roles
    if (!role.isSystem) {
      return res.status(400).json({
        success: false,
        message: 'Cannot reset non-system roles',
        error: 'Only system roles can be reset to defaults',
      });
    }

    // Find the original role definition by name
    const originalRoleDefinition = Role.defaultRoles.find(def => def.name === role.name);
    if (!originalRoleDefinition) {
      return res.status(404).json({
        success: false,
        message: 'Original role definition not found',
        error: 'Cannot find default definition for this system role',
      });
    }

    // Reset role to original definition (excluding _id, createdAt, updatedAt)
    const resetData = {
      name: originalRoleDefinition.name,
      displayName: originalRoleDefinition.displayName,
      level: originalRoleDefinition.level,
      hierarchyLevel: originalRoleDefinition.hierarchyLevel,
      canManage: originalRoleDefinition.canManage,
      permissions: originalRoleDefinition.permissions,
      description: originalRoleDefinition.description,
      roleCategory: originalRoleDefinition.roleCategory,
      quotaLimits: originalRoleDefinition.quotaLimits,
      isSystem: originalRoleDefinition.isSystem,
      isActive: true, // Ensure role is active after reset
    };

    Object.assign(role, resetData);
    await role.save();

    // Log system role reset
    console.log(`[AUDIT] System role reset to defaults by super admin: ${req.user.email}`, {
      roleId: id,
      roleName: role.name,
      timestamp: new Date().toISOString(),
      userEmail: req.user.email,
      userId: req.user._id
    });

    // Add warning header
    res.set('X-System-Role-Reset', 'true');

    res.json({
      success: true,
      message: 'System role reset to default configuration',
      data: role,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// GET /api/roles - Get all roles
router.get(
  '/',
  authorize('roles.read'),
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
      // Error fetching roles
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// GET /api/roles/:id - Get specific role
router.get('/:id', authorize('roles.read'), async (req, res) => {
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
    // Error fetching role
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
  authorize('roles.create'),
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
      // Error creating role
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
  authorize('roles.update'),
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

      // Allow super admins to modify system roles with restrictions
      if (role.isSystem) {
        const { user } = req;
        const isSuperAdmin = user.permissions?.includes('*') || user.permissions?.includes('all');
        
        if (!isSuperAdmin) {
          // Non-super admins can only modify isActive
          if (Object.keys(updates).some((key) => key !== 'isActive')) {
            return res.status(403).json({
              success: false,
              message: 'System roles cannot be modified by non-super admins',
              error: 'Insufficient privileges to modify system role',
            });
          }
        } else {
          // Super admins can modify system roles, but prevent certain critical changes
          const restrictedFields = ['isSystem']; // Prevent toggling system status
          if (Object.keys(updates).some((key) => restrictedFields.includes(key))) {
            return res.status(403).json({
              success: false,
              message: 'Cannot modify system role status',
              error: 'The isSystem property cannot be changed',
            });
          }
          
          // Log system role modification
          console.log(`[AUDIT] System role modified by super admin: ${user.email}`, {
            roleId: id,
            roleName: role.name,
            changes: updates,
            timestamp: new Date().toISOString(),
            userEmail: user.email,
            userId: user._id
          });
          
          // Add warning header for system role modifications
          res.set('X-System-Role-Warning', 'true');
        }
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
      // Error updating role
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// DELETE /api/roles/:id - Delete role
router.delete('/:id', authorize('roles.delete'), async (req, res) => {
  try {
    const { id } = req.params;

    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found',
      });
    }

    // Allow only super admins to delete system roles
    if (role.isSystem) {
      const { user } = req;
      const isSuperAdmin = user.permissions?.includes('*') || user.permissions?.includes('all');
      
      if (!isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'System roles cannot be deleted by non-super admins',
          error: 'Insufficient privileges to delete system role',
        });
      }
      
      // Log system role deletion
      console.log(`[AUDIT] System role deleted by super admin: ${user.email}`, {
        roleId: id,
        roleName: role.name,
        timestamp: new Date().toISOString(),
        userEmail: user.email,
        userId: user._id
      });
      
      // Add warning header for system role deletion
      res.set('X-System-Role-Warning', 'true');
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
    // Error deleting role
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

module.exports = router;
