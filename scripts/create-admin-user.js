const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
require('../models/Union');
require('../models/Conference');
require('../models/Church');
const Role = require('../models/Role');
const User = require('../models/User');

// Explicitly get models
const Union = mongoose.model('Union');

const createAdminUser = async () => {
    try {
        console.log('Connecting to MongoDB...', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        // 0. Fix Indexes (Drop rogue username_1 index if exists)
        try {
            const collection = mongoose.connection.collection('users');
            const indexes = await collection.indexes();
            const usernameIndex = indexes.find(idx => idx.name === 'username_1');
            if (usernameIndex) {
                console.log('Dropping rogue index "username_1"...');
                await collection.dropIndex('username_1');
                console.log('Index dropped.');
            }
        } catch (idxErr) {
            console.log('Index check skipped/failed:', idxErr.message);
        }

        // 1. Ensure Role Exists
        let role = await Role.findOne({ name: 'super_admin' });
        if (!role) {
            console.log('Role "super_admin" not found. Creating system roles...');
            await Role.createSystemRoles();
            role = await Role.findOne({ name: 'super_admin' });
            if (!role) throw new Error('Failed to create super_admin role');
        }
        console.log(`Using Role: ${role.name}`);

        // 2. Ensure Union Exists
        let union = await Union.findOne({ name: 'Australian Union Conference' });
        if (!union) {
            console.log('Creating Union...');
            union = new Union({
                name: 'Australian Union Conference',
                hierarchyPath: 'legacy_union',
                isActive: true
            });
            await union.save();
        }
        console.log(`Using Union: ${union.name}`);

        // 3. Create/Update User
        const email = 'Admin@admin.com';
        const password = 'Admin123';

        let user = await User.findOne({ email: { $regex: new RegExp(`^${email}$`, 'i') } }); // Case insensitive check
        if (user) {
            console.log('User already exists. Updating...');
            user.password = password;
            user.name = 'Admin User';
            user.verified = true;
            user.isActive = true;
            user.isSuperAdmin = true;

            // Assign to Union
            user.unionAssignments = [{
                union: union._id,
                role: role._id,
                assignedAt: new Date()
            }];

            await user.save();
            console.log('User updated.');
        } else {
            console.log('Creating new user...');
            user = new User({
                name: 'Admin User',
                email: email, // Model lowercases it usually, but we pass as is
                password,
                verified: true,
                isActive: true,
                isSuperAdmin: true,
                unionAssignments: [{
                    union: union._id,
                    role: role._id,
                    assignedAt: new Date()
                }]
            });
            await user.save();
            console.log('User created.');
        }

        console.log(`
---------------------------------------------------
SUCCESS!
User: ${email}
Pass: ${password}
Assigned to: ${union.name}
Role: ${role.name}
Privileges: Super Admin
---------------------------------------------------
`);

    } catch (err) {
        console.error('---------------- ERROR ----------------');
        console.error('Message:', err.message);
        console.error('Code:', err.code);
        console.error('KeyPattern:', err.keyPattern);
        console.error('KeyValue:', err.keyValue);
        console.error('Stack:', err.stack);
        console.error('---------------------------------------');
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
        process.exit(0);
    }
};

createAdminUser();
