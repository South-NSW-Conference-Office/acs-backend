const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Organization = require('../models/Organization');
const OrganizationService = require('../services/organizationService');
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

// POST /api/organizations/quick-setup - Create organization with admin user
router.post(
  '/quick-setup',
  authorize('organizations.create'),
  [
    // Organization validation
    body('organization.name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Organization name must be at least 2 characters'),
    body('organization.type')
      .isIn(['union', 'conference', 'church'])
      .withMessage('Type must be union, conference, or church'),
    body('organization.parentId')
      .optional()
      .isMongoId()
      .withMessage('Valid parent organization ID required'),
    body('organization.metadata.email')
      .optional()
      .isEmail()
      .withMessage('Valid organization email required'),
    body('organization.metadata.phone').optional().isString().trim(),
    body('organization.metadata.address').optional().isString().trim(),

    // Admin user validation
    body('adminUser.firstName')
      .trim()
      .isLength({ min: 2 })
      .withMessage('First name must be at least 2 characters'),
    body('adminUser.lastName')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Last name must be at least 2 characters'),
    body('adminUser.email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email address required'),
    body('adminUser.role')
      .optional()
      .isString()
      .withMessage('Role must be a string'),

    // Options
    body('sendInvitation')
      .optional()
      .isBoolean()
      .withMessage('sendInvitation must be a boolean'),
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

      // Map parentId to parentOrganization for consistency
      const setupData = {
        ...req.body,
        organization: {
          ...req.body.organization,
          parentOrganization: req.body.organization.parentId,
        },
      };
      delete setupData.organization.parentId;

      const result = await OrganizationService.quickSetup(
        setupData,
        req.user,
        req.userPermissions
      );

      res.status(201).json({
        success: true,
        message: 'Organization and admin user created successfully',
        data: result,
      });
    } catch (error) {
      // Error in quick setup
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Failed to create organization and user';

      res.status(statusCode).json({
        success: false,
        message: message,
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  }
);

// GET /api/organizations/suggested-parents - Get suggested parent organizations
router.get(
  '/suggested-parents',
  authorize('organizations.create'),
  [
    query('type')
      .isIn(['union', 'conference', 'church'])
      .withMessage('Invalid organization type'),
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

      const { type } = req.query;
      const suggestions = await OrganizationService.getSuggestedParents(
        req.user.id,
        type
      );

      res.json({
        success: true,
        message: 'Suggested parent organizations retrieved successfully',
        data: suggestions,
      });
    } catch (error) {
      // Error getting suggested parents
      res.status(500).json({
        success: false,
        message: 'Failed to get suggested parent organizations',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// POST /api/organizations/bulk-create - Bulk create organizations
router.post(
  '/bulk-create',
  authorize('organizations.create'),
  [
    body('organizations')
      .isArray({ min: 1 })
      .withMessage('Organizations array required'),
    body('organizations.*.organization.name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Organization name must be at least 2 characters'),
    body('organizations.*.organization.type')
      .isIn(['union', 'conference', 'church'])
      .withMessage('Type must be union, conference, or church'),
    body('organizations.*.includeAdminUser')
      .optional()
      .isBoolean()
      .withMessage('includeAdminUser must be a boolean'),
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

      const results = await OrganizationService.bulkCreate(
        req.body.organizations,
        req.user,
        req.userPermissions
      );

      const statusCode = results.failed.length > 0 ? 207 : 201; // Multi-status if partial success

      res.status(statusCode).json({
        success: results.failed.length === 0,
        message: `${results.successful.length} organizations created successfully, ${results.failed.length} failed`,
        data: results,
      });
    } catch (error) {
      // Error in bulk create
      res.status(500).json({
        success: false,
        message: 'Failed to bulk create organizations',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/organizations - Get all organizations (authenticated users only)
router.get(
  '/',
  authorize('organizations.read'),
  [
    query('type')
      .optional()
      .isIn(['union', 'conference', 'church'])
      .withMessage('Invalid organization type'),
    query('parentOrganization')
      .optional()
      .isMongoId()
      .withMessage('Invalid parent organization ID'),
    query('isActive')
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

      // Build base query with filters
      const baseQuery = { isActive: true };
      const { type, parentOrganization, isActive } = req.query;

      if (type) baseQuery.type = type;
      if (parentOrganization) baseQuery.parentOrganization = parentOrganization;
      if (isActive !== undefined) baseQuery.isActive = isActive === 'true';

      // Apply organization access filtering
      const query = await secureQueryBuilder.buildOrganizationQuery(
        req.user,
        baseQuery
      );

      const organizations = await Organization.aggregate([
        { $match: query },
        {
          $lookup: {
            from: 'organizations',
            localField: '_id',
            foreignField: 'parentOrganization',
            as: 'children',
            pipeline: [{ $match: { isActive: true } }],
          },
        },
        {
          $addFields: {
            childCount: { $size: '$children' },
          },
        },
        {
          $lookup: {
            from: 'organizations',
            localField: 'parentOrganization',
            foreignField: '_id',
            as: 'parentOrganization',
          },
        },
        {
          $unwind: {
            path: '$parentOrganization',
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $project: {
            children: 0,
            'parentOrganization.metadata': 0,
            'parentOrganization.isActive': 0,
            'parentOrganization.createdAt': 0,
            'parentOrganization.updatedAt': 0,
          },
        },
        { $sort: { type: 1, name: 1 } },
      ]);

      // Return data in format expected by frontend
      res.json({
        success: true,
        message: 'Organizations retrieved successfully',
        data: organizations,
      });
    } catch (error) {
      // Error fetching organizations
      res.status(500).json({
        success: false,
        message: 'Failed to fetch organizations',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/organizations/:id - Get specific organization
router.get('/:id', authorize('organizations.read'), async (req, res) => {
  try {
    const { id } = req.params;

    // Verify user has access to this organization
    const hasAccess = await authorizationService.validateOrganizationAccess(
      req.user,
      id
    );

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this organization',
      });
    }

    const organization = await Organization.findById(id)
      .populate('parentOrganization', 'name type')
      .populate('children');

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    res.json({
      success: true,
      message: 'Organization retrieved successfully',
      data: organization,
    });
  } catch (error) {
    // Error fetching organization
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organization',
      error:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
    });
  }
});

// POST /api/organizations - Create new organization
router.post(
  '/',
  authorize('organizations.create'),
  [
    body('name')
      .trim()
      .isLength({ min: 2 })
      .withMessage('Organization name must be at least 2 characters'),
    body('type')
      .isIn(['union', 'conference', 'church'])
      .withMessage('Type must be union, conference, or church'),
    body('parentOrganization')
      .optional()
      .isMongoId()
      .withMessage('Valid parent organization ID required'),
    body('metadata.email')
      .optional()
      .isEmail()
      .withMessage('Valid email required'),
    body('metadata.phone').optional().isString().trim(),
    body('metadata.address').optional().isString().trim(),
    body('metadata.territory').optional().isArray(),
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

      const { name, type, parentOrganization, metadata } = req.body;

      // Validate parent organization if provided
      if (parentOrganization) {
        const parent = await Organization.findById(parentOrganization);
        if (!parent) {
          return res.status(400).json({
            success: false,
            message: 'Parent organization not found',
          });
        }

        // Validate hierarchy rules
        if (type === 'union' && parentOrganization) {
          return res.status(400).json({
            success: false,
            message: 'Union organizations cannot have a parent',
          });
        }

        if (type === 'conference' && parent.type !== 'union') {
          return res.status(400).json({
            success: false,
            message: 'Conference organizations must have a union parent',
          });
        }

        if (type === 'church' && parent.type !== 'conference') {
          return res.status(400).json({
            success: false,
            message: 'Church organizations must have a conference parent',
          });
        }
      }

      // Check for duplicate names within the same parent
      const duplicateQuery = { name, type };
      if (parentOrganization) {
        duplicateQuery.parentOrganization = parentOrganization;
      } else {
        duplicateQuery.parentOrganization = null;
      }

      const existingOrg = await Organization.findOne(duplicateQuery);
      if (existingOrg) {
        return res.status(400).json({
          success: false,
          message:
            'Organization with this name already exists in the same parent',
        });
      }

      const organization = new Organization({
        name,
        type,
        parentOrganization: parentOrganization || null,
        metadata: metadata || {},
      });

      await organization.save();
      await organization.populate('parentOrganization', 'name type');

      res.status(201).json({
        success: true,
        message: 'Organization created successfully',
        data: organization,
      });
    } catch (error) {
      // Error creating organization
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// PUT /api/organizations/:id - Update organization
router.put(
  '/:id',
  authorize('organizations.update'),
  [
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2 })
      .withMessage('Organization name must be at least 2 characters'),
    body('type')
      .optional()
      .isIn(['union', 'conference', 'church'])
      .withMessage('Type must be union, conference, or church'),
    body('parentOrganization')
      .optional()
      .isMongoId()
      .withMessage('Valid parent organization ID required'),
    body('metadata.email')
      .optional()
      .isEmail()
      .withMessage('Valid email required'),
    body('metadata.phone').optional().isString().trim(),
    body('metadata.address').optional().isString().trim(),
    body('metadata.territory').optional().isArray(),
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

      const organization = await Organization.findById(id);
      if (!organization) {
        return res.status(404).json({
          success: false,
          message: 'Organization not found',
        });
      }

      // Validate parent organization change
      if (
        updates.parentOrganization &&
        updates.parentOrganization !==
          organization.parentOrganization?.toString()
      ) {
        const parent = await Organization.findById(updates.parentOrganization);
        if (!parent) {
          return res.status(400).json({
            success: false,
            message: 'Parent organization not found',
          });
        }

        // Validate hierarchy rules
        const orgType = updates.type || organization.type;
        if (orgType === 'union' && updates.parentOrganization) {
          return res.status(400).json({
            success: false,
            message: 'Union organizations cannot have a parent',
          });
        }

        if (orgType === 'conference' && parent.type !== 'union') {
          return res.status(400).json({
            success: false,
            message: 'Conference organizations must have a union parent',
          });
        }

        if (orgType === 'church' && parent.type !== 'conference') {
          return res.status(400).json({
            success: false,
            message: 'Church organizations must have a conference parent',
          });
        }
      }

      // Update organization
      Object.assign(organization, updates);
      await organization.save();
      await organization.populate('parentOrganization', 'name type');

      res.json({
        success: true,
        message: 'Organization updated successfully',
        data: organization,
      });
    } catch (error) {
      // Error updating organization
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
);

// DELETE /api/organizations/:id - Delete organization
router.delete('/:id', authorize('organizations.delete'), async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findById(id);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    // Check if organization has children
    const children = await Organization.find({
      parentOrganization: id,
      isActive: true,
    });
    if (children.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete organization with active child organizations',
        error: 'Organization has dependent children',
      });
    }

    // Soft delete by marking as inactive
    organization.isActive = false;
    await organization.save();

    res.json({
      success: true,
      message: 'Organization deleted successfully',
    });
  } catch (error) {
    // Error deleting organization
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// GET /api/organizations/:id/hierarchy - Get organization hierarchy
router.get(
  '/:id/hierarchy',
  authorize('organizations.read'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const hierarchy = await Organization.getHierarchy(id);
      res.json({
        success: true,
        message: 'Organization hierarchy retrieved successfully',
        data: hierarchy,
      });
    } catch (error) {
      // Error fetching organization hierarchy
      res.status(500).json({
        success: false,
        message: 'Failed to fetch organization hierarchy',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

// GET /api/organizations/:id/subordinates - Get subordinate organizations
router.get(
  '/:id/subordinates',
  authorize('organizations.read'),
  async (req, res) => {
    try {
      const { id } = req.params;

      const subordinates = await Organization.getSubordinates(id);
      res.json({
        success: true,
        message: 'Subordinate organizations retrieved successfully',
        data: subordinates,
      });
    } catch (error) {
      // Error fetching subordinate organizations
      res.status(500).json({
        success: false,
        message: 'Failed to fetch subordinate organizations',
        error:
          process.env.NODE_ENV === 'development'
            ? error.message
            : 'Internal server error',
      });
    }
  }
);

module.exports = router;
