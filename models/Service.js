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
      required: true,
    },
    type: {
      type: String,
      enum: [
        'food_distribution',
        'clothing_assistance',
        'disaster_relief',
        'health_services',
        'education_support',
        'elderly_care',
        'youth_programs',
        'community_service',
        'financial_assistance',
        'counseling_services',
        'other'
      ],
      default: 'community_service',
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
    tags: [{
      type: String,
      maxlength: 50,
    }],
    locations: [{
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        index: '2dsphere',
      },
      address: String,
      name: String,
    }],
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
    hierarchyPath: {
      type: String,
      required: true,
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
      this.hierarchyPath = `${team.hierarchyPath}/service_${this._id}`;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Static method to find services accessible to user based on hierarchy
serviceSchema.statics.findAccessibleServices = async function (userHierarchyPath) {
  if (!userHierarchyPath) {
    return [];
  }
  
  // Find services where the hierarchy path starts with user's path
  const services = await this.find({
    hierarchyPath: new RegExp(`^${userHierarchyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    status: 'active'
  })
  .populate('teamId', 'name type')
  .populate('churchId', 'name')
  .sort({ name: 1 });
  
  return services;
};

// Static method to find services by team
serviceSchema.statics.findByTeam = async function (teamId, includeArchived = false) {
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
serviceSchema.statics.findByChurch = async function (churchId, includeArchived = false) {
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
serviceSchema.statics.findNearby = async function (coordinates, maxDistance = 50000) {
  const services = await this.find({
    'locations.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [coordinates.lng, coordinates.lat]
        },
        $maxDistance: maxDistance
      }
    },
    status: 'active'
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