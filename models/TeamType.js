const mongoose = require('mongoose');

const teamTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false, // Set to true for system-wide default types
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure unique names per organization
teamTypeSchema.index({ name: 1, organizationId: 1 }, { unique: true });

// Static method to create default team types for an organization
teamTypeSchema.statics.createDefaultTypes = async function (
  organizationId,
  createdBy
) {
  const defaultTypes = [
    {
      name: 'ACS Service',
      description:
        'Primary community service teams for outreach and aid programs',
      organizationId,
      createdBy,
      isDefault: true,
      permissions: ['services.*', 'stories.*', 'users.read'],
    },
    {
      name: 'Communications',
      description:
        'Teams focused on outreach, marketing, and community engagement',
      organizationId,
      createdBy,
      isDefault: true,
      permissions: ['services.manage', 'stories.*', 'users.read'],
    },
    {
      name: 'General',
      description: 'Administrative and support teams',
      organizationId,
      createdBy,
      isDefault: true,
      permissions: ['users.read'],
    },
  ];

  try {
    // Check if default types already exist
    const existingTypes = await this.find({ organizationId, isDefault: true });

    if (existingTypes.length === 0) {
      await this.insertMany(defaultTypes);
    }
  } catch (error) {
    // If unique constraint fails, types already exist - ignore
    if (error.code !== 11000) {
      throw error;
    }
  }
};

// Instance method to get teams using this type
teamTypeSchema.methods.getTeams = function () {
  return mongoose.model('Team').find({
    type: this.name,
    organizationId: this.organizationId,
  });
};

// Virtual for team count
teamTypeSchema.virtual('teamCount', {
  ref: 'Team',
  localField: 'name',
  foreignField: 'type',
  count: true,
  match: function () {
    return { organizationId: this.organizationId };
  },
});

// Ensure virtuals are included when converting to JSON
teamTypeSchema.set('toJSON', { virtuals: true });

const TeamType = mongoose.model('TeamType', teamTypeSchema);

module.exports = TeamType;
