const express = require('express');
const router = express.Router();
const UniversalAssignmentService = require('../services/universalAssignmentService');
const UserService = require('../services/userService');
const Team = require('../models/Team');
const { authenticateToken } = require('../middleware/auth');
const {
  AppError,
  NotFoundError,
  ValidationError,
} = require('../middleware/errorHandler');

// Middleware to ensure user is authenticated
router.use(authenticateToken);

/**
 * @route   POST /api/assignments/assign
 * @desc    Assign user to team - Universal assignment (no organizational restrictions)
 * @access  Private (requires team management permissions)
 */
router.post('/assign', async (req, res, next) => {
  try {
    const { userId, teamId, role = 'member' } = req.body;

    // Validate required fields
    if (!userId || !teamId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Team ID are required'
      });
    }

    // Validate role
    const validRoles = ['leader', 'coordinator', 'member'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role. Must be: leader, coordinator, or member'
      });
    }

    // Check if requesting user has permission to assign to this team
    const hasPermission = await UniversalAssignmentService.validateAssignmentPermission(
      req.user._id,
      teamId
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to assign users to this team'
      });
    }

    // Assign user to team
    const result = await UniversalAssignmentService.assignUserToTeam(
      userId,
      teamId,
      role,
      req.user._id
    );

    res.json({
      success: true,
      message: 'User successfully assigned to team',
      assignment: result.assignment
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /api/assignments/remove
 * @desc    Remove user from team
 * @access  Private (requires team management permissions)
 */
router.delete('/remove', async (req, res, next) => {
  try {
    const { userId, teamId } = req.body;

    if (!userId || !teamId) {
      return res.status(400).json({
        success: false,
        error: 'User ID and Team ID are required'
      });
    }

    // Check permission
    const hasPermission = await UniversalAssignmentService.validateAssignmentPermission(
      req.user._id,
      teamId
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to remove users from this team'
      });
    }

    const result = await UniversalAssignmentService.removeUserFromTeam(userId, teamId);

    res.json({
      success: true,
      message: 'User successfully removed from team'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/assignments/move
 * @desc    Move user between teams
 * @access  Private (requires permissions for both teams)
 */
router.post('/move', async (req, res, next) => {
  try {
    const { userId, fromTeamId, toTeamId, newRole = 'member' } = req.body;

    if (!userId || !fromTeamId || !toTeamId) {
      return res.status(400).json({
        success: false,
        error: 'User ID, from Team ID, and to Team ID are required'
      });
    }

    // Validate permissions for both teams
    const fromPermission = await UniversalAssignmentService.validateAssignmentPermission(
      req.user._id,
      fromTeamId
    );
    
    const toPermission = await UniversalAssignmentService.validateAssignmentPermission(
      req.user._id,
      toTeamId
    );

    if (!fromPermission || !toPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to move user between these teams'
      });
    }

    const result = await UniversalAssignmentService.moveUserBetweenTeams(
      userId,
      fromTeamId,
      toTeamId,
      newRole,
      req.user._id
    );

    res.json({
      success: true,
      message: 'User successfully moved between teams',
      assignment: result.assignment
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/assignments/bulk-assign
 * @desc    Bulk assign multiple users to a team
 * @access  Private (requires team management permissions)
 */
router.post('/bulk-assign', async (req, res, next) => {
  try {
    const { userIds, teamId, role = 'member' } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0 || !teamId) {
      return res.status(400).json({
        success: false,
        error: 'User IDs array and Team ID are required'
      });
    }

    // Check permission
    const hasPermission = await UniversalAssignmentService.validateAssignmentPermission(
      req.user._id,
      teamId
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to assign users to this team'
      });
    }

    const results = await UniversalAssignmentService.bulkAssignUsersToTeam(
      userIds,
      teamId,
      role,
      req.user._id
    );

    res.json({
      success: true,
      message: `Bulk assignment completed: ${results.successful.length} successful, ${results.failed.length} failed`,
      results: results
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/assignments/assignable-teams
 * @desc    Get teams that the current user can assign people to
 * @access  Private
 */
router.get('/assignable-teams', async (req, res, next) => {
  try {
    const teams = await UniversalAssignmentService.getAssignableTeams(req.user._id);

    res.json({
      success: true,
      teams: teams
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/assignments/user/:userId
 * @desc    Get user's team assignments with organizational context
 * @access  Private
 */
router.get('/user/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Check if requesting user can access target user
    const canAccess = await UserService.canUserAccessUser(
      req.user._id,
      userId,
      req.user.permissions || {}
    );

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view user assignments'
      });
    }

    const assignments = await UniversalAssignmentService.getUserAssignments(userId);

    res.json({
      success: true,
      assignments: assignments
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/assignments/team-suggestions/:userId
 * @desc    Get team suggestions for a user
 * @access  Private
 */
router.get('/team-suggestions/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { limit = 10, includeCurrentTeams = false } = req.query;

    // Check permission to view user
    const canAccess = await UserService.canUserAccessUser(
      req.user._id,
      userId,
      req.user.permissions || {}
    );

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view team suggestions for this user'
      });
    }

    const suggestions = await UniversalAssignmentService.getTeamSuggestions(userId, {
      limit: parseInt(limit),
      includeCurrentTeams: includeCurrentTeams === 'true'
    });

    res.json({
      success: true,
      suggestions: suggestions
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/assignments/invite-to-team
 * @desc    Create team invitation for user (preserves existing invitation system)
 * @access  Private
 */
router.post('/invite-to-team', async (req, res, next) => {
  try {
    const { teamId, email, role = 'member', personalMessage = '' } = req.body;

    if (!teamId || !email) {
      return res.status(400).json({
        success: false,
        error: 'Team ID and email are required'
      });
    }

    // Check permission
    const hasPermission = await UniversalAssignmentService.validateAssignmentPermission(
      req.user._id,
      teamId
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to invite users to this team'
      });
    }

    const result = await UniversalAssignmentService.createTeamInvitation(
      teamId,
      email,
      role,
      req.user._id,
      personalMessage
    );

    res.json({
      success: true,
      message: 'Team invitation sent successfully',
      invitation: result
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/assignments/team/:teamId/members
 * @desc    Get all members of a team with their roles
 * @access  Private
 */
router.get('/team/:teamId/members', async (req, res, next) => {
  try {
    const { teamId } = req.params;

    // Check if user can access this team
    const hasPermission = await UniversalAssignmentService.validateAssignmentPermission(
      req.user._id,
      teamId
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to view team members'
      });
    }

    const team = await Team.findById(teamId);
    if (!team) {
      throw new NotFoundError('Team');
    }

    const members = await team.getMembers();

    res.json({
      success: true,
      teamId: teamId,
      teamName: team.name,
      members: members
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/assignments/accessible-teams
 * @desc    Get teams accessible to current user
 * @access  Private
 */
router.get('/accessible-teams', async (req, res, next) => {
  try {
    const accessibleTeamIds = await UserService.getUserAccessibleTeams(req.user._id);
    
    const teams = await Team.find({ 
      _id: { $in: accessibleTeamIds },
      isActive: true 
    })
    .populate('churchId', 'name')
    .populate('leaderId', 'name email')
    .sort({ name: 1 });

    res.json({
      success: true,
      teams: teams
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;