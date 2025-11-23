const mongoose = require('mongoose');

const unionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true, // Union names should be unique globally
    },

    // Hierarchy properties
    hierarchyPath: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    hierarchyLevel: {
      type: Number,
      default: 0, // Union is always level 0
      immutable: true,
    },

    // Union-specific properties
    territory: {
      description: String,
    },

    headquarters: {
      address: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
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
    },

    // Administrative settings
    settings: {
      fiscalYearStart: {
        type: String,
        default: 'January',
        enum: [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December',
        ],
      },
      defaultCurrency: {
        type: String,
        default: 'USD',
        validate: {
          validator: function (v) {
            return /^[A-Z]{3}$/.test(v); // ISO currency code
          },
          message: 'Currency must be 3-letter ISO code',
        },
      },
      languages: [
        {
          code: String, // ISO language code
          name: String,
          isPrimary: { type: Boolean, default: false },
        },
      ],
    },

    // Status and metadata
    isActive: {
      type: Boolean,
      default: true,
    },

    metadata: {
      membershipCount: Number,
      churchCount: Number,
      lastUpdated: { type: Date, default: Date.now },
    },

    // Banner image for the union
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

// Indexes for performance
unionSchema.index({ name: 1 });
unionSchema.index({ isActive: 1 });

// Virtual to get conferences
unionSchema.virtual('conferences', {
  ref: 'Conference',
  localField: '_id',
  foreignField: 'unionId',
  match: { isActive: true },
});

// Virtual to get statistics
unionSchema.virtual('statistics', {
  ref: 'UnionStatistics',
  localField: '_id',
  foreignField: 'unionId',
  justOne: true,
});

// Ensure virtual fields are serialized
unionSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

// Pre-save middleware
unionSchema.pre('save', async function (next) {
  try {
    // Set hierarchy path (union uses its own ID)
    if (this.isNew || !this.hierarchyPath) {
      this.hierarchyPath = this._id.toString();
    }

    // Ensure hierarchy level is 0
    this.hierarchyLevel = 0;

    // Update metadata timestamp
    this.metadata.lastUpdated = new Date();

    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
unionSchema.methods.getFullHierarchy = async function () {
  const Conference = mongoose.model('Conference');
  const Church = mongoose.model('Church');

  const conferences = await Conference.find({
    unionId: this._id,
    isActive: true,
  })
    .select('name code hierarchyPath')
    .sort('name');

  const result = {
    union: this,
    conferences: [],
  };

  for (const conference of conferences) {
    const churches = await Church.find({
      conferenceId: conference._id,
      isActive: true,
    })
      .select('name hierarchyPath')
      .sort('name');

    result.conferences.push({
      ...conference.toObject(),
      churches,
    });
  }

  return result;
};

unionSchema.methods.getStatistics = async function () {
  const Conference = mongoose.model('Conference');
  const Church = mongoose.model('Church');
  const Team = mongoose.model('Team');
  const Service = mongoose.model('Service');

  const stats = {
    conferences: await Conference.countDocuments({
      unionId: this._id,
      isActive: true,
    }),
    churches: 0,
    teams: 0,
    services: 0,
  };

  // Get conferences for this union
  const conferences = await Conference.find({
    unionId: this._id,
    isActive: true,
  }).select('_id');
  const conferenceIds = conferences.map((c) => c._id);

  if (conferenceIds.length > 0) {
    // Count churches in these conferences
    const churches = await Church.find({
      conferenceId: { $in: conferenceIds },
      isActive: true,
    }).select('_id');
    stats.churches = churches.length;
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
  }

  return stats;
};

// Static methods
unionSchema.statics.getActiveUnions = function () {
  return this.find({ isActive: true })
    .select('name hierarchyPath territory.description contact')
    .sort('name');
};

// Cascade deletion prevention
unionSchema.pre('remove', async function (next) {
  const Conference = mongoose.model('Conference');
  const conferenceCount = await Conference.countDocuments({
    unionId: this._id,
  });

  if (conferenceCount > 0) {
    return next(
      new Error(
        `Cannot delete union: ${conferenceCount} conferences still exist`
      )
    );
  }

  next();
});

// Validation
unionSchema.pre('save', function (next) {
  // Ensure at least one primary language
  const primaryLanguages =
    this.settings.languages?.filter((lang) => lang.isPrimary) || [];
  if (this.settings.languages?.length > 0 && primaryLanguages.length === 0) {
    this.settings.languages[0].isPrimary = true;
  }

  next();
});

module.exports = mongoose.model('Union', unionSchema);
