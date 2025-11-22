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
      enum: ['union', 'conference', 'church', 'team', 'service'],
      lowercase: true,
    },
    
    // HIERARCHICAL LEVEL NUMBER (0=highest, 4=lowest)
    hierarchyLevel: {
      type: Number,
      required: true,
      min: 0,
      max: 4,
      default: function() {
        const levelMap = { 'union': 0, 'conference': 1, 'church': 2, 'team': 3, 'service': 4 };
        return levelMap[this.level] || 2;
      }
    },
    
    // LEVELS THIS ROLE CAN MANAGE
    canManage: {
      type: [Number],
      default: function() {
        // Each level can manage levels below it
        const manageLevels = [];
        for (let i = this.hierarchyLevel + 1; i <= 4; i++) {
          manageLevels.push(i);
        }
        return manageLevels;
      }
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
        'union_admin',
        'conference_admin',
        'team_leader',
        'team_member',
        'communications',
        'viewer',
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
        enum: ['system', 'union', 'conference', 'church', 'team', 'service'],
        default: 'church',
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

// Static method to create HIERARCHICAL system roles
roleSchema.statics.createSystemRoles = async function () {
  const systemRoles = [
    // LEVEL 0: SUPER ADMIN
    {
      name: 'super_admin',
      displayName: 'Super Administrator',
      level: 'union',
      hierarchyLevel: 0,
      canManage: [1, 2, 3, 4],
      permissions: ['*'], // All permissions
      description: 'Full system access including system administration',
      roleCategory: 'super_admin',
      quotaLimits: {
        maxUsers: 5,
        scope: 'system',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    
    // LEVEL 0: UNION ADMIN (between super_admin and conference)
    {
      name: 'union_admin',
      displayName: 'Union Administrator', 
      level: 'union',
      hierarchyLevel: 0,
      canManage: [1, 2, 3, 4], // All subordinate levels
      permissions: [
        'unions.read:own',
        'unions.update:own',
        'conferences.create:subordinate',
        'conferences.read:subordinate',
        'conferences.update:subordinate', 
        'conferences.delete:subordinate',
        'churches.read:subordinate',
        'churches.manage:subordinate',
        'teams.read:subordinate',
        'teams.manage:subordinate',
        'services.read:subordinate',
        'services.manage:subordinate',
        'users.manage:subordinate',
        'dashboard.view',
        'analytics.read:subordinate',
        'reports.generate:subordinate'
      ],
      description: 'Administrative access for union level operations',
      roleCategory: 'union_admin',
      quotaLimits: {
        maxUsers: 10,
        scope: 'system',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    
    // LEVEL 1: CONFERENCE/REGION  
    {
      name: 'conference_admin',
      displayName: 'Conference Administrator',
      level: 'conference',
      hierarchyLevel: 1,
      canManage: [2, 3, 4], // Churches, teams, services
      permissions: [
        'churches.create:subordinate',
        'churches.read:subordinate', 
        'churches.update:subordinate',
        'churches.delete:subordinate',
        'conferences.read:own',
        'conferences.update:own',
        'teams.read:subordinate',
        'teams.manage:subordinate',
        'services.read:subordinate',
        'services.manage:subordinate',
        'users.manage:subordinate',
        'dashboard.view',
        'analytics.read:subordinate'
      ],
      description: 'Administrative access for conference level',
      roleCategory: 'conference_admin',
      quotaLimits: {
        maxUsers: 20,
        scope: 'conference',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    
    // LEVEL 2: CHURCH
    {
      name: 'church_admin',
      displayName: 'Church Administrator',
      level: 'church',
      hierarchyLevel: 2,
      canManage: [3, 4], // Teams and services only
      permissions: [
        'teams.create:own',
        'teams.read:own',
        'teams.update:own',
        'teams.delete:own',
        'services.read:own',
        'services.manage:own',
        'users.manage:own',
        'dashboard.view'
      ],
      description: 'Full access within own church',
      roleCategory: 'team_leader',
      quotaLimits: {
        maxUsers: 500,
        scope: 'church',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    
    // LEVEL 3: TEAM
    {
      name: 'team_leader',
      displayName: 'Team Leader',
      level: 'team',
      hierarchyLevel: 3,
      canManage: [4], // Services only
      permissions: [
        'services.create:team',
        'services.read:team',
        'services.update:team',
        'services.delete:team',
        'users.read:team',
        'teams.read:own',
        'teams.update:own'
      ],
      description: 'Team leadership with service management',
      roleCategory: 'team_leader',
      quotaLimits: {
        maxUsers: 50,
        scope: 'team',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    
    {
      name: 'team_member',
      displayName: 'Team Member',
      level: 'team',
      hierarchyLevel: 3,
      canManage: [], // Cannot manage other entities
      permissions: [
        'services.read:team',
        'teams.read:own',
        'users.read:team'
      ],
      description: 'Basic team member access',
      roleCategory: 'team_member',
      quotaLimits: {
        maxUsers: 500,
        scope: 'team',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    
    // LEVEL 4: SERVICE (Lowest)
    {
      name: 'service_coordinator',
      displayName: 'Service Coordinator',
      level: 'service',
      hierarchyLevel: 4,
      canManage: [], // Cannot manage other entities
      permissions: [
        'services.read:own',
        'services.update:own'
      ],
      description: 'Service-level coordinator with limited access',
      roleCategory: 'team_member',
      quotaLimits: {
        maxUsers: 100,
        scope: 'service',
        warningThreshold: 0.8,
      },
      isSystem: true,
    },
    
    // VIEWER ROLES
    {
      name: 'church_viewer',
      displayName: 'Church Viewer',
      level: 'church',
      hierarchyLevel: 2,
      canManage: [],
      permissions: ['services.read:public', 'stories.read:public'],
      description: 'Read-only access to public information',
      roleCategory: 'viewer',
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

// NEW: Check if role can manage a specific hierarchy level
roleSchema.methods.canManageLevel = function (targetLevel) {
  return this.canManage.includes(targetLevel);
};

// NEW: Check if role can access entity at specific hierarchy path
roleSchema.methods.canAccessEntity = function (userHierarchyPath, targetHierarchyPath) {
  // Users can only access entities in their subtree
  return targetHierarchyPath.startsWith(userHierarchyPath);
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
      // Using hierarchical system - get organizations in region
      const Union = mongoose.model('Union');
      const Conference = mongoose.model('Conference');  
      const Church = mongoose.model('Church');
      
      let orgIds = [organizationId]; // Start with the given org
      
      // Try to find as union and get all conferences/churches
      const union = await Union.findById(organizationId);
      if (union) {
        const conferences = await Conference.find({ unionId: union._id }).select('_id');
        const churches = await Church.find({ unionId: union._id }).select('_id');
        orgIds.push(...conferences.map(c => c._id), ...churches.map(c => c._id));
      } else {
        // Try as conference and get all churches
        const conference = await Conference.findById(organizationId);
        if (conference) {
          const churches = await Church.find({ conferenceId: conference._id }).select('_id');
          orgIds.push(...churches.map(c => c._id));
        }
      }
      
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
