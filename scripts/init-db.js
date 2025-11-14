const mongoose = require('mongoose');
require('dotenv').config();

const Role = require('../models/Role');
const Organization = require('../models/Organization');
const User = require('../models/User');

async function initializeDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Create system roles
    console.log('Creating system roles...');
    await Role.createSystemRoles();
    console.log('System roles created successfully');

    // Create sample organizations if they don't exist
    console.log('Creating sample organizations...');
    
    // Create Union organization
    let union = await Organization.findOne({ type: 'union', name: 'North Queensland Conference' });
    if (!union) {
      union = new Organization({
        name: 'North Queensland Conference',
        type: 'union',
        metadata: {
          address: '123 Union Street, Brisbane, QLD',
          phone: '+61 7 1234 5678',
          email: 'admin@nqc.org.au',
          territory: ['Queensland', 'Northern Territory']
        }
      });
      await union.save();
      console.log('Union organization created');
    }

    // Create Conference organization
    let conference = await Organization.findOne({ type: 'conference', name: 'Greater Sydney Conference' });
    if (!conference) {
      conference = new Organization({
        name: 'Greater Sydney Conference',
        type: 'conference',
        parentOrganization: union._id,
        metadata: {
          address: '456 Conference Ave, Sydney, NSW',
          phone: '+61 2 9876 5432',
          email: 'office@gsc.org.au',
          territory: ['Sydney', 'Central Coast', 'Blue Mountains']
        }
      });
      await conference.save();
      console.log('Conference organization created');
    }

    // Create Church organization
    let church = await Organization.findOne({ type: 'church', name: 'Hornsby Adventist Church' });
    if (!church) {
      church = new Organization({
        name: 'Hornsby Adventist Church',
        type: 'church', 
        parentOrganization: conference._id,
        metadata: {
          address: '789 Church Lane, Hornsby, NSW',
          phone: '+61 2 9876 1234',
          email: 'office@hornsbysda.org.au',
          territory: ['Hornsby', 'Wahroonga', 'Turramurra']
        }
      });
      await church.save();
      console.log('Church organization created');
    }

    // Create sample admin user if it doesn't exist
    console.log('Creating sample admin user...');
    
    let adminUser = await User.findOne({ email: 'admin@nqc.org.au' });
    if (!adminUser) {
      const unionAdminRole = await Role.findOne({ name: 'union_admin' });
      
      adminUser = new User({
        name: 'Admin User',
        email: 'admin@nqc.org.au',
        password: 'admin123', // This will be hashed by the pre-save middleware
        verified: true,
        primaryOrganization: union._id,
        organizations: [{
          organization: union._id,
          role: unionAdminRole._id,
          assignedAt: new Date()
        }]
      });
      
      await adminUser.save();
      console.log('Admin user created with email: admin@nqc.org.au and password: admin123');
    }

    // Create sample pastor user
    let pastorUser = await User.findOne({ email: 'pastor@hornsbysda.org.au' });
    if (!pastorUser) {
      const pastorRole = await Role.findOne({ name: 'church_pastor' });
      
      pastorUser = new User({
        name: 'Pastor John Smith',
        email: 'pastor@hornsbysda.org.au',
        password: 'pastor123',
        verified: true,
        primaryOrganization: church._id,
        organizations: [{
          organization: church._id,
          role: pastorRole._id,
          assignedAt: new Date()
        }]
      });
      
      await pastorUser.save();
      console.log('Pastor user created with email: pastor@hornsbysda.org.au and password: pastor123');
    }

    console.log('Database initialization completed successfully!');
    console.log('\nSample login credentials:');
    console.log('Admin: admin@nqc.org.au / admin123');
    console.log('Pastor: pastor@hornsbysda.org.au / pastor123');

  } catch (error) {
    console.error('Database initialization error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run initialization if this script is called directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = initializeDatabase;