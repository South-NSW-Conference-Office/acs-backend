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
      /^[a-z_]+\.([a-z_]+|\*)(:([a-z_]+|self|own|subordinate|all|assigned|acs_team|acs|public))?$/;
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
      ],
      description: 'Administrative access for conference level',
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
      ],
      description: 'Full access within own church',
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
      ],
      description: 'ACS team leadership role',
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
      ],
      description: 'Basic team member access',
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

module.exports = mongoose.model('Role', roleSchema);
