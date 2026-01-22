const mongoose = require('mongoose');

const contentBlockSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ['text', 'richtext', 'image', 'cta'],
    default: 'richtext',
  },
  content: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  order: {
    type: Number,
    default: 0,
  },
  metadata: {
    label: String,
    description: String,
    placeholder: String,
    maxLength: Number,
  },
});

const sectionSchema = new mongoose.Schema({
  sectionId: {
    type: String,
    required: true,
    trim: true,
  },
  sectionName: {
    type: String,
    required: true,
    trim: true,
  },
  description: String,
  order: {
    type: Number,
    default: 0,
  },
  blocks: [contentBlockSchema],
  isEnabled: {
    type: Boolean,
    default: true,
  },
});

const pageContentSchema = new mongoose.Schema(
  {
    pageId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    pageName: {
      type: String,
      required: true,
      trim: true,
    },
    description: String,
    slug: {
      type: String,
      required: true,
      trim: true,
    },
    sections: [sectionSchema],
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    publishedAt: Date,
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
  }
);

// Indexes
pageContentSchema.index({ pageId: 1, status: 1 });
pageContentSchema.index({ status: 1, publishedAt: -1 });

// Static method to find published content for a page
pageContentSchema.statics.findPublished = function (pageId) {
  return this.findOne({ pageId, status: 'published' });
};

// Static method to find all published pages
pageContentSchema.statics.findAllPublished = function () {
  return this.find({ status: 'published' }).sort('pageName');
};

// Static method to find by pageId (any status)
pageContentSchema.statics.findByPageId = function (pageId) {
  return this.findOne({ pageId });
};

// Instance method to get a specific block content
pageContentSchema.methods.getBlockContent = function (sectionId, blockKey) {
  const section = this.sections.find((s) => s.sectionId === sectionId);
  if (!section) return null;

  const block = section.blocks.find((b) => b.key === blockKey);
  return block ? block.content : null;
};

// Instance method to update a specific block content
pageContentSchema.methods.updateBlockContent = function (
  sectionId,
  blockKey,
  content
) {
  const section = this.sections.find((s) => s.sectionId === sectionId);
  if (!section) return false;

  const block = section.blocks.find((b) => b.key === blockKey);
  if (!block) return false;

  block.content = content;
  return true;
};

module.exports = mongoose.model('PageContent', pageContentSchema);
