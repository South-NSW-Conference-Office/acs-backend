const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('../services/loggerService');

class RawPermissionChecker {
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

      const db = mongoose.connection.db;

      // Check raw permission data
      const permissions = await db
        .collection('permissions')
        .find({
          key: { $regex: '^unions\\.' },
        })
        .toArray();

      this.log('Raw union permissions:');
      permissions.forEach((perm) => {
        this.log(
          `- ${perm.key} -> category type: ${typeof perm.category}, value: ${perm.category}`
        );
      });

      // Check if categories are valid ObjectIds
      const categories = await db
        .collection('permissioncategories')
        .find({
          name: { $in: ['unions', 'conferences', 'churches'] },
        })
        .toArray();

      this.log('\nCategories:');
      categories.forEach((cat) => {
        this.log(`- ${cat.name} -> _id: ${cat._id} (type: ${typeof cat._id})`);
      });

      // Test if the ObjectId references match
      if (permissions.length > 0 && categories.length > 0) {
        const unionCategory = categories.find((c) => c.name === 'unions');
        const unionPerm = permissions[0];

        this.log('\nReference check:');
        this.log(`Union category _id: ${unionCategory._id}`);
        this.log(`Permission category: ${unionPerm.category}`);
        this.log(
          `Types match: ${typeof unionCategory._id === typeof unionPerm.category}`
        );
        this.log(
          `Values equal: ${unionCategory._id.toString() === unionPerm.category.toString()}`
        );
      }

      process.exit(0);
    } catch (error) {
      this.error('Error:' + error);
      process.exit(1);
    }
  }
}

async function checkRawPermissions() {
  const checker = new RawPermissionChecker();
  return checker.check();
}

checkRawPermissions();
