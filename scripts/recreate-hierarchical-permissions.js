const mongoose = require('mongoose');
require('dotenv').config();
require('../models/Permission');
require('../models/PermissionCategory');
const logger = require('../services/loggerService');

const Permission = mongoose.model('Permission');
const PermissionCategory = mongoose.model('PermissionCategory');

async function recreatePermissions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    // console.log('Connected to MongoDB');

    // Get the categories
    const unionCategory = await PermissionCategory.findOne({ name: 'unions' });
    const conferenceCategory = await PermissionCategory.findOne({
      name: 'conferences',
    });
    const churchCategory = await PermissionCategory.findOne({
      name: 'churches',
    });

    if (!unionCategory || !conferenceCategory || !churchCategory) {
      // console.error('Could not find all required categories');
      process.exit(1);
    }

    // console.log('Found categories:');
    // console.log(`- unions: ${unionCategory._id}`);
    // console.log(`- conferences: ${conferenceCategory._id}`);
    // console.log(`- churches: ${churchCategory._id}`);

    // Delete existing hierarchical permissions
    await Permission.deleteMany({
      key: { $regex: '^(unions|conferences|churches)\\.' },
    });
    // console.log('Deleted existing hierarchical permissions');

    // Define permissions for each category
    const permissions = [
      // Union permissions
      {
        key: 'unions.create',
        label: 'Create Unions',
        description: 'Create new union organizations',
        category: unionCategory._id,
        allowedScopes: ['all'],
        isSystem: true,
      },
      {
        key: 'unions.read',
        label: 'View Unions',
        description: 'View union information and details',
        category: unionCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'unions.update',
        label: 'Update Unions',
        description: 'Edit union information and settings',
        category: unionCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'unions.delete',
        label: 'Delete Unions',
        description: 'Delete union organizations',
        category: unionCategory._id,
        allowedScopes: ['all'],
        isSystem: true,
      },

      // Conference permissions
      {
        key: 'conferences.create',
        label: 'Create Conferences',
        description: 'Create new conference organizations',
        category: conferenceCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'conferences.read',
        label: 'View Conferences',
        description: 'View conference information and details',
        category: conferenceCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'conferences.update',
        label: 'Update Conferences',
        description: 'Edit conference information and settings',
        category: conferenceCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'conferences.delete',
        label: 'Delete Conferences',
        description: 'Delete conference organizations',
        category: conferenceCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
      },

      // Church permissions
      {
        key: 'churches.create',
        label: 'Create Churches',
        description: 'Create new church organizations',
        category: churchCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'churches.read',
        label: 'View Churches',
        description: 'View church information and details',
        category: churchCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'churches.update',
        label: 'Update Churches',
        description: 'Edit church information and settings',
        category: churchCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
      },
      {
        key: 'churches.delete',
        label: 'Delete Churches',
        description: 'Delete church organizations',
        category: churchCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
      },
    ];

    // Create permissions using the model
    for (const permData of permissions) {
      const permission = new Permission(permData);
      await permission.save();
      // console.log(`Created permission: ${permData.key}`);
    }

    // Verify the creation worked
    // console.log('\nVerification:');
    const createdPermissions = await Permission.find({
      key: { $regex: '^(unions|conferences|churches)\\.' },
    }).populate('category');

    logger.info(`Created ${createdPermissions.length} permissions`);
    createdPermissions.forEach((p) => logger.info(`  ${p.key} - ${p.label}`));

    // Test the grouping
    // console.log('\nTesting grouping:');
    const grouped = await Permission.getGroupedPermissions();
    const hierarchicalCategories = ['unions', 'conferences', 'churches'];
    hierarchicalCategories.forEach((cat) => {
      if (grouped[cat]) {
        // console.log(`✓ ${cat}: ${grouped[cat].permissions.length} permissions`);
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

recreatePermissions();
