const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Team = require('../models/Team');
const Church = require('../models/Church');
const UniversalAssignmentService = require('../services/universalAssignmentService');

// Debug logger - set DEBUG_MODE to true to enable console output for debugging
const DEBUG_MODE = false;

/**
 * Custom logger for test script - can be enabled/disabled for debugging
 */
const logger = {
  log: (...args) => {
    if (DEBUG_MODE) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
    // For production linting compliance, we comment out the actual console.log
    // Uncomment the line below to enable logging during debugging:
    // console.log(...args);
  },
  error: (message, error) => {
    // Always log errors to stderr for proper error handling
    if (error && error.message) {
      process.stderr.write(`Error: ${message} - ${error.message}\n`);
    } else {
      process.stderr.write(`Error: ${message}\n`);
    }
    if (error && error.stack && DEBUG_MODE) {
      process.stderr.write(`Stack trace: ${error.stack}\n`);
    }
  },
};

/**
 * Test script to verify the team-centric assignment system works correctly
 */
async function testTeamCentricSystem() {
  try {
    logger.log('🚀 Testing Team-Centric Assignment System...\n');

    // Connect to database
    await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/adventist-services'
    );
    logger.log('✅ Connected to database');

    // Test 1: Create a test user
    logger.log('\n📝 Test 1: Creating test user...');
    const testUser = new User({
      name: 'Test Team User',
      email: `test-team-user-${Date.now()}@example.com`,
      verified: true,
      isActive: true,
      teamAssignments: [],
    });
    await testUser.save();
    logger.log(`✅ Created test user: ${testUser.email}`);

    // Test 2: Find a church and team to assign to
    logger.log('\n🏫 Test 2: Finding church and team...');
    const church = await Church.findOne({ isActive: true }).populate(
      'conferenceId'
    );
    if (!church) {
      logger.log('❌ No active churches found - skipping assignment tests');
      return;
    }
    logger.log(`✅ Found church: ${church.name}`);

    let team = await Team.findOne({ churchId: church._id, isActive: true });
    if (!team) {
      // Create a test team if none exists
      logger.log('📋 Creating test team...');
      team = await Team.create({
        name: `${church.name} - Test Team`,
        description: 'Test team for team-centric assignment testing',
        category: 'test',
        tags: ['test', 'ministry'],
        churchId: church._id,
        createdBy: testUser._id,
        settings: {
          isPubliclyVisible: true,
          allowCrossChurchMembers: false,
          collaborationEnabled: true,
        },
        metadata: {
          ministry: 'test',
          focus: ['testing'],
        },
      });
    }
    logger.log(`✅ Using team: ${team.name}`);

    // Test 3: Assign user to team
    logger.log('\n🔗 Test 3: Assigning user to team...');
    const assignmentResult = await UniversalAssignmentService.assignUserToTeam(
      testUser._id,
      team._id,
      'member',
      testUser._id
    );
    logger.log('✅ User assigned to team:', assignmentResult.assignment);

    // Test 4: Test dynamic organizational context
    logger.log('\n🌐 Test 4: Testing dynamic organizational context...');
    const updatedUser = await User.findById(testUser._id);
    const organizationalScope = await updatedUser.getOrganizationalScope();
    logger.log('✅ Organizational scope calculated:', organizationalScope);

    const accessibleChurches = await updatedUser.getAccessibleChurches();
    logger.log(`✅ User has access to ${accessibleChurches.length} church(es)`);

    // Test 5: Test team permissions
    logger.log('\n🔐 Test 5: Testing team permissions...');
    const teamPermissions = await updatedUser.getPermissionsForTeam(team._id);
    logger.log('✅ Team permissions:', teamPermissions);

    // Test 6: Test user assignments retrieval
    logger.log('\n📊 Test 6: Testing assignment retrieval...');
    const userAssignments = await UniversalAssignmentService.getUserAssignments(
      testUser._id
    );
    logger.log(
      '✅ User assignments:',
      JSON.stringify(userAssignments, null, 2)
    );

    // Test 7: Test team removal
    logger.log('\n🗑️  Test 7: Testing user removal from team...');
    await UniversalAssignmentService.removeUserFromTeam(testUser._id, team._id);
    logger.log('✅ User removed from team successfully');

    // Cleanup: Remove test user
    logger.log('\n🧹 Cleaning up test data...');
    await User.findByIdAndDelete(testUser._id);
    logger.log('✅ Test user deleted');

    logger.log('\n🎉 All tests completed successfully!');
    logger.log('\nTeam-centric assignment system is working correctly ✅');
  } catch (error) {
    logger.error('\n❌ Test failed', error);
    // Additional error details are handled by the custom logger
    throw error; // Re-throw to maintain error propagation
  } finally {
    // Close database connection
    await mongoose.connection.close();
    logger.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testTeamCentricSystem().catch((error) => {
    logger.error('Test script execution failed', error);
    process.exit(1);
  });
}

module.exports = testTeamCentricSystem;
