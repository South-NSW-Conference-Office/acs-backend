const mongoose = require('mongoose');

const volunteerRoleSchema = new mongoose.Schema(
  {
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        'administration',
        'direct_service',
        'fundraising',
        'marketing',
        'technology',
        'education',
        'health_support',
        'logistics',
        'other',
      ],
      default: 'other',
    },
    requirements: {
      skills: [
        {
          type: String,
          trim: true,
        },
      ],
      experience: String,
      backgroundCheck: {
        type: Boolean,
        default: false,
      },
      workingWithChildrenCheck: {
        type: Boolean,
        default: false,
      },
      minimumAge: {
        type: Number,
        min: 0,
        max: 100,
      },
      physicalRequirements: String,
      otherRequirements: String,
    },
    training: {
      required: {
        type: Boolean,
        default: false,
      },
      description: String,
      duration: String,
      schedule: String,
    },
    timeCommitment: {
      type: {
        type: String,
        enum: ['one_time', 'occasional', 'regular', 'flexible'],
        default: 'flexible',
      },
      hoursPerWeek: {
        minimum: Number,
        maximum: Number,
      },
      duration: String,
      schedule: String,
      description: String,
    },
    location: {
      type: {
        type: String,
        enum: ['on_site', 'remote', 'hybrid'],
        default: 'on_site',
      },
      details: String,
    },
    benefits: [
      {
        type: String,
        trim: true,
      },
    ],
    numberOfPositions: {
      type: Number,
      default: 1,
      min: 1,
    },
    positionsFilled: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['draft', 'open', 'closed', 'filled', 'paused'],
      default: 'draft',
      index: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'members_only', 'private'],
      default: 'public',
    },
    applicationProcess: {
      method: {
        type: String,
        enum: ['email', 'phone', 'online_form', 'in_person'],
        default: 'email',
      },
      contactEmail: String,
      contactPhone: String,
      applicationLink: String,
      additionalInfo: String,
    },
    startDate: Date,
    endDate: Date,
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

volunteerRoleSchema.index({ title: 'text', description: 'text', tags: 'text' });
volunteerRoleSchema.index({ organization: 1, status: 1 });
volunteerRoleSchema.index({ service: 1, status: 1 });

volunteerRoleSchema.virtual('isOpen').get(function () {
  return (
    this.status === 'open' && this.positionsFilled < this.numberOfPositions
  );
});

volunteerRoleSchema.virtual('positionsAvailable').get(function () {
  return Math.max(0, this.numberOfPositions - this.positionsFilled);
});

volunteerRoleSchema.virtual('isActive').get(function () {
  if (this.status !== 'open') return false;
  if (this.endDate && this.endDate < new Date()) return false;
  return this.positionsAvailable > 0;
});

volunteerRoleSchema.pre('save', async function (next) {
  if (this.isNew && !this.organization) {
    const service = await mongoose
      .model('Service')
      .findById(this.service)
      .select('organization');
    if (service) {
      this.organization = service.organization;
    }
  }

  if (
    this.positionsFilled >= this.numberOfPositions &&
    this.status === 'open'
  ) {
    this.status = 'filled';
  }

  if (this.isModified()) {
    this.updatedBy = this.createdBy;
  }

  next();
});

volunteerRoleSchema.methods.canBeViewedBy = function (user) {
  if (this.visibility === 'public' && this.status === 'open') return true;
  if (!user) return false;

  return user.organizations.some((org) =>
    org.organization.equals(this.organization)
  );
};

volunteerRoleSchema.methods.fillPosition = function (count = 1) {
  this.positionsFilled = Math.min(
    this.positionsFilled + count,
    this.numberOfPositions
  );
  return this.save();
};

volunteerRoleSchema.methods.unfillPosition = function (count = 1) {
  this.positionsFilled = Math.max(0, this.positionsFilled - count);
  if (
    this.status === 'filled' &&
    this.positionsFilled < this.numberOfPositions
  ) {
    this.status = 'open';
  }
  return this.save();
};

volunteerRoleSchema.statics.findOpenRoles = function (filters = {}) {
  return this.find({
    ...filters,
    status: 'open',
    $expr: { $lt: ['$positionsFilled', '$numberOfPositions'] },
  })
    .populate('service', 'name type')
    .populate('organization', 'name type')
    .sort('-createdAt');
};

volunteerRoleSchema.statics.findBySkills = function (skills, filters = {}) {
  return this.find({
    ...filters,
    status: 'open',
    'requirements.skills': { $in: skills },
  }).populate('service', 'name type');
};

const VolunteerRole = mongoose.model('VolunteerRole', volunteerRoleSchema);

module.exports = VolunteerRole;
