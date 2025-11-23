const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// organizationAssignmentSchema REMOVED - Using hierarchical assignments (unionAssignments, conferenceAssignments, churchAssignments)

const unionAssignmentSchema = new mongoose.Schema({
  union: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Union',
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

const conferenceAssignmentSchema = new mongoose.Schema({
  conference: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conference',
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

const churchAssignmentSchema = new mongoose.Schema({
  church: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Church',
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
    // organizations: [organizationAssignmentSchema], // REMOVED - Using hierarchical assignments
    // primaryOrganization REMOVED - Using hierarchical structure
    unionAssignments: {
      type: [unionAssignmentSchema],
      default: [],
    },
    conferenceAssignments: {
      type: [conferenceAssignmentSchema],
      default: [],
    },
    churchAssignments: {
      type: [churchAssignmentSchema],
      default: [],
    },
    teamAssignments: {
      type: [teamAssignmentSchema],
      default: [],
    },
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

// getPermissionsForOrganization REMOVED - Using hierarchical permission methods (getPermissionsForUnion, getPermissionsForConference, getPermissionsForChurch)

// Get user permissions for a specific union
userSchema.methods.getPermissionsForUnion = async function (unionId) {
  if (!this.unionAssignments || !Array.isArray(this.unionAssignments)) {
    return { role: null, permissions: [] };
  }
  
  const assignment = this.unionAssignments.find(
    (assignment) => assignment.union.toString() === unionId.toString()
  );

  if (!assignment) {
    return { role: null, permissions: [] };
  }

  await this.populate('unionAssignments.role');
  const role = assignment.role;

  return {
    role: {
      id: role._id,
      name: role.name,
      displayName: role.displayName,
      level: role.level,
    },
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    union: unionId,
  };
};

// Get user permissions for a specific conference
userSchema.methods.getPermissionsForConference = async function (conferenceId) {
  if (!this.conferenceAssignments || !Array.isArray(this.conferenceAssignments)) {
    return { role: null, permissions: [] };
  }
  
  const assignment = this.conferenceAssignments.find(
    (assignment) => assignment.conference.toString() === conferenceId.toString()
  );

  if (!assignment) {
    return { role: null, permissions: [] };
  }

  await this.populate('conferenceAssignments.role');
  const role = assignment.role;

  return {
    role: {
      id: role._id,
      name: role.name,
      displayName: role.displayName,
      level: role.level,
    },
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    conference: conferenceId,
  };
};

// Get user permissions for a specific church
userSchema.methods.getPermissionsForChurch = async function (churchId) {
  if (!this.churchAssignments || !Array.isArray(this.churchAssignments)) {
    return { role: null, permissions: [] };
  }
  
  const assignment = this.churchAssignments.find(
    (assignment) => assignment.church.toString() === churchId.toString()
  );

  if (!assignment) {
    return { role: null, permissions: [] };
  }

  await this.populate('churchAssignments.role');
  const role = assignment.role;

  return {
    role: {
      id: role._id,
      name: role.name,
      displayName: role.displayName,
      level: role.level,
    },
    permissions: Array.isArray(role.permissions) ? role.permissions : [],
    church: churchId,
  };
};

// Get user permissions for a specific team
userSchema.methods.getPermissionsForTeam = async function (teamId) {
  // Check if user is super admin first
  const hasSuperAdminRole = this.isSuperAdmin || 
    (this.unionAssignments && this.unionAssignments.some((assignment) => assignment.role?.name === 'super_admin')) ||
    (this.conferenceAssignments && this.conferenceAssignments.some((assignment) => assignment.role?.name === 'super_admin')) ||
    (this.churchAssignments && this.churchAssignments.some((assignment) => assignment.role?.name === 'super_admin'));

  // Check for wildcard permissions across hierarchical entities
  let hasWildcardPermissions = false;
  const allAssignments = [
    ...(this.unionAssignments || []),
    ...(this.conferenceAssignments || []),
    ...(this.churchAssignments || [])
  ];

  for (const assignment of allAssignments) {
    if (assignment.role?.permissions?.includes('*') || assignment.role?.permissions?.includes('all')) {
      hasWildcardPermissions = true;
      break;
    }
  }

  // If user is super admin, grant full access
  if (hasSuperAdminRole || hasWildcardPermissions) {
    return {
      teamRole: 'super_admin',
      hierarchicalRole: 'super_admin', 
      permissions: ['*'],
      team: teamId,
    };
  }

  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return { role: null, permissions: [] };
  }

  const assignment = this.teamAssignments.find(
    (team) => team.teamId.toString() === teamId.toString()
  );

  if (!assignment) {
    return { role: null, permissions: [] };
  }

  // Get church permissions first
  await this.populate({
    path: 'teamAssignments.teamId',
    populate: { path: 'churchId' },
  });

  const team = assignment.teamId;
  const churchPermissions = await this.getPermissionsForChurch(team.churchId);

  // Combine church permissions with team-specific overrides
  const teamPermissions = [
    ...churchPermissions.permissions,
    ...assignment.permissions,
  ];

  return {
    teamRole: assignment.role,
    churchRole: churchPermissions.role,
    permissions: [...new Set(teamPermissions)], // Remove duplicates
    team: teamId,
    church: team.churchId,
  };
};

// Get all teams for user
userSchema.methods.getTeams = async function () {
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return [];
  }
  
  await this.populate({
    path: 'teamAssignments.teamId',
    populate: { path: 'churchId', select: 'name' },
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
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return false;
  }
  
  const assignment = this.teamAssignments.find(
    (team) => team.teamId.toString() === teamId.toString()
  );

  return assignment && assignment.role === role;
};

// Check if user is team leader for any team
userSchema.methods.isTeamLeader = function () {
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return false;
  }
  
  return this.teamAssignments.some(
    (assignment) => assignment.role === 'leader'
  );
};

// Get teams where user is leader
userSchema.methods.getLeadingTeams = async function () {
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return [];
  }
  
  const leadingAssignments = this.teamAssignments.filter(
    (assignment) => assignment.role === 'leader'
  );

  if (!leadingAssignments.length) return [];

  const Team = mongoose.model('Team');
  const teamIds = leadingAssignments.map((a) => a.teamId);

  return Team.find({ _id: { $in: teamIds } })
    .populate([
      { path: 'unionId', select: 'name' },
      { path: 'conferenceId', select: 'name' },
      { path: 'churchId', select: 'name' }
    ])
    .lean();
};

module.exports = mongoose.model('User', userSchema);
