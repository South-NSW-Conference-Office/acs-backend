/* eslint-disable no-console */
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Role = require('../models/Role');

async function checkKyleMorrison() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log('Connected to MongoDB');

    // Find Kyle Morrison by email (case insensitive)
    let user = await User.findOne({
      email: { $regex: new RegExp('kyle.*morrison', 'i') },
    })
      .populate({
        path: 'organizations.role',
        model: 'Role',
      })
      .populate({
        path: 'organizations.organization',
        model: 'Organization',
      });

    // Also check with exact email match
    if (!user) {
      const userByExact = await User.findOne({
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
      if (userByExact) {
        console.log('Found with exact email match');
        user = userByExact;
      }
    }

    if (!user) {
      console.log('❌ Kyle Morrison not found in the database');

      // Search for similar names
      console.log('\n🔍 Searching for similar names...');
      const similarUsers = await User.find({
        $or: [
          { name: { $regex: new RegExp('kyle', 'i') } },
          { name: { $regex: new RegExp('morrison', 'i') } },
          { email: { $regex: new RegExp('kyle', 'i') } },
          { email: { $regex: new RegExp('morrison', 'i') } },
        ],
      });

      if (similarUsers.length > 0) {
        console.log('Found similar users:');
        similarUsers.forEach((u) => {
          console.log(`- ${u.name} (${u.email})`);
        });
      }
      return;
    }

    console.log('\n✅ Found Kyle Morrison:');
    console.log(`Name: ${user.name}`);
    console.log(`Email: ${user.email}`);
    console.log(`User ID: ${user._id}`);
    console.log(`Verified: ${user.verified}`);
    console.log(`Active: ${user.isActive}`);

    // Check organizations and roles
    console.log('\n📋 Organization Assignments:');
    if (user.organizations.length === 0) {
      console.log('❌ No organization assignments found!');
    } else {
      for (const orgAssignment of user.organizations) {
        const role = orgAssignment.role;
        const org = orgAssignment.organization;

        console.log(`\n🏢 Organization: ${org ? org.name : 'Unknown'}`);
        console.log(
          `   Role: ${role ? role.name : 'Unknown'} (${role ? role.displayName : 'N/A'})`
        );
        console.log(`   Role Level: ${role ? role.level : 'N/A'}`);

        if (role && role.permissions) {
          console.log(`   Permissions (${role.permissions.length}):`);
          role.permissions.forEach((permission) => {
            console.log(`     - ${permission}`);
            if (permission === 'manage_service_types') {
              console.log('       ✅ HAS manage_service_types permission!');
            }
          });

          // Check if manage_service_types permission is missing
          if (!role.permissions.includes('manage_service_types')) {
            console.log('     ❌ MISSING manage_service_types permission!');
          }
        } else {
          console.log('     ❌ No permissions found for this role!');
        }
      }
    }

    // Check if this user has Super Admin role
    console.log('\n🔍 Checking for Super Admin role...');
    const superAdminRole = await Role.findOne({ name: 'Super Admin' });
    if (superAdminRole) {
      console.log(`Super Admin role found with ID: ${superAdminRole._id}`);
      console.log(
        `Super Admin permissions: ${superAdminRole.permissions.join(', ')}`
      );

      const hasSuperAdminRole = user.organizations.some(
        (org) =>
          org.role && org.role._id.toString() === superAdminRole._id.toString()
      );

      if (hasSuperAdminRole) {
        console.log('✅ User HAS Super Admin role');
      } else {
        console.log('❌ User does NOT have Super Admin role');
      }
    } else {
      console.log('❌ Super Admin role not found in database!');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

checkKyleMorrison();
