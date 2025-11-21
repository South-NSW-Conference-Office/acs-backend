const Organization = require('../models/Organization');
const User = require('../models/User');
const Role = require('../models/Role');
const mongoose = require('mongoose');
const logger = require('./loggerService');
const {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
} = require('../middleware/errorHandler');
const EmailService = require('./emailService');

class OrganizationService {
  // Get organizations with filtering and permission-based access
  static async getOrganizations(
    filters = {},
    userPermissions = {},
    userId = null
  ) {
    try {
      const query = { isActive: true };

      // Apply filters
      if (filters.type) query.type = filters.type;
      if (filters.parentOrganization)
        query.parentOrganization = filters.parentOrganization;
      if (filters.isActive !== undefined) query.isActive = filters.isActive;

      // Apply permission-based filtering
      if (!userPermissions.permissions?.includes('*')) {
        const userOrgIds = await this.getUserAccessibleOrganizations(userId);
        if (userOrgIds.length > 0) {
          query._id = { $in: userOrgIds };
        } else {
          return []; // No accessible organizations
        }
      }

      const organizations = await Organization.find(query)
        .populate('parentOrganization', 'name type')
        .sort({ type: 1, name: 1 })
        .lean();

      return organizations;
    } catch (error) {
      throw new AppError('Failed to fetch organizations', 500);
    }
  }

  // Get single organization by ID
  static async getOrganizationById(id, userPermissions = {}, userId = null) {
    try {
      const organization = await Organization.findById(id)
        .populate('parentOrganization', 'name type')
        .populate('children')
        .lean();

      if (!organization) {
        throw new NotFoundError('Organization');
      }

      // Check access permissions
      const hasAccess = await this.canUserAccessOrganization(
        userId,
        id,
        userPermissions
      );
      if (!hasAccess) {
        throw new AppError(
          'Insufficient permissions to access this organization',
          403
        );
      }

      return organization;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch organization', 500);
    }
  }

  // Create new organization
  static async createOrganization(orgData, createdBy) {
    try {
      // Validate hierarchy rules
      await this.validateOrganizationHierarchy(
        orgData.type,
        orgData.parentOrganization
      );

      // Check for duplicate names
      await this.checkDuplicateName(
        orgData.name,
        orgData.parentOrganization,
        orgData.type
      );

      // Create organization
      const organization = new Organization({
        ...orgData,
        createdBy,
      });

      await organization.save();
      await organization.populate('parentOrganization', 'name type');

      return organization.toObject();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error.code === 11000) {
        throw new ConflictError('Organization with this name already exists');
      }
      throw new AppError('Failed to create organization', 500);
    }
  }

  // Update organization
  static async updateOrganization(
    id,
    updates,
    userPermissions = {},
    userId = null
  ) {
    try {
      const organization = await Organization.findById(id);
      if (!organization) {
        throw new NotFoundError('Organization');
      }

      // Check access permissions
      const hasAccess = await this.canUserAccessOrganization(
        userId,
        id,
        userPermissions
      );
      if (!hasAccess) {
        throw new AppError(
          'Insufficient permissions to update this organization',
          403
        );
      }

      // Validate hierarchy if parent is being changed
      if (updates.parentOrganization !== undefined) {
        await this.validateOrganizationHierarchy(
          updates.type || organization.type,
          updates.parentOrganization,
          id
        );
      }

      // Check for duplicate names if name is being changed
      if (updates.name && updates.name !== organization.name) {
        await this.checkDuplicateName(
          updates.name,
          updates.parentOrganization || organization.parentOrganization,
          updates.type || organization.type,
          id
        );
      }

      Object.assign(organization, updates);
      await organization.save();
      await organization.populate('parentOrganization', 'name type');

      return organization.toObject();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to update organization', 500);
    }
  }

  // Delete (deactivate) organization
  static async deleteOrganization(id, userPermissions = {}, userId = null) {
    try {
      const organization = await Organization.findById(id);
      if (!organization) {
        throw new NotFoundError('Organization');
      }

      // Check access permissions
      const hasAccess = await this.canUserAccessOrganization(
        userId,
        id,
        userPermissions
      );
      if (!hasAccess) {
        throw new AppError(
          'Insufficient permissions to delete this organization',
          403
        );
      }

      // Check for active children
      const children = await Organization.find({
        parentOrganization: id,
        isActive: true,
      });
      if (children.length > 0) {
        throw new ValidationError(
          'Cannot delete organization with active child organizations'
        );
      }

      // Soft delete
      organization.isActive = false;
      await organization.save();

      return { message: 'Organization deleted successfully' };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to delete organization', 500);
    }
  }

  // Get organization hierarchy
  static async getOrganizationHierarchy(id) {
    try {
      const hierarchy = await Organization.getHierarchy(id);
      return hierarchy;
    } catch (error) {
      throw new AppError('Failed to fetch organization hierarchy', 500);
    }
  }

  // Get subordinate organizations
  static async getSubordinateOrganizations(id) {
    try {
      const subordinates = await Organization.getSubordinates(id);
      return subordinates;
    } catch (error) {
      throw new AppError('Failed to fetch subordinate organizations', 500);
    }
  }

  // Helper methods
  static async validateOrganizationHierarchy(type, parentId, excludeId = null) {
    if (type === 'union' && parentId) {
      throw new ValidationError(
        'Union organizations cannot have a parent organization'
      );
    }

    if (parentId) {
      const parent = await Organization.findById(parentId);
      if (!parent) {
        throw new NotFoundError('Parent organization');
      }

      // Check if trying to set self as parent
      if (excludeId && parent._id.toString() === excludeId.toString()) {
        throw new ValidationError('Organization cannot be its own parent');
      }

      // Validate type hierarchy
      if (type === 'conference' && parent.type !== 'union') {
        throw new ValidationError(
          'Conference organizations must have a union parent'
        );
      }

      if (type === 'church' && parent.type !== 'conference') {
        throw new ValidationError(
          'Church organizations must have a conference parent'
        );
      }

      // Check for circular references
      const hierarchy = await Organization.getHierarchy(parentId);
      if (
        excludeId &&
        hierarchy.some((org) => org._id.toString() === excludeId.toString())
      ) {
        throw new ValidationError(
          'Cannot create circular organizational hierarchy'
        );
      }
    } else {
      // No parent specified
      if (type === 'conference') {
        throw new ValidationError(
          'Conference organizations must have a union parent'
        );
      }
      if (type === 'church') {
        throw new ValidationError(
          'Church organizations must have a conference parent'
        );
      }
    }
  }

  static async checkDuplicateName(name, parentId, type, excludeId = null) {
    const query = {
      name: name.trim(),
      type,
      isActive: true,
    };

    if (parentId) {
      query.parentOrganization = parentId;
    } else {
      query.parentOrganization = null;
    }

    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existing = await Organization.findOne(query);
    if (existing) {
      throw new ConflictError(
        'Organization with this name already exists in the same parent'
      );
    }
  }

  static async getUserAccessibleOrganizations(userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId).populate(
        'organizations.organization'
      );

      if (!user) return [];

      let accessibleIds = [];

      // Add user's direct organizations
      accessibleIds = user.organizations
        .filter((org) => org.organization)
        .map((org) => org.organization._id);

      // Add subordinate organizations for each user organization
      for (const userOrg of user.organizations) {
        if (userOrg.organization) {
          const subordinates = await Organization.getSubordinates(
            userOrg.organization._id
          );
          accessibleIds.push(...subordinates.map((sub) => sub._id));
        }
      }

      // Remove duplicates
      return [...new Set(accessibleIds.map((id) => id.toString()))];
    } catch (error) {
      // Error getting user accessible organizations
      return [];
    }
  }

  static async canUserAccessOrganization(userId, orgId, userPermissions) {
    // System admins can access all
    if (userPermissions.permissions?.includes('*')) {
      return true;
    }

    const accessibleIds = await this.getUserAccessibleOrganizations(userId);
    return accessibleIds.includes(orgId.toString());
  }

  // Quick Setup: Create organization with admin user
  static async quickSetup(setupData, currentUser, userPermissions) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        organization: orgData,
        adminUser: userData,
        sendInvitation = true,
      } = setupData;

      // Validate permissions using the authorization service approach
      const permissions = userPermissions?.permissions || [];
      const hasPermission =
        permissions.includes('*') ||
        permissions.includes('organizations.create') ||
        permissions.includes('organizations.*');

      if (!hasPermission) {
        logger.debug('Permission check failed for quick setup:', {
          userPermissions: permissions,
          requiredPermission: 'organizations.create',
          fullUserPermissions: userPermissions,
        });
        throw new AppError(
          'Insufficient permissions to create organizations',
          403
        );
      }

      // Validate hierarchy rules
      await this.validateOrganizationHierarchy(
        orgData.type,
        orgData.parentOrganization
      );

      // Check for duplicate organization name
      await this.checkDuplicateName(
        orgData.name,
        orgData.parentOrganization,
        orgData.type
      );

      // Check for duplicate user email
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        throw new ConflictError('User with this email already exists');
      }

      // Create organization
      const organization = new Organization({
        ...orgData,
        createdBy: currentUser.id,
        setupCompleted: false,
      });
      await organization.save({ session });

      // Get appropriate admin role based on organization type and user input
      let roleName = userData.role;

      // If no role specified, determine based on organization type
      if (!roleName) {
        switch (orgData.type) {
          case 'union':
            roleName = 'union_admin';
            break;
          case 'conference':
            roleName = 'conference_admin';
            break;
          case 'church':
            roleName = 'church_pastor';
            break;
          default:
            roleName = 'church_pastor';
        }
      }

      let adminRole = await Role.findOne({ name: roleName });
      if (!adminRole) {
        // Fallback to appropriate admin role for organization type
        const fallbackRoleName =
          orgData.type === 'union'
            ? 'union_admin'
            : orgData.type === 'conference'
              ? 'conference_admin'
              : 'church_pastor';
        adminRole = await Role.findOne({ name: fallbackRoleName });
        if (!adminRole) {
          throw new ValidationError(
            `Admin role '${roleName}' not found in system`
          );
        }
      }

      // Create admin user
      const user = new User({
        name: `${userData.firstName} ${userData.lastName}`.trim(),
        email: userData.email,
        organizations: [
          {
            organization: organization._id,
            role: adminRole._id,
            assignedAt: new Date(),
            assignedBy: currentUser.id,
          },
        ],
        primaryOrganization: organization._id,
        verified: false,
        passwordSet: false,
        invitedBy: currentUser.id,
        invitedAt: new Date(),
        invitationStatus: 'pending',
      });

      // Generate email verification token
      const crypto = require('crypto');
      user.emailVerificationToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationExpires = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ); // 7 days

      await user.save({ session });

      // Update organization setupCompleted flag
      organization.setupCompleted = true;
      await organization.save({ session });

      await session.commitTransaction();

      // Send invitation email (outside of transaction)
      let invitationSent = false;
      if (sendInvitation) {
        try {
          await EmailService.sendOrganizationSetupInvitation(
            user,
            organization,
            currentUser
          );
          invitationSent = true;
        } catch (emailError) {
          logger.error('Failed to send invitation email:', emailError);
        }
      }

      // Populate necessary fields for response
      await organization.populate('parentOrganization', 'name type');
      await user.populate('organizations.role', 'name displayName');

      return {
        organization: organization.toObject(),
        user: user.toObject(),
        invitationSent,
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  // Bulk create organizations with optional users
  static async bulkCreate(organizations, currentUser, userPermissions) {
    const results = {
      successful: [],
      failed: [],
    };

    for (const orgData of organizations) {
      try {
        if (orgData.includeAdminUser && orgData.adminUser) {
          // Use quick setup for orgs with admin users
          const result = await this.quickSetup(
            {
              organization: orgData.organization,
              adminUser: orgData.adminUser,
              sendInvitation: orgData.sendInvitation ?? true,
            },
            currentUser,
            userPermissions
          );
          results.successful.push({
            organization: result.organization,
            user: result.user,
          });
        } else {
          // Regular organization creation
          const org = await this.createOrganization(
            orgData.organization,
            currentUser.id
          );
          results.successful.push({ organization: org });
        }
      } catch (error) {
        results.failed.push({
          data: orgData,
          error: error.message,
        });
      }
    }

    return results;
  }

  // Get organizations user can create children for
  static async getSuggestedParents(userId, organizationType) {
    try {
      const userOrgIds = await this.getUserAccessibleOrganizations(userId);
      if (userOrgIds.length === 0) return [];

      // Determine valid parent types based on organization type
      let validParentTypes;
      switch (organizationType) {
        case 'conference':
          validParentTypes = ['union'];
          break;
        case 'church':
          validParentTypes = ['conference'];
          break;
        default:
          return []; // Unions don't have parents
      }

      // Find organizations of valid parent types
      const parents = await Organization.find({
        _id: { $in: userOrgIds },
        type: { $in: validParentTypes },
        isActive: true,
      })
        .sort({ name: 1 })
        .lean();

      return parents;
    } catch (error) {
      throw new AppError('Failed to get suggested parent organizations', 500);
    }
  }
}

module.exports = OrganizationService;
