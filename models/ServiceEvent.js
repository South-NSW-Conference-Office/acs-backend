const mongoose = require('mongoose');

const serviceEventSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    eventType: {
      type: String,
      enum: [
        'workshop',
        'training',
        'fundraiser',
        'community_meal',
        'distribution',
        'health_screening',
        'other',
      ],
      default: 'other',
    },
    start: {
      type: Date,
      required: true,
      index: true,
    },
    end: {
      type: Date,
      required: true,
      validate: {
        validator: function (value) {
          return value >= this.start;
        },
        message: 'End time must be after start time',
      },
    },
    location: {
      useServiceLocation: {
        type: Boolean,
        default: true,
      },
      customLocation: {
        name: String,
        address: {
          street: String,
          suburb: String,
          state: String,
          postcode: String,
        },
      },
    },
    locationText: {
      type: String,
      required: true,
    },
    capacity: {
      maximum: Number,
      registered: {
        type: Number,
        default: 0,
      },
    },
    registration: {
      required: {
        type: Boolean,
        default: false,
      },
      link: String,
      deadline: Date,
      contactEmail: String,
      contactPhone: String,
    },
    recurringPattern: {
      type: {
        type: String,
        enum: ['none', 'daily', 'weekly', 'monthly'],
        default: 'none',
      },
      interval: Number,
      daysOfWeek: [Number],
      endDate: Date,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'cancelled', 'completed'],
      default: 'draft',
      index: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'members_only', 'private'],
      default: 'public',
    },
    image: {
      url: String,
      alt: String,
    },
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
    cancelledAt: Date,
    cancelledReason: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

serviceEventSchema.index({ service: 1, start: 1 });
serviceEventSchema.index({ organization: 1, start: 1 });
serviceEventSchema.index({ name: 'text', description: 'text', tags: 'text' });

serviceEventSchema.virtual('isUpcoming').get(function () {
  return this.start > new Date() && this.status === 'published';
});

serviceEventSchema.virtual('isRegistrationOpen').get(function () {
  if (!this.registration.required) return false;
  if (this.status !== 'published') return false;
  if (this.registration.deadline && this.registration.deadline < new Date())
    return false;
  if (
    this.capacity.maximum &&
    this.capacity.registered >= this.capacity.maximum
  )
    return false;
  return true;
});

serviceEventSchema.virtual('spotsAvailable').get(function () {
  if (!this.capacity.maximum) return null;
  return Math.max(0, this.capacity.maximum - this.capacity.registered);
});

serviceEventSchema.pre('save', async function (next) {
  if (this.isNew && !this.organization) {
    const service = await mongoose
      .model('Service')
      .findById(this.service)
      .select('organization');
    if (service) {
      this.organization = service.organization;
    }
  }

  if (this.isModified()) {
    this.updatedBy = this.createdBy;
  }

  next();
});

serviceEventSchema.methods.cancel = function (reason, userId) {
  this.status = 'cancelled';
  this.cancelledAt = new Date();
  this.cancelledReason = reason;
  this.updatedBy = userId;
  return this.save();
};

serviceEventSchema.methods.canBeViewedBy = function (user) {
  if (this.visibility === 'public') return true;
  if (!user) return false;

  return user.organizations.some((org) =>
    org.organization.equals(this.organization)
  );
};

serviceEventSchema.statics.findUpcoming = function (filters = {}) {
  return this.find({
    ...filters,
    start: { $gt: new Date() },
    status: 'published',
  })
    .populate('service', 'name type')
    .populate('organization', 'name type')
    .sort('start');
};

serviceEventSchema.statics.findByDateRange = function (
  startDate,
  endDate,
  filters = {}
) {
  return this.find({
    ...filters,
    start: { $gte: startDate },
    end: { $lte: endDate },
    status: { $in: ['published', 'completed'] },
  })
    .populate('service', 'name type')
    .sort('start');
};

const ServiceEvent = mongoose.model('ServiceEvent', serviceEventSchema);

module.exports = ServiceEvent;
