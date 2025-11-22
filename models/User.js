const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const organizationAssignmentSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
  },
  assignedAt: {
    type: Date,
    default: Date.now,
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  expiresAt: {
    type: Date,
  },
});

const teamAssignmentSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
  },
  role: {
    type: String,
    enum: ['leader', 'member', 'communications'],
    default: 'member',
    required: true,
  },
  assignedAt: {
    type: Date,
    default: Date.now,
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  permissions: [
    {
      type: String,
    },
  ], // Team-specific permission overrides
});

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
      minlength: 6,
    },
    passwordSet: {
      type: Boolean,
      default: false,
    },
    isSuperAdmin: {
      type: Boolean,
      default: false,
    },
    phone: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
      default: 'Australia',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    avatar: {
      url: {
        type: String,
      },
      key: {
        type: String,
      },
    },
    organizations: [organizationAssignmentSchema],
    primaryOrganization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    teamAssignments: [teamAssignmentSchema],
    primaryTeam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    emailVerificationToken: {
      type: String,
    },
    emailVerificationExpires: {
      type: Date,
    },
    invitationStatus: {
      type: String,
      enum: ['pending', 'accepted', 'expired'],
      default: 'pending',
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    invitedAt: {
      type: Date,
      default: Date.now,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for id (compatibility with frontend)
userSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.password;
    return ret;
  },
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    if (this.password) {
      this.passwordSet = true;
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Get user permissions for a specific organization
userSchema.methods.getPermissionsForOrganization = async function (
  organizationId
) {
  const assignment = this.organizations.find(
    (org) => org.organization.toString() === organizationId.toString()
  );

  if (!assignment) {
    return { role: null, permissions: [] };
  }

  await this.populate('organizations.role');
  const role = assignment.role;

  return {
    role: {
      id: role._id,
      name: role.name,
      displayName: role.displayName,
      level: role.level,
    },
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    organization: organizationId,
  };
};

// Get user permissions for a specific team
userSchema.methods.getPermissionsForTeam = async function (teamId) {
  // Check if user is super admin first - avoid importing models here
  const hasSuperAdminRole = this.organizations && this.organizations.some((org) => {
    const roleName = org.role?.name || org.role;
    return roleName === 'super_admin';
  });

  // Check for wildcard permissions across organizations
  let hasWildcardPermissions = false;
  if (this.organizations && this.organizations.length > 0) {
    for (const org of this.organizations) {
      try {
        const orgPermissions = await this.getPermissionsForOrganization(org.organization || org._id);
        if (orgPermissions.permissions.includes('*') || orgPermissions.permissions.includes('all')) {
          hasWildcardPermissions = true;
          break;
        }
      } catch (error) {
        // Continue checking other organizations
      }
    }
  }

  // If user is super admin, grant full access
  if (hasSuperAdminRole || hasWildcardPermissions) {
    return {
      teamRole: 'super_admin',
      orgRole: 'super_admin', 
      permissions: ['*'],
      team: teamId,
      organization: null, // Will be set by calling code if needed
    };
  }

  const assignment = this.teamAssignments.find(
    (team) => team.teamId.toString() === teamId.toString()
  );

  if (!assignment) {
    return { role: null, permissions: [] };
  }

  // Get organization permissions first
  await this.populate({
    path: 'teamAssignments.teamId',
    populate: { path: 'organizationId' },
  });

  const team = assignment.teamId;
  const orgPermissions = await this.getPermissionsForOrganization(
    team.organizationId
  );

  // Combine org permissions with team-specific overrides
  const teamPermissions = [
    ...orgPermissions.permissions,
    ...assignment.permissions,
  ];

  return {
    teamRole: assignment.role,
    orgRole: orgPermissions.role,
    permissions: [...new Set(teamPermissions)], // Remove duplicates
    team: teamId,
    organization: team.organizationId,
  };
};

// Get all teams for user
userSchema.methods.getTeams = async function () {
  await this.populate({
    path: 'teamAssignments.teamId',
    populate: { path: 'organizationId', select: 'name' },
  });

  return this.teamAssignments.map((assignment) => ({
    team: assignment.teamId,
    role: assignment.role,
    assignedAt: assignment.assignedAt,
    permissions: assignment.permissions,
  }));
};

// Check if user has specific team role
userSchema.methods.hasTeamRole = function (teamId, role) {
  const assignment = this.teamAssignments.find(
    (team) => team.teamId.toString() === teamId.toString()
  );

  return assignment && assignment.role === role;
};

// Check if user is team leader for any team
userSchema.methods.isTeamLeader = function () {
  return this.teamAssignments.some(
    (assignment) => assignment.role === 'leader'
  );
};

// Get teams where user is leader
userSchema.methods.getLeadingTeams = async function () {
  const leadingAssignments = this.teamAssignments.filter(
    (assignment) => assignment.role === 'leader'
  );

  if (!leadingAssignments.length) return [];

  const Team = mongoose.model('Team');
  const teamIds = leadingAssignments.map((a) => a.teamId);

  return Team.find({ _id: { $in: teamIds } })
    .populate('organizationId', 'name')
    .lean();
};

module.exports = mongoose.model('User', userSchema);
