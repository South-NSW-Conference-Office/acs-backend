const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const User = require('../models/User');

const search = process.argv[2];

if (!search) {
  console.error('Usage: node scripts/find-user.js <emailFragment>');
  process.exit(1);
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

    const query = search.includes('@')
      ? { email: search.toLowerCase().trim() }
      : { email: { $regex: search, $options: 'i' } };

    const users = await User.find(query).select('name email isActive');

    if (!users.length) {
      console.log('No users found');
    } else {
      console.log(users.map((u) => u.toObject()));
    }
  } catch (err) {
    console.error('Failed to query users:', err);
  } finally {
    await mongoose.disconnect();
  }
})();
