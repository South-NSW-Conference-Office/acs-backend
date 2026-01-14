const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

/**
 * Diagnostic script to check what assignment data existing users have
 */
async function checkUserAssignments() {
  // Check if already connected
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB\n');
  }

  console.log('=== User Assignment Diagnostic Report ===\n');

  // Count total users
  const totalUsers = await User.countDocuments({});
  console.log(`Total users in database: ${totalUsers}\n`);

  // Count users with team assignments
  const usersWithTeamAssignments = await User.countDocuments({
    'teamAssignments.0': { $exists: true },
  });
  console.log(`Users with team assignments: ${usersWithTeamAssignments}`);

  // Count users without team assignments
  const usersWithoutTeamAssignments = await User.countDocuments({
    $or: [
      { teamAssignments: { $exists: false } },
      { teamAssignments: { $size: 0 } },
    ],
  });
  console.log(`Users without team assignments: ${usersWithoutTeamAssignments}`);

  // Count users with hierarchical assignments already
  const usersWithUnionAssignments = await User.countDocuments({
    'unionAssignments.0': { $exists: true },
  });
  const usersWithConferenceAssignments = await User.countDocuments({
    'conferenceAssignments.0': { $exists: true },
  });
  const usersWithChurchAssignments = await User.countDocuments({
    'churchAssignments.0': { $exists: true },
  });

  console.log(`\nUsers with hierarchical assignments:`);
  console.log(`  - Union assignments: ${usersWithUnionAssignments}`);
  console.log(`  - Conference assignments: ${usersWithConferenceAssignments}`);
  console.log(`  - Church assignments: ${usersWithChurchAssignments}`);

  // Show sample of users without any assignments
  console.log('\n--- Sample users without team assignments ---');
  const sampleUsersNoTeam = await User.find({
    $or: [
      { teamAssignments: { $exists: false } },
      { teamAssignments: { $size: 0 } },
    ],
  })
    .select(
      'name email teamAssignments unionAssignments conferenceAssignments churchAssignments'
    )
    .limit(5)
    .lean();

  if (sampleUsersNoTeam.length > 0) {
    sampleUsersNoTeam.forEach((user) => {
      console.log(`\n  ${user.name} (${user.email})`);
      console.log(`    Team assignments: ${user.teamAssignments?.length || 0}`);
      console.log(
        `    Union assignments: ${user.unionAssignments?.length || 0}`
      );
      console.log(
        `    Conference assignments: ${user.conferenceAssignments?.length || 0}`
      );
      console.log(
        `    Church assignments: ${user.churchAssignments?.length || 0}`
      );
    });
  } else {
    console.log('  No users found without team assignments');
  }

  // Show sample of users with team assignments
  console.log('\n--- Sample users with team assignments ---');
  const sampleUsersWithTeam = await User.find({
    'teamAssignments.0': { $exists: true },
  })
    .select(
      'name email teamAssignments unionAssignments conferenceAssignments churchAssignments'
    )
    .populate({
      path: 'teamAssignments.teamId',
      select: 'name',
    })
    .limit(5)
    .lean();

  if (sampleUsersWithTeam.length > 0) {
    sampleUsersWithTeam.forEach((user) => {
      console.log(`\n  ${user.name} (${user.email})`);
      console.log(`    Team assignments: ${user.teamAssignments?.length || 0}`);
      if (user.teamAssignments?.length > 0) {
        user.teamAssignments.forEach((ta) => {
          console.log(
            `      - Team: ${ta.teamId?.name || ta.teamId}, Role: ${ta.role}`
          );
        });
      }
      console.log(
        `    Union assignments: ${user.unionAssignments?.length || 0}`
      );
      console.log(
        `    Conference assignments: ${user.conferenceAssignments?.length || 0}`
      );
      console.log(
        `    Church assignments: ${user.churchAssignments?.length || 0}`
      );
    });
  } else {
    console.log('  No users found with team assignments');
  }

  console.log('\n=== End of Report ===');
}

// Run the check
if (require.main === module) {
  checkUserAssignments()
    .then(() => {
      mongoose.connection.close();
    })
    .catch((error) => {
      console.error('Check failed:', error);
      process.exit(1);
    });
}

module.exports = checkUserAssignments;
