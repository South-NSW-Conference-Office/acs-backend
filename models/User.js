const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const organizationAssignmentSchema = new mongoose.Schema({
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
  },
  assignedAt: {
    type: Date,
    default: Date.now,
  },
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  expiresAt: {
    type: Date,
  },
});

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    phone: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
      default: 'Australia',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    avatar: {
      type: String,
    },
    organizations: [organizationAssignmentSchema],
    primaryOrganization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Virtual for id (compatibility with frontend)
userSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
  virtuals: true,
  transform: function (doc, ret) {
    delete ret.password;
    return ret;
  },
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Get user permissions for a specific organization
userSchema.methods.getPermissionsForOrganization = async function (
  organizationId
) {
  const assignment = this.organizations.find(
    (org) => org.organization.toString() === organizationId.toString()
  );

  if (!assignment) {
    return { role: null, permissions: [] };
  }

  await this.populate('organizations.role');
  const role = assignment.role;

  return {
    role: {
      id: role._id,
      name: role.name,
      displayName: role.displayName,
      level: role.level,
    },
    permissions: role.permissions || [],
    organization: organizationId,
  };
};

module.exports = mongoose.model('User', userSchema);
