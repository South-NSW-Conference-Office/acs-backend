const mongoose = require('mongoose');
require('dotenv').config();
require('../models/Permission');
require('../models/PermissionCategory');
const logger = require('../services/loggerService');

const Permission = mongoose.model('Permission');

async function testUnionPermissions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    // console.log('Testing permission API response...');

    // Simulate what the API returns for union level roles
    const groupedPermissions = await Permission.getGroupedPermissions();

    const categoryHierarchyRequirements = {
      system: 0,
      unions: 0,
      conferences: 0,
      churches: 0,
      users: 1,
      roles: 1,
      teams: 2,
      services: 2,
      stories: 2,
      dashboard: 2,
    };

    const userHierarchyLevel = 0; // Union level (super admin)

    // Filter permissions based on role hierarchy level
    const filteredPermissions = {};

    for (const [categoryName, data] of Object.entries(groupedPermissions)) {
      const requiredLevel = categoryHierarchyRequirements[categoryName];

      // Skip categories that require higher hierarchy level
      if (requiredLevel !== undefined && userHierarchyLevel > requiredLevel) {
        continue;
      }

      filteredPermissions[categoryName] = data.permissions.map((perm) => ({
        key: perm.key,
        label: perm.label,
        description: perm.description,
        allowedScopes: perm.allowedScopes,
        isSystem: perm.isSystem,
      }));
    }

    // console.log('Available categories for union level role:');
    Object.keys(filteredPermissions).forEach((cat) => {
      const permCount = filteredPermissions[cat].length;
      logger.info(`- ${cat} (${permCount} permissions)`);
    });

    // Check specifically for the three new categories
    const newCategories = ['unions', 'conferences', 'churches'];
    // console.log('\nNew hierarchical categories status:');
    newCategories.forEach((cat) => {
      if (filteredPermissions[cat]) {
        // console.log(`✓ ${cat}: ${filteredPermissions[cat].length} permissions`);
      } else {
        // console.log(`✗ ${cat}: not found`);
      }
    });

    process.exit(0);
  } catch (error) {
    // console.error('Error:', error);
    process.exit(1);
  }
}

testUnionPermissions();
