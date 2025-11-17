const mongoose = require('mongoose');
require('dotenv').config();

const Role = require('../models/Role');
const Organization = require('../models/Organization');
const User = require('../models/User');

// Enhanced logging
const log = (message, type = 'info') => {
  const timestamp = new Date().toISOString();
  const prefix = type.toUpperCase();
  console.log(`[${timestamp}] [${prefix}] ${message}`);
};

const logError = (message, error = null) => {
  log(message, 'error');
  if (error) {
    console.error('Error details:', error.message);
    if (process.env.NODE_ENV === 'development') {
      console.error('Stack trace:', error.stack);
    }
  }
};

async function initializeDatabase() {
  const session = await mongoose.startSession();

  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    log('Connected to MongoDB');

    // Start transaction for atomic operations
    await session.startTransaction();
    log('Starting database initialization transaction');

    // Create system roles
    log('Creating system roles...');
    await Role.createSystemRoles();
    log('System roles created successfully');

    // Verify roles were created
    const roleCount = await Role.countDocuments({ isSystem: true });
    log(`Verified ${roleCount} system roles created`);

    // Create sample organizations if they don't exist
    log('Creating sample organizations...');

    // Create Union organization
    let union = await Organization.findOne({
      type: 'union',
      name: 'Australian Union Conference',
    });
    if (!union) {
      union = new Organization({
        name: 'Australian Union Conference',
        type: 'union',
        metadata: {
          address: '148 Fox Valley Rd, Wahroonga NSW 2076',
          phone: '+61 2 9847 3333',
          email: 'admin@adventist.org.au',
          territory: ['Australia', 'New Zealand', 'Pacific Islands'],
        },
      });
      await union.save({ session });
      log('Union organization created: Australian Union Conference');
    } else {
      log('Union organization already exists: Australian Union Conference');
    }

    // Create Conference organizations
    const conferences = [
      {
        name: 'Greater Sydney Conference',
        metadata: {
          address: '2 Aintree Ave, Epping NSW 2121',
          phone: '+61 2 9868 6522',
          email: 'office@gscsda.org.au',
          territory: ['Sydney', 'Central Coast', 'Blue Mountains'],
        },
      },
      {
        name: 'North New South Wales Conference',
        metadata: {
          address: '18 King St, Coffs Harbour NSW 2450',
          phone: '+61 2 6652 8000',
          email: 'info@nnsw.org.au',
          territory: ['Newcastle', 'Central Coast', 'Northern Rivers'],
        },
      },
    ];

    const createdConferences = [];
    for (const confData of conferences) {
      let conference = await Organization.findOne({
        type: 'conference',
        name: confData.name,
      });
      if (!conference) {
        conference = new Organization({
          ...confData,
          type: 'conference',
          parentOrganization: union._id,
        });
        await conference.save({ session });
        log(`Conference organization created: ${confData.name}`);
      } else {
        log(`Conference organization already exists: ${confData.name}`);
      }
      createdConferences.push(conference);
    }

    // Create Church organizations
    const churches = [
      {
        name: 'Hornsby Adventist Church',
        conferenceIndex: 0, // Greater Sydney Conference
        metadata: {
          address: '2 Aintree Ave, Epping NSW 2121',
          phone: '+61 2 9868 6644',
          email: 'office@hornsbysda.org.au',
          territory: ['Hornsby', 'Wahroonga', 'Turramurra'],
        },
      },
      {
        name: 'Wahroonga Adventist Church',
        conferenceIndex: 0, // Greater Sydney Conference
        metadata: {
          address: '8 Redleaf Ave, Wahroonga NSW 2076',
          phone: '+61 2 9489 8000',
          email: 'office@wahroongasda.org.au',
          territory: ['Wahroonga', 'Pymble', 'Turramurra'],
        },
      },
      {
        name: 'Newcastle Adventist Church',
        conferenceIndex: 1, // North NSW Conference
        metadata: {
          address: '45 Main Rd, Cardiff NSW 2285',
          phone: '+61 2 4954 5566',
          email: 'office@newcastlesda.org.au',
          territory: ['Newcastle', 'Cardiff', 'Lake Macquarie'],
        },
      },
    ];

    const createdChurches = [];
    for (const churchData of churches) {
      let church = await Organization.findOne({
        type: 'church',
        name: churchData.name,
      });
      if (!church) {
        church = new Organization({
          name: churchData.name,
          type: 'church',
          parentOrganization:
            createdConferences[churchData.conferenceIndex]._id,
          metadata: churchData.metadata,
        });
        await church.save({ session });
        log(`Church organization created: ${churchData.name}`);
      } else {
        log(`Church organization already exists: ${churchData.name}`);
      }
      createdChurches.push(church);
    }

    // Create sample users
    log('Creating sample users...');

    const users = [
      {
        name: 'System Administrator',
        email: 'admin@adventist.org.au',
        password: 'Admin123!@#',
        roleName: 'union_admin',
        organizationIndex: 'union',
      },
      {
        name: 'Conference Administrator',
        email: 'admin@gscsda.org.au',
        password: 'Conference123!@#',
        roleName: 'conference_admin',
        organizationIndex: 0, // Greater Sydney Conference
      },
      {
        name: 'Pastor John Smith',
        email: 'pastor@hornsbysda.org.au',
        password: 'Pastor123!@#',
        roleName: 'church_pastor',
        organizationIndex: 0, // Hornsby Church
      },
      {
        name: 'ACS Leader Mary Johnson',
        email: 'acs@wahroongasda.org.au',
        password: 'AcsLeader123!@#',
        roleName: 'church_acs_leader',
        organizationIndex: 1, // Wahroonga Church
      },
    ];

    for (const userData of users) {
      let user = await User.findOne({ email: userData.email });
      if (!user) {
        const role = await Role.findOne({ name: userData.roleName });
        let organization;

        if (userData.organizationIndex === 'union') {
          organization = union;
        } else if (typeof userData.organizationIndex === 'number') {
          // Determine if it's conference or church based on role
          if (userData.roleName.includes('conference')) {
            organization = createdConferences[userData.organizationIndex];
          } else {
            organization = createdChurches[userData.organizationIndex];
          }
        }

        user = new User({
          name: userData.name,
          email: userData.email,
          password: userData.password,
          verified: true,
          primaryOrganization: organization._id,
          organizations: [
            {
              organization: organization._id,
              role: role._id,
              assignedAt: new Date(),
            },
          ],
        });

        await user.save({ session });
        log(`User created: ${userData.name} (${userData.email})`);
      } else {
        log(`User already exists: ${userData.name} (${userData.email})`);
      }
    }

    // Commit transaction
    await session.commitTransaction();
    log('Database initialization transaction committed successfully');

    // Verify data integrity
    await verifyDataIntegrity();

    log('Database initialization completed successfully!');
    log('');
    log('Sample login credentials:');
    log('System Admin: admin@adventist.org.au / Admin123!@#');
    log('Conference Admin: admin@gscsda.org.au / Conference123!@#');
    log('Pastor: pastor@hornsbysda.org.au / Pastor123!@#');
    log('ACS Leader: acs@wahroongasda.org.au / AcsLeader123!@#');
    log('');
  } catch (error) {
    // Rollback transaction on error
    if (session.inTransaction()) {
      await session.abortTransaction();
      log('Transaction aborted due to error');
    }

    logError('Database initialization failed:', error);
    throw error;
  } finally {
    await session.endSession();
    await mongoose.connection.close();
    log('Database connection closed');
  }
}

// Verify data integrity after initialization
async function verifyDataIntegrity() {
  try {
    log('Verifying data integrity...');

    const roleCount = await Role.countDocuments({ isSystem: true });
    const orgCount = await Organization.countDocuments({ isActive: true });
    const userCount = await User.countDocuments({ isActive: true });

    log(`Data verification complete:`);
    log(`- System roles: ${roleCount}`);
    log(`- Organizations: ${orgCount}`);
    log(`- Users: ${userCount}`);

    // Verify hierarchy
    const unions = await Organization.countDocuments({
      type: 'union',
      isActive: true,
    });
    const conferences = await Organization.countDocuments({
      type: 'conference',
      isActive: true,
    });
    const churches = await Organization.countDocuments({
      type: 'church',
      isActive: true,
    });

    log(`Organization hierarchy:`);
    log(`- Unions: ${unions}`);
    log(`- Conferences: ${conferences}`);
    log(`- Churches: ${churches}`);
  } catch (error) {
    logError('Data integrity verification failed:', error);
    throw error;
  }
}

// Enhanced CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const isForced = args.includes('--force');
  const isVerbose = args.includes('--verbose');

  if (isVerbose) {
    log('Running in verbose mode');
  }

  if (isForced) {
    log('Running in force mode - will recreate existing data');
  }

  // Set environment
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';

  initializeDatabase()
    .then(() => {
      log('Initialization completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logError('Initialization failed:', error);
      process.exit(1);
    });
}

module.exports = { initializeDatabase, verifyDataIntegrity };
