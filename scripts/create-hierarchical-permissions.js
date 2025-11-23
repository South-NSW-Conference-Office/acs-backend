const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('../services/loggerService');

class HierarchicalPermissionCreator {
  constructor() {
    this.isVerbose = process.env.SCRIPT_VERBOSE === 'true';
  }

  log(message) {
    if (this.isVerbose) {
      logger.info(message);
    }
  }

  error(message) {
    logger.error(message);
  }

  async create() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      this.log('Connected to MongoDB');

      const PermissionCategory = mongoose.model(
        'PermissionCategory',
        new mongoose.Schema(
          {
            name: String,
            displayName: String,
            description: String,
            displayOrder: Number,
            isSystem: Boolean,
            isActive: { type: Boolean, default: true },
          },
          { timestamps: true }
        )
      );

      const Permission = mongoose.model(
        'Permission',
        new mongoose.Schema(
          {
            key: String,
            label: String,
            description: String,
            category: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'PermissionCategory',
            },
            allowedScopes: [String],
            isSystem: Boolean,
            isActive: { type: Boolean, default: true },
          },
          { timestamps: true }
        )
      );

      // Get the new categories
      const unionCategory = await PermissionCategory.findOne({
        name: 'unions',
      });
      const conferenceCategory = await PermissionCategory.findOne({
        name: 'conferences',
      });
      const churchCategory = await PermissionCategory.findOne({
        name: 'churches',
      });

      if (!unionCategory || !conferenceCategory || !churchCategory) {
        this.error('Could not find all required categories');
        process.exit(1);
      }

      this.log('Creating permissions for hierarchical categories...');

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

      for (const permData of permissions) {
        const existing = await Permission.findOne({ key: permData.key });
        if (existing) {
          this.log(`Permission ${permData.key} already exists`);
        } else {
          // Insert directly to bypass validation
          await Permission.collection.insertOne({
            ...permData,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          this.log(`Created permission: ${permData.key} (${permData.label})`);
        }
      }

      this.log('\nPermission creation complete!');
      process.exit(0);
    } catch (error) {
      this.error('Error:' + error);
      process.exit(1);
    }
  }
}

async function createPermissions() {
  const creator = new HierarchicalPermissionCreator();
  return creator.create();
}

createPermissions();
