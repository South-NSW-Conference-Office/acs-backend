const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('../services/loggerService');

const User = require('../models/User');
const Organization = require('../models/Organization');
const Team = require('../models/Team');
const Role = require('../models/Role');

async function migrateToTeams() {
  try {
    logger.info('Starting team migration...');

    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    logger.info('Database connected');

    // Step 1: Update roles with new fields
    logger.info('\n1. Updating roles with roleCategory and quotaLimits...');

    const roleMapping = {
      super_admin: { category: 'super_admin', maxUsers: 5 },
      union_admin: { category: 'conference_admin', maxUsers: 10 },
      conference_admin: { category: 'conference_admin', maxUsers: 20 },
      church_pastor: { category: 'team_leader', maxUsers: 500 },
      church_acs_leader: { category: 'team_member', maxUsers: 900 },
      church_team_member: { category: 'team_member', maxUsers: 900 },
      church_communications: { category: 'communications', maxUsers: 900 },
    };

    for (const [roleName, config] of Object.entries(roleMapping)) {
      const role = await Role.findOne({ name: roleName });
      if (role && !role.roleCategory) {
        role.roleCategory = config.category;
        if (!role.quotaLimits || !role.quotaLimits.maxUsers) {
          role.quotaLimits = {
            maxUsers: config.maxUsers,
            scope:
              roleName === 'super_admin'
                ? 'system'
                : roleName.includes('union') || roleName.includes('conference')
                  ? 'region'
                  : 'organization',
            warningThreshold: 0.8,
          };
        }
        await role.save();
        logger.info(`  ✓ Updated role: ${roleName}`);
      }
    }

    // Step 2: Create default teams for each church organization
    logger.info('\n2. Creating default teams for church organizations...');

    const churches = await Organization.find({
      type: 'church',
      isActive: true,
    });
    logger.info(`  Found ${churches.length} church organizations`);

    for (const church of churches) {
      // Check if church already has teams
      const existingTeams = await Team.find({ organizationId: church._id });

      if (existingTeams.length === 0) {
        // Create ACS team
        await Team.create({
          name: `${church.name} ACS Team`,
          organizationId: church._id,
          type: 'acs',
          description: 'Adventist Community Services team',
          maxMembers: 50,
          settings: {
            allowSelfJoin: false,
            requireApproval: true,
            visibility: 'organization',
          },
          metadata: {
            conference: church.parent ? church.parent.toString() : null,
          },
          createdBy: new mongoose.Types.ObjectId('000000000000000000000000'), // System user
          isActive: true,
        });
        logger.info(`  ✓ Created ACS team for: ${church.name}`);

        // Create Communications team
        await Team.create({
          name: `${church.name} Communications`,
          organizationId: church._id,
          type: 'communications',
          description: 'Communications and messaging team',
          maxMembers: 20,
          settings: {
            allowSelfJoin: false,
            requireApproval: true,
            visibility: 'organization',
          },
          metadata: {
            conference: church.parent ? church.parent.toString() : null,
          },
          createdBy: new mongoose.Types.ObjectId('000000000000000000000000'), // System user
          isActive: true,
        });
        logger.info(`  ✓ Created Communications team for: ${church.name}`);
      }
    }

    // Step 3: Migrate existing church users to teams
    logger.info('\n3. Migrating church users to team assignments...');

    const churchUsers = await User.find({
      'organizations.organization': { $in: churches.map((c) => c._id) },
    }).populate('organizations.role');

    let migratedCount = 0;
    for (const user of churchUsers) {
      let updated = false;

      // Initialize team assignments if not exists
      if (!user.teamAssignments) {
        user.teamAssignments = [];
      }

      for (const orgAssignment of user.organizations) {
        const org = await Organization.findById(orgAssignment.organization);
        if (!org || org.type !== 'church') continue;

        const role = orgAssignment.role;
        if (!role) continue;

        // Find appropriate team
        let teamType = 'acs';
        let teamRole = 'member';

        if (role.name === 'church_pastor') {
          teamRole = 'leader';
        } else if (role.name === 'church_acs_leader') {
          teamRole = 'leader';
        } else if (role.name === 'church_communications') {
          teamType = 'communications';
          teamRole = 'member';
        }

        // Find or create team assignment
        const team = await Team.findOne({
          organizationId: org._id,
          type: teamType,
        });

        if (team) {
          // Check if already assigned
          const existingAssignment = user.teamAssignments.find(
            (ta) => ta.teamId && ta.teamId.toString() === team._id.toString()
          );

          if (!existingAssignment) {
            user.teamAssignments.push({
              teamId: team._id,
              role: teamRole,
              assignedAt: orgAssignment.assignedAt || new Date(),
              assignedBy:
                orgAssignment.assignedBy ||
                new mongoose.Types.ObjectId('000000000000000000000000'),
              permissions: [],
            });

            // Update team member count
            await team.updateOne({ $inc: { memberCount: 1 } });

            // If leader, update team leader
            if (teamRole === 'leader' && !team.leaderId) {
              await team.updateOne({ leaderId: user._id });
            }

            updated = true;
          }
        }
      }

      if (updated) {
        await user.save();
        migratedCount++;
      }
    }

    logger.info(`  ✓ Migrated ${migratedCount} users to team assignments`);

    // Step 4: Add new team permissions to existing roles
    logger.info('\n4. Adding team permissions to roles...');

    const teamPermissions = {
      church_pastor: ['teams.*:own'],
      church_acs_leader: [
        'teams.read:team',
        'teams.update:team',
        'teams.manage_members:team',
      ],
      church_team_member: ['teams.read:team'],
      church_communications: ['teams.read:team'],
      conference_admin: ['teams.*:region'],
    };

    for (const [roleName, permissions] of Object.entries(teamPermissions)) {
      const role = await Role.findOne({ name: roleName });
      if (role) {
        const existingPerms = new Set(role.permissions || []);
        let added = false;

        for (const perm of permissions) {
          if (!existingPerms.has(perm)) {
            role.permissions.push(perm);
            added = true;
          }
        }

        if (added) {
          await role.save();
          logger.info(`  ✓ Added team permissions to: ${roleName}`);
        }
      }
    }

    logger.info('\n✅ Migration completed successfully!');

    // Print summary
    const totalTeams = await Team.countDocuments();
    const totalUsersWithTeams = await User.countDocuments({
      'teamAssignments.0': { $exists: true },
    });

    logger.info('\nSummary:');
    logger.info(`  - Total teams created: ${totalTeams}`);
    logger.info(`  - Users with team assignments: ${totalUsersWithTeams}`);
    logger.info(`  - Churches processed: ${churches.length}`);
  } catch (error) {
    logger.error('Migration error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    logger.info('\nDatabase connection closed');
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateToTeams()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error(err);
      process.exit(1);
    });
}

module.exports = migrateToTeams;
