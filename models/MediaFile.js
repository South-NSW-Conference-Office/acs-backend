const mongoose = require('mongoose');

const mediaFileSchema = new mongoose.Schema(
  {
    // File identification
    originalName: {
      type: String,
      required: true,
      trim: true,
    },

    fileName: {
      type: String,
      required: true,
      unique: true,
    },

    // Storage information
    key: {
      type: String,
      required: true,
      unique: true,
    },

    url: {
      type: String,
      required: true,
    },

    // File metadata
    mimeType: {
      type: String,
      required: true,
    },

    size: {
      type: Number,
      required: true,
    },

    dimensions: {
      width: Number,
      height: Number,
    },

    // File type and purpose
    type: {
      type: String,
      enum: ['banner', 'gallery', 'thumbnail', 'avatar', 'document'],
      required: true,
    },

    category: {
      type: String,
      enum: [
        'service',
        'union',
        'conference',
        'church',
        'team',
        'user',
        'general',
      ],
      default: 'general',
    },

    // User and ownership tracking
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Entity relationships (optional - for context)
    entityType: {
      type: String,
      enum: ['service', 'union', 'conference', 'church', 'team', 'user'],
    },

    entityId: {
      type: mongoose.Schema.Types.ObjectId,
    },

    // Additional metadata
    alt: {
      type: String,
      default: '',
    },

    caption: {
      type: String,
      default: '',
    },

    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    // Thumbnail information
    thumbnail: {
      key: String,
      url: String,
      size: Number,
    },

    // Status and visibility
    isActive: {
      type: Boolean,
      default: true,
    },

    isPublic: {
      type: Boolean,
      default: false,
    },

    // Usage tracking
    usageCount: {
      type: Number,
      default: 0,
    },

    lastUsedAt: {
      type: Date,
    },

    // Audit information
    metadata: {
      uploadedFrom: String, // IP address or source
      userAgent: String,
      processedAt: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
mediaFileSchema.index({ uploadedBy: 1, createdAt: -1 });
mediaFileSchema.index({ type: 1, category: 1 });
mediaFileSchema.index({ entityType: 1, entityId: 1 });
mediaFileSchema.index({ isActive: 1, isPublic: 1 });
mediaFileSchema.index({ tags: 1 });
mediaFileSchema.index({ originalName: 'text', alt: 'text', caption: 'text' }); // Text search

// Virtual for file extension
mediaFileSchema.virtual('extension').get(function () {
  return this.originalName.split('.').pop().toLowerCase();
});

// Virtual for formatted file size
mediaFileSchema.virtual('formattedSize').get(function () {
  const bytes = this.size;
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Virtual for full URL with fallback
mediaFileSchema.virtual('fullUrl').get(function () {
  return (
    this.url ||
    `${process.env.WASABI_ENDPOINT}/${process.env.WASABI_BUCKET}/${this.key}`
  );
});

// Ensure virtual fields are serialized
mediaFileSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

// Instance methods
mediaFileSchema.methods.incrementUsage = function () {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  return this.save();
};

mediaFileSchema.methods.updateMetadata = function (updates) {
  Object.assign(this.metadata, updates);
  return this.save();
};

// Static methods for user-specific queries
mediaFileSchema.statics.findByUser = function (userId, options = {}) {
  const {
    type,
    category,
    isActive = true,
    limit = 50,
    skip = 0,
    sort = { createdAt: -1 },
  } = options;

  const query = { uploadedBy: userId, isActive };

  if (type) query.type = type;
  if (category) query.category = category;

  return this.find(query)
    .sort(sort)
    .limit(limit)
    .skip(skip)
    .populate('uploadedBy', 'name email');
};

mediaFileSchema.statics.findAllForAdmin = function (options = {}) {
  const {
    type,
    category,
    isActive = true,
    limit = 50,
    skip = 0,
    sort = { createdAt: -1 },
    search,
  } = options;

  const query = { isActive };

  if (type) query.type = type;
  if (category) query.category = category;
  if (search) {
    query.$text = { $search: search };
  }

  return this.find(query)
    .sort(search ? { score: { $meta: 'textScore' } } : sort)
    .limit(limit)
    .skip(skip)
    .populate('uploadedBy', 'name email');
};

mediaFileSchema.statics.getStorageStats = function (userId = null) {
  const matchStage = userId
    ? {
        $match: {
          uploadedBy: new mongoose.Types.ObjectId(userId),
          isActive: true,
        },
      }
    : { $match: { isActive: true } };

  return this.aggregate([
    matchStage,
    {
      $group: {
        _id: null,
        totalFiles: { $sum: 1 },
        totalSize: { $sum: '$size' },
        byType: {
          $push: {
            type: '$type',
            size: '$size',
          },
        },
      },
    },
    {
      $addFields: {
        formattedTotalSize: {
          $switch: {
            branches: [
              {
                case: { $lt: ['$totalSize', 1024] },
                then: { $concat: [{ $toString: '$totalSize' }, ' B'] },
              },
              {
                case: { $lt: ['$totalSize', 1048576] },
                then: {
                  $concat: [
                    {
                      $toString: {
                        $round: [{ $divide: ['$totalSize', 1024] }, 2],
                      },
                    },
                    ' KB',
                  ],
                },
              },
              {
                case: { $lt: ['$totalSize', 1073741824] },
                then: {
                  $concat: [
                    {
                      $toString: {
                        $round: [{ $divide: ['$totalSize', 1048576] }, 2],
                      },
                    },
                    ' MB',
                  ],
                },
              },
            ],
            default: {
              $concat: [
                {
                  $toString: {
                    $round: [{ $divide: ['$totalSize', 1073741824] }, 2],
                  },
                },
                ' GB',
              ],
            },
          },
        },
      },
    },
  ]);
};

// Pre-save middleware
mediaFileSchema.pre('save', function (next) {
  // Update metadata timestamp
  if (!this.metadata) {
    this.metadata = {};
  }
  this.metadata.processedAt = new Date();
  next();
});

// Pre-remove middleware to clean up storage
mediaFileSchema.pre(
  'deleteOne',
  { document: true, query: false },
  async function () {
    const storageService = require('../services/storageService');

    try {
      // Delete main file
      if (this.key) {
        await storageService.deleteImage(this.key);
      }

      // Delete thumbnail if exists
      if (this.thumbnail && this.thumbnail.key) {
        await storageService.deleteImage(this.thumbnail.key);
      }
    } catch (error) {
      // Don't fail the delete operation if storage cleanup fails
    }
  }
);

module.exports = mongoose.model('MediaFile', mediaFileSchema);
