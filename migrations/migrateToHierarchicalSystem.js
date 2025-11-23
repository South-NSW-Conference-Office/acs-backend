const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Import models
const Organization = require('../models/Organization');
const Team = require('../models/Team');
const Service = require('../models/Service');
const User = require('../models/User');
const Role = require('../models/Role');
const AuditLog = require('../models/AuditLog');

// Import services
const hierarchyMigrationService = require('../services/hierarchyMigrationService');
// const HierarchyValidator = require('../utils/hierarchyValidator');

/**
 * Migration script to update existing data to new hierarchical system
 * Run with: node migrations/migrateToHierarchicalSystem.js [--dry-run] [--verbose]
 */
class HierarchicalMigration {
  constructor(options = {}) {
    this.dryRun = options.dryRun || process.argv.includes('--dry-run');
    this.verbose = options.verbose || process.argv.includes('--verbose');
    this.stats = {
      organizations: { total: 0, updated: 0, errors: 0 },
      teams: { total: 0, updated: 0, errors: 0 },
      services: { total: 0, updated: 0, errors: 0 },
      users: { total: 0, updated: 0, errors: 0 },
      roles: { total: 0, updated: 0, errors: 0 },
    };
    this.errors = [];
  }

  async run() {
    try {
      // Hierarchical System Migration
      // Mode and verbosity settings configured

      // Connect to MongoDB
      await this.connect();

      // Pre-migration validation
      // Step 1: Pre-migration validation
      const validation = await this.validatePreMigration();
      if (!validation.isValid) {
        // Pre-migration validation failed
        if (!this.dryRun) {
          throw new Error(
            'Cannot proceed with migration due to validation errors'
          );
        }
      }

      // Create backup point
      if (!this.dryRun) {
        // Step 2: Creating backup point
        await this.createBackupPoint();
      }

      // Run migrations
      // Step 3: Migrating organizations
      await this.migrateOrganizations();

      // Step 4: Migrating teams
      await this.migrateTeams();

      // Step 5: Migrating services
      await this.migrateServices();

      // Step 6: Updating user hierarchy data
      await this.migrateUsers();

      // Step 7: Updating role hierarchy levels
      await this.migrateRoles();

      // Post-migration validation
      // Step 8: Post-migration validation
      const postValidation =
        await hierarchyMigrationService.validateHierarchyIntegrity();
      this.printValidationResults(postValidation);

      // Apply indexes
      if (!this.dryRun) {
        // Step 9: Applying performance indexes
        await this.applyIndexes();
      }

      // Print summary
      this.printSummary();

      // Log migration
      if (!this.dryRun) {
        await this.logMigration();
      }
    } catch (error) {
      // Migration failed - error will be thrown
      if (!this.dryRun) {
        // Attempting rollback
        await this.rollback();
      }
      throw error;
    } finally {
      await mongoose.disconnect();
    }
  }

  async connect() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/acs';
    await mongoose.connect(mongoUri);
    // Connected to MongoDB
  }

  async validatePreMigration() {
    const errors = [];

    // Check for organizations without type/hierarchyLevel
    const orgsWithoutType = await Organization.countDocuments({
      $or: [
        { type: { $exists: false } },
        { hierarchyLevel: { $exists: false } },
      ],
    });

    if (orgsWithoutType > 0) {
      errors.push(
        `${orgsWithoutType} organizations missing type/hierarchyLevel`
      );
    }

    // Check for orphaned teams
    const orphanedTeams = await Team.find({
      $or: [{ churchId: { $exists: false } }, { churchId: null }],
    });

    if (orphanedTeams.length > 0) {
      errors.push(`${orphanedTeams.length} teams without church assignment`);
    }

    // Check for circular dependencies
    const allOrgs = await Organization.find({});
    for (const org of allOrgs) {
      if (
        org.parentOrganization &&
        org.parentOrganization.toString() === org._id.toString()
      ) {
        errors.push(`Circular dependency: ${org.name} is its own parent`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  async migrateOrganizations() {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const organizations = await Organization.find({}).session(session);
      this.stats.organizations.total = organizations.length;

      // First pass: Set hierarchyLevel from type if missing
      for (const org of organizations) {
        try {
          let updated = false;

          // Ensure hierarchyLevel matches type
          if (!org.hierarchyLevel && org.type) {
            org.hierarchyLevel = org.type;
            updated = true;
          }

          // Set hierarchy depth
          const depthMap = { union: 0, conference: 1, church: 2 };
          if (org.hierarchyDepth === undefined) {
            org.hierarchyDepth = depthMap[org.hierarchyLevel] ?? 2;
            updated = true;
          }

          if (updated) {
            if (!this.dryRun) {
              await org.save({ session, validateBeforeSave: false });
            }
            this.stats.organizations.updated++;
          }
        } catch (error) {
          this.stats.organizations.errors++;
          this.errors.push({
            type: 'organization',
            id: org._id,
            error: error.message,
          });
        }
      }

      // Second pass: Build hierarchy paths
      await this.buildOrganizationPaths(session);

      if (!this.dryRun) {
        await session.commitTransaction();
      } else {
        await session.abortTransaction();
      }
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  async buildOrganizationPaths(session) {
    // Build paths top-down
    const levels = ['union', 'conference', 'church'];

    for (const level of levels) {
      const orgs = await Organization.find({
        hierarchyLevel: level,
      }).session(session);

      for (const org of orgs) {
        try {
          const oldPath = org.hierarchyPath;

          if (level === 'union') {
            org.hierarchyPath = org._id.toString();
          } else if (org.parentOrganization) {
            const parent = await Organization.findById(
              org.parentOrganization
            ).session(session);

            if (parent && parent.hierarchyPath) {
              org.hierarchyPath = `${parent.hierarchyPath}/${org._id}`;
            } else {
              throw new Error('Parent missing or has no hierarchy path');
            }
          } else {
            throw new Error(`${level} missing parent organization`);
          }

          if (oldPath !== org.hierarchyPath) {
            if (!this.dryRun) {
              await org.save({ session, validateBeforeSave: false });
            }
            this.stats.organizations.updated++;

            if (this.verbose) {
              // Organization path updated
            }
          }
        } catch (error) {
          this.stats.organizations.errors++;
          this.errors.push({
            type: 'organization',
            id: org._id,
            name: org.name,
            error: error.message,
          });
        }
      }
    }
  }

  async migrateTeams() {
    const teams = await Team.find({}).populate('churchId');
    this.stats.teams.total = teams.length;

    for (const team of teams) {
      try {
        if (!team.churchId) {
          throw new Error('Team has no church assignment');
        }

        const church = team.churchId;
        // Store old hierarchy path for reference
        const expectedPath = `${church.hierarchyPath}/team_${team._id}`;

        let updated = false;

        if (team.hierarchyPath !== expectedPath) {
          team.hierarchyPath = expectedPath;
          updated = true;
        }

        if (team.hierarchyDepth !== 3) {
          team.hierarchyDepth = 3;
          updated = true;
        }

        if (updated) {
          if (!this.dryRun) {
            await team.save({ validateBeforeSave: false });
          }
          this.stats.teams.updated++;

          if (this.verbose) {
            // Team path updated
          }
        }
      } catch (error) {
        this.stats.teams.errors++;
        this.errors.push({
          type: 'team',
          id: team._id,
          name: team.name,
          error: error.message,
        });
      }
    }
  }

  async migrateServices() {
    const services = await Service.find({}).populate('teamId');
    this.stats.services.total = services.length;

    for (const service of services) {
      try {
        if (!service.teamId) {
          throw new Error('Service has no team assignment');
        }

        const team = await Team.findById(service.teamId).populate('churchId');
        if (!team) {
          throw new Error('Team not found');
        }

        // Store old hierarchy path for reference
        const expectedPath = `${team.hierarchyPath}/service_${service._id}`;

        let updated = false;

        if (service.hierarchyPath !== expectedPath) {
          service.hierarchyPath = expectedPath;
          updated = true;
        }

        if (!service.churchId && team.churchId) {
          service.churchId = team.churchId._id || team.churchId;
          updated = true;
        }

        if (updated) {
          if (!this.dryRun) {
            await service.save({ validateBeforeSave: false });
          }
          this.stats.services.updated++;

          if (this.verbose) {
            // Service path updated
          }
        }
      } catch (error) {
        this.stats.services.errors++;
        this.errors.push({
          type: 'service',
          id: service._id,
          name: service.name,
          error: error.message,
        });
      }
    }
  }

  async migrateUsers() {
    const users = await User.find({}).populate('organizations.organization');
    this.stats.users.total = users.length;

    for (const user of users) {
      try {
        let updated = false;

        // Set user hierarchy level based on highest role
        if (user.organizations && user.organizations.length > 0) {
          let highestLevel = 999;
          let primaryPath = '';

          for (const orgAssignment of user.organizations) {
            const org = orgAssignment.organization;
            if (org && org.hierarchyLevel) {
              const level =
                { union: 1, conference: 1, church: 2 }[org.hierarchyLevel] || 2;
              if (level < highestLevel) {
                highestLevel = level;
                primaryPath = org.hierarchyPath;
              }
            }
          }

          // Add hierarchy fields if they don't exist
          if (!user.hierarchyLevel && highestLevel !== 999) {
            user.hierarchyLevel = highestLevel;
            updated = true;
          }

          if (!user.hierarchyPath && primaryPath) {
            user.hierarchyPath = primaryPath;
            updated = true;
          }
        }

        if (updated) {
          if (!this.dryRun) {
            await user.save({ validateBeforeSave: false });
          }
          this.stats.users.updated++;
        }
      } catch (error) {
        this.stats.users.errors++;
        this.errors.push({
          type: 'user',
          id: user._id,
          email: user.email,
          error: error.message,
        });
      }
    }
  }

  async migrateRoles() {
    const roles = await Role.find({});
    this.stats.roles.total = roles.length;

    for (const role of roles) {
      try {
        let updated = false;

        // Set hierarchy level based on role name
        if (role.hierarchyLevel === undefined) {
          const levelMap = {
            super_admin: 0,
            union_admin: 1,
            conference_admin: 1,
            church_admin: 2,
            team_leader: 3,
            member: 4,
          };

          const level = levelMap[role.name] ?? 4;
          role.hierarchyLevel = level;
          updated = true;
        }

        // Set canManage levels
        if (!role.canManage || role.canManage.length === 0) {
          if (role.hierarchyLevel < 4) {
            role.canManage = [];
            for (let i = role.hierarchyLevel + 1; i <= 4; i++) {
              role.canManage.push(i);
            }
            updated = true;
          }
        }

        if (updated) {
          if (!this.dryRun) {
            await role.save({ validateBeforeSave: false });
          }
          this.stats.roles.updated++;
        }
      } catch (error) {
        this.stats.roles.errors++;
        this.errors.push({
          type: 'role',
          id: role._id,
          name: role.name,
          error: error.message,
        });
      }
    }
  }

  async applyIndexes() {
    // Running index migration script
    const indexMigration = require('./addHierarchyIndexes');
    await indexMigration.addHierarchyIndexes();
  }

  async createBackupPoint() {
    // In production, this would create a database backup
    // For now, just log the intent
    // Backup point created (simulated)
  }

  async rollback() {
    // Rollback initiated (would restore from backup in production)
  }

  async logMigration() {
    await AuditLog.logAction({
      action: 'system.migration',
      actor: {
        type: 'system',
        name: 'hierarchical_migration',
      },
      target: {
        type: 'system',
        name: 'database',
      },
      result: {
        success: this.errors.length === 0,
        affectedCount: Object.values(this.stats).reduce(
          (sum, stat) => sum + stat.updated,
          0
        ),
      },
      changes: this.stats,
      compliance: {
        reason: 'Hierarchical system migration',
        dataClassification: 'internal',
      },
      retention: {
        category: 'compliance',
      },
    });
  }

  printValidationResults(validation) {
    // Validation Results:

    const categories = [
      'orphanedEntities',
      'circularDependencies',
      'invalidPaths',
      'depthMismatches',
      'missingParents',
    ];

    categories.forEach((category) => {
      if (validation[category] && validation[category].length > 0) {
        // Validation category has issues found
        if (this.verbose) {
          // First 5 validation issues available for category
          if (validation[category].length > 5) {
            // Additional issues available
          }
        }
      }
    });
  }

  printSummary() {
    // Migration Summary

    // Entity migration statistics available in this.stats

    if (this.errors.length > 0) {
      // Errors found during migration
      // First 10 errors available in this.errors array
      if (this.errors.length > 10) {
        // Additional errors available
      }
    }

    // Migration run complete
  }
}

// Run migration if called directly
if (require.main === module) {
  const migration = new HierarchicalMigration();
  migration
    .run()
    .then(() => process.exit(0))
    .catch(() => {
      // Migration error
      process.exit(1);
    });
}

module.exports = HierarchicalMigration;
