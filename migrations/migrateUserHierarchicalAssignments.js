const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
require('dotenv').config();

/**
 * Migration script to populate hierarchical assignments for existing users
 * This derives unionAssignments, conferenceAssignments, and churchAssignments
 * from users' existing teamAssignments
 */
async function migrateUserHierarchicalAssignments() {
  // Check if already connected
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  }

  console.log('Starting user hierarchical assignments migration...');

  // Find a default role to use for assignments (conference_admin or similar)
  const defaultRole = await Role.findOne({
    $or: [
      { name: 'conference_admin' },
      { name: 'church_admin' },
      { name: 'member' },
    ],
  });

  if (!defaultRole) {
    console.log('Warning: No default role found, will use team role names');
  }

  // Find all users with team assignments but without hierarchical assignments
  const users = await User.find({
    $and: [
      { 'teamAssignments.0': { $exists: true } }, // Has at least one team assignment
      {
        $or: [
          { unionAssignments: { $exists: false } },
          { unionAssignments: { $size: 0 } },
          { conferenceAssignments: { $exists: false } },
          { conferenceAssignments: { $size: 0 } },
          { churchAssignments: { $exists: false } },
          { churchAssignments: { $size: 0 } },
        ],
      },
    ],
  }).populate({
    path: 'teamAssignments.teamId',
    select: 'name churchId',
    populate: {
      path: 'churchId',
      select: 'name conferenceId',
      populate: {
        path: 'conferenceId',
        select: 'name unionId',
        populate: {
          path: 'unionId',
          select: 'name',
        },
      },
    },
  });

  console.log(`Found ${users.length} users with team assignments to migrate`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    try {
      const unionAssignments = [];
      const conferenceAssignments = [];
      const churchAssignments = [];

      const processedUnions = new Set();
      const processedConferences = new Set();
      const processedChurches = new Set();

      for (const teamAssignment of user.teamAssignments) {
        if (!teamAssignment.teamId || !teamAssignment.teamId.churchId) {
          continue;
        }

        const church = teamAssignment.teamId.churchId;
        const churchId =
          typeof church === 'object' ? church._id.toString() : church;

        // Add church assignment
        if (!processedChurches.has(churchId)) {
          processedChurches.add(churchId);

          // Try to find a church-level role, or use default
          let roleId = defaultRole?._id;
          const churchRole = await Role.findOne({
            level: 'church',
            isActive: true,
          });
          if (churchRole) {
            roleId = churchRole._id;
          }

          if (roleId) {
            churchAssignments.push({
              church: church._id || church,
              role: roleId,
              assignedAt: teamAssignment.joinedAt || new Date(),
              assignedBy: teamAssignment.invitedBy,
            });
          }
        }

        // Add conference assignment if available
        if (church.conferenceId) {
          const conference = church.conferenceId;
          const conferenceId =
            typeof conference === 'object'
              ? conference._id.toString()
              : conference;

          if (!processedConferences.has(conferenceId)) {
            processedConferences.add(conferenceId);

            let roleId = defaultRole?._id;
            const confRole = await Role.findOne({
              level: 'conference',
              isActive: true,
            });
            if (confRole) {
              roleId = confRole._id;
            }

            if (roleId) {
              conferenceAssignments.push({
                conference: conference._id || conference,
                role: roleId,
                assignedAt: teamAssignment.joinedAt || new Date(),
                assignedBy: teamAssignment.invitedBy,
              });
            }
          }

          // Add union assignment if available
          if (conference.unionId) {
            const union = conference.unionId;
            const unionId =
              typeof union === 'object' ? union._id.toString() : union;

            if (!processedUnions.has(unionId)) {
              processedUnions.add(unionId);

              let roleId = defaultRole?._id;
              const unionRole = await Role.findOne({
                level: 'union',
                isActive: true,
              });
              if (unionRole) {
                roleId = unionRole._id;
              }

              if (roleId) {
                unionAssignments.push({
                  union: union._id || union,
                  role: roleId,
                  assignedAt: teamAssignment.joinedAt || new Date(),
                  assignedBy: teamAssignment.invitedBy,
                });
              }
            }
          }
        }
      }

      // Only update if we have assignments to add
      if (
        unionAssignments.length > 0 ||
        conferenceAssignments.length > 0 ||
        churchAssignments.length > 0
      ) {
        await User.findByIdAndUpdate(user._id, {
          $set: {
            unionAssignments,
            conferenceAssignments,
            churchAssignments,
          },
        });

        console.log(
          `Migrated user ${user.email}: ${churchAssignments.length} church, ${conferenceAssignments.length} conference, ${unionAssignments.length} union assignments`
        );
        migratedCount++;
      } else {
        console.log(
          `Skipped user ${user.email}: No valid assignments could be derived`
        );
        skippedCount++;
      }
    } catch (error) {
      console.error(`Error migrating user ${user.email}:`, error.message);
      skippedCount++;
    }
  }

  console.log('\nMigration completed!');
  console.log(`- Migrated: ${migratedCount} users`);
  console.log(`- Skipped: ${skippedCount} users`);
  console.log(`- Total processed: ${users.length} users`);
}

// Run the migration
if (require.main === module) {
  migrateUserHierarchicalAssignments()
    .then(() => {
      console.log('Closing database connection...');
      mongoose.connection.close();
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = migrateUserHierarchicalAssignments;
