const Team = require('../models/Team');
const User = require('../models/User');
const hierarchicalAuthService = require('./hierarchicalAuthService');

class TeamService {
  /**
   * Create a new team
   */
  static async createTeam(data, createdBy) {
    const { churchId, leaderId, name, type, description } = data;

    // Validate church exists and user has permission
    const hasPermission = await hierarchicalAuthService.canUserManageEntity(
      createdBy,
      churchId,
      'create'
    );

    if (!hasPermission) {
      throw new Error('Insufficient permissions to create team in this church');
    }

    // Validate leader if specified
    if (leaderId) {
      const leader = await User.findById(leaderId);
      if (!leader) {
        throw new Error('Leader not found');
      }

      // Check if leader belongs to the church hierarchy
      const canAccess = await hierarchicalAuthService.canUserManageEntity(
        leader,
        churchId,
        'read'
      );

      if (!canAccess) {
        throw new Error('Leader must have access to this church');
      }
    }

    // Create team
    const team = await Team.createTeam({
      name,
      churchId,
      category: type || 'acs',
      leaderId,
      description,
      createdBy: createdBy._id,
    });

    return team;
  }

  /**
   * Update team details
   */
  static async updateTeam(teamId, updates, updatedBy) {
    const team = await Team.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Check permissions
    const hasPermission = await hierarchicalAuthService.canUserManageEntity(
      updatedBy,
      team.churchId,
      'update'
    );

    if (
      !hasPermission &&
      team.leaderId?.toString() !== updatedBy._id.toString()
    ) {
      throw new Error('Insufficient permissions to update this team');
    }

    // Update allowed fields
    const allowedUpdates = [
      'name',
      'description',
      'leaderId',
      'settings',
      'metadata',
    ];
    const updateFields = {};

    for (const field of allowedUpdates) {
      if (updates[field] !== undefined) {
        updateFields[field] = updates[field];
      }
    }

    updateFields.updatedBy = updatedBy._id;

    // Validate new leader if changing
    if (updateFields.leaderId) {
      const leader = await User.findById(updateFields.leaderId);
      if (!leader) {
        throw new Error('New leader not found');
      }

      const canAccess = await hierarchicalAuthService.canUserManageEntity(
        leader,
        team.churchId,
        'read'
      );

      if (!canAccess) {
        throw new Error('New leader must have access to this church');
      }
    }

    // Update team
    Object.assign(team, updateFields);
    await team.save();

    return team;
  }

  /**
   * Add member to team
   */
  static async addTeamMember(teamId, userId, role = 'member', addedBy) {
    const team = await Team.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Check permissions - team leader or church admin can add members
    const hasChurchPermission =
      await hierarchicalAuthService.canUserManageEntity(
        addedBy,
        team.churchId,
        'update'
      );

    const isTeamLeader = team.leaderId?.toString() === addedBy._id.toString();

    if (!hasChurchPermission && !isTeamLeader) {
      throw new Error('Insufficient permissions to add members to this team');
    }

    // Add member
    const user = await team.addMember(userId, role, addedBy._id);

    return { team, user };
  }

  /**
   * Remove member from team
   */
  static async removeTeamMember(teamId, userId, removedBy) {
    const team = await Team.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Check permissions
    const hasChurchPermission =
      await hierarchicalAuthService.canUserManageEntity(
        removedBy,
        team.churchId,
        'update'
      );

    const isTeamLeader = team.leaderId?.toString() === removedBy._id.toString();
    const isSelfRemoval = userId === removedBy._id.toString();

    if (!hasChurchPermission && !isTeamLeader && !isSelfRemoval) {
      throw new Error(
        'Insufficient permissions to remove members from this team'
      );
    }

    // Prevent removing team leader unless by church admin
    if (team.leaderId?.toString() === userId && !hasChurchPermission) {
      throw new Error(
        'Cannot remove team leader without church admin permissions'
      );
    }

    // Remove member
    const user = await team.removeMember(userId);

    return { team, user };
  }

  /**
   * Get teams for church
   */
  static async getChurchTeams(churchId, user, options = {}) {
    // Check if user can view teams in this church
    const hasPermission = await hierarchicalAuthService.canUserManageEntity(
      user,
      churchId,
      'read'
    );

    if (!hasPermission) {
      // Check if user is member of any team in this church
      const userTeams = await Team.getTeamsByUser(user._id);

      const churchTeams = userTeams.filter(
        (team) => team.churchId.toString() === churchId.toString()
      );

      if (churchTeams.length === 0) {
        throw new Error('No permission to view teams in this church');
      }

      // Return only user's teams
      return churchTeams;
    }

    // Return all teams for church
    const allTeams = await Team.getTeamsByChurch(churchId, options);

    return allTeams;
  }

  /**
   * Get team details
   */
  static async getTeamDetails(teamId, user) {
    const team = await Team.findById(teamId)
      .populate('churchId', 'name hierarchyLevel')
      .populate('leaderId', 'name email avatar')
      .populate('createdBy', 'name email')
      .populate('serviceIds', 'name');

    if (!team) {
      throw new Error('Team not found');
    }

    // Check permissions
    const hasChurchPermission =
      await hierarchicalAuthService.canUserManageEntity(
        user,
        team.churchId._id,
        'read'
      );

    // Check if user is team member
    const isMember = user.teamAssignments?.some(
      (assignment) => assignment.teamId.toString() === teamId
    );

    if (!hasChurchPermission && !isMember) {
      throw new Error('No permission to view this team');
    }

    // Get members if authorized
    let members = [];
    if (hasChurchPermission || isMember) {
      members = await team.getMembers();
    }

    return {
      ...team.toObject(),
      members,
    };
  }

  /**
   * Get user's teams across all organizations
   */
  static async getUserTeams(userId) {
    return Team.getTeamsByUser(userId);
  }

  /**
   * Update team member role
   */
  static async updateMemberRole(teamId, userId, newRole, updatedBy) {
    const team = await Team.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Check permissions
    const hasChurchPermission =
      await hierarchicalAuthService.canUserManageEntity(
        updatedBy,
        team.churchId,
        'update'
      );

    const isTeamLeader = team.leaderId?.toString() === updatedBy._id.toString();

    if (!hasChurchPermission && !isTeamLeader) {
      throw new Error('Insufficient permissions to update member roles');
    }

    // Update user's team assignment
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const assignment = user.teamAssignments.find(
      (a) => a.teamId.toString() === teamId
    );

    if (!assignment) {
      throw new Error('User is not a member of this team');
    }

    // Update role
    assignment.role = newRole;
    await user.save();

    // If promoting to leader, update team leader
    if (newRole === 'leader') {
      team.leaderId = userId;
      await team.save();
    }

    return { team, user };
  }

  /**
   * Search teams
   */
  static async searchTeams(query, user, options = {}) {
    const { churchId, type, includeInactive = false } = options;

    const searchQuery = {};

    // Add text search if query provided
    if (query) {
      searchQuery.$text = { $search: query };
    }

    // Filter by church if specified
    if (churchId) {
      const hasPermission = await hierarchicalAuthService.canUserManageEntity(
        user,
        churchId,
        'read'
      );

      if (!hasPermission) {
        // Return only user's teams
        const userTeams = await Team.getTeamsByUser(user._id);
        return userTeams.filter((team) => {
          if (churchId && team.churchId.toString() !== churchId) {
            return false;
          }
          if (type && team.category !== type) {
            return false;
          }
          if (!includeInactive && !team.isActive) {
            return false;
          }
          return true;
        });
      }

      searchQuery.churchId = churchId;
    } else {
      // Get accessible teams based on user's hierarchy
      const userHierarchy =
        await hierarchicalAuthService.getUserHierarchyPath(user);
      if (userHierarchy) {
        const accessibleTeams = await Team.getAccessibleTeams(userHierarchy);
        searchQuery._id = {
          $in: accessibleTeams.map((team) => team._id),
        };
      }
    }

    // Add filters
    if (type) {
      searchQuery.category = type;
    }

    if (!includeInactive) {
      searchQuery.isActive = true;
    }

    const teams = await Team.find(searchQuery)
      .populate('churchId', 'name')
      .populate('leaderId', 'name email')
      .limit(options.limit || 50)
      .skip(options.skip || 0);

    return teams;
  }
}

module.exports = TeamService;
