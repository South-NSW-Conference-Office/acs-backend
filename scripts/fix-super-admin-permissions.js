require('dotenv').config();
const mongoose = require('mongoose');
const Role = require('../models/Role');
const User = require('../models/User');

async function fixSuperAdminPermissions() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // Update super_admin role to have full permissions
    const result = await Role.findOneAndUpdate(
      { name: 'super_admin' },
      {
        permissions: ['*'], // Full wildcard permission
        description: 'Full system access - super administrator',
      },
      { new: true }
    );

    if (!result) {
      process.exit(1);
    }

    // Find users with super_admin role to verify
    await User.find({
      'organizations.role': result._id,
    }).populate('organizations.organization');

    // Super admin users processed

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

fixSuperAdminPermissions();
