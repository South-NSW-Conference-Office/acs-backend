const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['union', 'conference', 'church'],
    lowercase: true
  },
  parentOrganization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null
  },
  metadata: {
    address: {
      type: String,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    territory: [{
      type: String,
      trim: true
    }],
    email: {
      type: String,
      lowercase: true,
      trim: true
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Virtual to populate parent organization details
organizationSchema.virtual('parent', {
  ref: 'Organization',
  localField: 'parentOrganization',
  foreignField: '_id',
  justOne: true
});

// Virtual to get child organizations
organizationSchema.virtual('children', {
  ref: 'Organization',
  localField: '_id',
  foreignField: 'parentOrganization'
});

// Ensure virtual fields are serialized
organizationSchema.set('toJSON', {
  virtuals: true
});

// Pre-save middleware to validate hierarchy
organizationSchema.pre('save', function(next) {
  // Validation logic for organization hierarchy
  if (this.type === 'union' && this.parentOrganization) {
    return next(new Error('Union organizations cannot have a parent organization'));
  }
  
  if (this.type === 'conference' && !this.parentOrganization) {
    return next(new Error('Conference organizations must have a parent union'));
  }
  
  if (this.type === 'church' && !this.parentOrganization) {
    return next(new Error('Church organizations must have a parent conference'));
  }
  
  next();
});

// Static method to get organization hierarchy
organizationSchema.statics.getHierarchy = async function(organizationId) {
  const org = await this.findById(organizationId).populate('parentOrganization');
  
  if (!org) {
    throw new Error('Organization not found');
  }
  
  const hierarchy = [org];
  let current = org;
  
  // Get all parent organizations
  while (current.parentOrganization) {
    current = await this.findById(current.parentOrganization._id).populate('parentOrganization');
    hierarchy.unshift(current);
  }
  
  return hierarchy;
};

// Static method to get subordinate organizations
organizationSchema.statics.getSubordinates = async function(organizationId) {
  const getAllSubordinates = async (orgId) => {
    const children = await this.find({ parentOrganization: orgId });
    let result = [...children];
    
    for (const child of children) {
      const subChildren = await getAllSubordinates(child._id);
      result = result.concat(subChildren);
    }
    
    return result;
  };
  
  return getAllSubordinates(organizationId);
};

module.exports = mongoose.model('Organization', organizationSchema);