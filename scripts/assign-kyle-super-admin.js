/* eslint-disable no-console */
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Role = require('../models/Role');

async function assignKyleSuperAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('Connected to MongoDB');

    // Find Kyle Morrison
    const user = await User.findOne({
      email: 'kylemorrison@adventist.org.au',
    })
      .populate({
        path: 'organizations.role',
        model: 'Role',
      })
      .populate({
        path: 'organizations.organization',
        model: 'Organization',
      });

    if (!user) {
      console.log('❌ Kyle Morrison not found in the database');
      return;
    }

    console.log(`✅ Found Kyle Morrison: ${user.name} (${user.email})`);

    // Find the Super Admin role
    const superAdminRole = await Role.findOne({ name: 'super_admin' });
    if (!superAdminRole) {
      console.log('❌ Super Admin role not found!');
      return;
    }

    console.log(
      `✅ Found Super Admin role with permissions: ${superAdminRole.permissions.join(', ')}`
    );

    // Check if Kyle already has super admin role
    const hasSuperAdmin = user.organizations.some(
      (org) =>
        org.role && org.role._id.toString() === superAdminRole._id.toString()
    );

    if (hasSuperAdmin) {
      console.log('✅ Kyle Morrison already has Super Admin role');
      return;
    }

    // Get Kyle's current organization (Australia)
    const australiaOrg = user.organizations.find(
      (org) => org.organization && org.organization.name === 'Australia'
    );

    if (!australiaOrg) {
      console.log('❌ Kyle Morrison is not assigned to Australia organization');
      return;
    }

    console.log(
      `🔧 Updating Kyle's role from ${australiaOrg.role.name} to Super Admin...`
    );

    // Update the role for the Australia organization
    const orgIndex = user.organizations.findIndex(
      (org) => org.organization && org.organization.name === 'Australia'
    );

    if (orgIndex !== -1) {
      user.organizations[orgIndex].role = superAdminRole._id;
      user.organizations[orgIndex].assignedAt = new Date();

      await user.save();

      console.log('✅ Successfully assigned Kyle Morrison as Super Admin!');

      // Verify the change
      const updatedUser = await User.findById(user._id).populate({
        path: 'organizations.role',
        model: 'Role',
      });

      const updatedRole = updatedUser.organizations.find(
        (org) =>
          org.organization.toString() ===
          australiaOrg.organization._id.toString()
      );

      if (updatedRole && updatedRole.role.name === 'super_admin') {
        console.log('✅ Verification: Role assignment successful!');
        console.log(`   New role: ${updatedRole.role.name}`);
        console.log(
          `   Permissions: ${updatedRole.role.permissions.join(', ')}`
        );
      } else {
        console.log(
          '❌ Verification failed: Role assignment may not have worked'
        );
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

assignKyleSuperAdmin();
