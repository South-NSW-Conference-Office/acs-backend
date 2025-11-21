const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const TeamType = require('../models/TeamType');
const Team = require('../models/Team');
const logger = require('../services/loggerService');

// Get team types for an organization
router.get(
  '/organization/:organizationId',
  authenticateToken,
  authorize('teams.read'),
  async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { includeInactive } = req.query;

      const filter = { organizationId };
      if (includeInactive !== 'true') {
        filter.isActive = true;
      }

      const teamTypes = await TeamType.find(filter)
        .populate('teamCount')
        .sort({ isDefault: -1, name: 1 }); // Default types first

      // Debug: Let's also manually count teams for each team type
      const Team = require('../models/Team');
      for (const teamType of teamTypes) {
        const manualCount = await Team.countDocuments({
          type: teamType.name,
          organizationId: teamType.organizationId,
        });
        logger.debug(
          `TeamType "${teamType.name}": virtual count = ${teamType.teamCount}, manual count = ${manualCount}`
        );
      }

      res.json({
        success: true,
        data: teamTypes,
      });
    } catch (error) {
      logger.error('Error fetching team types:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch team types',
        error: error.message,
      });
    }
  }
);

// Get a specific team type
router.get(
  '/:id',
  authenticateToken,
  authorize('teams.read'),
  async (req, res) => {
    try {
      const teamType = await TeamType.findById(req.params.id).populate(
        'teamCount'
      );

      if (!teamType) {
        return res.status(404).json({
          success: false,
          message: 'Team type not found',
        });
      }

      res.json({
        success: true,
        data: teamType,
      });
    } catch (error) {
      logger.error('Error fetching team type:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch team type',
        error: error.message,
      });
    }
  }
);

// Create a new team type
router.post(
  '/',
  authenticateToken,
  authorize('teams.manage'),
  async (req, res) => {
    try {
      const { name, description, permissions } = req.body;

      // Get organization from authenticated user context
      const organizationId =
        req.authorizedOrgId ||
        req.user.primaryOrganization?._id ||
        req.user.primaryOrganization;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Team type name is required',
        });
      }

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'No organization context available',
        });
      }

      const teamType = new TeamType({
        name,
        description,
        organizationId,
        permissions: permissions || [],
        createdBy: req.user._id,
      });

      await teamType.save();

      logger.audit('teamType.create', {
        userId: req.user._id,
        teamTypeId: teamType._id,
        organizationId,
      });

      res.status(201).json({
        success: true,
        data: teamType,
        message: 'Team type created successfully',
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message:
            'A team type with this name already exists in this organization',
        });
      }

      logger.error('Error creating team type:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create team type',
        error: error.message,
      });
    }
  }
);

// Update a team type
router.put(
  '/:id',
  authenticateToken,
  authorize('teams.manage'),
  async (req, res) => {
    try {
      const { name, description, permissions, isActive } = req.body;

      const teamType = await TeamType.findById(req.params.id);

      if (!teamType) {
        return res.status(404).json({
          success: false,
          message: 'Team type not found',
        });
      }

      // Don't allow editing default types' core properties
      if (teamType.isDefault && name !== teamType.name) {
        return res.status(403).json({
          success: false,
          message: 'Cannot modify core properties of default team types',
        });
      }

      // Update fields
      if (name) teamType.name = name;
      if (description !== undefined) teamType.description = description;
      if (permissions) teamType.permissions = permissions;
      if (isActive !== undefined) teamType.isActive = isActive;

      await teamType.save();

      logger.audit('teamType.update', {
        userId: req.user._id,
        teamTypeId: teamType._id,
        changes: req.body,
      });

      res.json({
        success: true,
        data: teamType,
        message: 'Team type updated successfully',
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message:
            'A team type with this name already exists in this organization',
        });
      }

      logger.error('Error updating team type:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update team type',
        error: error.message,
      });
    }
  }
);

// Delete a team type
router.delete(
  '/:id',
  authenticateToken,
  authorize('teams.manage'),
  async (req, res) => {
    try {
      const teamType = await TeamType.findById(req.params.id);

      if (!teamType) {
        return res.status(404).json({
          success: false,
          message: 'Team type not found',
        });
      }

      // Don't allow deleting default types
      if (teamType.isDefault) {
        return res.status(403).json({
          success: false,
          message: 'Cannot delete default team types',
        });
      }

      // Check if any teams are using this type
      const teamsCount = await Team.countDocuments({
        type: teamType.name,
        organizationId: teamType.organizationId,
      });

      if (teamsCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete team type. ${teamsCount} team(s) are currently using this type.`,
        });
      }

      await TeamType.findByIdAndDelete(req.params.id);

      logger.audit('teamType.delete', {
        userId: req.user._id,
        teamTypeId: teamType._id,
      });

      res.json({
        success: true,
        message: 'Team type deleted successfully',
      });
    } catch (error) {
      logger.error('Error deleting team type:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete team type',
        error: error.message,
      });
    }
  }
);

// Initialize default team types for an organization
router.post(
  '/initialize/:organizationId',
  authenticateToken,
  authorize('organizations.manage'),
  async (req, res) => {
    try {
      const { organizationId } = req.params;

      await TeamType.createDefaultTypes(organizationId, req.user._id);

      res.json({
        success: true,
        message: 'Default team types initialized successfully',
      });
    } catch (error) {
      logger.error('Error initializing default team types:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to initialize default team types',
        error: error.message,
      });
    }
  }
);

module.exports = router;
