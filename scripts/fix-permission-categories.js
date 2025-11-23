const mongoose = require('mongoose');
require('dotenv').config();

async function fixPermissionCategories() {
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

    // Get category IDs
    const unionCat = await PermissionCategory.findOne({ name: 'unions' });
    const conferenceCat = await PermissionCategory.findOne({
      name: 'conferences',
    });
    const churchCat = await PermissionCategory.findOne({ name: 'churches' });

    // Update permissions to use proper ObjectId references
    const updates = [
      { pattern: 'unions.', categoryId: unionCat._id },
      { pattern: 'conferences.', categoryId: conferenceCat._id },
      { pattern: 'churches.', categoryId: churchCat._id },
    ];

    for (const update of updates) {
      await Permission.updateMany(
        { key: { $regex: `^${update.pattern}` } },
        { $set: { category: update.categoryId } }
      );
    }

    // Verify the fix worked
    for (const update of updates) {
      await Permission.countDocuments({
        key: { $regex: `^${update.pattern}` },
        category: update.categoryId,
      });
    }

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

fixPermissionCategories();
