const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  authorizeHierarchical,
  // authorizeTeamAccess,
  // requireSuperAdmin
} = require('../middleware/hierarchicalAuth');
const { authorize, authorizeWithTeam } = require('../middleware/auth');
const { checkRoleQuota } = require('../middleware/quotaCheck');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const TeamService = require('../services/teamService');
const Team = require('../models/Team');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// Get teams for an organization (church)
router.get(
  '/organization/:organizationId',
  authenticateToken,
  authorizeHierarchical('read', 'organization'),
  async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { type, includeInactive } = req.query;

      // Use new hierarchical method - only get teams for churches
      const teams = await Team.getTeamsByChurch(organizationId, {
        type,
        includeInactive: includeInactive === 'true',
      });

      res.json({
        success: true,
        data: teams,
      });
    } catch (error) {
      res.status(error.message.includes('permission') ? 403 : 400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get all teams accessible to user (hierarchical)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    // Get teams accessible based on user's hierarchy level
    const userHierarchyPath =
      await hierarchicalAuthService.getUserHierarchyPath(req.user);

    if (userHierarchyPath === null) {
      return res.status(403).json({
        success: false,
        message: 'No hierarchy access found',
      });
    }

    // Get accessible teams using hierarchical path
    const teams = await Team.getAccessibleTeams(userHierarchyPath);

    res.json({
      success: true,
      data: teams,
    });
  } catch (error) {
    res.status(error.message.includes('permission') ? 403 : 400).json({
      success: false,
      message: error.message,
    });
  }
});

// Get user's teams
router.get('/my-teams', authenticateToken, async (req, res) => {
  try {
    const teams = await TeamService.getUserTeams(req.user._id);

    res.json({
      success: true,
      data: teams,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

// Search teams
router.get(
  '/search',
  authenticateToken,
  authorize('teams.read'),
  async (req, res) => {
    try {
      const {
        q,
        organizationId,
        type,
        limit = 50,
        skip = 0,
        includeInactive,
      } = req.query;

      const teams = await TeamService.searchTeams(q, req.user, {
        organizationId,
        type,
        limit: parseInt(limit),
        skip: parseInt(skip),
        includeInactive: includeInactive === 'true',
      });

      res.json({
        success: true,
        data: teams,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get team details
router.get(
  '/:teamId',
  authenticateToken,
  authorizeWithTeam('teams.read'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const team = await TeamService.getTeamDetails(teamId, req.user);

      res.json({
        success: true,
        data: team,
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get team statistics
router.get(
  '/:teamId/statistics',
  authenticateToken,
  authorizeWithTeam('teams.read'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const stats = await TeamService.getTeamStatistics(teamId, req.user);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Create new team (HIERARCHICAL - must be under church)
router.post(
  '/',
  authenticateToken,
  authorizeHierarchical('create', 'team'),
  auditLog('team.create'),
  async (req, res) => {
    try {
      const { name, type, leaderId, description, maxMembers, churchId } =
        req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Team name is required',
        });
      }

      // Get user's church or use provided churchId (must be validated by middleware)
      let targetChurchId = churchId;

      if (!targetChurchId) {
        // Get user's church assignment
        const userChurch = await hierarchicalAuthService.getUserChurch(
          req.user
        );

        if (!userChurch) {
          return res.status(403).json({
            success: false,
            message:
              'No church assignment found. Teams must be created under a church.',
          });
        }

        targetChurchId = userChurch._id;
      }

      // Validate user can create team in this church
      await hierarchicalAuthService.getUserHierarchyPath(req.user);
      const church = await hierarchicalAuthService.getEntity(
        'organization',
        targetChurchId
      );

      if (!church || church.hierarchyLevel !== 'church') {
        return res.status(400).json({
          success: false,
          message: 'Teams can only be created under church organizations',
        });
      }

      const canCreate = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        church.hierarchyPath,
        'create'
      );

      if (!canCreate) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to create team in this church',
        });
      }

      // Create team with church binding
      const team = await Team.createTeam({
        name,
        churchId: targetChurchId,
        type: type || 'other',
        leaderId,
        description,
        maxMembers: maxMembers || 50,
        createdBy: req.user._id,
      });

      res.status(201).json({
        success: true,
        data: team,
        message: 'Team created successfully',
      });
    } catch (error) {
      res.status(error.message.includes('permission') ? 403 : 400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Update team
router.put(
  '/:teamId',
  authenticateToken,
  authorizeWithTeam('teams.update'),
  auditLog('team.update'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const updates = req.body;

      const team = await TeamService.updateTeam(teamId, updates, req.user);

      res.json({
        success: true,
        data: team,
        message: 'Team updated successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Add team member
router.post(
  '/:teamId/members',
  authenticateToken,
  authorizeWithTeam('teams.manage_members'),
  checkRoleQuota,
  auditLog('team.member.add'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { userId, role = 'member' } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required',
        });
      }

      const result = await TeamService.addTeamMember(
        teamId,
        userId,
        role,
        req.user
      );

      res.json({
        success: true,
        data: result,
        message: 'Member added to team successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Update team member role
router.put(
  '/:teamId/members/:userId',
  authenticateToken,
  authorizeWithTeam('teams.manage_members'),
  auditLog('team.member.update'),
  async (req, res) => {
    try {
      const { teamId, userId } = req.params;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({
          success: false,
          message: 'New role is required',
        });
      }

      const result = await TeamService.updateMemberRole(
        teamId,
        userId,
        role,
        req.user
      );

      res.json({
        success: true,
        data: result,
        message: 'Member role updated successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Remove team member
router.delete(
  '/:teamId/members/:userId',
  authenticateToken,
  authorizeWithTeam('teams.manage_members'),
  auditLog('team.member.remove'),
  async (req, res) => {
    try {
      const { teamId, userId } = req.params;

      const result = await TeamService.removeTeamMember(
        teamId,
        userId,
        req.user
      );

      res.json({
        success: true,
        data: result,
        message: 'Member removed from team successfully',
      });
    } catch (error) {
      res.status(error.message.includes('not found') ? 404 : 403).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get team members
router.get(
  '/:teamId/members',
  authenticateToken,
  authorizeWithTeam('teams.read'),
  async (req, res) => {
    try {
      const { teamId } = req.params;
      const { role, limit = 100, skip = 0 } = req.query;

      const team = await Team.findById(teamId);
      if (!team) {
        return res.status(404).json({
          success: false,
          message: 'Team not found',
        });
      }

      const members = await team.getMembers({
        role,
        limit: parseInt(limit),
        skip: parseInt(skip),
      });

      res.json({
        success: true,
        data: members,
        meta: {
          total: team.memberCount,
          limit: parseInt(limit),
          skip: parseInt(skip),
        },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Delete team (soft delete)
router.delete(
  '/:teamId',
  authenticateToken,
  authorize('teams.delete'),
  auditLog('team.delete'),
  async (req, res) => {
    try {
      const { teamId } = req.params;

      const team = await Team.findById(teamId);
      if (!team) {
        return res.status(404).json({
          success: false,
          message: 'Team not found',
        });
      }

      // Check permissions
      const hasPermission = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        team.organizationId
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions to delete this team',
        });
      }

      // Soft delete
      team.isActive = false;
      team.updatedBy = req.user._id;
      await team.save();

      res.json({
        success: true,
        message: 'Team deleted successfully',
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

module.exports = router;
