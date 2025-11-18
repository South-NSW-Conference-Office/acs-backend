require('dotenv').config();
const mongoose = require('mongoose');
const Role = require('../models/Role');

async function fixSuperAdminPermissions() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    // Connected to MongoDB

    // Update union_admin role to have full permissions
    const result = await Role.findOneAndUpdate(
      { name: 'union_admin' },
      {
        permissions: ['*'], // Full wildcard permission
        description: 'Full system access for union administrators',
      },
      { new: true }
    );

    if (!result) {
      // Error: Union admin role not found
      // Error: Union admin role not found
      process.exit(1);
    }

    // Successfully updated union_admin role and permissions

    process.exit(0);
  } catch (error) {
    // Error occurred during permission update
    // Error occurred during permission update
    process.exit(1);
  }
}

fixSuperAdminPermissions();
