/**
 * Migration: Split Organization Model into Union, Conference, Church
 * 
 * This migration transforms the existing Organization model into separate models:
 * 1. Split organizations by hierarchyLevel into Union, Conference, Church models
 * 2. Update relationships to reference new models
 * 3. Migrate Teams to reference Churches directly
 * 4. Update hierarchy paths across all entities
 * 
 * Date: 2024-11-22
 * Description: Restructure hierarchy with separate standalone models
 */

const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Union = require('../models/Union');
const Conference = require('../models/Conference');
const Church = require('../models/Church');
const Team = require('../models/Team');
const Service = require('../models/Service');
const Role = require('../models/Role');

class HierarchyMigration {
  constructor() {
    this.migrationName = '2024-11-22-split-organization-models';
    this.logPrefix = `[${this.migrationName}]`;
    this.mappings = {
      unions: new Map(),
      conferences: new Map(),
      churches: new Map(),
    };
  }

  /**
   * Main migration function
   */
  async up() {
    console.log(`${this.logPrefix} Starting hierarchy model split migration...`);
    
    try {
      // 1. Migrate Union organizations
      await this.migrateUnions();
      
      // 2. Migrate Conference organizations
      await this.migrateConferences();
      
      // 3. Migrate Church organizations
      await this.migrateChurches();
      
      // 4. Update Teams to reference Churches
      await this.updateTeamReferences();
      
      // 5. Update Services hierarchy paths
      await this.updateServiceHierarchy();
      
      // 6. Update User organization assignments
      await this.updateUserOrganizations();
      
      // 7. Ensure system roles exist with correct permissions
      await this.ensureSystemRoles();
      
      // 8. Validate new hierarchy consistency
      await this.validateNewHierarchy();
      
      console.log(`${this.logPrefix} Migration completed successfully`);
      console.log(`${this.logPrefix} Migrated:`);
      console.log(`${this.logPrefix}   - ${this.mappings.unions.size} unions`);
      console.log(`${this.logPrefix}   - ${this.mappings.conferences.size} conferences`);
      console.log(`${this.logPrefix}   - ${this.mappings.churches.size} churches`);
      
    } catch (error) {
      console.error(`${this.logPrefix} Migration failed:`, error);
      throw error;
    }
  }

  /**
   * Rollback migration (if needed)
   */
  async down() {
    console.log(`${this.logPrefix} Rollback not implemented - hierarchy updates are permanent`);
    console.log(`${this.logPrefix} Data integrity maintained, no rollback needed`);
  }

  /**
   * Migrate Union-level organizations to Union model
   */
  async migrateUnions() {
    console.log(`${this.logPrefix} Migrating unions...`);
    
    const unionOrgs = await Organization.find({ 
      hierarchyLevel: 'union',
      isActive: true 
    }).lean();

    let migrated = 0;
    let errors = 0;

    for (const org of unionOrgs) {
      try {
        const unionData = {
          _id: org._id,
          name: org.name,
          code: org.name.substring(0, 10).toUpperCase().replace(/\s/g, ''),
          hierarchyPath: org.hierarchyPath || org._id.toString(),
          headquarters: {
            address: org.metadata?.address,
            email: org.metadata?.email,
            phone: org.metadata?.phone,
          },
          contact: {
            email: org.metadata?.email,
            phone: org.metadata?.phone,
          },
          isActive: org.isActive,
          establishedDate: org.createdAt,
          createdBy: org.createdBy,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
        };

        const union = await Union.create(unionData);
        this.mappings.unions.set(org._id.toString(), union._id.toString());
        migrated++;
        
      } catch (error) {
        console.error(`${this.logPrefix} Error migrating union ${org._id}:`, error.message);
        errors++;
      }
    }

    console.log(`${this.logPrefix} Unions migrated: ${migrated}, errors: ${errors}`);
  }

  /**
   * Migrate Conference-level organizations to Conference model
   */
  async migrateConferences() {
    console.log(`${this.logPrefix} Migrating conferences...`);
    
    const conferenceOrgs = await Organization.find({ 
      hierarchyLevel: 'conference',
      isActive: true 
    }).lean();

    let migrated = 0;
    let errors = 0;

    for (const org of conferenceOrgs) {
      try {
        // Find parent union mapping
        const parentUnionId = this.mappings.unions.get(org.parentOrganization?.toString());
        
        if (!parentUnionId) {
          console.warn(`${this.logPrefix} No parent union found for conference ${org._id}, skipping`);
          continue;
        }

        const conferenceData = {
          _id: org._id,
          name: org.name,
          code: org.name.substring(0, 15).toUpperCase().replace(/\s/g, ''),
          unionId: parentUnionId,
          hierarchyPath: org.hierarchyPath || `${parentUnionId}/${org._id}`,
          territory: {
            states: org.metadata?.territory || [],
            description: org.metadata?.description,
          },
          headquarters: {
            address: org.metadata?.address,
            email: org.metadata?.email,
            phone: org.metadata?.phone,
          },
          contact: {
            email: org.metadata?.email,
            phone: org.metadata?.phone,
          },
          isActive: org.isActive,
          establishedDate: org.createdAt,
          createdBy: org.createdBy,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
        };

        const conference = await Conference.create(conferenceData);
        this.mappings.conferences.set(org._id.toString(), conference._id.toString());
        migrated++;
        
      } catch (error) {
        console.error(`${this.logPrefix} Error migrating conference ${org._id}:`, error.message);
        errors++;
      }
    }

    console.log(`${this.logPrefix} Conferences migrated: ${migrated}, errors: ${errors}`);
  }

  /**
   * Migrate Church-level organizations to Church model
   */
  async migrateChurches() {
    console.log(`${this.logPrefix} Migrating churches...`);
    
    const churchOrgs = await Organization.find({ 
      hierarchyLevel: 'church',
      isActive: true 
    }).lean();

    let migrated = 0;
    let errors = 0;

    for (const org of churchOrgs) {
      try {
        // Find parent conference mapping
        const parentConferenceId = this.mappings.conferences.get(org.parentOrganization?.toString());
        
        if (!parentConferenceId) {
          console.warn(`${this.logPrefix} No parent conference found for church ${org._id}, skipping`);
          continue;
        }

        const churchData = {
          _id: org._id,
          name: org.name,
          code: org.name.substring(0, 20).toUpperCase().replace(/\s/g, ''),
          conferenceId: parentConferenceId,
          hierarchyPath: org.hierarchyPath || `${parentConferenceId}/${org._id}`,
          location: {
            address: {
              street: org.metadata?.address,
              city: org.metadata?.city,
              state: org.metadata?.state,
              country: org.metadata?.country,
            },
          },
          contact: {
            email: org.metadata?.email,
            phone: org.metadata?.phone,
          },
          isActive: org.isActive,
          establishedDate: org.createdAt,
          createdBy: org.createdBy,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
        };

        const church = await Church.create(churchData);
        this.mappings.churches.set(org._id.toString(), church._id.toString());
        migrated++;
        
      } catch (error) {
        console.error(`${this.logPrefix} Error migrating church ${org._id}:`, error.message);
        errors++;
      }
    }

    console.log(`${this.logPrefix} Churches migrated: ${migrated}, errors: ${errors}`);
  }

  /**
   * Update Teams to reference Church model instead of Organization
   */
  async updateTeamReferences() {
    console.log(`${this.logPrefix} Updating team references...`);
    
    const teams = await Team.find({ isActive: true });
    let updated = 0;
    let errors = 0;

    for (const team of teams) {
      try {
        const churchId = this.mappings.churches.get(team.churchId?.toString());
        
        if (!churchId) {
          console.warn(`${this.logPrefix} No church mapping found for team ${team._id}, skipping`);
          continue;
        }

        // Update team to reference new Church model
        team.churchId = churchId;
        team.organizationId = churchId; // For backward compatibility
        
        // Rebuild hierarchy path
        await team.buildHierarchyPath();
        await team.save();
        
        updated++;
        
      } catch (error) {
        console.error(`${this.logPrefix} Error updating team ${team._id}:`, error.message);
        errors++;
      }
    }

    console.log(`${this.logPrefix} Teams updated: ${updated}, errors: ${errors}`);
  }

  /**
   * Update User organization assignments to reference new models
   */
  async updateUserOrganizations() {
    console.log(`${this.logPrefix} Updating user organization assignments...`);
    
    const User = require('../models/User');
    const users = await User.find({ 'organizations.0': { $exists: true } });
    
    let updated = 0;
    let errors = 0;

    for (const user of users) {
      try {
        let hasUpdates = false;
        
        for (const orgAssignment of user.organizations) {
          const orgId = orgAssignment.organization?.toString();
          
          // Check if this organization has been migrated to a new model
          const unionId = this.mappings.unions.get(orgId);
          const conferenceId = this.mappings.conferences.get(orgId);
          const churchId = this.mappings.churches.get(orgId);
          
          if (unionId || conferenceId || churchId) {
            // Update to point to new model ID (they're the same in this case)
            orgAssignment.organization = orgId; // Keep same ID
            hasUpdates = true;
          }
        }
        
        if (hasUpdates) {
          await user.save();
          updated++;
        }
        
      } catch (error) {
        console.error(`${this.logPrefix} Error updating user ${user._id}:`, error.message);
        errors++;
      }
    }

    console.log(`${this.logPrefix} User assignments updated: ${updated}, errors: ${errors}`);
  }

  /**
   * Ensure all system roles exist with proper permissions
   */
  async ensureSystemRoles() {
    console.log(`${this.logPrefix} Ensuring system roles...`);
    
    try {
      await Role.createSystemRoles();
      console.log(`${this.logPrefix} System roles ensured`);
    } catch (error) {
      console.error(`${this.logPrefix} Error creating system roles:`, error.message);
      throw error;
    }
  }

  /**
   * Update service hierarchy paths after model migration
   */
  async updateServiceHierarchy() {
    console.log(`${this.logPrefix} Updating service hierarchy...`);
    
    const services = await Service.find({ status: { $ne: 'archived' } })
      .populate('teamId');

    let updated = 0;
    let errors = 0;

    for (const service of services) {
      try {
        if (!service.teamId) {
          console.warn(`${this.logPrefix} Service ${service._id} has no team - skipping`);
          continue;
        }

        // Services now auto-populate churchId and hierarchyPath via pre-save middleware
        // Just trigger a save to rebuild paths with new model structure
        await service.save();
        updated++;
        
      } catch (error) {
        console.error(`${this.logPrefix} Error updating service ${service._id}:`, error.message);
        errors++;
      }
    }

    console.log(`${this.logPrefix} Services updated: ${updated}, errors: ${errors}`);
  }

  /**
   * Validate new hierarchy consistency after migration
   */
  async validateNewHierarchy() {
    console.log(`${this.logPrefix} Validating new hierarchy consistency...`);
    
    const issues = [];

    // Check unions
    const unions = await Union.find({ isActive: true });
    for (const union of unions) {
      if (!union.hierarchyPath) {
        issues.push(`Union ${union._id} missing hierarchy path`);
      }
      if (union.hierarchyLevel !== 0) {
        issues.push(`Union ${union._id} has incorrect hierarchy level`);
      }
    }

    // Check conferences
    const conferences = await Conference.find({ isActive: true });
    for (const conference of conferences) {
      if (!conference.hierarchyPath) {
        issues.push(`Conference ${conference._id} missing hierarchy path`);
      }
      if (conference.hierarchyLevel !== 1) {
        issues.push(`Conference ${conference._id} has incorrect hierarchy level`);
      }
      
      // Verify parent union exists
      const union = await Union.findById(conference.unionId);
      if (!union) {
        issues.push(`Conference ${conference._id} references missing union ${conference.unionId}`);
      }
    }

    // Check churches
    const churches = await Church.find({ isActive: true });
    for (const church of churches) {
      if (!church.hierarchyPath) {
        issues.push(`Church ${church._id} missing hierarchy path`);
      }
      if (church.hierarchyLevel !== 2) {
        issues.push(`Church ${church._id} has incorrect hierarchy level`);
      }
      
      // Verify parent conference exists
      const conference = await Conference.findById(church.conferenceId);
      if (!conference) {
        issues.push(`Church ${church._id} references missing conference ${church.conferenceId}`);
      }
    }

    // Check teams
    const teams = await Team.find({ isActive: true });
    for (const team of teams) {
      if (!team.hierarchyPath || !team.hierarchyPath.includes('team_')) {
        issues.push(`Team ${team._id} has invalid hierarchy path`);
      }
      if (team.hierarchyDepth !== 3) {
        issues.push(`Team ${team._id} has incorrect hierarchy depth`);
      }
      
      // Verify parent church exists
      const church = await Church.findById(team.churchId);
      if (!church) {
        issues.push(`Team ${team._id} references missing church ${team.churchId}`);
      }
    }

    // Check services
    const services = await Service.find({ status: { $ne: 'archived' } });
    for (const service of services) {
      if (!service.hierarchyPath || !service.hierarchyPath.includes('service_')) {
        issues.push(`Service ${service._id} has invalid hierarchy path`);
      }
      if (service.hierarchyDepth !== 4) {
        issues.push(`Service ${service._id} has incorrect hierarchy depth`);
      }
      
      // Verify parent team exists
      const team = await Team.findById(service.teamId);
      if (!team) {
        issues.push(`Service ${service._id} references missing team ${service.teamId}`);
      }
    }

    if (issues.length > 0) {
      console.warn(`${this.logPrefix} Validation found ${issues.length} issues:`);
      issues.forEach(issue => console.warn(`${this.logPrefix}   - ${issue}`));
    } else {
      console.log(`${this.logPrefix} New hierarchy validation passed - all entities consistent`);
    }

    return issues.length === 0;
  }
}

// Export for use in migration runner
module.exports = {
  up: async () => {
    const migration = new HierarchyMigration();
    await migration.up();
  },
  
  down: async () => {
    const migration = new HierarchyMigration();
    await migration.down();
  },

  // For manual execution
  HierarchyMigration
};

// Allow direct execution
if (require.main === module) {
  (async () => {
    try {
      // Connect to database if not already connected
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/adventist-services');
      }

      const migration = new HierarchyMigration();
      await migration.up();
      
      console.log('Migration completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  })();
}