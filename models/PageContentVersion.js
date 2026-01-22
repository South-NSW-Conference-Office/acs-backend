const mongoose = require('mongoose');

const pageContentVersionSchema = new mongoose.Schema(
  {
    pageContent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PageContent',
      required: true,
      index: true,
    },
    pageId: {
      type: String,
      required: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
    },
    sections: mongoose.Schema.Types.Mixed,
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    changeDescription: String,
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient version queries
pageContentVersionSchema.index({ pageContent: 1, version: -1 });
pageContentVersionSchema.index({ pageId: 1, version: -1 });

// Static method to get version history for a page
pageContentVersionSchema.statics.getVersionHistory = function (
  pageContentId,
  limit = 20
) {
  return this.find({ pageContent: pageContentId })
    .populate('createdBy', 'firstName lastName email')
    .sort({ version: -1 })
    .limit(limit);
};

// Static method to get a specific version
pageContentVersionSchema.statics.getVersion = function (
  pageContentId,
  version
) {
  return this.findOne({ pageContent: pageContentId, version }).populate(
    'createdBy',
    'firstName lastName email'
  );
};

// Static method to create a new version snapshot
pageContentVersionSchema.statics.createSnapshot = async function (
  pageContent,
  userId,
  changeDescription = ''
) {
  const snapshot = new this({
    pageContent: pageContent._id,
    pageId: pageContent.pageId,
    version: pageContent.version,
    sections: JSON.parse(JSON.stringify(pageContent.sections)),
    status: pageContent.status,
    createdBy: userId,
    changeDescription,
  });

  return snapshot.save();
};

module.exports = mongoose.model('PageContentVersion', pageContentVersionSchema);
