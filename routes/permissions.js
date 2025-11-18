const express = require('express');
const router = express.Router();
const Permission = require('../models/Permission');
const PermissionCategory = require('../models/PermissionCategory');
const { authenticateToken, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/permissions
 * Get all available permissions grouped by category
 */
router.get('/', authorize('roles.read'), async (req, res) => {
  try {
    // Get grouped permissions
    const groupedPermissions = await Permission.getGroupedPermissions();

    // Convert to the format expected by frontend
    const formattedPermissions = {};

    for (const [categoryName, data] of Object.entries(groupedPermissions)) {
      formattedPermissions[categoryName] = data.permissions.map((perm) => ({
        key: perm.key,
        label: perm.label,
        description: perm.description,
        allowedScopes: perm.allowedScopes,
        isSystem: perm.isSystem,
      }));
    }

    res.json({
      success: true,
      permissions: formattedPermissions,
    });
  } catch (error) {
    // Error fetching permissions
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions',
      error: error.message,
    });
  }
});

/**
 * GET /api/permissions/categories
 * Get all permission categories
 */
router.get('/categories', authorize('roles.read'), async (req, res) => {
  try {
    const categories = await PermissionCategory.getActiveCategories();

    res.json({
      success: true,
      categories,
    });
  } catch (error) {
    // Error fetching permission categories
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permission categories',
      error: error.message,
    });
  }
});

/**
 * POST /api/permissions
 * Create a new custom permission
 */
router.post('/', authorize('system.configure'), async (req, res) => {
  try {
    const { key, label, description, category, allowedScopes } = req.body;

    // Validate inputs
    if (!key || !label || !description || !category) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // Find category
    const categoryDoc = await PermissionCategory.findById(category);
    if (!categoryDoc) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category',
      });
    }

    // Create permission
    const permission = new Permission({
      key,
      label,
      description,
      category: categoryDoc._id,
      allowedScopes: allowedScopes || [],
      isSystem: false,
      createdBy: req.user._id,
    });

    await permission.save();
    await permission.populate('category');

    res.status(201).json({
      success: true,
      permission,
    });
  } catch (error) {
    // Error creating permission

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Permission key already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create permission',
      error: error.message,
    });
  }
});

/**
 * PUT /api/permissions/:id
 * Update a permission (only non-system permissions)
 */
router.put('/:id', authorize('system.configure'), async (req, res) => {
  try {
    const { label, description, allowedScopes } = req.body;

    const permission = await Permission.findById(req.params.id);
    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'Permission not found',
      });
    }

    if (permission.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'System permissions cannot be modified',
      });
    }

    // Update allowed fields
    if (label !== undefined) permission.label = label;
    if (description !== undefined) permission.description = description;
    if (allowedScopes !== undefined) permission.allowedScopes = allowedScopes;

    await permission.save();
    await permission.populate('category');

    res.json({
      success: true,
      permission,
    });
  } catch (error) {
    // Error updating permission
    res.status(500).json({
      success: false,
      message: 'Failed to update permission',
      error: error.message,
    });
  }
});

/**
 * DELETE /api/permissions/:id
 * Delete a permission (only non-system permissions)
 */
router.delete('/:id', authorize('system.configure'), async (req, res) => {
  try {
    const permission = await Permission.findById(req.params.id);
    if (!permission) {
      return res.status(404).json({
        success: false,
        message: 'Permission not found',
      });
    }

    if (permission.isSystem) {
      return res.status(403).json({
        success: false,
        message: 'System permissions cannot be deleted',
      });
    }

    await permission.deleteOne();

    res.json({
      success: true,
      message: 'Permission deleted successfully',
    });
  } catch (error) {
    // Error deleting permission
    res.status(500).json({
      success: false,
      message: 'Failed to delete permission',
      error: error.message,
    });
  }
});

/**
 * GET /api/permissions/available-for-role
 * Get permissions available for a role based on its level
 */
router.get('/available-for-role', authorize('roles.read'), async (req, res) => {
  try {
    const { roleLevel } = req.query;

    // Get all permissions grouped
    const groupedPermissions = await Permission.getGroupedPermissions();

    // Filter system permissions based on role level
    const filteredPermissions = {};

    for (const [categoryName, data] of Object.entries(groupedPermissions)) {
      // Skip system category for non-super-admin roles
      if (categoryName === 'system' && roleLevel !== 'union') {
        continue;
      }

      filteredPermissions[categoryName] = data.permissions.map((perm) => ({
        key: perm.key,
        label: perm.label,
        description: perm.description,
        allowedScopes: perm.allowedScopes,
        isSystem: perm.isSystem,
      }));
    }

    res.json({
      success: true,
      permissions: filteredPermissions,
    });
  } catch (error) {
    // Error fetching available permissions
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available permissions',
      error: error.message,
    });
  }
});

module.exports = router;
