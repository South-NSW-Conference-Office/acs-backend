const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('../services/loggerService');

async function recreatePermissions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const db = mongoose.connection.db;

    // Get the categories
    const categories = await db
      .collection('permissioncategories')
      .find({
        name: { $in: ['unions', 'conferences', 'churches'] },
      })
      .toArray();

    const unionCategory = categories.find((c) => c.name === 'unions');
    const conferenceCategory = categories.find((c) => c.name === 'conferences');
    const churchCategory = categories.find((c) => c.name === 'churches');

    if (!unionCategory || !conferenceCategory || !churchCategory) {
      process.exit(1);
    }

    // Delete existing hierarchical permissions
    await db.collection('permissions').deleteMany({
      key: { $regex: '^(unions|conferences|churches)\\.' },
    });

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
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'unions.read',
        label: 'View Unions',
        description: 'View union information and details',
        category: unionCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'unions.update',
        label: 'Update Unions',
        description: 'Edit union information and settings',
        category: unionCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'unions.delete',
        label: 'Delete Unions',
        description: 'Delete union organizations',
        category: unionCategory._id,
        allowedScopes: ['all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },

      // Conference permissions
      {
        key: 'conferences.create',
        label: 'Create Conferences',
        description: 'Create new conference organizations',
        category: conferenceCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'conferences.read',
        label: 'View Conferences',
        description: 'View conference information and details',
        category: conferenceCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'conferences.update',
        label: 'Update Conferences',
        description: 'Edit conference information and settings',
        category: conferenceCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'conferences.delete',
        label: 'Delete Conferences',
        description: 'Delete conference organizations',
        category: conferenceCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },

      // Church permissions
      {
        key: 'churches.create',
        label: 'Create Churches',
        description: 'Create new church organizations',
        category: churchCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'churches.read',
        label: 'View Churches',
        description: 'View church information and details',
        category: churchCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'churches.update',
        label: 'Update Churches',
        description: 'Edit church information and settings',
        category: churchCategory._id,
        allowedScopes: ['own', 'subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        key: 'churches.delete',
        label: 'Delete Churches',
        description: 'Delete church organizations',
        category: churchCategory._id,
        allowedScopes: ['subordinate', 'all'],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // Create permissions directly in collection
    await db.collection('permissions').insertMany(permissions);

    // Test with the proper models now
    require('../models/Permission');
    require('../models/PermissionCategory');

    const Permission = mongoose.model('Permission');

    const createdPermissions = await Permission.find({
      key: { $regex: '^(unions|conferences|churches)\\.' },
    }).populate('category');

    logger.info(
      `Verified ${createdPermissions.length} hierarchical permissions created`
    );

    // Test the grouping
    const grouped = await Permission.getGroupedPermissions();
    const hierarchicalCategories = ['unions', 'conferences', 'churches'];
    hierarchicalCategories.forEach((cat) => {
      logger.info(`Hierarchical category '${cat}' exists: ${!!grouped[cat]}`);
    });

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

recreatePermissions();
