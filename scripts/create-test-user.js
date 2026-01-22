const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
require('../models/Union');
require('../models/Conference');
require('../models/Church');
const Role = require('../models/Role');
const User = require('../models/User');

// Explicitly get models to use in script
const Union = mongoose.model('Union');
const Conference = mongoose.model('Conference');
const Church = mongoose.model('Church');

const createTestUser = async () => {
    try {
        console.log('Connecting to MongoDB...', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        // 1. Ensure Role Exists
        let role = await Role.findOne({ name: 'church_admin' });
        if (!role) {
            console.log('Role "church_admin" not found. Creating system roles...');
            await Role.createSystemRoles();
            role = await Role.findOne({ name: 'church_admin' });
            if (!role) throw new Error('Failed to create church_admin role');
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

        // 3. Ensure Conference Exists
        let conference = await Conference.findOne({ name: 'Greater Sydney Conference' });
        if (!conference) {
            console.log('Creating Conference...');
            conference = new Conference({
                name: 'Greater Sydney Conference',
                unionId: union._id,
                isActive: true
                // hierarchyPath will be handled by pre-save hooks usually
            });
            await conference.save();
        }
        console.log(`Using Conference: ${conference.name}`);

        // 4. Ensure Church Exists
        let church = await Church.findOne({ name: 'Wahroonga Adventist Church' });
        if (!church) {
            console.log('Creating Church...');
            church = new Church({
                name: 'Wahroonga Adventist Church',
                conferenceId: conference._id,
                isActive: true,
                code: 'WAHC',
                hierarchyPath: 'temp_path' // required for validation, overwritten by pre-save
            });
            await church.save();
        }
        console.log(`Using Church: ${church.name}`);

        // 5. Create/Update User
        const email = 'test@test.com';
        const password = 'test123';

        let user = await User.findOne({ email });
        if (user) {
            console.log('User already exists. Updating password...');
            user.password = password;
            user.name = 'Test User';
            user.verified = true;
            user.isActive = true;

            // Overwrite assignments to be sure
            user.churchAssignments = [{
                church: church._id,
                role: role._id,
                assignedAt: new Date()
            }];

            await user.save();
            console.log('User updated.');
        } else {
            console.log('Creating new user...');
            user = new User({
                name: 'Test User',
                email,
                password,
                verified: true,
                isActive: true,
                churchAssignments: [{
                    church: church._id,
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
Assigned to: ${church.name}
Role: ${role.name}
---------------------------------------------------
`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected');
        process.exit(0);
    }
};

createTestUser();
