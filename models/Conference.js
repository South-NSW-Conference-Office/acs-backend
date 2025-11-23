const mongoose = require('mongoose');

const conferenceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Parent relationship
    unionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Union',
      required: true,
      index: true,
    },

    // Hierarchy properties
    hierarchyPath: {
      type: String,
      required: false, // Will be set automatically in pre-save middleware
      index: true,
    },

    hierarchyLevel: {
      type: Number,
      default: 1, // Conference is always level 1
      immutable: true,
    },

    // Conference-specific properties
    territory: {
      states: [String], // States/provinces this conference covers
      regions: [String], // Sub-regions within the conference
      description: String,
    },

    headquarters: {
      address: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
      timezone: String,
    },

    contact: {
      email: {
        type: String,
        lowercase: true,
        trim: true,
        validate: {
          validator: function (v) {
            return !v || /^\S+@\S+\.\S+$/.test(v);
          },
          message: 'Invalid email format',
        },
      },
      phone: String,
      website: String,
      mailingAddress: {
        street: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
      },
    },

    // Conference programs and services
    programs: [
      {
        name: String,
        type: {
          type: String,
          enum: [
            'community_services',
            'education',
            'health',
            'youth',
            'family',
            'evangelism',
            'stewardship',
          ],
        },
        director: String,
        contact: String,
        description: String,
      },
    ],

    // Budget and financial info
    budget: {
      fiscalYear: Number,
      totalBudget: Number,
      acsAllocation: Number,
      currency: {
        type: String,
        default: 'USD',
        validate: {
          validator: function (v) {
            return /^[A-Z]{3}$/.test(v);
          },
          message: 'Currency must be 3-letter ISO code',
        },
      },
    },

    // Conference settings
    settings: {
      reportingFrequency: {
        type: String,
        enum: ['monthly', 'quarterly', 'annually'],
        default: 'quarterly',
      },
      defaultServiceTypes: [String],
      requiredFields: [
        {
          entity: String, // 'church', 'team', 'service'
          field: String,
          required: Boolean,
        },
      ],
    },

    // Status and metadata
    isActive: {
      type: Boolean,
      default: true,
    },

    metadata: {
      churchCount: { type: Number, default: 0 },
      membershipCount: Number,
      lastReportDate: Date,
      lastUpdated: { type: Date, default: Date.now },
    },

    // Banner image for the conference
    primaryImage: {
      url: String,
      key: String,
      alt: String,
      mediaFileId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MediaFile',
      },
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
conferenceSchema.index({ unionId: 1, name: 1 });
conferenceSchema.index({ 'territory.states': 1 });
conferenceSchema.index({ isActive: 1, unionId: 1 });

// Virtual to get parent union
conferenceSchema.virtual('union', {
  ref: 'Union',
  localField: 'unionId',
  foreignField: '_id',
  justOne: true,
});

// Virtual to get churches
conferenceSchema.virtual('churches', {
  ref: 'Church',
  localField: '_id',
  foreignField: 'conferenceId',
  match: { isActive: true },
});

// Ensure virtual fields are serialized
conferenceSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

// Pre-save middleware
conferenceSchema.pre('save', async function (next) {
  try {
    // Build hierarchy path: union_path/conference_id
    if (this.isNew && !this.hierarchyPath) {
      const Union = mongoose.model('Union');
      const union = await Union.findById(this.unionId);
      if (!union) {
        return next(new Error('Parent union not found'));
      }
      if (!union.hierarchyPath) {
        return next(new Error('Parent union has no hierarchy path'));
      }
      // For new documents, set a temporary path that will be updated after save
      this.hierarchyPath = `${union.hierarchyPath}/temp-${Date.now()}`;
    }

    // Ensure hierarchy level is 1
    this.hierarchyLevel = 1;

    // Update metadata timestamp
    if (!this.metadata) this.metadata = {};
    this.metadata.lastUpdated = new Date();

    next();
  } catch (error) {
    next(error);
  }
});

// Post-save middleware to update hierarchy path with actual _id
conferenceSchema.post('save', async function (doc, next) {
  try {
    // Update hierarchy path with actual _id if it was a temp path
    if (doc.hierarchyPath.includes('/temp-')) {
      const Union = mongoose.model('Union');
      const union = await Union.findById(doc.unionId);
      if (union) {
        const correctPath = `${union.hierarchyPath}/${doc._id}`;
        await this.constructor.findByIdAndUpdate(
          doc._id,
          {
            hierarchyPath: correctPath,
          },
          { new: false }
        );
        doc.hierarchyPath = correctPath;
      }
    }
    next();
  } catch (error) {
    next();
  }
});

// Instance methods
conferenceSchema.methods.getFullHierarchy = async function () {
  const Union = mongoose.model('Union');
  const Church = mongoose.model('Church');

  const union = await Union.findById(this.unionId).select('name');
  const churches = await Church.find({ conferenceId: this._id, isActive: true })
    .select('name hierarchyPath')
    .sort('name');

  return {
    union,
    conference: this,
    churches,
  };
};

conferenceSchema.methods.getStatistics = async function () {
  const Church = mongoose.model('Church');
  const Team = mongoose.model('Team');
  const Service = mongoose.model('Service');

  const stats = {
    churches: await Church.countDocuments({
      conferenceId: this._id,
      isActive: true,
    }),
    teams: 0,
    services: 0,
  };

  // Get churches for this conference
  const churches = await Church.find({
    conferenceId: this._id,
    isActive: true,
  }).select('_id');
  const churchIds = churches.map((c) => c._id);

  if (churchIds.length > 0) {
    // Count teams in these churches
    const teams = await Team.find({
      churchId: { $in: churchIds },
      isActive: true,
    }).select('_id');
    stats.teams = teams.length;
    const teamIds = teams.map((t) => t._id);

    if (teamIds.length > 0) {
      // Count services in these teams
      stats.services = await Service.countDocuments({
        teamId: { $in: teamIds },
        status: { $ne: 'archived' },
      });
    }
  }

  return stats;
};

conferenceSchema.methods.canManageChurch = function (churchHierarchyPath) {
  return churchHierarchyPath.startsWith(this.hierarchyPath + '/');
};

// Static methods
conferenceSchema.statics.findByUnion = function (unionId) {
  return this.find({ unionId, isActive: true }).sort('name');
};

conferenceSchema.statics.findByTerritory = function (state) {
  return this.find({
    'territory.states': state,
    isActive: true,
  }).populate('unionId', 'name code');
};

conferenceSchema.statics.getActiveConferences = function (unionId = null) {
  const query = { isActive: true };
  if (unionId) query.unionId = unionId;

  return this.find(query)
    .select('name hierarchyPath territory contact')
    .populate('unionId', 'name')
    .sort('name');
};

// Cascade deletion prevention
conferenceSchema.pre('remove', async function (next) {
  const Church = mongoose.model('Church');
  const churchCount = await Church.countDocuments({ conferenceId: this._id });

  if (churchCount > 0) {
    return next(
      new Error(`Cannot delete conference: ${churchCount} churches still exist`)
    );
  }

  next();
});

module.exports = mongoose.model('Conference', conferenceSchema);
