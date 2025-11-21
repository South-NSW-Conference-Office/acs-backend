const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          // Validate permission format: resource.action
          return /^[a-z_]+\.[a-z_]+$/.test(v);
        },
        message:
          'Permission key must be in format: resource.action (e.g., users.create)',
      },
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PermissionCategory',
      required: true,
    },
    allowedScopes: [
      {
        type: String,
        enum: [
          'self',
          'own',
          'subordinate',
          'all',
          'acs_team',
          'acs',
          'public',
          'team',
          'team_subordinate',
          'service',
          'region',
        ],
      },
    ],
    isSystem: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
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

// Index for faster lookups
permissionSchema.index({ key: 1 });
permissionSchema.index({ category: 1 });
permissionSchema.index({ isActive: 1 });

// Static method to find active permissions by category
permissionSchema.statics.findByCategory = async function (categoryId) {
  return this.find({ category: categoryId, isActive: true })
    .populate('category')
    .sort('key');
};

// Static method to get all active permissions grouped by category
permissionSchema.statics.getGroupedPermissions = async function () {
  const permissions = await this.find({ isActive: true })
    .populate('category')
    .sort('category.displayOrder key');

  // Group by category
  const grouped = {};
  permissions.forEach((perm) => {
    const categoryName = perm.category.name;
    if (!grouped[categoryName]) {
      grouped[categoryName] = {
        category: perm.category,
        permissions: [],
      };
    }
    grouped[categoryName].permissions.push(perm);
  });

  return grouped;
};

// Instance method to check if permission allows a specific scope
permissionSchema.methods.allowsScope = function (scope) {
  if (!scope) return true;
  if (this.allowedScopes.length === 0) return true;
  return this.allowedScopes.includes(scope);
};

// Prevent deletion of system permissions
permissionSchema.pre('remove', async function (next) {
  if (this.isSystem) {
    const error = new Error('System permissions cannot be deleted');
    error.statusCode = 403;
    return next(error);
  }
  next();
});

// Prevent modification of system permission keys
permissionSchema.pre('save', async function (next) {
  if (this.isSystem && this.isModified('key')) {
    const error = new Error('System permission keys cannot be modified');
    error.statusCode = 403;
    return next(error);
  }
  next();
});

module.exports = mongoose.model('Permission', permissionSchema);
