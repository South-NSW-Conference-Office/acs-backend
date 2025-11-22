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
      users: { processed: 0, updated: 0, errors: 0 }
    };
  }
  
  /**
   * Main migration function
   */
  async runMigration() {
    console.log('🚀 Starting hierarchical restructure migration...');
    console.log('⚠️  WARNING: This will modify your database structure!');
    
    try {
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
      
      console.log('✅ Hierarchical restructure migration completed successfully!');
      this.printMigrationSummary();
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }
  
  /**
   * Step 1: Migrate Organizations to add hierarchy fields
   */
  async migrateOrganizations() {
    console.log('\n📂 Migrating Organizations...');
    
    const organizations = await Organization.find().populate('parentOrganization');
    
    for (const org of organizations) {
      try {
        this.migrationResults.organizations.processed++;
        
        // Set hierarchyLevel from type
        if (!org.hierarchyLevel) {
          org.hierarchyLevel = org.type;
        }
        
        // Set hierarchy depth
        const depthMap = { 'union': 0, 'conference': 1, 'church': 2 };
        org.hierarchyDepth = depthMap[org.hierarchyLevel] || 2;
        
        // Build hierarchy path
        if (!org.hierarchyPath) {
          org.hierarchyPath = await this.buildOrganizationHierarchyPath(org);
        }
        
        await org.save();
        this.migrationResults.organizations.updated++;
        
        console.log(`  ✓ ${org.name} (${org.hierarchyLevel}): ${org.hierarchyPath}`);
        
      } catch (error) {
        this.migrationResults.organizations.errors++;
        console.error(`  ❌ Error migrating organization ${org.name}:`, error.message);
      }
    }
  }
  
  /**
   * Step 2: Create hierarchical system roles
   */
  async createHierarchicalRoles() {
    console.log('\n👤 Creating hierarchical system roles...');
    
    try {
      await Role.createSystemRoles();
      this.migrationResults.roles.updated++;
      console.log('  ✓ Hierarchical system roles created');
    } catch (error) {
      this.migrationResults.roles.errors++;
      console.error('  ❌ Error creating roles:', error.message);
    }
  }
  
  /**
   * Step 3: Migrate Teams to be church-bound
   */
  async migrateTeams() {
    console.log('\n👥 Migrating Teams...');
    
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
              isActive: true
            });
            
            if (church) {
              team.churchId = church._id;
              team.organizationId = church._id; // Update organizationId for compatibility
              console.log(`  ⚠️  Moved team "${team.name}" from conference to church: ${church.name}`);
            } else {
              console.error(`  ❌ No church found for team "${team.name}" under conference "${org.name}"`);
              continue;
            }
          } else {
            console.error(`  ❌ Cannot migrate team "${team.name}" - parent is not church or conference`);
            continue;
          }
        } else {
          console.error(`  ❌ Team "${team.name}" has no organization assignment`);
          continue;
        }
        
        // Build hierarchy path
        const church = await Organization.findById(team.churchId);
        if (church && church.hierarchyPath) {
          team.hierarchyPath = `${church.hierarchyPath}/team_${team._id}`;
          team.hierarchyDepth = 3;
        }
        
        // Standardize team type
        if (!team.type || !['acs', 'youth', 'music', 'outreach', 'education'].includes(team.type)) {
          team.type = 'other';
        }
        
        await team.save();
        this.migrationResults.teams.updated++;
        
        console.log(`  ✓ ${team.name}: ${team.hierarchyPath}`);
        
      } catch (error) {
        this.migrationResults.teams.errors++;
        console.error(`  ❌ Error migrating team ${team.name}:`, error.message);
      }
    }
  }
  
  /**
   * Step 4: Migrate Services to be team-bound
   */
  async migrateServices() {
    console.log('\n🎯 Migrating Services...');
    
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
        
        if (service.organization && service.organization.hierarchyLevel === 'church') {
          // Find existing ACS team or create one
          targetTeam = await Team.findOne({
            churchId: service.organization._id,
            type: 'acs',
            isActive: true
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
              hierarchyDepth: 3
            });
            
            console.log(`  📋 Created default ACS team for church: ${service.organization.name}`);
          }
        } else {
          console.error(`  ❌ Cannot migrate service "${service.name}" - not bound to church`);
          continue;
        }
        
        // Bind service to team
        service.teamId = targetTeam._id;
        service.churchId = targetTeam.churchId;
        service.hierarchyPath = `${targetTeam.hierarchyPath}/service_${service._id}`;
        service.hierarchyDepth = 4;
        
        // Standardize service type
        const validTypes = ['community_service', 'disaster_relief', 'food_assistance', 'clothing_assistance', 'health_services', 'education'];
        if (!service.type || !validTypes.includes(service.type)) {
          service.type = 'community_service'; // Default
        }
        
        await service.save();
        this.migrationResults.services.updated++;
        
        console.log(`  ✓ ${service.name}: ${service.hierarchyPath}`);
        
      } catch (error) {
        this.migrationResults.services.errors++;
        console.error(`  ❌ Error migrating service ${service.name}:`, error.message);
      }
    }
  }
  
  /**
   * Step 5: Migrate User Role Assignments
   */
  async migrateUserRoles() {
    console.log('\n👨‍💼 Migrating User Role Assignments...');
    
    const users = await User.find().populate('organizations.organization organizations.role');
    
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
                console.log(`  🔄 Updated ${user.name}: ${role.name} → ${newRoleName}`);
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
        console.error(`  ❌ Error migrating user ${user.name}:`, error.message);
      }
    }
  }
  
  /**
   * Step 6: Validate hierarchy integrity
   */
  async validateHierarchy() {
    console.log('\n🔍 Validating hierarchy integrity...');
    
    let errors = 0;
    
    // Validate organizations
    const organizations = await Organization.find();
    for (const org of organizations) {
      if (!org.hierarchyPath || !org.hierarchyLevel) {
        console.error(`  ❌ Organization "${org.name}" missing hierarchy fields`);
        errors++;
      }
    }
    
    // Validate teams
    const teams = await Team.find();
    for (const team of teams) {
      if (!team.churchId || !team.hierarchyPath) {
        console.error(`  ❌ Team "${team.name}" missing hierarchy fields`);
        errors++;
      }
    }
    
    // Validate services
    const services = await Service.find();
    for (const service of services) {
      if (!service.teamId || !service.churchId || !service.hierarchyPath) {
        console.error(`  ❌ Service "${service.name}" missing hierarchy fields`);
        errors++;
      }
    }
    
    if (errors === 0) {
      console.log('  ✅ Hierarchy validation passed!');
    } else {
      console.log(`  ⚠️  Found ${errors} validation issues`);
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
        parent.hierarchyPath = await this.buildOrganizationHierarchyPath(parent);
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
      'union_admin': 'super_admin',
      'church_pastor': 'church_admin',
      'church_acs_leader': 'team_leader',
      'church_team_member': 'team_member',
      'church_communications': 'team_member'
    };
    
    return roleMapping[oldRoleName] || oldRoleName;
  }
  
  /**
   * Print migration summary
   */
  printMigrationSummary() {
    console.log('\n📊 Migration Summary:');
    console.log('====================');
    
    for (const [entity, stats] of Object.entries(this.migrationResults)) {
      console.log(`${entity.toUpperCase()}:`);
      console.log(`  Processed: ${stats.processed}`);
      console.log(`  Updated: ${stats.updated}`);
      console.log(`  Errors: ${stats.errors}`);
    }
  }
}

/**
 * Run migration if called directly
 */
if (require.main === module) {
  const migration = new HierarchicalRestructureMigration();
  
  migration.runMigration()
    .then(() => {
      console.log('\n🎉 Migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = HierarchicalRestructureMigration;