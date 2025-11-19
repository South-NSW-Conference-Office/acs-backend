const mongoose = require('mongoose');

const serviceTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    value: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z_]+$/,
    },
    description: {
      type: String,
      maxlength: 500,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
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
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

serviceTypeSchema.index({ value: 1 }, { unique: true });
serviceTypeSchema.index({ isActive: 1, displayOrder: 1 });
serviceTypeSchema.index({ deletedAt: 1 });

serviceTypeSchema.methods.softDelete = async function (userId) {
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.isActive = false;
  await this.save();
};

serviceTypeSchema.methods.restore = async function () {
  this.deletedAt = null;
  this.deletedBy = null;
  this.isActive = true;
  await this.save();
};

serviceTypeSchema.statics.findActive = function () {
  return this.find({ deletedAt: null, isActive: true }).sort(
    'displayOrder name'
  );
};

serviceTypeSchema.statics.findByValue = function (value) {
  return this.findOne({ value: value.toLowerCase(), deletedAt: null });
};

serviceTypeSchema.pre('save', function (next) {
  if (this.isModified('name') && !this.value) {
    this.value = this.name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z_]/g, '');
  }
  next();
});

const ServiceType = mongoose.model('ServiceType', serviceTypeSchema);

module.exports = ServiceType;
