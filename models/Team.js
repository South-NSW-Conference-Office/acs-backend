const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      maxlength: [100, 'Team name must be less than 100 characters'],
    },

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: [true, 'Organization is required'],
      index: true,
    },

    type: {
      type: String,
      required: true,
      trim: true,
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

// Indexes for performance
teamSchema.index({ organizationId: 1, type: 1 });
teamSchema.index({ leaderId: 1 });
teamSchema.index({ name: 'text' });
teamSchema.index({ 'metadata.conference': 1 });
teamSchema.index({ createdAt: -1 });

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

// Statics
teamSchema.statics.createTeam = async function (data) {
  const { organizationId, leaderId } = data;

  // Validate organization exists
  const Organization = mongoose.model('Organization');
  const org = await Organization.findById(organizationId);
  if (!org) throw new Error('Organization not found');

  // Create team
  const team = await this.create(data);

  // If leader is specified, add them as team leader
  if (leaderId) {
    await team.addMember(leaderId, 'leader', data.createdBy);
  }

  return team;
};

teamSchema.statics.getTeamsByOrganization = async function (
  organizationId,
  options = {}
) {
  const { includeInactive = false, type } = options;

  const query = { organizationId };
  if (!includeInactive) query.isActive = true;
  if (type) query.type = type;

  return this.find(query).populate('leaderId', 'name email avatar').lean();
};

teamSchema.statics.getTeamsByUser = async function (userId) {
  const User = mongoose.model('User');
  const user = await User.findById(userId).select('teamAssignments');

  if (!user || !user.teamAssignments.length) return [];

  const teamIds = user.teamAssignments.map((a) => a.teamId);

  return this.find({ _id: { $in: teamIds } })
    .populate('organizationId', 'name')
    .populate('leaderId', 'name email')
    .lean();
};

// Middleware
teamSchema.pre('save', function (next) {
  if (this.isModified('memberCount')) {
    // Ensure member count doesn't exceed max
    if (this.memberCount > this.maxMembers) {
      this.memberCount = this.maxMembers;
    }
  }
  next();
});

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
