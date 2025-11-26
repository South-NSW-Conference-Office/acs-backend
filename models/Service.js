const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
    },
    churchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Church',
    },
    type: {
      type: String,
      required: true,
      validate: {
        validator: async function (value) {
          // Validate against dynamic service types from database
          const ServiceType = require('./ServiceType');
          const serviceType = await ServiceType.findOne({
            value: value,
            isActive: true,
          });
          return !!serviceType;
        },
        message:
          'Invalid service type. Please select from available service types.',
      },
    },
    descriptionShort: {
      type: String,
      maxlength: 200,
    },
    descriptionLong: {
      type: String,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    tags: [
      {
        type: String,
        maxlength: 50,
      },
    ],
    locations: [
      {
        label: {
          type: String,
          default: 'Main Location',
        },
        address: {
          street: String,
          suburb: String,
          state: String,
          postcode: String,
        },
        coordinates: {
          lat: Number,
          lng: Number,
        },
        isMobile: {
          type: Boolean,
          default: false,
        },
      },
    ],
    contactInfo: {
      phone: String,
      email: String,
      website: String,
    },
    eligibility: {
      requirements: [String],
      restrictions: [String],
      ageRequirements: {
        min: Number,
        max: Number,
      },
    },
    capacity: {
      maxParticipants: Number,
      currentParticipants: {
        type: Number,
        default: 0,
      },
    },
    primaryImage: {
      url: {
        type: String,
        default: null,
      },
      key: {
        type: String,
        default: null,
      },
      alt: {
        type: String,
        default: '',
      },
    },
    gallery: [
      {
        url: {
          type: String,
          required: true,
        },
        key: {
          type: String,
          required: true,
        },
        thumbnailUrl: {
          type: String,
        },
        thumbnailKey: {
          type: String,
        },
        alt: {
          type: String,
          default: '',
        },
        caption: {
          type: String,
          default: '',
        },
        type: {
          type: String,
          enum: ['image', 'video'],
          default: 'image',
        },
      },
    ],
    hierarchyPath: {
      type: String,
    },
    // Service Availability and Scheduling
    availability: {
      type: String,
      enum: ['always_open', 'set_times', 'set_events', null],
      default: null,
    },
    scheduling: {
      weeklySchedule: {
        timezone: {
          type: String,
          default: 'Australia/Sydney',
        },
        schedule: [
          {
            dayOfWeek: {
              type: Number,
              min: 0,
              max: 6,
            },
            timeSlots: [
              {
                startTime: String, // HH:mm format
                endTime: String, // HH:mm format
              },
            ],
            isEnabled: {
              type: Boolean,
              default: false,
            },
          },
        ],
      },
      events: [
        {
          name: {
            type: String,
            required: true,
            maxlength: 100,
          },
          description: {
            type: String,
            maxlength: 500,
          },
          startDateTime: {
            type: Date,
            required: true,
          },
          endDateTime: {
            type: Date,
            required: true,
          },
          timezone: {
            type: String,
            default: 'Australia/Sydney',
          },
          isRecurring: {
            type: Boolean,
            default: false,
          },
          recurrencePattern: {
            type: {
              type: String,
              enum: ['daily', 'weekly', 'monthly'],
            },
            interval: {
              type: Number,
              min: 1,
              max: 52,
            },
            endDate: Date,
            daysOfWeek: [
              {
                type: Number,
                min: 0,
                max: 6,
              },
            ],
          },
        },
      ],
      lastUpdated: {
        type: Date,
        default: Date.now,
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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

// Indexes for performance
serviceSchema.index({ teamId: 1, status: 1 });
serviceSchema.index({ churchId: 1, status: 1 });
serviceSchema.index({ hierarchyPath: 1 });
serviceSchema.index({ type: 1, status: 1 });
serviceSchema.index({ 'locations.coordinates': '2dsphere' });

// Pre-save middleware to auto-populate churchId and hierarchyPath
serviceSchema.pre('save', async function (next) {
  if (this.isNew || this.isModified('teamId')) {
    try {
      const Team = mongoose.model('Team');
      const team = await Team.findById(this.teamId).populate('churchId');

      if (!team) {
        throw new Error('Team not found');
      }

      if (!team.churchId) {
        throw new Error('Team must be assigned to a church');
      }

      this.churchId = team.churchId._id;
      // For new documents, _id might not exist yet, so use a placeholder and update in post-save
      if (this.isNew) {
        this.hierarchyPath = `${team.hierarchyPath}/service_new`;
      } else {
        this.hierarchyPath = `${team.hierarchyPath}/service_${this._id}`;
      }
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Post-save middleware to update hierarchyPath with correct _id for new documents
serviceSchema.post('save', async function (doc) {
  if (doc.hierarchyPath && doc.hierarchyPath.includes('/service_new')) {
    try {
      const Team = mongoose.model('Team');
      const team = await Team.findById(doc.teamId);
      if (team) {
        doc.hierarchyPath = `${team.hierarchyPath}/service_${doc._id}`;
        await doc.save();
      }
    } catch (error) {
      // Error updating hierarchyPath - fail silently to avoid breaking the save operation
    }
  }
});

// Static method to find services accessible to user based on hierarchy
serviceSchema.statics.findAccessibleServices = async function (
  userHierarchyPath
) {
  if (!userHierarchyPath) {
    return [];
  }

  // Find services where the hierarchy path starts with user's path
  const services = await this.find({
    hierarchyPath: new RegExp(
      `^${userHierarchyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    ),
    status: 'active',
  })
    .populate('teamId', 'name type')
    .populate('churchId', 'name')
    .sort({ name: 1 });

  return services;
};

// Static method to find services by team
serviceSchema.statics.findByTeam = async function (
  teamId,
  includeArchived = false
) {
  const query = { teamId };
  if (!includeArchived) {
    query.status = { $ne: 'archived' };
  }

  const services = await this.find(query)
    .populate('teamId', 'name type')
    .populate('churchId', 'name')
    .sort({ name: 1 });

  return services;
};

// Static method to find services by church
serviceSchema.statics.findByChurch = async function (
  churchId,
  includeArchived = false
) {
  const query = { churchId };
  if (!includeArchived) {
    query.status = { $ne: 'archived' };
  }

  const services = await this.find(query)
    .populate('teamId', 'name type')
    .populate('churchId', 'name')
    .sort({ name: 1 });

  return services;
};

// Static method for geographic search
serviceSchema.statics.findNearby = async function (
  coordinates,
  maxDistance = 50000
) {
  const services = await this.find({
    'locations.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [coordinates.lng, coordinates.lat],
        },
        $maxDistance: maxDistance,
      },
    },
    status: 'active',
  })
    .populate('teamId', 'name type')
    .populate('churchId', 'name')
    .sort({ name: 1 });

  return services;
};

// Instance method to check if service can be viewed by user
serviceSchema.methods.canBeViewedBy = function (user) {
  // Public services can be viewed by anyone
  if (this.status === 'active') {
    return true;
  }

  // Inactive or archived services require authentication
  return user && user.isActive;
};

module.exports = mongoose.model('Service', serviceSchema);
