const express = require('express');
const { body, validationResult, query } = require('express-validator');
const Organization = require('../models/Organization');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// GET /api/organizations - Get all organizations
router.get('/', async (req, res) => {
  try {
    const organizations = await Organization.find({ isActive: true })
      .populate('parentOrganization', 'name type')
      .sort({ type: 1, name: 1 });

    res.json(organizations);

  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// GET /api/organizations/:id - Get specific organization
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findById(id)
      .populate('parentOrganization', 'name type')
      .populate('children');

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    res.json(organization);

  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// POST /api/organizations - Create new organization
router.post('/', [
  body('name').trim().isLength({ min: 2 }).withMessage('Organization name must be at least 2 characters'),
  body('type').isIn(['union', 'conference', 'church']).withMessage('Type must be union, conference, or church'),
  body('parentOrganization').optional().isMongoId().withMessage('Valid parent organization ID required'),
  body('metadata.email').optional().isEmail().withMessage('Valid email required'),
  body('metadata.phone').optional().isString().trim(),
  body('metadata.address').optional().isString().trim(),
  body('metadata.territory').optional().isArray()
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

    const { name, type, parentOrganization, metadata } = req.body;

    // Validate parent organization if provided
    if (parentOrganization) {
      const parent = await Organization.findById(parentOrganization);
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Parent organization not found'
        });
      }

      // Validate hierarchy rules
      if (type === 'union' && parentOrganization) {
        return res.status(400).json({
          success: false,
          message: 'Union organizations cannot have a parent'
        });
      }

      if (type === 'conference' && parent.type !== 'union') {
        return res.status(400).json({
          success: false,
          message: 'Conference organizations must have a union parent'
        });
      }

      if (type === 'church' && parent.type !== 'conference') {
        return res.status(400).json({
          success: false,
          message: 'Church organizations must have a conference parent'
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
        message: 'Organization with this name already exists in the same parent'
      });
    }

    const organization = new Organization({
      name,
      type,
      parentOrganization: parentOrganization || null,
      metadata: metadata || {}
    });

    await organization.save();
    await organization.populate('parentOrganization', 'name type');

    res.status(201).json(organization);

  } catch (error) {
    console.error('Error creating organization:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// PUT /api/organizations/:id - Update organization
router.put('/:id', [
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Organization name must be at least 2 characters'),
  body('type').optional().isIn(['union', 'conference', 'church']).withMessage('Type must be union, conference, or church'),
  body('parentOrganization').optional().isMongoId().withMessage('Valid parent organization ID required'),
  body('metadata.email').optional().isEmail().withMessage('Valid email required'),
  body('metadata.phone').optional().isString().trim(),
  body('metadata.address').optional().isString().trim(),
  body('metadata.territory').optional().isArray(),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
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

    const { id } = req.params;
    const updates = req.body;

    const organization = await Organization.findById(id);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    // Validate parent organization change
    if (updates.parentOrganization && updates.parentOrganization !== organization.parentOrganization?.toString()) {
      const parent = await Organization.findById(updates.parentOrganization);
      if (!parent) {
        return res.status(400).json({
          success: false,
          message: 'Parent organization not found'
        });
      }

      // Validate hierarchy rules
      const orgType = updates.type || organization.type;
      if (orgType === 'union' && updates.parentOrganization) {
        return res.status(400).json({
          success: false,
          message: 'Union organizations cannot have a parent'
        });
      }

      if (orgType === 'conference' && parent.type !== 'union') {
        return res.status(400).json({
          success: false,
          message: 'Conference organizations must have a union parent'
        });
      }

      if (orgType === 'church' && parent.type !== 'conference') {
        return res.status(400).json({
          success: false,
          message: 'Church organizations must have a conference parent'
        });
      }
    }

    // Update organization
    Object.assign(organization, updates);
    await organization.save();
    await organization.populate('parentOrganization', 'name type');

    res.json(organization);

  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// DELETE /api/organizations/:id - Delete organization
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Organization.findById(id);
    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    // Check if organization has children
    const children = await Organization.find({ parentOrganization: id, isActive: true });
    if (children.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete organization with active child organizations',
        error: 'Organization has dependent children'
      });
    }

    // Soft delete by marking as inactive
    organization.isActive = false;
    await organization.save();

    res.json({
      success: true,
      message: 'Organization deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// GET /api/organizations/:id/hierarchy - Get organization hierarchy
router.get('/:id/hierarchy', async (req, res) => {
  try {
    const { id } = req.params;

    const hierarchy = await Organization.getHierarchy(id);
    res.json(hierarchy);

  } catch (error) {
    console.error('Error fetching organization hierarchy:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// GET /api/organizations/:id/subordinates - Get subordinate organizations
router.get('/:id/subordinates', async (req, res) => {
  try {
    const { id } = req.params;

    const subordinates = await Organization.getSubordinates(id);
    res.json(subordinates);

  } catch (error) {
    console.error('Error fetching subordinate organizations:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;