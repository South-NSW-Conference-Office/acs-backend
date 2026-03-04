const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Ensure we load the backend .env file
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const User = require('../models/User');

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: node scripts/reset-user-password.js <email> <newPassword>');
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      autoIndex: false,
    });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      console.error(`No user found for email ${email}`);
      process.exitCode = 2;
      return;
    }

    user.password = newPassword;
    user.passwordSet = true;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    console.log(`Password updated for ${user.email}`);
  } catch (err) {
    console.error('Failed to reset password:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
