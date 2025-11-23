const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Team = require('../models/Team');
const Service = require('../models/Service');
const Role = require('../models/Role');
const User = require('../models/User');

/**
 * Migration script to convert existing data to hierarchical structure
 * Run this ONCE to migrate from old structure to new hierarchical system
 */
class HierarchicalRestructureMigration {
  constructor() {
    this.migrationResults = {
      organizations: { processed: 0, updated: 0, errors: 0 },
      teams: { processed: 0, updated: 0, errors: 0 },
      services: { processed: 0, updated: 0, errors: 0 },
      roles: { processed: 0, updated: 0, errors: 0 },
      users: { processed: 0, updated: 0, errors: 0 },
    };
  }

  /**
   * Main migration function
   */
  async runMigration() {
    // Starting hierarchical restructure migration
    // WARNING: This will modify your database structure

    // Step 1: Migrate Organizations (add hierarchy paths)
    await this.migrateOrganizations();

    // Step 2: Create new hierarchical system roles
    await this.createHierarchicalRoles();

    // Step 3: Migrate Teams (bind to churches, add hierarchy paths)
    await this.migrateTeams();

    // Step 4: Migrate Services (bind to teams, add hierarchy paths)
    await this.migrateServices();

    // Step 5: Migrate User role assignments
    await this.migrateUserRoles();

    // Step 6: Validate data integrity
    await this.validateHierarchy();

    // Hierarchical restructure migration completed successfully
    this.printMigrationSummary();
  }

  /**
   * Step 1: Migrate Organizations to add hierarchy fields
   */
  async migrateOrganizations() {
    // Migrating Organizations

    const organizations =
      await Organization.find().populate('parentOrganization');

    for (const org of organizations) {
      try {
        this.migrationResults.organizations.processed++;

        // Set hierarchyLevel from type
        if (!org.hierarchyLevel) {
          org.hierarchyLevel = org.type;
        }

        // Set hierarchy depth
        const depthMap = { union: 0, conference: 1, church: 2 };
        org.hierarchyDepth = depthMap[org.hierarchyLevel] || 2;

        // Build hierarchy path
        if (!org.hierarchyPath) {
          org.hierarchyPath = await this.buildOrganizationHierarchyPath(org);
        }

        await org.save();
        this.migrationResults.organizations.updated++;

        // Organization migrated successfully
      } catch (error) {
        this.migrationResults.organizations.errors++;
        // Error migrating organization - see error
      }
    }
  }

  /**
   * Step 2: Create hierarchical system roles
   */
  async createHierarchicalRoles() {
    // Creating hierarchical system roles

    try {
      await Role.createSystemRoles();
      this.migrationResults.roles.updated++;
      // Hierarchical system roles created
    } catch (error) {
      this.migrationResults.roles.errors++;
      // Error creating roles
    }
  }

  /**
   * Step 3: Migrate Teams to be church-bound
   */
  async migrateTeams() {
    // Migrating Teams

    const teams = await Team.find().populate('organizationId');

    for (const team of teams) {
      try {
        this.migrationResults.teams.processed++;

        // Skip if already migrated
        if (team.churchId && team.hierarchyPath) {
          continue;
        }

        // Ensure team is bound to a church
        if (team.organizationId) {
          const org = team.organizationId;

          if (org.hierarchyLevel === 'church') {
            // Already bound to church
            team.churchId = org._id;
          } else if (org.hierarchyLevel === 'conference') {
            // Find a default church under this conference
            const church = await Organization.findOne({
              parentOrganization: org._id,
              hierarchyLevel: 'church',
              isActive: true,
            });

            if (church) {
              team.churchId = church._id;
              team.organizationId = church._id; // Update organizationId for compatibility
              // Moved team from conference to church
            } else {
              // No church found for team under conference
              continue;
            }
          } else {
            // Cannot migrate team - parent is not church or conference
            continue;
          }
        } else {
          // Team has no organization assignment
          continue;
        }

        // Build hierarchy path
        const church = await Organization.findById(team.churchId);
        if (church && church.hierarchyPath) {
          team.hierarchyPath = `${church.hierarchyPath}/team_${team._id}`;
          team.hierarchyDepth = 3;
        }

        // Standardize team type
        if (
          !team.type ||
          !['acs', 'youth', 'music', 'outreach', 'education'].includes(
            team.type
          )
        ) {
          team.type = 'other';
        }

        await team.save();
        this.migrationResults.teams.updated++;

        // Team migrated successfully
      } catch (error) {
        this.migrationResults.teams.errors++;
        // Error migrating team
      }
    }
  }

  /**
   * Step 4: Migrate Services to be team-bound
   */
  async migrateServices() {
    // Migrating Services

    const services = await Service.find().populate('organization');

    for (const service of services) {
      try {
        this.migrationResults.services.processed++;

        // Skip if already migrated
        if (service.teamId && service.hierarchyPath) {
          continue;
        }

        // Find or create a default ACS team for this service
        let targetTeam;

        if (
          service.organization &&
          service.organization.hierarchyLevel === 'church'
        ) {
          // Find existing ACS team or create one
          targetTeam = await Team.findOne({
            churchId: service.organization._id,
            type: 'acs',
            isActive: true,
          });

          if (!targetTeam) {
            // Create default ACS team for this church
            targetTeam = await Team.create({
              name: 'Community Services',
              churchId: service.organization._id,
              organizationId: service.organization._id,
              type: 'acs',
              description: 'Default ACS team (created during migration)',
              createdBy: service.createdBy,
              hierarchyPath: `${service.organization.hierarchyPath}/team_${new mongoose.Types.ObjectId()}`,
              hierarchyDepth: 3,
            });

            // Created default ACS team for church
          }
        } else {
          // Cannot migrate service - not bound to church
          continue;
        }

        // Bind service to team
        service.teamId = targetTeam._id;
        service.churchId = targetTeam.churchId;
        service.hierarchyPath = `${targetTeam.hierarchyPath}/service_${service._id}`;
        service.hierarchyDepth = 4;

        // Standardize service type
        const validTypes = [
          'community_service',
          'disaster_relief',
          'food_assistance',
          'clothing_assistance',
          'health_services',
          'education',
        ];
        if (!service.type || !validTypes.includes(service.type)) {
          service.type = 'community_service'; // Default
        }

        await service.save();
        this.migrationResults.services.updated++;

        // Service migrated successfully
      } catch (error) {
        this.migrationResults.services.errors++;
        // Error migrating service
      }
    }
  }

  /**
   * Step 5: Migrate User Role Assignments
   */
  async migrateUserRoles() {
    // Migrating User Role Assignments

    const users = await User.find().populate(
      'organizations.organization organizations.role'
    );

    for (const user of users) {
      try {
        this.migrationResults.users.processed++;

        let updated = false;

        for (const orgAssignment of user.organizations) {
          const role = orgAssignment.role;

          // Map old roles to new hierarchical roles
          if (role && typeof role === 'object' && role.name) {
            const newRoleName = this.mapOldRoleToHierarchical(role.name);

            if (newRoleName !== role.name) {
              const newRole = await Role.findOne({ name: newRoleName });
              if (newRole) {
                orgAssignment.role = newRole._id;
                updated = true;
                // Updated user role
              }
            }
          }
        }

        if (updated) {
          await user.save();
          this.migrationResults.users.updated++;
        }
      } catch (error) {
        this.migrationResults.users.errors++;
        // Error migrating user
      }
    }
  }

  /**
   * Step 6: Validate hierarchy integrity
   */
  async validateHierarchy() {
    // Validating hierarchy integrity

    let errors = 0;

    // Validate organizations
    const organizations = await Organization.find();
    for (const org of organizations) {
      if (!org.hierarchyPath || !org.hierarchyLevel) {
        // Organization missing hierarchy fields
        errors++;
      }
    }

    // Validate teams
    const teams = await Team.find();
    for (const team of teams) {
      if (!team.churchId || !team.hierarchyPath) {
        // Team missing hierarchy fields
        errors++;
      }
    }

    // Validate services
    const services = await Service.find();
    for (const service of services) {
      if (!service.teamId || !service.churchId || !service.hierarchyPath) {
        // Service missing hierarchy fields
        errors++;
      }
    }

    if (errors === 0) {
      // Hierarchy validation passed
    } else {
      // Found validation issues
    }
  }

  /**
   * Helper: Build organization hierarchy path
   */
  async buildOrganizationHierarchyPath(org) {
    if (org.hierarchyLevel === 'union') {
      return org._id.toString();
    }

    if (org.parentOrganization) {
      let parent = org.parentOrganization;

      // If not populated, fetch it
      if (typeof parent === 'string') {
        parent = await Organization.findById(parent);
      }

      if (!parent.hierarchyPath) {
        parent.hierarchyPath =
          await this.buildOrganizationHierarchyPath(parent);
        await parent.save();
      }

      return `${parent.hierarchyPath}/${org._id}`;
    } else {
      throw new Error(`Non-union organization ${org.name} has no parent`);
    }
  }

  /**
   * Helper: Map old role names to new hierarchical roles
   */
  mapOldRoleToHierarchical(oldRoleName) {
    const roleMapping = {
      union_admin: 'super_admin',
      church_pastor: 'church_admin',
      church_acs_leader: 'team_leader',
      church_team_member: 'team_member',
      church_communications: 'team_member',
    };

    return roleMapping[oldRoleName] || oldRoleName;
  }

  /**
   * Print migration summary
   */
  printMigrationSummary() {
    // Migration Summary
    // Migration results available in this.migrationResults
  }
}

/**
 * Run migration if called directly
 */
if (require.main === module) {
  const migration = new HierarchicalRestructureMigration();

  migration
    .runMigration()
    .then(() => {
      // Migration completed successfully
      process.exit(0);
    })
    .catch(() => {
      // Migration failed
      process.exit(1);
    });
}

module.exports = HierarchicalRestructureMigration;
