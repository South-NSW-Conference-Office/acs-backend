const User = require('../models/User');
const Role = require('../models/Role');
// const Organization = require('../models/Organization'); // REMOVED - Using hierarchical models
const Union = require('../models/Union');
const Conference = require('../models/Conference');
const Church = require('../models/Church');
const {
  AppError,
  NotFoundError,
  ConflictError,
} = require('../middleware/errorHandler');
const emailService = require('./emailService');

class UserService {
  // Get users with filtering and pagination
  static async getUsers(
    filters = {},
    pagination = {},
    userPermissions = {},
    requestingUserId = null
  ) {
    try {
      const {
        search,
        organizationId,
        roleId,
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

      // Apply permission-based filtering
      if (!userPermissions.permissions?.includes('*')) {
        const accessibleOrgIds =
          await this.getUserAccessibleOrganizations(requestingUserId);

        if (organizationId) {
          // Check if requesting user can access the specified organization
          if (!accessibleOrgIds.includes(organizationId.toString())) {
            return { users: [], total: 0, pagination: {} };
          }
          query['organizations.organization'] = organizationId;
        } else {
          // Filter to only accessible organizations
          if (accessibleOrgIds.length > 0) {
            query['organizations.organization'] = { $in: accessibleOrgIds };
          } else {
            return { users: [], total: 0, pagination: {} };
          }
        }
      } else if (organizationId) {
        query['organizations.organization'] = organizationId;
      }

      if (roleId) {
        query['organizations.role'] = roleId;
      }

      // Execute query with pagination
      const users = await User.find(query)
        .populate('organizations.organization', 'name type')
        .populate('organizations.role', 'name displayName level')
        .populate('primaryOrganization', 'name type')
        .select('-password')
        .sort({ [sortBy]: sortOrder })
        .limit(limit)
        .skip(skip)
        .lean();

      const total = await User.countDocuments(query);

      // Add computed id field for frontend compatibility
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

  // Get single user by ID
  static async getUserById(id, userPermissions = {}, requestingUserId = null) {
    try {
      const user = await User.findById(id)
        .populate('organizations.organization', 'name type')
        .populate('organizations.role', 'name displayName level permissions')
        .populate('primaryOrganization', 'name type')
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

  // Create new user
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
        organizations = [],
      } = userData;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new ConflictError('User with this email already exists');
      }

      // Validate organization assignments
      const validatedOrganizations =
        await this.validateOrganizationAssignments(organizations);

      // Create user
      const userFields = {
        name,
        email,
        phone,
        address,
        city,
        state,
        country: country || 'Australia',
        verified: process.env.NODE_ENV === 'development', // Auto-verify in development
        organizations: validatedOrganizations.map((org) => ({
          organization: org.organizationId,
          role: org.roleId,
          assignedAt: new Date(),
          assignedBy: createdBy,
        })),
        primaryOrganization:
          validatedOrganizations.length > 0
            ? validatedOrganizations[0].organizationId
            : null,
      };

      // Only add password if provided (for users who need to set it later)
      if (password) {
        userFields.password = password;
      }

      const user = new User(userFields);

      // Generate verification token
      const verificationToken = emailService.generateVerificationToken();
      const expirationTime = emailService.getExpirationTime();

      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpires = expirationTime;

      await user.save();

      // Populate for email details
      await user.populate(
        'organizations.organization organizations.role primaryOrganization'
      );

      // Prepare user details for email
      const userWithDetails = {
        ...user.toObject(),
        organizationName: user.organizations[0]?.organization?.name,
        roleName: user.organizations[0]?.role?.displayName,
      };

      // Send verification email
      try {
        await emailService.sendVerificationEmail(
          userWithDetails,
          verificationToken
        );
      } catch (emailError) {
        // Failed to send verification email
        // Don't fail user creation if email fails
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

  // Assign role to user
  static async assignRole(userId, organizationId, roleName, assignedBy) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User');
      }

      // Find organization (try all hierarchical types)
      let organization = await Union.findById(organizationId);
      if (!organization) {
        organization = await Conference.findById(organizationId);
      }
      if (!organization) {
        organization = await Church.findById(organizationId);
      }
      if (!organization) {
        throw new NotFoundError('Organization');
      }

      const role = await Role.findOne({ name: roleName, isActive: true });
      if (!role) {
        throw new NotFoundError('Role');
      }

      // Check if user already has a role in this organization
      const existingIndex = user.organizations.findIndex(
        (org) => org.organization.toString() === organizationId
      );

      if (existingIndex !== -1) {
        // Update existing assignment
        user.organizations[existingIndex] = {
          organization: organizationId,
          role: role._id,
          assignedAt: new Date(),
          assignedBy,
        };
      } else {
        // Add new assignment
        user.organizations.push({
          organization: organizationId,
          role: role._id,
          assignedAt: new Date(),
          assignedBy,
        });
      }

      // Set as primary organization if user doesn't have one
      if (!user.primaryOrganization) {
        user.primaryOrganization = organizationId;
      }

      await user.save();
      await user.populate('organizations.organization organizations.role');

      return user.organizations;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to assign role', 500);
    }
  }

  // Revoke user role
  static async revokeRole(userId, organizationId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User');
      }

      // Remove organization assignment
      user.organizations = user.organizations.filter(
        (org) => org.organization.toString() !== organizationId
      );

      // Update primary organization if it was removed
      if (user.primaryOrganization?.toString() === organizationId) {
        user.primaryOrganization =
          user.organizations.length > 0
            ? user.organizations[0].organization
            : null;
      }

      await user.save();
      return user.organizations;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to revoke role', 500);
    }
  }

  // Get user permissions for organization
  static async getUserPermissions(userId, organizationId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new NotFoundError('User');
      }

      return await user.getPermissionsForOrganization(organizationId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch user permissions', 500);
    }
  }

  // Helper methods
  static async validateOrganizationAssignments(assignments) {
    const validated = [];

    for (const assignment of assignments) {
      // Find organization (try all hierarchical types)
      let org = await Union.findById(assignment.organizationId);
      if (!org) {
        org = await Conference.findById(assignment.organizationId);
      }
      if (!org) {
        org = await Church.findById(assignment.organizationId);
      }
      if (!org) {
        throw new NotFoundError(
          `Organization with ID ${assignment.organizationId}`
        );
      }

      const role = await Role.findOne({
        name: assignment.roleName,
        isActive: true,
      });
      if (!role) {
        throw new NotFoundError(`Role ${assignment.roleName}`);
      }

      validated.push({
        organizationId: assignment.organizationId,
        roleId: role._id,
      });
    }

    return validated;
  }

  static async getUserAccessibleOrganizations(userId) {
    try {
      // Legacy method - now returns empty array since organizations are replaced by hierarchical system
      // Use AuthorizationService.getUserUnionAccess, getUserConferenceAccess, or getUserChurchAccess instead
      console.warn('getUserAccessibleOrganizations is deprecated. Use hierarchical access methods instead.');
      return [];
    } catch (error) {
      return [];
    }
  }

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

    // Check if users share any organizations
    const requestingUserOrgs =
      await this.getUserAccessibleOrganizations(requestingUserId);
    const targetUserOrgs =
      await this.getUserAccessibleOrganizations(targetUserId);

    return requestingUserOrgs.some((orgId) => targetUserOrgs.includes(orgId));
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
