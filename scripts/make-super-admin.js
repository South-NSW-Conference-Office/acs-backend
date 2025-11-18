require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
const Organization = require('../models/Organization');

async function makeSuperAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    // Connected to MongoDB

    // Find the user
    const user = await User.findOne({ email: 'bem@gyocc.org' });
    if (!user) {
      // Error: User not found
      // Error: User not found
      process.exit(1);
    }
    // Found user

    // Find the union_admin role (super admin)
    const superAdminRole = await Role.findOne({ name: 'union_admin' });
    if (!superAdminRole) {
      // Error: Union admin role not found
      // Error: Union admin role not found
      process.exit(1);
    }
    // Found union admin role

    // Find or create a union organization
    let unionOrg = await Organization.findOne({ type: 'union' });
    if (!unionOrg) {
      // No union organization found, creating one
      unionOrg = new Organization({
        name: 'Australian Union Conference',
        type: 'union',
        address: 'Australia',
        country: 'Australia',
        isActive: true,
      });
      await unionOrg.save();
      // Created union organization
    }
    // Using union organization

    // Update user with super admin role
    user.organizations = [
      {
        organization: unionOrg._id,
        role: superAdminRole._id,
        assignedAt: new Date(),
      },
    ];
    user.primaryOrganization = unionOrg._id;
    user.verified = true; // Also verify the user

    await user.save();
    // Successfully made user super admin with full permissions

    // Verify the update
    await User.findById(user._id)
      .populate('organizations.organization')
      .populate('organizations.role');

    // User details verification completed

    process.exit(0);
  } catch (error) {
    // Error occurred during super admin creation
    // Error occurred during super admin creation
    process.exit(1);
  }
}

makeSuperAdmin();
