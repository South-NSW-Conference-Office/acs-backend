require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');

async function checkPermissions() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    // Connected to MongoDB

    // Check union_admin role
    await Role.findOne({ name: 'union_admin' });
    // Union Admin Role details logged

    // Check user
    await User.findOne({ email: 'bem@gyocc.org' })
      .populate('organizations.role')
      .populate('organizations.organization');

    // User details logged

    process.exit(0);
  } catch (error) {
    // Error occurred during permissions check
    process.exit(1);
  }
}

checkPermissions();
