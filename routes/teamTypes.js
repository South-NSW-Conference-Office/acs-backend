const express = require('express');
const router = express.Router();
const { authenticateToken, authorize } = require('../middleware/auth');
const TeamType = require('../models/TeamType');
const Team = require('../models/Team');
const logger = require('../services/loggerService');

// Get team types for current user
router.get(
  '/user/:userId',
  authenticateToken,
  authorize('teams.read'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { includeInactive } = req.query;

      // Verify the user is requesting their own data or has admin permissions
      if (req.user._id.toString() !== userId && !req.user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized to access team types for this user',
        });
      }

      const filter = {};
      if (includeInactive !== 'true') {
        filter.isActive = true;
      }

      const teamTypes = await TeamType.find(filter).sort({
        isDefault: -1,
        name: 1,
      }); // Default types first

      res.json({
        success: true,
        data: teamTypes,
      });
    } catch (error) {
      logger.error('Error fetching user team types:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch team types',
        error: error.message,
      });
    }
  }
);

// Get team types
router.get(
  '/all',
  authenticateToken,
  authorize('teams.read'),
  async (req, res) => {
    // GET /api/team-types/all called

    try {
      const { includeInactive } = req.query;

      // console.log('⚙️ Query parameters:');
      // console.log('  includeInactive:', includeInactive);

      // Include only default team types (no org-specific types anymore)
      const filter = {
        isDefault: true, // Only global default team types
      };
      if (includeInactive !== 'true') {
        filter.isActive = true;
      }

      // console.log('📋 MongoDB filter:', filter);
      // console.log('🗄️ Executing TeamType.find() query...');

      const teamTypes = await TeamType.find(filter)
        .populate('teamCount')
        .sort({ isDefault: -1, name: 1 }); // Default types first

      // console.log('✅ TeamType.find() returned:', teamTypes?.length || 0, 'team types');

      if (teamTypes && teamTypes.length > 0) {
        // console.log('🏷️ Team types found:');
        // Team types available in teamTypes array
      } else {
        // console.warn('⚠️ No team types found in database');
        // console.log('🔍 Debugging: Let\'s check what exists...');

        // Debug: Check all team types
        const allTeamTypes = await TeamType.find({}).select(
          'name isActive isDefault'
        );
        logger.debug(
          `🌐 All team types in database: ${allTeamTypes.length} found`
        );

        // Log what we found for debugging
        logger.debug(
          `Found ${allTeamTypes.length} total team types in database`
        );
        logger.debug(
          `Found ${allTeamTypes.filter((t) => t.isDefault).length} default types`
        );

        // If no organization-specific types exist, check if we need to initialize defaults
        if (allTeamTypes.filter((t) => t.isDefault).length === 0) {
          logger.warn(
            'No default team types found. They may need to be initialized.'
          );
        }
      }

      // Debug: Let's also manually count teams for each team type
      const Team = require('../models/Team');
      for (const teamType of teamTypes) {
        const manualCount = await Team.countDocuments({
          category: teamType.name,
        });
        // console.log(`📊 TeamType "${teamType.name}": virtual count = ${teamType.teamCount}, manual count = ${manualCount}`);
        logger.debug(
          `TeamType "${teamType.name}": virtual count = ${teamType.teamCount}, manual count = ${manualCount}`
        );
      }

      res.json({
        success: true,
        data: teamTypes,
      });
    } catch (error) {
      // console.error('❌ Error in team types route:', error);
      // console.error('📝 Error message:', error.message);
      // console.error('📚 Error stack:', error.stack);

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
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Team type name is required',
        });
      }

      const teamType = new TeamType({
        name,
        description,
        createdBy: req.user._id,
      });

      await teamType.save();

      logger.audit('teamType.create', {
        userId: req.user._id,
        teamTypeId: teamType._id,
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
          message: 'A team type with this name already exists',
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
      const { name, description, isActive } = req.body;

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
          message: 'A team type with this name already exists',
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
        category: teamType.name,
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

// Initialize default team types
router.post(
  '/initialize',
  authenticateToken,
  authorize('teams.manage'),
  async (req, res) => {
    try {
      await TeamType.createDefaultTypes(req.user._id);

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
