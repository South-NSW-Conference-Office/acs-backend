const mongoose = require('mongoose');
require('dotenv').config();
require('../models/Permission');
require('../models/PermissionCategory');
const logger = require('../services/loggerService');

const Permission = mongoose.model('Permission');

async function debugGroupedPermissions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Get raw permissions to debug
    const allPermissions = await Permission.find({ isActive: true })
      .populate('category')
      .sort('category.displayOrder key');

    // Check some hierarchical permissions specifically
    const hierarchicalPerms = allPermissions.filter(
      (p) =>
        p.key &&
        (p.key.startsWith('unions.') ||
          p.key.startsWith('conferences.') ||
          p.key.startsWith('churches.'))
    );

    logger.info(`Found ${hierarchicalPerms.length} hierarchical permissions`);

    // Now test the actual method
    const grouped = await Permission.getGroupedPermissions();

    logger.info(
      `Grouped permissions has ${Object.keys(grouped).length} categories`
    );

    // Check specifically for our new categories
    const newCategories = ['unions', 'conferences', 'churches'];
    newCategories.forEach((cat) => {
      logger.info(`Category '${cat}' exists: ${!!grouped[cat]}`);
    });

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

debugGroupedPermissions();
