const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  authorize,
  authorizeWithTeam,
} = require('../middleware/auth');
const { checkRoleQuota } = require('../middleware/quotaCheck');
const { auditLogMiddleware: auditLog } = require('../middleware/auditLog');
const TeamService = require('../services/teamService');
const Team = require('../models/Team');
const authorizationService = require('../services/authorizationService');

// Get teams for an organization
router.get(
  '/organization/:organizationId',
  authenticateToken,
  authorize('teams.read'),
  async (req, res) => {
    try {
      const { organizationId } = req.params;
      const { type, includeInactive } = req.query;

      const teams = await TeamService.getOrganizationTeams(
        organizationId,
        req.user,
        { type, includeInactive: includeInactive === 'true' }
      );

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

// Create new team
router.post(
  '/',
  authenticateToken,
  authorize('teams.create'),
  auditLog('team.create'),
  async (req, res) => {
    try {
      const { name, type, leaderId, description, maxMembers } = req.body;

      // Get organization from authenticated user context
      const organizationId =
        req.authorizedOrgId ||
        req.user.primaryOrganization?._id ||
        req.user.primaryOrganization;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Team name is required',
        });
      }

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'No organization context available',
        });
      }

      const team = await TeamService.createTeam(
        { name, organizationId, type, leaderId, description, maxMembers },
        req.user
      );

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
      const hasPermission =
        await authorizationService.validateOrganizationAccess(
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
