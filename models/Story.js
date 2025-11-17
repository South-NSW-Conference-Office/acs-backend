const mongoose = require('mongoose');

const storySchema = new mongoose.Schema(
  {
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      index: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    summary: {
      type: String,
      required: true,
      maxlength: 500,
    },
    body: {
      type: String,
      required: true,
    },
    storyType: {
      type: String,
      enum: ['beneficiary', 'volunteer', 'donor', 'community', 'organization'],
      default: 'community',
    },
    impactMetrics: [
      {
        label: String,
        value: String,
        icon: String,
      },
    ],
    author: {
      name: String,
      role: String,
      organization: String,
    },
    featuredImage: {
      url: {
        type: String,
        required: true,
      },
      alt: String,
      caption: String,
      credit: String,
    },
    gallery: [
      {
        url: String,
        alt: String,
        caption: String,
        credit: String,
      },
    ],
    video: {
      url: String,
      embedCode: String,
      thumbnail: String,
      duration: String,
    },
    highlightedQuote: {
      text: String,
      attribution: String,
    },
    testimonials: [
      {
        quote: String,
        author: String,
        role: String,
        image: String,
      },
    ],
    callToAction: {
      enabled: {
        type: Boolean,
        default: false,
      },
      text: String,
      buttonText: String,
      link: String,
    },
    relatedServices: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
      },
    ],
    relatedStories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Story',
      },
    ],
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    categories: [
      {
        type: String,
        enum: [
          'success_story',
          'news',
          'update',
          'testimonial',
          'case_study',
          'annual_report',
        ],
        default: 'success_story',
      },
    ],
    status: {
      type: String,
      enum: ['draft', 'review', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    visibility: {
      type: String,
      enum: ['public', 'members_only', 'private'],
      default: 'public',
    },
    publishedAt: Date,
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    featuredOrder: {
      type: Number,
      default: 0,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    featuredUntil: Date,
    viewCount: {
      type: Number,
      default: 0,
    },
    shareCount: {
      type: Number,
      default: 0,
    },
    seo: {
      metaTitle: String,
      metaDescription: String,
      keywords: [String],
      ogImage: String,
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

storySchema.index({
  title: 'text',
  summary: 'text',
  body: 'text',
  tags: 'text',
});
storySchema.index({ slug: 1 });
storySchema.index({ organization: 1, status: 1 });
storySchema.index({ service: 1, status: 1 });
storySchema.index({ publishedAt: -1 });
storySchema.index({ isFeatured: 1, featuredOrder: 1 });

storySchema.virtual('isCurrentlyFeatured').get(function () {
  return (
    this.isFeatured && (!this.featuredUntil || this.featuredUntil > new Date())
  );
});

storySchema.virtual('readingTime').get(function () {
  const wordsPerMinute = 200;
  const wordCount = this.body.split(/\s+/).length;
  return Math.ceil(wordCount / wordsPerMinute);
});

storySchema.pre('save', async function (next) {
  if (!this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();

    const baseSlug = this.slug;
    let counter = 1;
    while (
      await mongoose
        .model('Story')
        .findOne({ slug: this.slug, _id: { $ne: this._id } })
    ) {
      this.slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }

  if (
    this.isModified('status') &&
    this.status === 'published' &&
    !this.publishedAt
  ) {
    this.publishedAt = new Date();
  }

  if (this.isModified()) {
    this.updatedBy = this.createdBy;
  }

  next();
});

storySchema.methods.publish = function (userId) {
  this.status = 'published';
  this.publishedAt = new Date();
  this.publishedBy = userId;
  return this.save();
};

storySchema.methods.unpublish = function () {
  this.status = 'draft';
  this.publishedAt = null;
  this.publishedBy = null;
  return this.save();
};

storySchema.methods.incrementViewCount = function () {
  this.viewCount += 1;
  return this.save();
};

storySchema.methods.incrementShareCount = function () {
  this.shareCount += 1;
  return this.save();
};

storySchema.methods.canBeViewedBy = function (user) {
  if (this.visibility === 'public' && this.status === 'published') return true;
  if (!user) return false;

  return user.organizations.some((org) =>
    org.organization.equals(this.organization)
  );
};

storySchema.statics.findPublished = function (filters = {}) {
  return this.find({
    ...filters,
    status: 'published',
  })
    .populate('service', 'name type')
    .populate('organization', 'name type')
    .sort('-publishedAt');
};

storySchema.statics.findFeatured = function (limit = 5) {
  return this.find({
    status: 'published',
    isFeatured: true,
    $or: [{ featuredUntil: null }, { featuredUntil: { $gt: new Date() } }],
  })
    .populate('service', 'name type')
    .populate('organization', 'name type')
    .sort('featuredOrder -publishedAt')
    .limit(limit);
};

storySchema.statics.findRelated = function (storyId, limit = 3) {
  return this.findById(storyId).then((story) => {
    if (!story) return [];

    return this.find({
      _id: { $ne: storyId },
      status: 'published',
      $or: [
        { service: story.service },
        { tags: { $in: story.tags } },
        { categories: { $in: story.categories } },
      ],
    })
      .populate('service', 'name type')
      .sort('-publishedAt')
      .limit(limit);
  });
};

const Story = mongoose.model('Story', storySchema);

module.exports = Story;
