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
    isActive: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false, // Set to true for system-wide default types
    },
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

// Ensure unique names globally
teamTypeSchema.index({ name: 1 }, { unique: true });

// Static method to create default team types
teamTypeSchema.statics.createDefaultTypes = async function (createdBy) {
  const defaultTypes = [
    {
      name: 'ACS Service',
      description:
        'Primary community service teams for outreach and aid programs',
      createdBy,
      isDefault: true,
    },
    {
      name: 'Communications',
      description:
        'Teams focused on outreach, marketing, and community engagement',
      createdBy,
      isDefault: true,
    },
    {
      name: 'General',
      description: 'Administrative and support teams',
      createdBy,
      isDefault: true,
    },
  ];

  try {
    // Check if default types already exist
    const existingTypes = await this.find({ isDefault: true });

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
  });
};

// Virtual for team count
teamTypeSchema.virtual('teamCount', {
  ref: 'Team',
  localField: 'name',
  foreignField: 'type',
  count: true,
});

// Ensure virtuals are included when converting to JSON
teamTypeSchema.set('toJSON', { virtuals: true });

const TeamType = mongoose.model('TeamType', teamTypeSchema);

module.exports = TeamType;
