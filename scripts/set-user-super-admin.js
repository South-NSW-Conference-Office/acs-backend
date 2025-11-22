require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function setUserSuperAdmin() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const userEmail = process.argv[2];
    const isSuperAdmin = process.argv[3] === 'true';
    
    if (!userEmail) {
      console.error('Usage: node set-user-super-admin.js <email> [true|false]');
      console.error('Example: node set-user-super-admin.js admin@example.com true');
      process.exit(1);
    }

    // Find the user
    const user = await User.findOne({ email: userEmail });

    if (!user) {
      console.error(`User not found: ${userEmail}`);
      process.exit(1);
    }

    // Update isSuperAdmin flag
    user.isSuperAdmin = isSuperAdmin !== false;
    await user.save();

    console.log(`\n✅ Successfully updated user: ${user.name} (${user.email})`);
    console.log(`   isSuperAdmin: ${user.isSuperAdmin}`);
    
    if (user.isSuperAdmin) {
      console.log('\n🎉 This user now has super admin privileges!');
      console.log('   They will have access to all features regardless of organization assignments.');
    } else {
      console.log('\n📝 Super admin privileges removed.');
      console.log('   User will need proper organization/role assignments for access.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

setUserSuperAdmin();