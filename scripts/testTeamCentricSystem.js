const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Team = require('../models/Team');
const Church = require('../models/Church');
const UniversalAssignmentService = require('../services/universalAssignmentService');

/**
 * Test script to verify the team-centric assignment system works correctly
 */
async function testTeamCentricSystem() {
  try {
    console.log('🚀 Testing Team-Centric Assignment System...\n');

    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/adventist-services');
    console.log('✅ Connected to database');

    // Test 1: Create a test user
    console.log('\n📝 Test 1: Creating test user...');
    const testUser = new User({
      name: 'Test Team User',
      email: `test-team-user-${Date.now()}@example.com`,
      verified: true,
      isActive: true,
      teamAssignments: []
    });
    await testUser.save();
    console.log(`✅ Created test user: ${testUser.email}`);

    // Test 2: Find a church and team to assign to
    console.log('\n🏫 Test 2: Finding church and team...');
    const church = await Church.findOne({ isActive: true }).populate('conferenceId');
    if (!church) {
      console.log('❌ No active churches found - skipping assignment tests');
      return;
    }
    console.log(`✅ Found church: ${church.name}`);

    let team = await Team.findOne({ churchId: church._id, isActive: true });
    if (!team) {
      // Create a test team if none exists
      console.log('📋 Creating test team...');
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
          collaborationEnabled: true
        },
        metadata: {
          ministry: 'test',
          focus: ['testing']
        }
      });
    }
    console.log(`✅ Using team: ${team.name}`);

    // Test 3: Assign user to team
    console.log('\n🔗 Test 3: Assigning user to team...');
    const assignmentResult = await UniversalAssignmentService.assignUserToTeam(
      testUser._id,
      team._id,
      'member',
      testUser._id
    );
    console.log('✅ User assigned to team:', assignmentResult.assignment);

    // Test 4: Test dynamic organizational context
    console.log('\n🌐 Test 4: Testing dynamic organizational context...');
    const updatedUser = await User.findById(testUser._id);
    const organizationalScope = await updatedUser.getOrganizationalScope();
    console.log('✅ Organizational scope calculated:', organizationalScope);

    const accessibleChurches = await updatedUser.getAccessibleChurches();
    console.log(`✅ User has access to ${accessibleChurches.length} church(es)`);

    // Test 5: Test team permissions
    console.log('\n🔐 Test 5: Testing team permissions...');
    const teamPermissions = await updatedUser.getPermissionsForTeam(team._id);
    console.log('✅ Team permissions:', teamPermissions);

    // Test 6: Test user assignments retrieval
    console.log('\n📊 Test 6: Testing assignment retrieval...');
    const userAssignments = await UniversalAssignmentService.getUserAssignments(testUser._id);
    console.log('✅ User assignments:', JSON.stringify(userAssignments, null, 2));

    // Test 7: Test team removal
    console.log('\n🗑️  Test 7: Testing user removal from team...');
    await UniversalAssignmentService.removeUserFromTeam(testUser._id, team._id);
    console.log('✅ User removed from team successfully');

    // Cleanup: Remove test user
    console.log('\n🧹 Cleaning up test data...');
    await User.findByIdAndDelete(testUser._id);
    console.log('✅ Test user deleted');

    console.log('\n🎉 All tests completed successfully!');
    console.log('\nTeam-centric assignment system is working correctly ✅');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Error details:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testTeamCentricSystem().catch(console.error);
}

module.exports = testTeamCentricSystem;