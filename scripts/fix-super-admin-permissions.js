require('dotenv').config();
const mongoose = require('mongoose');
const Role = require('../models/Role');
const User = require('../models/User');

async function fixSuperAdminPermissions() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

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
      console.error('Error: Super admin role not found');
      process.exit(1);
    }

    console.log('Successfully updated super_admin role with wildcard permissions');
    console.log('Permissions:', result.permissions);

    // Find users with super_admin role to verify
    const superAdminUsers = await User.find({
      'organizations.role': result._id
    }).populate('organizations.organization');

    console.log(`\nFound ${superAdminUsers.length} users with super_admin role`);
    
    for (const user of superAdminUsers) {
      console.log(`- ${user.name} (${user.email})`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error occurred during permission update:', error.message);
    process.exit(1);
  }
}

fixSuperAdminPermissions();
