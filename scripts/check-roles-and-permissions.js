/* eslint-disable no-console */
const mongoose = require('mongoose');
require('dotenv').config();

const Role = require('../models/Role');
const Permission = require('../models/Permission');

async function checkRolesAndPermissions() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('Connected to MongoDB');

    // Get all roles
    const roles = await Role.find({}).sort({ level: -1, name: 1 });
    console.log(`\n📋 Found ${roles.length} roles:`);

    roles.forEach((role) => {
      console.log(`\n🔹 ${role.name} (${role.displayName})`);
      console.log(`   Level: ${role.level}`);
      console.log(`   Permissions (${role.permissions.length}):`);
      role.permissions.forEach((permission) => {
        console.log(`     - ${permission}`);
        if (permission === 'manage_service_types') {
          console.log('       ✅ HAS manage_service_types!');
        }
      });
    });

    // Check for Super Admin role specifically
    const superAdminRole = roles.find(
      (role) =>
        role.name.toLowerCase().includes('super') &&
        role.name.toLowerCase().includes('admin')
    );

    if (!superAdminRole) {
      console.log('\n❌ No Super Admin role found!');

      // Check if any role has manage_service_types
      const roleWithServiceTypes = roles.find((role) =>
        role.permissions.includes('manage_service_types')
      );

      if (roleWithServiceTypes) {
        console.log(
          `\n✅ Found role with manage_service_types: ${roleWithServiceTypes.name}`
        );
      } else {
        console.log('\n❌ NO role has manage_service_types permission!');
      }
    }

    // Get all available permissions
    console.log('\n🔍 Checking available permissions...');
    const permissions = await Permission.find({});
    console.log(`Found ${permissions.length} permissions in database:`);

    const serviceTypesPermission = permissions.find(
      (p) => p.name === 'manage_service_types'
    );
    if (serviceTypesPermission) {
      console.log('✅ manage_service_types permission exists in database');
    } else {
      console.log('❌ manage_service_types permission NOT found in database!');
      console.log('Available permissions:');
      permissions.forEach((p) => console.log(`  - ${p.name}`));
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

checkRolesAndPermissions();
