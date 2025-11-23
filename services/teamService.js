const Team = require('../models/Team');
const User = require('../models/User');
const authorizationService = require('./authorizationService');

class TeamService {
  /**
   * Create a new team
   */
  static async createTeam(data, createdBy) {
    const { organizationId, leaderId, name, type, description, maxMembers } =
      data;

    // Validate organization exists and user has permission
    const hasPermission = await authorizationService.validateOrganizationAccess(
      createdBy,
      organizationId
    );

    if (!hasPermission) {
      throw new Error(
        'Insufficient permissions to create team in this organization'
      );
    }

    // Validate leader if specified
    if (leaderId) {
      const leader = await User.findById(leaderId);
      if (!leader) {
        throw new Error('Leader not found');
      }

      // Check if leader belongs to the organization
      const belongsToOrg = leader.organizations.some(
        (org) => org.organization.toString() === organizationId.toString()
      );

      if (!belongsToOrg) {
        throw new Error('Leader must belong to the organization');
      }
    }

    // Create team
    const team = await Team.createTeam({
      name,
      organizationId,
      type: type || 'acs',
      leaderId,
      description,
      maxMembers: maxMembers || 50,
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
    const hasPermission = await authorizationService.validateOrganizationAccess(
      updatedBy,
      team.organizationId
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
      'maxMembers',
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

      const belongsToOrg = leader.organizations.some(
        (org) => org.organization.toString() === team.organizationId.toString()
      );

      if (!belongsToOrg) {
        throw new Error('New leader must belong to the organization');
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

    // Check permissions - team leader or org admin can add members
    const hasOrgPermission =
      await authorizationService.validateOrganizationAccess(
        addedBy,
        team.organizationId
      );

    const isTeamLeader = team.leaderId?.toString() === addedBy._id.toString();

    if (!hasOrgPermission && !isTeamLeader) {
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
    const hasOrgPermission =
      await authorizationService.validateOrganizationAccess(
        removedBy,
        team.organizationId
      );

    const isTeamLeader = team.leaderId?.toString() === removedBy._id.toString();
    const isSelfRemoval = userId === removedBy._id.toString();

    if (!hasOrgPermission && !isTeamLeader && !isSelfRemoval) {
      throw new Error(
        'Insufficient permissions to remove members from this team'
      );
    }

    // Prevent removing team leader unless by org admin
    if (team.leaderId?.toString() === userId && !hasOrgPermission) {
      throw new Error(
        'Cannot remove team leader without organization admin permissions'
      );
    }

    // Remove member
    const user = await team.removeMember(userId);

    return { team, user };
  }

  /**
   * Get teams for organization
   */
  static async getOrganizationTeams(organizationId, user, options = {}) {
    // Check if user can view teams in this organization
    const hasPermission = await authorizationService.validateOrganizationAccess(
      user,
      organizationId
    );

    if (!hasPermission) {
      // Check if user is member of any team in this org
      const userTeams = await Team.getTeamsByUser(user._id);

      const orgTeams = userTeams.filter(
        (team) => team.organizationId.toString() === organizationId.toString()
      );

      if (orgTeams.length === 0) {
        throw new Error('No permission to view teams in this organization');
      }

      // Return only user's teams
      return orgTeams;
    }

    // Return all teams for organization
    const allTeams = await Team.getTeamsByOrganization(organizationId, options);

    return allTeams;
  }

  /**
   * Get team details
   */
  static async getTeamDetails(teamId, user) {
    const team = await Team.findById(teamId)
      .populate('organizationId', 'name type')
      .populate('leaderId', 'name email avatar')
      .populate('createdBy', 'name email')
      .populate('serviceIds', 'name');

    if (!team) {
      throw new Error('Team not found');
    }

    // Check permissions
    const hasOrgPermission =
      await authorizationService.validateOrganizationAccess(
        user,
        team.organizationId._id
      );

    // Check if user is team member
    const isMember = user.teamAssignments?.some(
      (assignment) => assignment.teamId.toString() === teamId
    );

    if (!hasOrgPermission && !isMember) {
      throw new Error('No permission to view this team');
    }

    // Get members if authorized
    let members = [];
    if (hasOrgPermission || isMember) {
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
    const hasOrgPermission =
      await authorizationService.validateOrganizationAccess(
        updatedBy,
        team.organizationId
      );

    const isTeamLeader = team.leaderId?.toString() === updatedBy._id.toString();

    if (!hasOrgPermission && !isTeamLeader) {
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
    const { organizationId, type, includeInactive = false } = options;

    const searchQuery = {};

    // Add text search if query provided
    if (query) {
      searchQuery.$text = { $search: query };
    }

    // Filter by organization if specified
    if (organizationId) {
      const hasPermission =
        await authorizationService.validateOrganizationAccess(
          user,
          organizationId
        );

      if (!hasPermission) {
        // Return only user's teams
        const userTeams = await Team.getTeamsByUser(user._id);
        return userTeams.filter((team) => {
          if (
            organizationId &&
            team.organizationId.toString() !== organizationId
          ) {
            return false;
          }
          if (type && team.type !== type) {
            return false;
          }
          if (!includeInactive && !team.isActive) {
            return false;
          }
          return true;
        });
      }

      searchQuery.organizationId = organizationId;
    } else {
      // Get all organizations user can access
      const accessibleOrgs =
        await authorizationService.getAccessibleOrganizations(
          user,
          'teams.read'
        );

      searchQuery.organizationId = {
        $in: accessibleOrgs.map((org) => org._id),
      };
    }

    // Add filters
    if (type) {
      searchQuery.type = type;
    }

    if (!includeInactive) {
      searchQuery.isActive = true;
    }

    const teams = await Team.find(searchQuery)
      .populate('organizationId', 'name')
      .populate('leaderId', 'name email')
      .limit(options.limit || 50)
      .skip(options.skip || 0);

    return teams;
  }

  /**
   * Get team statistics
   */
  static async getTeamStatistics(teamId, user) {
    const team = await Team.findById(teamId);
    if (!team) {
      throw new Error('Team not found');
    }

    // Check permissions
    const hasPermission = await authorizationService.validateOrganizationAccess(
      user,
      team.organizationId
    );

    const isTeamLeader = team.leaderId?.toString() === user._id.toString();
    const isMember = user.teamAssignments?.some(
      (a) => a.teamId.toString() === teamId
    );

    if (!hasPermission && !isTeamLeader && !isMember) {
      throw new Error('No permission to view team statistics');
    }

    // Get member statistics
    const members = await User.find({
      'teamAssignments.teamId': teamId,
    }).select('teamAssignments');

    const roleCount = {
      leader: 0,
      member: 0,
      communications: 0,
    };

    members.forEach((member) => {
      const assignment = member.teamAssignments.find(
        (a) => a.teamId.toString() === teamId
      );
      if (assignment) {
        roleCount[assignment.role]++;
      }
    });

    // Get service statistics if applicable
    const Service = require('../models/Service');
    const serviceCount = await Service.countDocuments({
      _id: { $in: team.serviceIds },
    });

    return {
      teamId: team._id,
      name: team.name,
      memberCount: team.memberCount,
      maxMembers: team.maxMembers,
      capacity: (team.memberCount / team.maxMembers) * 100,
      roleDistribution: roleCount,
      serviceCount,
      isActive: team.isActive,
      createdAt: team.createdAt,
    };
  }
}

module.exports = TeamService;
