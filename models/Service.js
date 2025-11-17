const mongoose = require('mongoose');

const serviceLocationSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
    },
    address: {
      street: String,
      suburb: String,
      state: String,
      postcode: String,
      country: { type: String, default: 'Australia' },
    },
    coordinates: {
      lat: Number,
      lng: Number,
    },
    isMobile: {
      type: Boolean,
      default: false,
    },
    openingHours: [
      {
        day: {
          type: String,
          enum: [
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
            'sunday',
          ],
        },
        open: String,
        close: String,
        closed: Boolean,
      },
    ],
  },
  { _id: false }
);

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'op_shop',
        'food_pantry',
        'soup_kitchen',
        'disaster_response',
        'health_program',
        'youth_outreach',
        'emergency_shelter',
        'counseling_service',
        'education_program',
        'community_garden',
        'other',
      ],
      required: true,
      index: true,
    },
    descriptionShort: {
      type: String,
      maxlength: 200,
      required: true,
    },
    descriptionLong: {
      type: String,
      required: true,
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    status: {
      type: String,
      enum: ['active', 'paused', 'archived'],
      default: 'active',
      index: true,
    },
    primaryImage: {
      url: String,
      alt: String,
    },
    gallery: [
      {
        url: String,
        alt: String,
        caption: String,
      },
    ],
    locations: [serviceLocationSchema],
    contactInfo: {
      email: String,
      phone: String,
      website: String,
    },
    socialMedia: {
      facebook: String,
      instagram: String,
      twitter: String,
    },
    eligibility: {
      requirements: String,
      ageGroups: [
        {
          type: String,
          enum: ['children', 'teens', 'adults', 'seniors'],
        },
      ],
    },
    capacity: {
      daily: Number,
      weekly: Number,
      notes: String,
    },
    featuredUntil: Date,
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

serviceSchema.index({
  name: 'text',
  descriptionShort: 'text',
  descriptionLong: 'text',
  tags: 'text',
});
serviceSchema.index({ organization: 1, status: 1 });
serviceSchema.index({ type: 1, status: 1 });
serviceSchema.index({ 'locations.coordinates': '2dsphere' });

serviceSchema.virtual('isActive').get(function () {
  return this.status === 'active';
});

serviceSchema.virtual('isFeatured').get(function () {
  return this.featuredUntil && this.featuredUntil > new Date();
});

serviceSchema.pre('save', function (next) {
  if (this.isModified()) {
    this.updatedBy = this.createdBy;
  }
  next();
});

serviceSchema.methods.canBeViewedBy = function (user) {
  return (
    this.status === 'active' ||
    (user &&
      user.organizations.some((org) =>
        org.organization.equals(this.organization)
      ))
  );
};

serviceSchema.statics.findActiveServices = function (filters = {}) {
  return this.find({ ...filters, status: 'active' })
    .populate('organization', 'name type')
    .sort('-createdAt');
};

serviceSchema.statics.findByOrganization = function (
  organizationId,
  includeArchived = false
) {
  const query = { organization: organizationId };
  if (!includeArchived) {
    query.status = { $ne: 'archived' };
  }
  return this.find(query).populate('organization', 'name type');
};

serviceSchema.statics.findNearby = function (coordinates, maxDistance = 50000) {
  return this.find({
    status: 'active',
    'locations.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [coordinates.lng, coordinates.lat],
        },
        $maxDistance: maxDistance,
      },
    },
  });
};

const Service = mongoose.model('Service', serviceSchema);

module.exports = Service;
