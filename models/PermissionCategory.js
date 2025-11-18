const mongoose = require('mongoose');

const permissionCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    icon: {
      type: String,
      trim: true,
    },
    displayOrder: {
      type: Number,
      default: 100,
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster lookups and sorting
permissionCategorySchema.index({ name: 1 });
permissionCategorySchema.index({ displayOrder: 1 });
permissionCategorySchema.index({ isActive: 1 });

// Static method to get active categories ordered
permissionCategorySchema.statics.getActiveCategories = async function () {
  return this.find({ isActive: true }).sort('displayOrder name');
};

// Prevent deletion of system categories
permissionCategorySchema.pre('remove', async function (next) {
  if (this.isSystem) {
    const error = new Error('System permission categories cannot be deleted');
    error.statusCode = 403;
    return next(error);
  }

  // Check if any permissions are using this category
  const Permission = mongoose.model('Permission');
  const permissionCount = await Permission.countDocuments({
    category: this._id,
  });
  if (permissionCount > 0) {
    const error = new Error(
      `Cannot delete category with ${permissionCount} associated permissions`
    );
    error.statusCode = 400;
    return next(error);
  }

  next();
});

// Prevent modification of system category names
permissionCategorySchema.pre('save', async function (next) {
  if (this.isSystem && this.isModified('name')) {
    const error = new Error(
      'System permission category names cannot be modified'
    );
    error.statusCode = 403;
    return next(error);
  }
  next();
});

module.exports = mongoose.model('PermissionCategory', permissionCategorySchema);
