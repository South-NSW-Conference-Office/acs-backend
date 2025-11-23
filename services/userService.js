const User = require('../models/User');
const Team = require('../models/Team');
const Church = require('../models/Church');
const Conference = require('../models/Conference');
const Union = require('../models/Union');
const UniversalAssignmentService = require('./universalAssignmentService');
const {
  AppError,
  NotFoundError,
  ConflictError,
} = require('../middleware/errorHandler');
const emailService = require('./emailService');

class UserService {
  // Get users with filtering and pagination - TEAM-CENTRIC
  static async getUsers(
    filters = {},
    pagination = {},
    userPermissions = {},
    requestingUserId = null
  ) {
    try {
      const {
        search,
        teamId,
        churchId,
        role,
        isActive = true,
        verified,
      } = filters;

      const {
        limit = 50,
        skip = 0,
        sortBy = 'createdAt',
        sortOrder = -1,
      } = pagination;

      // Build query
      const query = { isActive };

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }

      if (verified !== undefined) {
        query.verified = verified;
      }

      // Apply team-based filtering
      if (!userPermissions.permissions?.includes('*') && requestingUserId) {
        const accessibleTeams = await this.getUserAccessibleTeams(requestingUserId);

        if (teamId) {
          // Check if requesting user can access the specified team
          if (!accessibleTeams.includes(teamId.toString())) {
            return { users: [], total: 0, pagination: {} };
          }
          query['teamAssignments.teamId'] = teamId;
        } else {
          // Filter to only users in accessible teams
          if (accessibleTeams.length > 0) {
            query['teamAssignments.teamId'] = { $in: accessibleTeams };
          } else {
            return { users: [], total: 0, pagination: {} };
          }
        }
      } else if (teamId) {
        query['teamAssignments.teamId'] = teamId;
      }

      // Filter by church (through team assignments)
      if (churchId) {
        const churchTeams = await Team.find({ churchId, isActive: true }).select('_id');
        const churchTeamIds = churchTeams.map(team => team._id);
        query['teamAssignments.teamId'] = { $in: churchTeamIds };
      }

      // Filter by team role
      if (role) {
        query['teamAssignments.role'] = role;
      }

      // Execute query with pagination
      const users = await User.find(query)
        .populate({
          path: 'teamAssignments.teamId',
          populate: { path: 'churchId', select: 'name' }
        })
        .populate('primaryTeam', 'name')
        .select('-password')
        .sort({ [sortBy]: sortOrder })
        .limit(limit)
        .skip(skip)
        .lean();

      const total = await User.countDocuments(query);

      // Add computed id field and organizational context for frontend compatibility
      const usersWithId = users.map((user) => ({
        ...user,
        id: user._id.toString(),
      }));

      return {
        users: usersWithId,
        total,
        pagination: {
          limit,
          skip,
          hasMore: skip + limit < total,
          totalPages: Math.ceil(total / limit),
          currentPage: Math.floor(skip / limit) + 1,
        },
      };
    } catch (error) {
      throw new AppError('Failed to fetch users', 500);
    }
  }

  // Get single user by ID - TEAM-CENTRIC
  static async getUserById(id, userPermissions = {}, requestingUserId = null) {
    try {
      const user = await User.findById(id)
        .populate({
          path: 'teamAssignments.teamId',
          populate: {
            path: 'churchId',
            populate: {
              path: 'conferenceId',
              populate: { path: 'unionId' }
            }
          }
        })
        .populate('primaryTeam', 'name category tags')
        .select('-password')
        .lean();

      if (!user) {
        throw new NotFoundError('User');
      }

      // Check if requesting user can access this user
      const canAccess = await this.canUserAccessUser(
        requestingUserId,
        id,
        userPermissions
      );
      if (!canAccess) {
        throw new AppError('Insufficient permissions to access this user', 403);
      }

      return {
        ...user,
        id: user._id.toString(),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch user', 500);
    }
  }

  // Create new user - TEAM-CENTRIC (preserves invitation system)
  static async createUser(userData, createdBy) {
    try {
      const {
        name,
        email,
        password,
        phone,
        address,
        city,
        state,
        country,
        teamAssignments = [], // New: teams instead of organizations
        sendInvitation = true,
      } = userData;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new ConflictError('User with this email already exists');
      }

      // Validate team assignments
      const validatedTeamAssignments = [];
      for (const teamAssignment of teamAssignments) {
        const team = await Team.findById(teamAssignment.teamId);
        if (!team) {
          throw new NotFoundError(`Team with ID ${teamAssignment.teamId}`);
        }
        if (!team.isActive) {
          throw new AppError(`Cannot assign user to inactive team: ${team.name}`, 400);
        }
        
        validatedTeamAssignments.push({
          teamId: teamAssignment.teamId,
          role: teamAssignment.role || 'member',
          status: 'active',
          joinedAt: new Date(),
          invitedBy: createdBy,
          permissions: teamAssignment.permissions || []
        });
      }

      // Create user with team assignments
      const userFields = {
        name,
        email,
        phone,
        address,
        city,
        state,
        country: country || 'Australia',
        verified: process.env.NODE_ENV === 'development', // Auto-verify in development
        teamAssignments: validatedTeamAssignments,
        primaryTeam: validatedTeamAssignments.length > 0 
          ? validatedTeamAssignments[0].teamId 
          : null,
      };

      // Only add password if provided (for users who need to set it later)
      if (password) {
        userFields.password = password;
      }

      const user = new User(userFields);

      // Generate verification token for invitation system
      const verificationToken = emailService.generateVerificationToken();
      const expirationTime = emailService.getExpirationTime();

      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpires = expirationTime;

      await user.save();

      // Update team member counts
      for (const assignment of validatedTeamAssignments) {
        await UniversalAssignmentService.updateTeamMemberCount(assignment.teamId);
      }

      // Populate team details for email
      await user.populate({
        path: 'teamAssignments.teamId',
        populate: { path: 'churchId', select: 'name' }
      });

      // Prepare user details for email (preserving existing invitation system)
      const primaryTeam = user.teamAssignments[0]?.teamId;
      const userWithDetails = {
        ...user.toObject(),
        organizationName: primaryTeam?.churchId?.name || 'Adventist Community Services',
        roleName: user.teamAssignments[0]?.role || 'Team Member',
        teamName: primaryTeam?.name,
      };

      // Send verification email (preserving existing invitation system)
      if (sendInvitation) {
        try {
          await emailService.sendVerificationEmail(
            userWithDetails,
            verificationToken
          );
        } catch (emailError) {
          // Failed to send verification email
          // Don't fail user creation if email fails
          console.error('Failed to send verification email:', emailError);
        }
      }

      const userObj = user.toObject();
      delete userObj.password;

      return {
        ...userObj,
        id: userObj._id.toString(),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error.code === 11000) {
        throw new ConflictError('User with this email already exists');
      }
      throw new AppError('Failed to create user', 500);
    }
  }

  // Update user
  static async updateUser(
    id,
    updates,
    userPermissions = {},
    requestingUserId = null
  ) {
    try {
      const user = await User.findById(id);
      if (!user) {
        throw new NotFoundError('User');
      }

      // Check permissions
      const canAccess = await this.canUserAccessUser(
        requestingUserId,
        id,
        userPermissions
      );
      if (!canAccess) {
        throw new AppError('Insufficient permissions to update this user', 403);
      }

      // Validate email uniqueness if changed
      if (updates.email && updates.email !== user.email) {
        const existingUser = await User.findOne({ email: updates.email });
        if (existingUser) {
          throw new ConflictError('User with this email already exists');
        }
      }

      // Remove sensitive fields from updates
      const { ...safeUpdates } = updates;
      delete safeUpdates.password;
      delete safeUpdates.organizations;

      // Update user
      Object.assign(user, safeUpdates);
      await user.save();

      await user.populate(
        'organizations.organization organizations.role primaryOrganization'
      );

      const userObj = user.toObject();
      delete userObj.password;

      return {
        ...userObj,
        id: userObj._id.toString(),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to update user', 500);
    }
  }

  // TEAM ASSIGNMENT METHODS - Replacing organizational assignment

  // Assign user to team
  static async assignUserToTeam(userId, teamId, role = 'member', assignedBy = null) {
    try {
      return await UniversalAssignmentService.assignUserToTeam(userId, teamId, role, assignedBy);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to assign user to team', 500);
    }
  }

  // Remove user from team
  static async removeUserFromTeam(userId, teamId) {
    try {
      return await UniversalAssignmentService.removeUserFromTeam(userId, teamId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to remove user from team', 500);
    }
  }

  // Get user team assignments with organizational context
  static async getUserAssignments(userId) {
    try {
      return await UniversalAssignmentService.getUserAssignments(userId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch user assignments', 500);
    }
  }

  // Get teams accessible to a user
  static async getUserAccessibleTeams(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User');
      }

      // Super admins can access all teams
      if (user.isSuperAdmin) {
        const allTeams = await Team.find({ isActive: true }).select('_id');
        return allTeams.map(team => team._id.toString());
      }

      // Get user's organizational scope through team memberships
      const scope = await user.getOrganizationalScope();
      
      // Find teams within user's accessible churches
      if (scope.churches.length > 0) {
        const accessibleTeams = await Team.find({ 
          churchId: { $in: scope.churches },
          isActive: true 
        }).select('_id');
        
        return accessibleTeams.map(team => team._id.toString());
      }

      return [];
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch accessible teams', 500);
    }
  }

  // Helper methods - TEAM-CENTRIC

  static async canUserAccessUser(
    requestingUserId,
    targetUserId,
    userPermissions
  ) {
    // System admins can access all users
    if (userPermissions.permissions?.includes('*')) {
      return true;
    }

    // Users can access themselves
    if (requestingUserId === targetUserId) {
      return true;
    }

    if (!requestingUserId) {
      return false;
    }

    try {
      // Get both users
      const requestingUser = await User.findById(requestingUserId);
      const targetUser = await User.findById(targetUserId);

      if (!requestingUser || !targetUser) {
        return false;
      }

      // Super admins can access all users
      if (requestingUser.isSuperAdmin) {
        return true;
      }

      // Check if users share organizational scope through team memberships
      const requestingUserScope = await requestingUser.getOrganizationalScope();
      const targetUserScope = await targetUser.getOrganizationalScope();

      // Check for shared churches
      const sharedChurches = requestingUserScope.churches.filter(
        churchId => targetUserScope.churches.includes(churchId)
      );

      if (sharedChurches.length > 0) {
        return true;
      }

      // Check for shared conferences
      const sharedConferences = requestingUserScope.conferences.filter(
        conferenceId => targetUserScope.conferences.includes(conferenceId)
      );

      if (sharedConferences.length > 0) {
        return true;
      }

      // Check for shared unions
      const sharedUnions = requestingUserScope.unions.filter(
        unionId => targetUserScope.unions.includes(unionId)
      );

      return sharedUnions.length > 0;

    } catch (error) {
      console.error('Error checking user access:', error);
      return false;
    }
  }

  static async sendWelcomeEmail() {
    try {
      // Implementation would depend on your email service
      // await emailService.sendWelcomeEmail(email, name);
    } catch (error) {
      // Failed to send welcome email
      // Don't throw error - user creation should still succeed
    }
  }
}

module.exports = UserService;
