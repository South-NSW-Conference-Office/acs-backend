const User = require('../models/User');
const Team = require('../models/Team');
const Church = require('../models/Church');
const Conference = require('../models/Conference');
const Union = require('../models/Union');
const {
  AppError,
  NotFoundError,
  ConflictError,
} = require('../middleware/errorHandler');

class UniversalAssignmentService {
  /**
   * Assign user to any team - universal assignment with no organizational restrictions
   */
  static async assignUserToTeam(userId, teamId, role = 'member', assignedBy = null) {
    try {
      // 1. Validate user exists
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User');
      }

      // 2. Validate team exists and is active
      const team = await Team.findById(teamId).populate('churchId');
      if (!team) {
        throw new NotFoundError('Team');
      }
      
      if (!team.isActive) {
        throw new AppError('Cannot assign user to inactive team', 400);
      }

      // 3. Validate role
      const validRoles = ['leader', 'coordinator', 'member'];
      if (!validRoles.includes(role)) {
        throw new AppError('Invalid team role', 400);
      }

      // 4. Check if user is already assigned to this team
      const existingAssignment = user.teamAssignments.find(
        assignment => assignment.teamId.toString() === teamId.toString()
      );

      if (existingAssignment) {
        // Update existing assignment
        existingAssignment.role = role;
        existingAssignment.status = 'active';
        existingAssignment.joinedAt = new Date();
        if (assignedBy) existingAssignment.invitedBy = assignedBy;
      } else {
        // Add new team assignment
        user.teamAssignments.push({
          teamId: teamId,
          role: role,
          status: 'active',
          joinedAt: new Date(),
          invitedBy: assignedBy,
          permissions: []
        });
      }

      // 5. Set as primary team if user doesn't have one
      if (!user.primaryTeam) {
        user.primaryTeam = teamId;
      }

      // 6. Save user with new assignment
      await user.save();

      // 7. Update team member count
      await this.updateTeamMemberCount(teamId);

      return {
        success: true,
        assignment: {
          userId: userId,
          teamId: teamId,
          role: role,
          teamName: team.name,
          churchName: team.churchId?.name,
          status: 'active'
        }
      };

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to assign user to team', 500);
    }
  }

  /**
   * Remove user from team
   */
  static async removeUserFromTeam(userId, teamId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User');
      }

      const team = await Team.findById(teamId);
      if (!team) {
        throw new NotFoundError('Team');
      }

      // Remove team assignment
      const originalLength = user.teamAssignments.length;
      user.teamAssignments = user.teamAssignments.filter(
        assignment => assignment.teamId.toString() !== teamId.toString()
      );

      if (user.teamAssignments.length === originalLength) {
        throw new AppError('User is not assigned to this team', 400);
      }

      // Update primary team if it was removed
      if (user.primaryTeam && user.primaryTeam.toString() === teamId.toString()) {
        user.primaryTeam = user.teamAssignments.length > 0 
          ? user.teamAssignments[0].teamId 
          : null;
      }

      await user.save();

      // Update team member count
      await this.updateTeamMemberCount(teamId);

      return {
        success: true,
        message: 'User removed from team successfully'
      };

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to remove user from team', 500);
    }
  }

  /**
   * Move user between teams - no organizational restrictions
   */
  static async moveUserBetweenTeams(userId, fromTeamId, toTeamId, newRole = 'member', movedBy = null) {
    try {
      // 1. Remove from old team
      await this.removeUserFromTeam(userId, fromTeamId);

      // 2. Add to new team
      const result = await this.assignUserToTeam(userId, toTeamId, newRole, movedBy);

      return {
        success: true,
        message: 'User moved between teams successfully',
        assignment: result.assignment
      };

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to move user between teams', 500);
    }
  }

  /**
   * Bulk assign multiple users to a team
   */
  static async bulkAssignUsersToTeam(userIds, teamId, role = 'member', assignedBy = null) {
    const results = {
      successful: [],
      failed: []
    };

    for (const userId of userIds) {
      try {
        const result = await this.assignUserToTeam(userId, teamId, role, assignedBy);
        results.successful.push({
          userId: userId,
          assignment: result.assignment
        });
      } catch (error) {
        results.failed.push({
          userId: userId,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get assignable teams for a user - teams the current admin can assign users to
   */
  static async getAssignableTeams(adminUserId) {
    try {
      const admin = await User.findById(adminUserId);
      if (!admin) {
        throw new NotFoundError('Admin user');
      }

      // Super admins can assign to any team
      if (admin.isSuperAdmin) {
        return Team.find({ isActive: true })
          .populate('churchId', 'name')
          .sort({ name: 1 });
      }

      // Get admin's organizational scope through their team memberships
      const adminScope = await admin.getOrganizationalScope();
      
      // Find teams within admin's accessible churches
      if (adminScope.churches.length > 0) {
        return Team.find({ 
          churchId: { $in: adminScope.churches },
          isActive: true 
        })
        .populate('churchId', 'name')
        .sort({ name: 1 });
      }

      // If admin has no team assignments, return empty array
      return [];

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch assignable teams', 500);
    }
  }

  /**
   * Validate assignment permissions - check if admin can assign to team
   */
  static async validateAssignmentPermission(adminUserId, teamId) {
    try {
      const admin = await User.findById(adminUserId);
      if (!admin) {
        throw new NotFoundError('Admin user');
      }

      // Super admins can assign to any team
      if (admin.isSuperAdmin) {
        return true;
      }

      const team = await Team.findById(teamId).populate('churchId');
      if (!team) {
        throw new NotFoundError('Team');
      }

      // Get admin's organizational scope
      const adminScope = await admin.getOrganizationalScope();
      
      // Check if team's church is within admin's scope
      const teamChurchId = team.churchId._id.toString();
      return adminScope.churches.includes(teamChurchId);

    } catch (error) {
      if (error instanceof AppError) throw error;
      return false; // Default to no permission on error
    }
  }

  /**
   * Get user assignments with organizational context
   */
  static async getUserAssignments(userId) {
    try {
      const user = await User.findById(userId)
        .populate({
          path: 'teamAssignments.teamId',
          populate: {
            path: 'churchId',
            populate: {
              path: 'conferenceId',
              populate: { path: 'unionId' }
            }
          }
        });

      if (!user) {
        throw new NotFoundError('User');
      }

      const assignments = user.teamAssignments
        .filter(assignment => assignment.status === 'active')
        .map(assignment => {
          const team = assignment.teamId;
          const church = team?.churchId;
          const conference = church?.conferenceId;
          const union = conference?.unionId;

          return {
            teamId: team?._id,
            teamName: team?.name,
            teamCategory: team?.category,
            teamTags: team?.tags,
            role: assignment.role,
            status: assignment.status,
            joinedAt: assignment.joinedAt,
            church: {
              id: church?._id,
              name: church?.name
            },
            conference: {
              id: conference?._id,
              name: conference?.name
            },
            union: {
              id: union?._id,
              name: union?.name
            }
          };
        });

      return {
        userId: userId,
        primaryTeam: user.primaryTeam,
        assignments: assignments,
        organizationalScope: await user.getOrganizationalScope()
      };

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch user assignments', 500);
    }
  }

  /**
   * Update team member count
   */
  static async updateTeamMemberCount(teamId) {
    try {
      const memberCount = await User.countDocuments({
        'teamAssignments.teamId': teamId,
        'teamAssignments.status': 'active'
      });

      await Team.findByIdAndUpdate(teamId, { memberCount });

      return memberCount;
    } catch (error) {
      // Don't throw error - this is a background operation
      console.error('Failed to update team member count:', error);
    }
  }

  /**
   * Get team assignment suggestions for user based on their interests/location
   */
  static async getTeamSuggestions(userId, options = {}) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User');
      }

      const { limit = 10, includeCurrentTeams = false } = options;

      // Build suggestion query
      const query = {
        isActive: true,
        'settings.isPubliclyVisible': true
      };

      // Exclude teams user is already part of unless specifically requested
      if (!includeCurrentTeams && user.teamAssignments.length > 0) {
        const currentTeamIds = user.teamAssignments.map(a => a.teamId);
        query._id = { $nin: currentTeamIds };
      }

      const suggestedTeams = await Team.find(query)
        .populate('churchId', 'name')
        .populate('leaderId', 'name email')
        .limit(limit)
        .lean();

      return suggestedTeams.map(team => ({
        teamId: team._id,
        teamName: team.name,
        category: team.category,
        tags: team.tags,
        description: team.description,
        church: team.churchId?.name,
        memberCount: team.memberCount,
        maxMembers: team.maxMembers,
        canJoin: !team.settings?.requireApproval,
        leader: team.leaderId?.name
      }));

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch team suggestions', 500);
    }
  }

  /**
   * Create team invitation for user
   */
  static async createTeamInvitation(teamId, email, role = 'member', invitedBy = null, personalMessage = '') {
    try {
      const team = await Team.findById(teamId).populate('churchId');
      if (!team) {
        throw new NotFoundError('Team');
      }

      // Check if user already exists
      let user = await User.findOne({ email });
      
      if (user) {
        // User exists - add team assignment with pending status
        const existingAssignment = user.teamAssignments.find(
          assignment => assignment.teamId.toString() === teamId.toString()
        );

        if (existingAssignment) {
          throw new ConflictError('User is already assigned to this team');
        }

        user.teamAssignments.push({
          teamId: teamId,
          role: role,
          status: 'pending',
          joinedAt: new Date(),
          invitedBy: invitedBy,
          permissions: []
        });

        await user.save();
      } else {
        // User doesn't exist - create with team invitation
        user = new User({
          email: email,
          name: email.split('@')[0], // Temporary name
          verified: false,
          teamAssignments: [{
            teamId: teamId,
            role: role,
            status: 'pending',
            joinedAt: new Date(),
            invitedBy: invitedBy,
            permissions: []
          }]
        });

        await user.save();
      }

      // TODO: Send team invitation email
      // await emailService.sendTeamInvitationEmail(user, team, personalMessage);

      return {
        success: true,
        userId: user._id,
        teamId: teamId,
        teamName: team.name,
        invitationStatus: 'sent'
      };

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to create team invitation', 500);
    }
  }
}

module.exports = UniversalAssignmentService;