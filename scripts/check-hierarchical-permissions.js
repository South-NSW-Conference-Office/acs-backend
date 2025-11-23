const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('../services/loggerService');

class PermissionChecker {
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

  async check() {
    try {
      await mongoose.connect(process.env.MONGODB_URI);

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

      this.log('Checking permissions for hierarchical categories...');

      const hierarchicalPerms = await Permission.find({
        key: { $regex: '^(unions|conferences|churches)\\.' },
      });

      this.log(`Found ${hierarchicalPerms.length} hierarchical permissions:`);
      hierarchicalPerms.forEach((perm) => {
        this.log(`- ${perm.key} (category: ${perm.category})`);
      });

      if (hierarchicalPerms.length === 0) {
        this.log(
          'No hierarchical permissions found. Need to check if they were created properly.'
        );

        // Check all permissions to see what exists
        const allPerms = await Permission.find({}).limit(20);
        this.log('\nFirst 20 permissions in database:');
        allPerms.forEach((perm) => {
          this.log(`- ${perm.key}`);
        });
      }

      process.exit(0);
    } catch (error) {
      this.error('Error:' + error);
      process.exit(1);
    }
  }
}

async function checkPermissions() {
  const checker = new PermissionChecker();
  return checker.check();
}

checkPermissions();
