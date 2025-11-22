require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Role = require('../models/Role');

async function checkUserOrganizations() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // You'll need to specify the user email here
    const userEmail = process.argv[2];
    
    if (!userEmail) {
      console.error('Please provide user email as argument: node check-user-organizations.js user@example.com');
      process.exit(1);
    }

    // Find the user
    const user = await User.findOne({ email: userEmail })
      .populate('organizations.organization')
      .populate('organizations.role')
      .populate('primaryOrganization');

    if (!user) {
      console.error(`User not found: ${userEmail}`);
      process.exit(1);
    }

    console.log(`\n👤 User: ${user.name} (${user.email})`);
    console.log(`   ID: ${user._id}`);
    console.log(`   Primary Organization ID: ${user.primaryOrganization?._id || user.primaryOrganization || 'None'}`);
    console.log(`   Organizations: ${user.organizations.length}`);

    if (user.organizations.length === 0) {
      console.log('\n❌ USER HAS NO ORGANIZATION ASSIGNMENTS!');
      
      // Check if the primary organization exists
      if (user.primaryOrganization) {
        const primaryOrgId = user.primaryOrganization._id || user.primaryOrganization;
        const org = await Organization.findById(primaryOrgId);
        if (org) {
          console.log(`\n📍 Primary organization "${org.name}" exists but user has no role assignment for it`);
        } else {
          console.log('\n❌ Primary organization ID is set but organization not found!');
        }
      }

      // Find super_admin role
      const superAdminRole = await Role.findOne({ name: 'super_admin' });
      if (superAdminRole) {
        console.log(`\n✅ Super admin role found: ${superAdminRole._id}`);
        console.log(`   Permissions: ${superAdminRole.permissions.join(', ')}`);
        console.log('\n💡 You need to assign this role to the user!');
      }

    } else {
      console.log('\n📋 Organization Assignments:');
      user.organizations.forEach((org, index) => {
        console.log(`\n   ${index + 1}. Organization: ${org.organization?.name || 'Unknown'}`);
        console.log(`      Organization ID: ${org.organization?._id || 'Missing'}`);
        console.log(`      Role: ${org.role?.name || 'No role'}`);
        console.log(`      Role Permissions: ${org.role?.permissions?.join(', ') || 'No permissions'}`);
        console.log(`      Assigned At: ${org.assignedAt}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkUserOrganizations();