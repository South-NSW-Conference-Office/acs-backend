const mongoose = require('mongoose');
require('dotenv').config();
require('../models/Permission');
require('../models/PermissionCategory');

const Permission = mongoose.model('Permission');

async function testPopulate() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    // console.log('Testing populate functionality...');

    // Test with unions permissions
    const unionPermissions = await Permission.find({
      key: { $regex: '^unions\\.' },
      isActive: true,
    }).populate('category');

    // console.log(`Found ${unionPermissions.length} union permissions:`);
    unionPermissions.forEach((perm) => {
      // console.log(`- ${perm.key}`);
      // console.log(`  Category populated: ${!!perm.category}`);
      if (perm.category) {
        // console.log(`  Category name: ${perm.category.name}`);
        // console.log(`  Category displayName: ${perm.category.displayName}`);
      } else {
        // console.log(`  Raw category value: ${perm.category}`);
      }
    });

    // Test the specific method that's failing
    // console.log('\nTesting full method...');
    const allPermissions = await Permission.find({ isActive: true })
      .populate('category')
      .sort('category.displayOrder key');

    const unionPermsFromAll = allPermissions.filter(
      (p) => p.key && p.key.startsWith('unions.')
    );
    // console.log(`Union permissions from full query: ${unionPermsFromAll.length}`);

    unionPermsFromAll.forEach((perm) => {
      // console.log(`- ${perm.key} -> category populated: ${!!perm.category}`);
      if (perm.category) {
        // console.log(`  Category: ${perm.category.name} (${perm.category.displayName})`);
      }
    });

    process.exit(0);
  } catch (error) {
    // console.error('Error:', error);
    process.exit(1);
  }
}

testPopulate();
