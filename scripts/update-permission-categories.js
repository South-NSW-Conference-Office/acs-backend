const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('../services/loggerService');

async function updateCategories() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    // console.log('Connected to MongoDB');

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

    // console.log('Checking existing categories...');
    const existing = await PermissionCategory.find({
      name: { $in: ['unions', 'conferences', 'churches'] },
    });
    // console.log(`Found ${existing.length} of the new categories`);

    if (existing.length === 3) {
      // console.log('All new categories already exist!');
      process.exit(0);
      return;
    }

    // Create new hierarchical categories
    const categories = [
      {
        name: 'unions',
        displayName: 'Union Management',
        description: 'Union-level administration and oversight',
        displayOrder: 20,
        isSystem: true,
        isActive: true,
      },
      {
        name: 'conferences',
        displayName: 'Conference Management',
        description: 'Conference-level administration and coordination',
        displayOrder: 30,
        isSystem: true,
        isActive: true,
      },
      {
        name: 'churches',
        displayName: 'Church Management',
        description: 'Church-level administration and coordination',
        displayOrder: 40,
        isSystem: true,
        isActive: true,
      },
    ];

    for (const categoryData of categories) {
      const existingCat = await PermissionCategory.findOne({
        name: categoryData.name,
      });
      if (existingCat) {
        // console.log(`Category ${categoryData.name} already exists`);
      } else {
        // Insert directly to bypass validation
        const result = await PermissionCategory.collection.insertOne({
          ...categoryData,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        logger.info(
          `Created category: ${categoryData.displayName} (${result.insertedId})`
        );
      }
    }

    logger.info('\nAll active categories:');
    const allCategories = await PermissionCategory.find({
      isActive: true,
    }).sort('displayOrder name');
    allCategories.forEach((cat) =>
      logger.info(`  ${cat.displayName} (${cat.name})`)
    );

    process.exit(0);
  } catch (error) {
    // console.error('Error:', error);
    process.exit(1);
  }
}

updateCategories();
