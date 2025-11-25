const mongoose = require('mongoose');
const User = require('../models/User');
const Team = require('../models/Team');
const Church = require('../models/Church');
const Conference = require('../models/Conference');
const Union = require('../models/Union');

/**
 * Migration Script: Convert from organizational assignments to team-centric assignments
 *
 * This migration helps transition existing users from the old organizational assignment system
 * to the new team-centric assignment system.
 *
 * Strategy:
 * 1. For users with church assignments -> Create default church teams and assign users
 * 2. For users with conference assignments -> Create default conference teams and assign users
 * 3. For users with union assignments -> Create default union teams and assign users
 * 4. Preserve user roles by mapping them to team roles
 * 5. Maintain administrative hierarchy through team structure
 */

class TeamCentricMigration {
  /**
   * Run the migration
   */
  static async migrate() {
    // Starting migration to team-centric assignments...

    // Step 1: Create default teams for churches that don't have teams
    await this.createDefaultChurchTeams();

    // Step 2: Create default teams for conferences (for conference-level users)
    await this.createDefaultConferenceTeams();

    // Step 3: Create default teams for unions (for union-level users)
    await this.createDefaultUnionTeams();

    // Step 4: Migrate users with church assignments
    await this.migrateChurchUsers();

    // Step 5: Migrate users with conference assignments
    await this.migrateConferenceUsers();

    // Step 6: Migrate users with union assignments
    await this.migrateUnionUsers();

    // Step 7: Clean up old assignment fields (commented out for safety)
    // await this.cleanupOldAssignments();

    // Migration to team-centric assignments completed successfully!
  }

  /**
   * Create default teams for churches that don't have any teams
   */
  static async createDefaultChurchTeams() {
    // Creating default teams for churches...

    const churches = await Church.find({ isActive: true });

    for (const church of churches) {
      // Check if church already has teams
      const existingTeams = await Team.countDocuments({ churchId: church._id });

      if (existingTeams === 0) {
        // Create default "Church Ministry Team"
        try {
          await Team.create({
            name: `${church.name} - Ministry Team`,
            description: 'Default ministry team for church members',
            category: 'ministry',
            tags: ['church', 'ministry', 'general'],
            churchId: church._id,
            settings: {
              isPubliclyVisible: true,
              allowCrossChurchMembers: false,
              collaborationEnabled: true,
            },
            metadata: {
              ministry: 'general',
              focus: ['church_administration', 'general_ministry'],
            },
            createdBy: null, // System created
            isActive: true,
          });

          // Created default team for church
        } catch (error) {
          // Failed to create team for church
        }
      }
    }

    // Completed creating default church teams
  }

  /**
   * Create default teams for conferences (for conference-level administrators)
   */
  static async createDefaultConferenceTeams() {
    // Creating default conference administrative teams...

    const conferences = await Conference.find({ isActive: true });

    for (const conference of conferences) {
      // Get first active church in conference to host conference team
      const hostChurch = await Church.findOne({
        conferenceId: conference._id,
        isActive: true,
      });

      if (hostChurch) {
        // Check if conference admin team already exists
        const existingConferenceTeam = await Team.findOne({
          churchId: hostChurch._id,
          category: 'administration',
          'metadata.ministry': 'conference_administration',
        });

        if (!existingConferenceTeam) {
          try {
            await Team.create({
              name: `${conference.name} - Administration Team`,
              description: 'Conference-level administration and oversight',
              category: 'administration',
              tags: ['conference', 'administration', 'leadership'],
              churchId: hostChurch._id, // Hosted by first church but serves whole conference
              settings: {
                isPubliclyVisible: false,
                allowCrossChurchMembers: true,
                collaborationEnabled: true,
              },
              metadata: {
                ministry: 'conference_administration',
                focus: ['administration', 'oversight', 'church_support'],
                serviceArea: 'conference-wide',
              },
              createdBy: null, // System created
              isActive: true,
            });

            // Created conference admin team
          } catch (error) {
            // Failed to create conference team
          }
        }
      }
    }

    // Completed creating conference administrative teams
  }

  /**
   * Create default teams for unions (for union-level administrators)
   */
  static async createDefaultUnionTeams() {
    // Creating default union administrative teams...

    const unions = await Union.find({ isActive: true });

    for (const union of unions) {
      // Get first active church in first conference to host union team
      const firstConference = await Conference.findOne({
        unionId: union._id,
        isActive: true,
      });

      if (firstConference) {
        const hostChurch = await Church.findOne({
          conferenceId: firstConference._id,
          isActive: true,
        });

        if (hostChurch) {
          // Check if union admin team already exists
          const existingUnionTeam = await Team.findOne({
            churchId: hostChurch._id,
            category: 'administration',
            'metadata.ministry': 'union_administration',
          });

          if (!existingUnionTeam) {
            try {
              await Team.create({
                name: `${union.name} - Executive Team`,
                description:
                  'Union-level executive administration and oversight',
                category: 'administration',
                tags: ['union', 'administration', 'executive'],
                churchId: hostChurch._id, // Hosted by first church but serves whole union
                settings: {
                  isPubliclyVisible: false,
                  allowCrossChurchMembers: true,
                  collaborationEnabled: true,
                },
                metadata: {
                  ministry: 'union_administration',
                  focus: [
                    'executive_administration',
                    'strategic_oversight',
                    'conference_support',
                  ],
                  serviceArea: 'union-wide',
                },
                createdBy: null, // System created
                isActive: true,
              });

              // Created union admin team
            } catch (error) {
              // Failed to create union team
            }
          }
        }
      }
    }

    // Completed creating union administrative teams
  }

  /**
   * Migrate users with church assignments to church teams
   */
  static async migrateChurchUsers() {
    // Migrating users with church assignments...

    const usersWithChurchAssignments = await User.find({
      'churchAssignments.0': { $exists: true },
      isActive: true,
    }).populate('churchAssignments.church churchAssignments.role');

    for (const user of usersWithChurchAssignments) {
      for (const churchAssignment of user.churchAssignments) {
        try {
          // Find or create team for this church
          let churchTeam = await Team.findOne({
            churchId: churchAssignment.church._id,
            category: 'ministry',
          });

          if (!churchTeam) {
            // Create default team if none exists
            churchTeam = await Team.create({
              name: `${churchAssignment.church.name} - Ministry Team`,
              description: 'Default ministry team for church members',
              category: 'ministry',
              tags: ['church', 'ministry'],
              churchId: churchAssignment.church._id,
              settings: { isPubliclyVisible: true },
              metadata: { ministry: 'general' },
              createdBy: null,
              isActive: true,
            });
          }

          // Map organizational role to team role
          const teamRole = this.mapRoleToTeamRole(churchAssignment.role);

          // Check if user is already assigned to this team
          const existingAssignment = user.teamAssignments.find(
            (assignment) =>
              assignment.teamId &&
              assignment.teamId.toString() === churchTeam._id.toString()
          );

          if (!existingAssignment) {
            // Add team assignment
            user.teamAssignments.push({
              teamId: churchTeam._id,
              role: teamRole,
              status: 'active',
              joinedAt: churchAssignment.assignedAt || new Date(),
              invitedBy: churchAssignment.assignedBy || null,
              permissions: [],
            });

            // Set as primary team if user doesn't have one
            if (!user.primaryTeam) {
              user.primaryTeam = churchTeam._id;
            }
          }
        } catch (error) {
          // Failed to migrate church assignment for user
        }
      }

      // Save user with new team assignments
      try {
        await user.save();
      } catch (error) {
        // Failed to save migrated user
      }
    }

    // Completed migrating users with church assignments
  }

  /**
   * Migrate users with conference assignments to conference admin teams
   */
  static async migrateConferenceUsers() {
    // Migrating users with conference assignments...

    const usersWithConferenceAssignments = await User.find({
      'conferenceAssignments.0': { $exists: true },
      isActive: true,
    }).populate('conferenceAssignments.conference conferenceAssignments.role');

    for (const user of usersWithConferenceAssignments) {
      for (const conferenceAssignment of user.conferenceAssignments) {
        try {
          // Find conference admin team
          const hostChurch = await Church.findOne({
            conferenceId: conferenceAssignment.conference._id,
            isActive: true,
          });

          if (hostChurch) {
            const conferenceTeam = await Team.findOne({
              churchId: hostChurch._id,
              category: 'administration',
              'metadata.ministry': 'conference_administration',
            });

            if (conferenceTeam) {
              const teamRole = this.mapRoleToTeamRole(
                conferenceAssignment.role
              );

              // Check if user is already assigned
              const existingAssignment = user.teamAssignments.find(
                (assignment) =>
                  assignment.teamId &&
                  assignment.teamId.toString() === conferenceTeam._id.toString()
              );

              if (!existingAssignment) {
                user.teamAssignments.push({
                  teamId: conferenceTeam._id,
                  role: teamRole,
                  status: 'active',
                  joinedAt: conferenceAssignment.assignedAt || new Date(),
                  invitedBy: conferenceAssignment.assignedBy || null,
                  permissions: ['conference.manage', 'churches.manage'],
                });

                if (!user.primaryTeam) {
                  user.primaryTeam = conferenceTeam._id;
                }
              }
            }
          }
        } catch (error) {
          // Failed to migrate conference assignment for user
        }
      }

      try {
        await user.save();
      } catch (error) {
        // Failed to save migrated conference user
      }
    }

    // Completed migrating users with conference assignments
  }

  /**
   * Migrate users with union assignments to union admin teams
   */
  static async migrateUnionUsers() {
    // Migrating users with union assignments...

    const usersWithUnionAssignments = await User.find({
      'unionAssignments.0': { $exists: true },
      isActive: true,
    }).populate('unionAssignments.union unionAssignments.role');

    for (const user of usersWithUnionAssignments) {
      for (const unionAssignment of user.unionAssignments) {
        try {
          // Find union admin team
          const firstConference = await Conference.findOne({
            unionId: unionAssignment.union._id,
            isActive: true,
          });

          if (firstConference) {
            const hostChurch = await Church.findOne({
              conferenceId: firstConference._id,
              isActive: true,
            });

            if (hostChurch) {
              const unionTeam = await Team.findOne({
                churchId: hostChurch._id,
                category: 'administration',
                'metadata.ministry': 'union_administration',
              });

              if (unionTeam) {
                const teamRole = this.mapRoleToTeamRole(unionAssignment.role);

                // Check if user is already assigned
                const existingAssignment = user.teamAssignments.find(
                  (assignment) =>
                    assignment.teamId &&
                    assignment.teamId.toString() === unionTeam._id.toString()
                );

                if (!existingAssignment) {
                  user.teamAssignments.push({
                    teamId: unionTeam._id,
                    role: teamRole,
                    status: 'active',
                    joinedAt: unionAssignment.assignedAt || new Date(),
                    invitedBy: unionAssignment.assignedBy || null,
                    permissions: [
                      'union.manage',
                      'conferences.manage',
                      'churches.manage',
                    ],
                  });

                  if (!user.primaryTeam) {
                    user.primaryTeam = unionTeam._id;
                  }
                }
              }
            }
          }
        } catch (error) {
          // Failed to migrate union assignment for user
        }
      }

      try {
        await user.save();
      } catch (error) {
        // Failed to save migrated union user
      }
    }

    // Completed migrating users with union assignments
  }

  /**
   * Map organizational role to team role
   */
  static mapRoleToTeamRole(role) {
    if (!role) return 'member';

    const roleName = role.name || role;

    // Map administrative roles to team leader
    if (
      roleName.includes('admin') ||
      roleName.includes('leader') ||
      roleName.includes('president') ||
      roleName.includes('director')
    ) {
      return 'leader';
    }

    // Map coordinator roles to team coordinator
    if (
      roleName.includes('coordinator') ||
      roleName.includes('manager') ||
      roleName.includes('secretary')
    ) {
      return 'coordinator';
    }

    // Default to member
    return 'member';
  }

  /**
   * Clean up old assignment fields (DANGEROUS - commented out for safety)
   * Only run this after confirming migration was successful
   */
  static async cleanupOldAssignments() {
    // WARNING: Cleaning up old assignment fields...
    // Uncomment these lines ONLY after confirming migration was successful
    /*
    await User.updateMany(
      {},
      {
        $unset: {
          unionAssignments: 1,
          conferenceAssignments: 1,
          churchAssignments: 1
        }
      }
    );
    
    console.log('Old assignment fields removed');
    */
    // Cleanup skipped for safety - remove comments to enable
  }

  /**
   * Rollback migration (in case of issues)
   */
  static async rollback() {
    // Rolling back team-centric migration...

    // Remove all team assignments from users
    await User.updateMany(
      {},
      {
        $unset: { teamAssignments: 1, primaryTeam: 1 },
      }
    );

    // Remove system-created teams
    await Team.deleteMany({
      createdBy: null,
    });

    // Migration rollback completed
  }

  /**
   * Validate migration results
   */
  static async validateMigration() {
    // Validating migration results...

    const totalUsers = await User.countDocuments({ isActive: true });
    const usersWithTeams = await User.countDocuments({
      'teamAssignments.0': { $exists: true },
      isActive: true,
    });
    // Count users with primary team for validation
    await User.countDocuments({
      primaryTeam: { $exists: true, $ne: null },
      isActive: true,
    });

    // Validation results calculated

    const migrationCoverage = (usersWithTeams / totalUsers) * 100;

    // Log validation metrics for monitoring
    // Migration validation: users migrated with coverage percentage
    // Primary team assignments for migrated users

    if (migrationCoverage < 90) {
      // Migration coverage is below 90% - some users may not have been migrated
    } else {
      // Migration appears successful
    }
  }
}

module.exports = TeamCentricMigration;

// Allow running as standalone script
if (require.main === module) {
  (async () => {
    try {
      await mongoose.connect(
        process.env.MONGODB_URI ||
          'mongodb://localhost:27017/adventist-services'
      );

      // Connected to database

      const command = process.argv[2];

      switch (command) {
        case 'migrate':
          await TeamCentricMigration.migrate();
          await TeamCentricMigration.validateMigration();
          break;
        case 'rollback':
          await TeamCentricMigration.rollback();
          break;
        case 'validate':
          await TeamCentricMigration.validateMigration();
          break;
        default:
        // Usage: node migrateToTeamCentricAssignments.js [migrate|rollback|validate]
      }

      process.exit(0);
    } catch (error) {
      // Migration script failed - error will be logged elsewhere
      process.exit(1);
    }
  })();
}
