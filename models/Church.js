const mongoose = require('mongoose');

const churchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Parent relationship
    conferenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conference',
      required: true,
      index: true,
    },

    // Hierarchy properties
    hierarchyPath: {
      type: String,
      required: true,
      index: true,
    },

    hierarchyLevel: {
      type: Number,
      default: 2, // Church is always level 2
      immutable: true,
    },

    // Church identification
    code: {
      type: String,
      uppercase: true,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^[A-Z0-9]{2,20}$/.test(v);
        },
        message: 'Church code must be 2-20 uppercase letters/numbers',
      },
    },

    // Location and contact
    location: {
      address: {
        street: String,
        city: String,
        state: String,
        postalCode: String,
        country: String,
      },
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
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

    // Church leadership
    leadership: {
      pastor: {
        name: String,
        title: String,
        email: String,
        phone: String,
        startDate: Date,
      },
      associatePastors: [
        {
          name: String,
          title: String,
          email: String,
          phone: String,
          responsibilities: [String],
        },
      ],
      firstElder: {
        name: String,
        email: String,
        phone: String,
      },
      acsCoordinator: {
        name: String,
        email: String,
        phone: String,
      },
      clerk: {
        name: String,
        email: String,
        phone: String,
      },
      treasurer: {
        name: String,
        email: String,
        phone: String,
      },
    },

    // Church demographics and statistics
    demographics: {
      membershipCount: {
        active: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
        baptisms: { type: Number, default: 0 },
        transfers: { type: Number, default: 0 },
        lastUpdated: Date,
      },
      attendance: {
        sabbathService: Number,
        sabbathSchool: Number,
        prayerMeeting: Number,
        lastUpdated: Date,
      },
      ageGroups: {
        children: Number, // 0-12
        youth: Number, // 13-17
        youngAdults: Number, // 18-35
        adults: Number, // 36-64
        seniors: Number, // 65+
      },
    },

    // Facilities and services
    facilities: {
      sanctuary: {
        capacity: Number,
        hasAV: { type: Boolean, default: false },
        hasAccessibility: { type: Boolean, default: false },
      },
      classrooms: [
        {
          name: String,
          capacity: Number,
          purpose: String, // 'sabbath_school', 'children', 'youth', 'multipurpose'
        },
      ],
      kitchen: {
        available: { type: Boolean, default: false },
        capacity: Number,
        equipment: [String],
      },
      parking: {
        spaces: Number,
        handicapSpaces: Number,
      },
      other: [String], // Fellowship hall, gymnasium, etc.
    },

    // Service schedule
    services: {
      sabbathSchool: {
        time: String,
        description: String,
      },
      worship: {
        time: String,
        description: String,
      },
      prayerMeeting: {
        day: String,
        time: String,
        description: String,
      },
      vespers: {
        time: String,
        description: String,
      },
      special: [
        {
          name: String,
          schedule: String,
          description: String,
        },
      ],
    },

    // Community outreach settings
    outreach: {
      primaryFocus: [
        {
          type: String,
          enum: [
            'food_assistance',
            'clothing',
            'health_services',
            'education',
            'disaster_relief',
            'community_development',
            'family_services',
          ],
        },
      ],
      serviceArea: {
        radius: Number, // Miles/kilometers served
        communities: [String],
        specialPopulations: [String],
      },
      partnerships: [
        {
          organization: String,
          type: String,
          contactPerson: String,
          relationship: String,
        },
      ],
    },

    // Church settings and preferences
    settings: {
      serviceLanguages: [
        {
          language: String,
          isPrimary: { type: Boolean, default: false },
          serviceTypes: [String], // Which services are in this language
        },
      ],
      reportingPreferences: {
        frequency: {
          type: String,
          enum: ['weekly', 'monthly', 'quarterly'],
          default: 'monthly',
        },
        preferredDay: String,
        contactMethod: {
          type: String,
          enum: ['email', 'phone', 'postal'],
          default: 'email',
        },
      },
      acsSettings: {
        operatingHours: [
          {
            day: String,
            open: String,
            close: String,
          },
        ],
        specialRequirements: [String],
        volunteerCoordinator: String,
      },
    },

    // Status and metadata
    isActive: {
      type: Boolean,
      default: true,
    },

    establishedDate: Date,
    organizedDate: Date, // When officially organized as SDA church

    metadata: {
      teamCount: { type: Number, default: 0 },
      serviceCount: { type: Number, default: 0 },
      lastReport: Date,
      lastVisit: Date,
      lastUpdated: { type: Date, default: Date.now },
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
churchSchema.index({ conferenceId: 1, name: 1 });
churchSchema.index({ conferenceId: 1, code: 1 }, { sparse: true });
churchSchema.index({ 'location.address.city': 1 });
churchSchema.index({ 'location.address.state': 1 });
churchSchema.index({ 'location.coordinates': '2dsphere' });
churchSchema.index({ isActive: 1, conferenceId: 1 });

// Virtual to get parent conference
churchSchema.virtual('conference', {
  ref: 'Conference',
  localField: 'conferenceId',
  foreignField: '_id',
  justOne: true,
});

// Virtual to get teams
churchSchema.virtual('teams', {
  ref: 'Team',
  localField: '_id',
  foreignField: 'churchId',
  match: { isActive: true },
});

// Ensure virtual fields are serialized
churchSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

// Pre-save middleware
churchSchema.pre('save', async function (next) {
  try {
    // Build hierarchy path: conference_path/church_id
    if (this.isNew || this.isModified('conferenceId')) {
      const Conference = mongoose.model('Conference');
      const conference = await Conference.findById(this.conferenceId);
      if (!conference) {
        return next(new Error('Parent conference not found'));
      }
      this.hierarchyPath = `${conference.hierarchyPath}/${this._id}`;
    }

    // Ensure hierarchy level is 2
    this.hierarchyLevel = 2;

    // Update metadata timestamp
    this.metadata.lastUpdated = new Date();

    // Calculate totals from components
    if (this.demographics) {
      const age = this.demographics.ageGroups;
      if (age) {
        const totalFromAgeGroups =
          (age.children || 0) +
          (age.youth || 0) +
          (age.youngAdults || 0) +
          (age.adults || 0) +
          (age.seniors || 0);
        if (
          totalFromAgeGroups > 0 &&
          !this.demographics.membershipCount.total
        ) {
          this.demographics.membershipCount.total = totalFromAgeGroups;
        }
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
churchSchema.methods.getFullHierarchy = async function () {
  const Conference = mongoose.model('Conference');
  const Team = mongoose.model('Team');

  const conference = await Conference.findById(this.conferenceId).populate(
    'unionId'
  );
  const teams = await Team.find({ churchId: this._id, isActive: true })
    .select('name type hierarchyPath')
    .sort('name');

  return {
    union: conference.unionId,
    conference,
    church: this,
    teams,
  };
};

churchSchema.methods.getStatistics = async function () {
  const Team = mongoose.model('Team');
  const Service = mongoose.model('Service');

  const stats = {
    teams: await Team.countDocuments({ churchId: this._id, isActive: true }),
    services: 0,
    volunteers: 0,
    beneficiaries: 0,
  };

  // Get teams for this church
  const teams = await Team.find({ churchId: this._id, isActive: true }).select(
    '_id'
  );
  const teamIds = teams.map((t) => t._id);

  if (teamIds.length > 0) {
    // Count services and get aggregated stats
    const serviceStats = await Service.aggregate([
      { $match: { teamId: { $in: teamIds }, status: { $ne: 'archived' } } },
      {
        $group: {
          _id: null,
          serviceCount: { $sum: 1 },
          totalVolunteers: { $sum: '$statistics.volunteers' },
          totalBeneficiaries: { $sum: '$statistics.beneficiaries' },
        },
      },
    ]);

    if (serviceStats.length > 0) {
      stats.services = serviceStats[0].serviceCount;
      stats.volunteers = serviceStats[0].totalVolunteers || 0;
      stats.beneficiaries = serviceStats[0].totalBeneficiaries || 0;
    }
  }

  return stats;
};

churchSchema.methods.canManageTeam = function (teamHierarchyPath) {
  return teamHierarchyPath.startsWith(this.hierarchyPath + '/');
};

churchSchema.methods.isNearLocation = function (
  latitude,
  longitude,
  radiusMiles = 50
) {
  if (
    !this.location.coordinates.latitude ||
    !this.location.coordinates.longitude
  ) {
    return false;
  }

  const earthRadius = 3959; // miles
  const lat1 = (this.location.coordinates.latitude * Math.PI) / 180;
  const lat2 = (latitude * Math.PI) / 180;
  const deltaLat =
    ((latitude - this.location.coordinates.latitude) * Math.PI) / 180;
  const deltaLng =
    ((longitude - this.location.coordinates.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = earthRadius * c;

  return distance <= radiusMiles;
};

// Static methods
churchSchema.statics.findByConference = function (conferenceId) {
  return this.find({ conferenceId, isActive: true }).sort('name');
};

churchSchema.statics.findByCode = function (code, conferenceId = null) {
  const query = { code: code.toUpperCase(), isActive: true };
  if (conferenceId) query.conferenceId = conferenceId;
  return this.findOne(query);
};

churchSchema.statics.findByLocation = function (city, state = null) {
  const query = {
    'location.address.city': new RegExp(city, 'i'),
    isActive: true,
  };
  if (state) query['location.address.state'] = new RegExp(state, 'i');

  return this.find(query).populate('conferenceId', 'name code');
};

churchSchema.statics.findNearLocation = function (
  latitude,
  longitude,
  radiusMiles = 50
) {
  const radiusMeters = radiusMiles * 1609.34; // Convert miles to meters

  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
        $maxDistance: radiusMeters,
      },
    },
    isActive: true,
  }).populate('conferenceId', 'name code');
};

churchSchema.statics.getActiveChurches = function (conferenceId = null) {
  const query = { isActive: true };
  if (conferenceId) query.conferenceId = conferenceId;

  return this.find(query)
    .select('name code hierarchyPath location contact leadership demographics')
    .populate('conferenceId', 'name code')
    .sort('name');
};

// Cascade deletion prevention
churchSchema.pre('remove', async function (next) {
  const Team = mongoose.model('Team');
  const teamCount = await Team.countDocuments({ churchId: this._id });

  if (teamCount > 0) {
    return next(
      new Error(`Cannot delete church: ${teamCount} teams still exist`)
    );
  }

  next();
});

// Validation
churchSchema.pre('save', async function (next) {
  if (this.code && this.isNew) {
    // Ensure code is unique within conference
    const existing = await this.constructor.findOne({
      conferenceId: this.conferenceId,
      code: this.code,
      _id: { $ne: this._id },
    });

    if (existing) {
      return next(
        new Error(
          `Church code '${this.code}' already exists in this conference`
        )
      );
    }
  }

  // Ensure at least one primary language
  if (
    this.settings.serviceLanguages &&
    this.settings.serviceLanguages.length > 0
  ) {
    const primaryLanguages = this.settings.serviceLanguages.filter(
      (lang) => lang.isPrimary
    );
    if (primaryLanguages.length === 0) {
      this.settings.serviceLanguages[0].isPrimary = true;
    }
  }

  next();
});

module.exports = mongoose.model('Church', churchSchema);
