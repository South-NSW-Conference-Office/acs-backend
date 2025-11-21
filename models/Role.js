const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    level: {
      type: String,
      required: true,
      enum: ['union', 'conference', 'church'],
      lowercase: true,
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    description: {
      type: String,
      trim: true,
    },
    roleCategory: {
      type: String,
      enum: [
        'super_admin',
        'conference_admin',
        'team_leader',
        'team_member',
        'communications',
      ],
      required: false,
    },
    quotaLimits: {
      maxUsers: {
        type: Number,
        default: null,
      },
      scope: {
        type: String,
        enum: ['system', 'organization', 'region', 'team'],
        default: 'organization',
      },
      warningThreshold: {
        type: Number,
        default: 0.8,
        min: 0,
        max: 1,
      },
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware to validate permissions format
roleSchema.pre('save', function (next) {
  if (this.permissions) {
    const validPermissionPattern =
      /^[a-z_]+\.([a-z_]+|\*)(:([a-z_]+|self|own|subordinate|all|assigned|acs_team|acs|public|team|team_subordinate|service|region))?$/;
    const invalidPermissions = this.permissions.filter((perm) => {
      return perm !== '*' && !validPermissionPattern.test(perm);
    });

    if (invalidPermissions.length > 0) {
      return next(
        new Error(`Invalid permission format: ${invalidPermissions.join(', ')}`)
      );
    }
  }
  next();
});

// Static method to create system roles
roleSchema.statics.createSystemRoles = async function () {
  const systemRoles = [
    {
      name: 'super_admin',
      displayName: 'Super Administrator',
      level: 'union',
      permissions: ['*'],
      description: 'Full system access including system administration',
      roleCategory: 'super_admin',
      quotaLimits: {
        maxUsers: 5,
        scope: 'system',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    {
      name: 'union_admin',
      displayName: 'Union Administrator',
      level: 'union',
      permissions: [
        'users.*',
        'organizations.*',
        'roles.*',
        'services.*',
        'stories.*',
        'dashboard.view',
        'analytics.read',
        'analytics.export',
      ],
      description:
        'Administrative access for union level without system permissions',
      roleCategory: 'conference_admin',
      quotaLimits: {
        maxUsers: 10,
        scope: 'region',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    {
      name: 'conference_admin',
      displayName: 'Conference Administrator',
      level: 'conference',
      permissions: [
        'organizations.read:subordinate',
        'organizations.create:subordinate',
        'organizations.update:subordinate',
        'users.read:subordinate',
        'users.create:subordinate',
        'users.update:subordinate',
        'users.assign_role:subordinate',
        'roles.read',
        'services.create:subordinate',
        'services.read:subordinate',
        'services.update:subordinate',
        'services.delete:subordinate',
        'services.manage:subordinate',
        'services.publish:subordinate',
        'services.archive:subordinate',
        'stories.create:subordinate',
        'stories.read:subordinate',
        'stories.update:subordinate',
        'stories.delete:subordinate',
        'stories.manage:subordinate',
        'dashboard.view',
        'analytics.read:subordinate',
        'teams.*:region',
      ],
      description: 'Administrative access for conference level',
      roleCategory: 'conference_admin',
      quotaLimits: {
        maxUsers: 20,
        scope: 'region',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    {
      name: 'church_pastor',
      displayName: 'Church Pastor',
      level: 'church',
      permissions: [
        'organizations.read:own',
        'organizations.update:own',
        'users.read:own',
        'users.create:own',
        'users.update:own',
        'users.assign_role:own',
        'roles.read',
        'services.create:own',
        'services.read:own',
        'services.update:own',
        'services.delete:own',
        'services.manage:own',
        'services.publish:own',
        'services.archive:own',
        'stories.create:own',
        'stories.read:own',
        'stories.update:own',
        'stories.delete:own',
        'stories.manage:own',
        'dashboard.view',
        'analytics.read:own',
        'teams.*:own',
      ],
      description: 'Full access within own church',
      roleCategory: 'team_leader',
      quotaLimits: {
        maxUsers: 500,
        scope: 'organization',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    {
      name: 'church_acs_leader',
      displayName: 'Church ACS Leader',
      level: 'church',
      permissions: [
        'users.read:acs_team',
        'users.create:acs_team',
        'users.update:acs_team',
        'services.create:acs',
        'services.read:acs',
        'services.update:acs',
        'services.manage:acs',
        'services.publish:acs',
        'stories.create:acs',
        'stories.read:acs',
        'stories.update:acs',
        'stories.manage:acs',
        'dashboard.view',
        'teams.read:team',
        'teams.update:team',
        'teams.manage_members:team',
      ],
      description: 'ACS team leadership role',
      roleCategory: 'team_member',
      quotaLimits: {
        maxUsers: 900,
        scope: 'organization',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    {
      name: 'church_team_member',
      displayName: 'Church Team Member',
      level: 'church',
      permissions: [
        'users.read:acs_team',
        'services.read:acs',
        'stories.read:acs',
        'teams.read:team',
      ],
      description: 'Basic team member access',
      roleCategory: 'team_member',
      quotaLimits: {
        maxUsers: 900,
        scope: 'organization',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    {
      name: 'church_communications',
      displayName: 'Church Communications',
      level: 'church',
      permissions: [
        'users.read:team',
        'services.read:team',
        'stories.create:team',
        'stories.read:team',
        'stories.update:team',
        'stories.manage:team',
        'messages.create:team',
        'messages.read:team',
        'messages.update:team',
        'messages.toggle:team',
        'teams.read:team',
        'dashboard.view',
      ],
      description: 'Communications team member with message management',
      roleCategory: 'communications',
      quotaLimits: {
        maxUsers: 900,
        scope: 'organization',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    {
      name: 'church_viewer',
      displayName: 'Church Viewer',
      level: 'church',
      permissions: ['services.read:public', 'stories.read:public'],
      description: 'Read-only access to public information',
      isSystem: true,
    },
  ];

  for (const roleData of systemRoles) {
    await this.findOneAndUpdate({ name: roleData.name }, roleData, {
      upsert: true,
      new: true,
    });
  }
};

// Method to check if user has permission
roleSchema.methods.hasPermission = function (requiredPermission) {
  if (
    !this.permissions ||
    !Array.isArray(this.permissions) ||
    this.permissions.length === 0
  ) {
    return false;
  }

  // Check for wildcard permissions
  if (this.permissions.includes('*') || this.permissions.includes('all')) {
    return true;
  }

  // Check exact match
  if (this.permissions.includes(requiredPermission)) {
    return true;
  }

  // Check resource wildcard (e.g., 'users.*' matches 'users.create')
  const [resource, action] = requiredPermission.split('.');
  if (this.permissions.includes(`${resource}.*`)) {
    return true;
  }

  // Check for scoped permissions (e.g., 'organizations.create:subordinate' matches 'organizations.create')
  const matchesScoped = this.permissions.some((permission) => {
    const [permResource, permActionWithScope] = permission.split('.');
    if (!permActionWithScope || !permActionWithScope.includes(':')) {
      return false;
    }

    const [permAction] = permActionWithScope.split(':');
    return permResource === resource && permAction === action;
  });

  return matchesScoped;
};

// Method to check if role has reached user quota
roleSchema.methods.checkQuota = async function (organizationId = null) {
  if (!this.quotaLimits || !this.quotaLimits.maxUsers) {
    return { allowed: true, current: 0, max: null };
  }

  const User = mongoose.model('User');
  let query = {};

  // Build query based on quota scope
  switch (this.quotaLimits.scope) {
    case 'system':
      // Count all users with this role system-wide
      query = { 'organizations.role': this._id };
      break;

    case 'region': {
      // Count users with this role in the same region/conference
      if (!organizationId) {
        throw new Error(
          'Organization ID required for region scope quota check'
        );
      }
      const Organization = mongoose.model('Organization');
      const org = await Organization.findById(organizationId);
      const regionOrgs = await Organization.find({
        parent: org.parent || org._id,
      }).select('_id');
      const orgIds = regionOrgs.map((o) => o._id);
      query = {
        'organizations.role': this._id,
        'organizations.organization': { $in: orgIds },
      };
      break;
    }

    case 'organization':
      // Count users with this role in specific organization
      if (!organizationId) {
        throw new Error(
          'Organization ID required for organization scope quota check'
        );
      }
      query = {
        'organizations.role': this._id,
        'organizations.organization': organizationId,
      };
      break;

    case 'team':
      // This would need team context - for now treat as organization
      if (!organizationId) {
        throw new Error('Organization ID required for team scope quota check');
      }
      query = {
        'organizations.role': this._id,
        'organizations.organization': organizationId,
      };
      break;
  }

  const currentCount = await User.countDocuments(query);
  const allowed = currentCount < this.quotaLimits.maxUsers;
  const nearLimit =
    currentCount >=
    this.quotaLimits.maxUsers * this.quotaLimits.warningThreshold;

  return {
    allowed,
    current: currentCount,
    max: this.quotaLimits.maxUsers,
    remaining: Math.max(0, this.quotaLimits.maxUsers - currentCount),
    nearLimit,
    percentage: (currentCount / this.quotaLimits.maxUsers) * 100,
  };
};

// Static method to get quota status for all roles
roleSchema.statics.getQuotaStatus = async function (organizationId = null) {
  const roles = await this.find({
    isActive: true,
    'quotaLimits.maxUsers': { $ne: null },
  });
  const quotaStatuses = [];

  for (const role of roles) {
    try {
      const status = await role.checkQuota(organizationId);
      quotaStatuses.push({
        role: {
          id: role._id,
          name: role.name,
          displayName: role.displayName,
          category: role.roleCategory,
        },
        quota: status,
      });
    } catch (error) {
      // Skip roles that can't be checked in this context
      continue;
    }
  }

  return quotaStatuses;
};

module.exports = mongoose.model('Role', roleSchema);
