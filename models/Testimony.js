const mongoose = require('mongoose');

const testimonySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    location: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    review: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    image: {
      url: {
        type: String,
        required: true,
      },
      alt: String,
      key: String,
    },
    status: {
      type: String,
      enum: ['draft', 'pending', 'approved', 'rejected'],
      default: 'draft',
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    featuredOrder: {
      type: Number,
      default: 0,
    },
    rejectionReason: {
      type: String,
      maxlength: 500,
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
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
testimonySchema.index({ name: 'text', location: 'text', review: 'text' });
testimonySchema.index({ status: 1, isFeatured: 1 });
testimonySchema.index({ isFeatured: 1, featuredOrder: 1 });
testimonySchema.index({ createdAt: -1 });
testimonySchema.index({ approvedAt: -1 });

// Static methods
testimonySchema.statics.findApproved = function (filters = {}) {
  return this.find({
    ...filters,
    status: 'approved',
  }).sort('-approvedAt');
};

testimonySchema.statics.findFeatured = function (limit = 8) {
  return this.find({
    status: 'approved',
    isFeatured: true,
  })
    .sort('featuredOrder -approvedAt')
    .limit(limit);
};

testimonySchema.statics.findPending = function () {
  return this.find({
    status: 'pending',
  })
    .populate('createdBy', 'firstName lastName email')
    .sort('-createdAt');
};

// Instance methods
testimonySchema.methods.submit = function () {
  if (this.status !== 'draft') {
    throw new Error('Only draft testimonies can be submitted for approval');
  }
  this.status = 'pending';
  return this.save();
};

testimonySchema.methods.approve = function (userId) {
  if (this.status !== 'pending') {
    throw new Error('Only pending testimonies can be approved');
  }
  this.status = 'approved';
  this.approvedAt = new Date();
  this.approvedBy = userId;
  this.rejectionReason = undefined;
  return this.save();
};

testimonySchema.methods.reject = function (userId, reason) {
  if (this.status !== 'pending') {
    throw new Error('Only pending testimonies can be rejected');
  }
  this.status = 'rejected';
  this.rejectionReason = reason;
  this.updatedBy = userId;
  return this.save();
};

testimonySchema.methods.setFeatured = function (featured, order = 0) {
  if (this.status !== 'approved') {
    throw new Error('Only approved testimonies can be featured');
  }
  this.isFeatured = featured;
  this.featuredOrder = order;
  return this.save();
};

const Testimony = mongoose.model('Testimony', testimonySchema);

module.exports = Testimony;
