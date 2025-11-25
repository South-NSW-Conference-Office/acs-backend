const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Enhanced team assignment schema - now the primary assignment method
const teamAssignmentSchema = new mongoose.Schema({
  teamId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Team',
    required: true,
  },
  role: {
    type: String,
    enum: ['leader', 'coordinator', 'member'],
    default: 'member',
    required: true,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'active',
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
    // TEAM-CENTRIC ASSIGNMENTS - Users only assigned to teams
    teamAssignments: {
      type: [teamAssignmentSchema],
      default: [],
      required: true,
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

// DYNAMIC ORGANIZATIONAL CONTEXT - Calculated from team memberships

// Get all churches user has access to through team memberships
userSchema.methods.getAccessibleChurches = async function () {
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return [];
  }

  await this.populate({
    path: 'teamAssignments.teamId',
    populate: { path: 'churchId', select: 'name hierarchyPath' },
  });

  const churchIds = [
    ...new Set(
      this.teamAssignments
        .filter((assignment) => assignment.teamId && assignment.teamId.churchId)
        .map((assignment) => assignment.teamId.churchId._id)
    ),
  ];

  const Church = mongoose.model('Church');
  return Church.find({ _id: { $in: churchIds } })
    .populate('conferenceId', 'name')
    .populate({
      path: 'conferenceId',
      populate: { path: 'unionId', select: 'name' },
    });
};

// Get all conferences user has access to through team memberships
userSchema.methods.getAccessibleConferences = async function () {
  const churches = await this.getAccessibleChurches();
  const conferenceIds = [
    ...new Set(churches.map((church) => church.conferenceId._id)),
  ];

  const Conference = mongoose.model('Conference');
  return Conference.find({ _id: { $in: conferenceIds } }).populate(
    'unionId',
    'name'
  );
};

// Get all unions user has access to through team memberships
userSchema.methods.getAccessibleUnions = async function () {
  const conferences = await this.getAccessibleConferences();
  const unionIds = [
    ...new Set(conferences.map((conference) => conference.unionId._id)),
  ];

  const Union = mongoose.model('Union');
  return Union.find({ _id: { $in: unionIds } });
};

// Calculate user's current organizational scope
userSchema.methods.getOrganizationalScope = async function () {
  const teams = await this.getTeams();

  await this.populate({
    path: 'teamAssignments.teamId',
    populate: {
      path: 'churchId',
      populate: {
        path: 'conferenceId',
        populate: { path: 'unionId' },
      },
    },
  });

  const churches = new Set();
  const conferences = new Set();
  const unions = new Set();
  const hierarchyPaths = [];

  this.teamAssignments.forEach((assignment) => {
    if (assignment.teamId && assignment.teamId.churchId) {
      const church = assignment.teamId.churchId;
      churches.add(church._id.toString());
      hierarchyPaths.push(assignment.teamId.hierarchyPath);

      if (church.conferenceId) {
        conferences.add(church.conferenceId._id.toString());

        if (church.conferenceId.unionId) {
          unions.add(church.conferenceId.unionId._id.toString());
        }
      }
    }
  });

  return {
    teams: teams.map((t) => t._id.toString()),
    churches: Array.from(churches),
    conferences: Array.from(conferences),
    unions: Array.from(unions),
    hierarchyPaths: hierarchyPaths,
  };
};

// Get user permissions for a specific team
userSchema.methods.getPermissionsForTeam = async function (teamId) {
  // Check if user is super admin
  if (this.isSuperAdmin) {
    return {
      teamRole: 'super_admin',
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

  // Get team information with church context
  await this.populate({
    path: 'teamAssignments.teamId',
    populate: { path: 'churchId' },
  });

  const team = assignment.teamId;

  // Base permissions based on team role
  let basePermissions = [];
  switch (assignment.role) {
    case 'leader':
      basePermissions = [
        'team.manage',
        'team.members.invite',
        'team.members.manage',
        'team.services.create',
        'team.services.manage',
        'church.view',
      ];
      break;
    case 'coordinator':
      basePermissions = [
        'team.participate',
        'team.services.manage',
        'team.view',
        'church.view',
      ];
      break;
    case 'member':
      basePermissions = ['team.participate', 'team.view', 'church.view'];
      break;
    default:
      basePermissions = ['team.view'];
  }

  // Combine base permissions with team-specific overrides
  const teamPermissions = [
    ...basePermissions,
    ...(assignment.permissions || []),
  ];

  return {
    teamRole: assignment.role,
    permissions: [...new Set(teamPermissions)], // Remove duplicates
    team: teamId,
    church: team.churchId,
    status: assignment.status,
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

  return this.teamAssignments
    .filter((assignment) => assignment.status === 'active')
    .map((assignment) => ({
      team: assignment.teamId,
      role: assignment.role,
      joinedAt: assignment.joinedAt,
      status: assignment.status,
      permissions: assignment.permissions,
    }));
};

// Check if user has specific team role
userSchema.methods.hasTeamRole = function (teamId, role) {
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return false;
  }

  const assignment = this.teamAssignments.find(
    (team) =>
      team.teamId.toString() === teamId.toString() && team.status === 'active'
  );

  return assignment && assignment.role === role;
};

// Check if user is team leader for any team
userSchema.methods.isTeamLeader = function () {
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return false;
  }

  return this.teamAssignments.some(
    (assignment) =>
      assignment.role === 'leader' && assignment.status === 'active'
  );
};

// Get teams where user is leader
userSchema.methods.getLeadingTeams = async function () {
  if (!this.teamAssignments || !Array.isArray(this.teamAssignments)) {
    return [];
  }

  const leadingAssignments = this.teamAssignments.filter(
    (assignment) =>
      assignment.role === 'leader' && assignment.status === 'active'
  );

  if (!leadingAssignments.length) return [];

  const Team = mongoose.model('Team');
  const teamIds = leadingAssignments.map((a) => a.teamId);

  return Team.find({ _id: { $in: teamIds } })
    .populate({ path: 'churchId', select: 'name' })
    .lean();
};

// Add user to team - universal assignment method
userSchema.methods.addToTeam = async function (
  teamId,
  role = 'member',
  invitedBy = null
) {
  // Check if user is already in this team
  const existingAssignment = this.teamAssignments.find(
    (assignment) => assignment.teamId.toString() === teamId.toString()
  );

  if (existingAssignment) {
    // Update existing assignment
    existingAssignment.role = role;
    existingAssignment.status = 'active';
    existingAssignment.joinedAt = new Date();
    if (invitedBy) existingAssignment.invitedBy = invitedBy;
  } else {
    // Add new team assignment
    this.teamAssignments.push({
      teamId: teamId,
      role: role,
      status: 'active',
      joinedAt: new Date(),
      invitedBy: invitedBy,
      permissions: [],
    });
  }

  // Set as primary team if user doesn't have one
  if (!this.primaryTeam) {
    this.primaryTeam = teamId;
  }

  await this.save();
  return this;
};

// Remove user from team
userSchema.methods.removeFromTeam = async function (teamId) {
  this.teamAssignments = this.teamAssignments.filter(
    (assignment) => assignment.teamId.toString() !== teamId.toString()
  );

  // Update primary team if it was removed
  if (this.primaryTeam && this.primaryTeam.toString() === teamId.toString()) {
    this.primaryTeam =
      this.teamAssignments.length > 0 ? this.teamAssignments[0].teamId : null;
  }

  await this.save();
  return this;
};

module.exports = mongoose.model('User', userSchema);
