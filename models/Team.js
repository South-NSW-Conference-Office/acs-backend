const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      maxlength: [100, 'Team name must be less than 100 characters'],
    },

    // MANDATORY church relationship - STRICT HIERARCHY ENFORCEMENT
    churchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Church',
      required: [true, 'Church is required'],
      index: true,
      validate: {
        validator: async function(churchId) {
          const Church = mongoose.model('Church');
          const church = await Church.findById(churchId);
          return church && church.isActive;
        },
        message: 'Team must belong to an active church'
      }
    },
    
    // Legacy field for backward compatibility
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },

    // TEAM HIERARCHY PATH  
    hierarchyPath: {
      type: String, // church's path + team ID
      required: true,
      index: true,
    },
    
    // TEAM LEVEL = 3 (church is 2)
    hierarchyDepth: {
      type: Number,
      default: 3,
      immutable: true,
    },

    type: {
      type: String,
      required: true,
      trim: true,
      enum: ['acs', 'youth', 'music', 'outreach', 'education', 'other'], // Standardize
    },

    leaderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    description: {
      type: String,
      maxlength: [500, 'Description must be less than 500 characters'],
    },

    serviceIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
      },
    ],

    memberCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    maxMembers: {
      type: Number,
      default: 50,
      min: 1,
    },

    settings: {
      allowSelfJoin: {
        type: Boolean,
        default: false,
      },
      requireApproval: {
        type: Boolean,
        default: true,
      },
      visibility: {
        type: String,
        enum: ['public', 'private', 'organization'],
        default: 'organization',
      },
    },

    metadata: {
      region: String,
      conference: String,
      district: String,
      customFields: mongoose.Schema.Types.Mixed,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance - HIERARCHICAL OPTIMIZATION
teamSchema.index({ churchId: 1, type: 1 });
teamSchema.index({ hierarchyPath: 1 });
teamSchema.index({ leaderId: 1 });
teamSchema.index({ name: 'text' });
teamSchema.index({ createdAt: -1 });
// Legacy index for backward compatibility
teamSchema.index({ organizationId: 1, type: 1 });

// Virtual for member assignments (will be stored in User model)
teamSchema.virtual('members', {
  ref: 'User',
  localField: '_id',
  foreignField: 'teamAssignments.teamId',
  justOne: false,
});

// Methods
teamSchema.methods.isFull = function () {
  return this.memberCount >= this.maxMembers;
};

teamSchema.methods.canUserJoin = function (user) {
  if (this.isFull()) return false;
  if (!this.isActive) return false;

  // Check if user is already a member
  const isMember = user.teamAssignments?.some(
    (assignment) => assignment.teamId.toString() === this._id.toString()
  );

  return !isMember;
};

teamSchema.methods.addMember = async function (
  userId,
  role = 'member',
  addedBy
) {
  const User = mongoose.model('User');
  const user = await User.findById(userId);

  if (!user) throw new Error('User not found');
  if (!this.canUserJoin(user)) throw new Error('Cannot add user to team');

  // Add team assignment to user
  user.teamAssignments.push({
    teamId: this._id,
    role,
    assignedAt: new Date(),
    assignedBy: addedBy,
  });

  await user.save();

  // Update member count
  this.memberCount = await User.countDocuments({
    'teamAssignments.teamId': this._id,
  });

  await this.save();

  return user;
};

teamSchema.methods.removeMember = async function (userId) {
  const User = mongoose.model('User');
  const user = await User.findById(userId);

  if (!user) throw new Error('User not found');

  // Remove team assignment from user
  user.teamAssignments = user.teamAssignments.filter(
    (assignment) => assignment.teamId.toString() !== this._id.toString()
  );

  await user.save();

  // Update member count
  this.memberCount = await User.countDocuments({
    'teamAssignments.teamId': this._id,
  });

  await this.save();

  return user;
};

teamSchema.methods.getMembers = async function (options = {}) {
  const { role, limit = 100, skip = 0 } = options;

  const query = { 'teamAssignments.teamId': this._id };

  if (role) {
    query['teamAssignments.role'] = role;
  }

  const User = mongoose.model('User');
  return User.find(query)
    .select('name email avatar teamAssignments')
    .limit(limit)
    .skip(skip)
    .lean();
};

// Statics - HIERARCHICAL TEAM MANAGEMENT
teamSchema.statics.createTeam = async function (data) {
  const { churchId, organizationId, leaderId } = data;
  
  // Support both new churchId and legacy organizationId
  const actualChurchId = churchId || organizationId;
  
  if (!actualChurchId) {
    throw new Error('Church ID is required');
  }

  // Validate church exists
  const Church = mongoose.model('Church');
  const church = await Church.findById(actualChurchId);
  
  if (!church) {
    throw new Error('Church not found');
  }
  
  if (!church.isActive) {
    throw new Error('Cannot create team under inactive church');
  }

  // Create team with church binding
  const teamData = {
    ...data,
    churchId: actualChurchId,
    organizationId: actualChurchId // For backward compatibility
  };

  const team = await this.create(teamData);

  // If leader is specified, add them as team leader
  if (leaderId) {
    await team.addMember(leaderId, 'leader', data.createdBy);
  }

  return team;
};

// Get teams by church (updated method name for clarity)
teamSchema.statics.getTeamsByChurch = async function (
  churchId,
  options = {}
) {
  const { includeInactive = false, type } = options;

  const query = { churchId };
  
  if (!includeInactive) {
    query.isActive = true;
  }
  
  if (type) {
    query.type = type;
  }

  const teams = await this.find(query)
    .populate('leaderId', 'name email avatar')
    .populate('churchId', 'name hierarchyLevel hierarchyPath')
    .populate('createdBy', 'name email')
    .lean();

  return teams;
};

// Legacy method for backward compatibility
teamSchema.statics.getTeamsByOrganization = async function (
  organizationId,
  options = {}
) {
  return this.getTeamsByChurch(organizationId, options);
};

// NEW: Get teams accessible to a user based on hierarchy
teamSchema.statics.getAccessibleTeams = async function (userHierarchyPath) {
  return this.find({
    hierarchyPath: { $regex: `^${userHierarchyPath}` },
    isActive: true
  })
  .populate('churchId', 'name hierarchyLevel')
  .populate('leaderId', 'name email')
  .sort('name');
};

teamSchema.statics.getTeamsByUser = async function (userId) {
  const User = mongoose.model('User');
  const user = await User.findById(userId).select('teamAssignments');

  if (!user || !user.teamAssignments.length) return [];

  const teamIds = user.teamAssignments.map((a) => a.teamId);

  return this.find({ _id: { $in: teamIds } })
    .populate('organizationId', 'name type')
    .populate('leaderId', 'name email')
    .populate('createdBy', 'name email')
    .lean();
};

// Middleware - HIERARCHICAL ENFORCEMENT
teamSchema.pre('save', async function (next) {
  try {
    // Build hierarchy path if modified
    if (this.isModified('churchId') || !this.hierarchyPath) {
      await this.buildHierarchyPath();
    }
    
    // Sync organizationId for backward compatibility
    if (this.isModified('churchId')) {
      this.organizationId = this.churchId;
    }
    
    // Ensure member count doesn't exceed max
    if (this.isModified('memberCount')) {
      if (this.memberCount > this.maxMembers) {
        this.memberCount = this.maxMembers;
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Build hierarchy path automatically
teamSchema.methods.buildHierarchyPath = async function() {
  if (!this.churchId) {
    throw new Error('Team must have a church assignment');
  }
  
  const Church = mongoose.model('Church');
  const church = await Church.findById(this.churchId);
  
  if (!church) {
    throw new Error('Church not found');
  }
  
  if (!church.isActive) {
    throw new Error('Cannot assign team to inactive church');
  }
  
  this.hierarchyPath = `${church.hierarchyPath}/team_${this._id}`;
};

teamSchema.pre('remove', async function (next) {
  // Remove all team assignments when team is deleted
  const User = mongoose.model('User');
  await User.updateMany(
    { 'teamAssignments.teamId': this._id },
    { $pull: { teamAssignments: { teamId: this._id } } }
  );
  next();
});

const Team = mongoose.model('Team', teamSchema);

module.exports = Team;
