const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
require('dotenv').config();

async function assignSuperAdminRole() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    // Connected to MongoDB

    // Find the user
    const userEmail = 'kylemorrison@adventist.org.au';
    const user = await User.findOne({ email: userEmail }).populate(
      'organizations.organization organizations.role'
    );

    if (!user) {
      // Error: User not found
      // Error: User not found
      process.exit(1);
    }

    // Found user

    // Find the super_admin role
    const superAdminRole = await Role.findOne({ name: 'super_admin' });

    if (!superAdminRole) {
      // Error: Super admin role not found
      // Error: Super admin role not found
      process.exit(1);
    }

    // Found super_admin role

    // Update the user's role for their primary organization
    let updated = false;

    for (let i = 0; i < user.organizations.length; i++) {
      const org = user.organizations[i];
      if (
        org.organization._id.toString() === user.primaryOrganization?.toString()
      ) {
        // Updating role for organization
        user.organizations[i].role = superAdminRole._id;
        updated = true;
        break;
      }
    }

    // If no primary organization match, update the first organization
    if (!updated && user.organizations.length > 0) {
      // Updating role for first organization
      user.organizations[0].role = superAdminRole._id;
      updated = true;
    }

    if (!updated) {
      // Error: No organization found to update role
      // Error: No organization found to update role
      process.exit(1);
    }

    // Save the user
    await user.save();
    // Successfully assigned super_admin role

    // Verify the permissions
    await User.findById(user._id).populate(
      'organizations.organization organizations.role'
    );

    // Verification completed
  } catch (error) {
    // Error occurred during assignment
    // Error occurred during assignment
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    // Database connection closed
  }
}

// Run the script
assignSuperAdminRole();
