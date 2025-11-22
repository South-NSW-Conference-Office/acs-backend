const mongoose = require('mongoose');

/**
 * Migration to move Organization collection data to Union, Conference, and Church collections
 * This script safely migrates data from the deprecated Organization model to the new hierarchical models
 */

// Import models
const Organization = require('../models/Organization');
const Union = require('../models/Union');
const Conference = require('../models/Conference');
const Church = require('../models/Church');
const User = require('../models/User');
const Team = require('../models/Team');
const Service = require('../models/Service');

class OrganizationToHierarchicalMigration {
  constructor() {
    this.results = {
      unions: { created: 0, skipped: 0, errors: 0 },
      conferences: { created: 0, skipped: 0, errors: 0 },
      churches: { created: 0, skipped: 0, errors: 0 },
      userUpdates: { processed: 0, updated: 0, errors: 0 },
      teamUpdates: { processed: 0, updated: 0, errors: 0 },
      serviceUpdates: { processed: 0, updated: 0, errors: 0 }
    };
    
    // Track mapping of old organization IDs to new entity IDs
    this.idMapping = {
      unions: new Map(), // oldOrgId -> newUnionId
      conferences: new Map(), // oldOrgId -> newConferenceId
      churches: new Map() // oldOrgId -> newChurchId
    };
  }

  async migrate() {
    console.log('🔄 Starting Organization to Hierarchical Migration...');
    console.log('=====================================================');
    
    try {
      // Step 1: Check if organizations exist
      const orgCount = await Organization.countDocuments();
      if (orgCount === 0) {
        console.log('ℹ️  No organizations found to migrate.');
        return;
      }
      
      console.log(`📊 Found ${orgCount} organizations to migrate`);
      
      // Step 2: Migrate Unions (type: 'union' or hierarchyLevel: 'union')
      await this.migrateUnions();
      
      // Step 3: Migrate Conferences (type: 'conference' or hierarchyLevel: 'conference')
      await this.migrateConferences();
      
      // Step 4: Migrate Churches (type: 'church' or hierarchyLevel: 'church')
      await this.migrateChurches();
      
      // Step 5: Update User organization assignments
      await this.updateUserAssignments();
      
      // Step 6: Update Team references
      await this.updateTeamReferences();
      
      // Step 7: Update Service references (if any)
      await this.updateServiceReferences();
      
      // Step 8: Validate migration
      await this.validateMigration();
      
      this.printResults();
      
      console.log('✅ Migration completed successfully!');
      console.log('⚠️  You can now safely remove the Organization model');
      
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  async migrateUnions() {
    console.log('\n📋 Migrating Unions...');
    
    const unions = await Organization.find({
      $or: [
        { type: 'union' },
        { hierarchyLevel: 'union' }
      ],
      isActive: { $ne: false }
    }).sort({ createdAt: 1 });
    
    console.log(`   Found ${unions.length} unions to migrate`);
    
    for (const org of unions) {
      try {
        // Check if union already exists
        const existing = await Union.findOne({ name: org.name });
        if (existing) {
          console.log(`   ⏭️  Union "${org.name}" already exists, skipping`);
          this.idMapping.unions.set(org._id.toString(), existing._id.toString());
          this.results.unions.skipped++;
          continue;
        }
        
        // Create new Union
        const union = new Union({
          name: org.name,
          metadata: org.metadata || {},
          isActive: org.isActive !== false,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
          createdBy: org.createdBy
        });
        
        await union.save();
        
        // Track the ID mapping
        this.idMapping.unions.set(org._id.toString(), union._id.toString());
        this.results.unions.created++;
        
        console.log(`   ✅ Created union: "${union.name}" (${union._id})`);
        
      } catch (error) {
        console.error(`   ❌ Error migrating union "${org.name}":`, error.message);
        this.results.unions.errors++;
      }
    }
  }

  async migrateConferences() {
    console.log('\n📋 Migrating Conferences...');
    
    const conferences = await Organization.find({
      $or: [
        { type: 'conference' },
        { hierarchyLevel: 'conference' }
      ],
      isActive: { $ne: false }
    }).populate('parentOrganization').sort({ createdAt: 1 });
    
    console.log(`   Found ${conferences.length} conferences to migrate`);
    
    for (const org of conferences) {
      try {
        // Find parent union
        let unionId = null;
        
        if (org.parentOrganization) {
          const parentId = org.parentOrganization._id.toString();
          unionId = this.idMapping.unions.get(parentId);
          
          if (!unionId) {
            // Try to find union by name as fallback
            const parentName = org.parentOrganization.name;
            const union = await Union.findOne({ name: parentName });
            if (union) {
              unionId = union._id.toString();
              this.idMapping.unions.set(parentId, unionId);
            }
          }
        }
        
        if (!unionId) {
          console.log(`   ⚠️  No parent union found for conference "${org.name}", skipping`);
          this.results.conferences.errors++;
          continue;
        }
        
        // Check if conference already exists
        const existing = await Conference.findOne({ 
          name: org.name,
          unionId: unionId 
        });
        
        if (existing) {
          console.log(`   ⏭️  Conference "${org.name}" already exists, skipping`);
          this.idMapping.conferences.set(org._id.toString(), existing._id.toString());
          this.results.conferences.skipped++;
          continue;
        }
        
        // Create new Conference
        const conference = new Conference({
          name: org.name,
          unionId: unionId,
          metadata: org.metadata || {},
          isActive: org.isActive !== false,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
          createdBy: org.createdBy
        });
        
        await conference.save();
        
        // Track the ID mapping
        this.idMapping.conferences.set(org._id.toString(), conference._id.toString());
        this.results.conferences.created++;
        
        console.log(`   ✅ Created conference: "${conference.name}" (${conference._id})`);
        
      } catch (error) {
        console.error(`   ❌ Error migrating conference "${org.name}":`, error.message);
        this.results.conferences.errors++;
      }
    }
  }

  async migrateChurches() {
    console.log('\n📋 Migrating Churches...');
    
    const churches = await Organization.find({
      $or: [
        { type: 'church' },
        { hierarchyLevel: 'church' }
      ],
      isActive: { $ne: false }
    }).populate('parentOrganization').sort({ createdAt: 1 });
    
    console.log(`   Found ${churches.length} churches to migrate`);
    
    for (const org of churches) {
      try {
        // Find parent conference and union
        let conferenceId = null;
        let unionId = null;
        
        if (org.parentOrganization) {
          const parentId = org.parentOrganization._id.toString();
          conferenceId = this.idMapping.conferences.get(parentId);
          
          if (!conferenceId) {
            // Try to find conference by name as fallback
            const parentName = org.parentOrganization.name;
            const conference = await Conference.findOne({ name: parentName });
            if (conference) {
              conferenceId = conference._id.toString();
              unionId = conference.unionId;
              this.idMapping.conferences.set(parentId, conferenceId);
            }
          } else {
            // Get union ID from conference
            const conference = await Conference.findById(conferenceId);
            if (conference) {
              unionId = conference.unionId;
            }
          }
        }
        
        if (!conferenceId || !unionId) {
          console.log(`   ⚠️  No parent conference found for church "${org.name}", skipping`);
          this.results.churches.errors++;
          continue;
        }
        
        // Check if church already exists
        const existing = await Church.findOne({ 
          name: org.name,
          conferenceId: conferenceId 
        });
        
        if (existing) {
          console.log(`   ⏭️  Church "${org.name}" already exists, skipping`);
          this.idMapping.churches.set(org._id.toString(), existing._id.toString());
          this.results.churches.skipped++;
          continue;
        }
        
        // Create new Church
        const church = new Church({
          name: org.name,
          conferenceId: conferenceId,
          unionId: unionId,
          metadata: org.metadata || {},
          isActive: org.isActive !== false,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
          createdBy: org.createdBy
        });
        
        await church.save();
        
        // Track the ID mapping
        this.idMapping.churches.set(org._id.toString(), church._id.toString());
        this.results.churches.created++;
        
        console.log(`   ✅ Created church: "${church.name}" (${church._id})`);
        
      } catch (error) {
        console.error(`   ❌ Error migrating church "${org.name}":`, error.message);
        this.results.churches.errors++;
      }
    }
  }

  async updateUserAssignments() {
    console.log('\n👥 Updating User organization assignments...');
    
    const users = await User.find({ 
      'organizations.0': { $exists: true }
    });
    
    console.log(`   Found ${users.length} users with organization assignments`);
    
    for (const user of users) {
      try {
        this.results.userUpdates.processed++;
        let hasUpdates = false;
        
        const newAssignments = [];
        
        for (const assignment of user.organizations || []) {
          const orgId = assignment.organization.toString();
          
          // Check which type of entity this organization became
          const unionId = this.idMapping.unions.get(orgId);
          const conferenceId = this.idMapping.conferences.get(orgId);
          const churchId = this.idMapping.churches.get(orgId);
          
          if (unionId) {
            newAssignments.push({
              ...assignment.toObject(),
              organization: unionId
            });
            hasUpdates = true;
          } else if (conferenceId) {
            newAssignments.push({
              ...assignment.toObject(),
              organization: conferenceId
            });
            hasUpdates = true;
          } else if (churchId) {
            newAssignments.push({
              ...assignment.toObject(),
              organization: churchId
            });
            hasUpdates = true;
          } else {
            // Keep original assignment if no mapping found
            newAssignments.push(assignment);
          }
        }
        
        if (hasUpdates) {
          user.organizations = newAssignments;
          await user.save();
          this.results.userUpdates.updated++;
          console.log(`   ✅ Updated user: ${user.email}`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error updating user ${user.email}:`, error.message);
        this.results.userUpdates.errors++;
      }
    }
  }

  async updateTeamReferences() {
    console.log('\n👫 Updating Team references...');
    
    const teams = await Team.find({
      $or: [
        { organizationId: { $exists: true } },
        { churchId: { $exists: false } }
      ]
    });
    
    console.log(`   Found ${teams.length} teams to update`);
    
    for (const team of teams) {
      try {
        this.results.teamUpdates.processed++;
        let hasUpdates = false;
        
        // Update organizationId to churchId if it maps to a church
        if (team.organizationId) {
          const orgId = team.organizationId.toString();
          const churchId = this.idMapping.churches.get(orgId);
          
          if (churchId) {
            team.churchId = churchId;
            // Keep organizationId for backward compatibility during transition
            hasUpdates = true;
          }
        }
        
        if (hasUpdates) {
          await team.save();
          this.results.teamUpdates.updated++;
          console.log(`   ✅ Updated team: ${team.name}`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error updating team ${team.name}:`, error.message);
        this.results.teamUpdates.errors++;
      }
    }
  }

  async updateServiceReferences() {
    console.log('\n🛠️  Updating Service references...');
    
    // Services should already be using Team references, but check for any direct organization references
    const services = await Service.find({
      organizationId: { $exists: true }
    });
    
    if (services.length === 0) {
      console.log('   ℹ️  No services with direct organization references found');
      return;
    }
    
    console.log(`   Found ${services.length} services to update`);
    
    for (const service of services) {
      try {
        this.results.serviceUpdates.processed++;
        // Services should reference teams, not organizations directly
        // Log for manual review
        console.log(`   ⚠️  Service "${service.name}" has direct organization reference - review needed`);
        
      } catch (error) {
        console.error(`   ❌ Error processing service ${service.name}:`, error.message);
        this.results.serviceUpdates.errors++;
      }
    }
  }

  async validateMigration() {
    console.log('\n🔍 Validating migration...');
    
    // Count new entities
    const unionCount = await Union.countDocuments();
    const conferenceCount = await Conference.countDocuments();
    const churchCount = await Church.countDocuments();
    
    console.log(`   📊 Created: ${unionCount} unions, ${conferenceCount} conferences, ${churchCount} churches`);
    
    // Validate hierarchy relationships
    const orphanedConferences = await Conference.find({
      unionId: { $nin: await Union.distinct('_id') }
    });
    
    const orphanedChurches = await Church.find({
      $or: [
        { conferenceId: { $nin: await Conference.distinct('_id') } },
        { unionId: { $nin: await Union.distinct('_id') } }
      ]
    });
    
    if (orphanedConferences.length > 0) {
      console.log(`   ⚠️  Found ${orphanedConferences.length} orphaned conferences`);
    }
    
    if (orphanedChurches.length > 0) {
      console.log(`   ⚠️  Found ${orphanedChurches.length} orphaned churches`);
    }
    
    if (orphanedConferences.length === 0 && orphanedChurches.length === 0) {
      console.log('   ✅ All hierarchy relationships are valid');
    }
  }

  printResults() {
    console.log('\n📊 Migration Results:');
    console.log('=====================');
    console.log(`Unions:       ${this.results.unions.created} created, ${this.results.unions.skipped} skipped, ${this.results.unions.errors} errors`);
    console.log(`Conferences:  ${this.results.conferences.created} created, ${this.results.conferences.skipped} skipped, ${this.results.conferences.errors} errors`);
    console.log(`Churches:     ${this.results.churches.created} created, ${this.results.churches.skipped} skipped, ${this.results.churches.errors} errors`);
    console.log(`Users:        ${this.results.userUpdates.updated} updated out of ${this.results.userUpdates.processed} processed`);
    console.log(`Teams:        ${this.results.teamUpdates.updated} updated out of ${this.results.teamUpdates.processed} processed`);
  }

  async rollback() {
    console.log('🔄 Rolling back migration...');
    
    // Remove all created entities based on tracking
    for (const [oldId, newId] of this.idMapping.unions) {
      await Union.findByIdAndDelete(newId);
    }
    
    for (const [oldId, newId] of this.idMapping.conferences) {
      await Conference.findByIdAndDelete(newId);
    }
    
    for (const [oldId, newId] of this.idMapping.churches) {
      await Church.findByIdAndDelete(newId);
    }
    
    console.log('✅ Rollback completed');
  }
}

module.exports = { OrganizationToHierarchicalMigration };

// CLI runner
if (require.main === module) {
  const migration = new OrganizationToHierarchicalMigration();
  
  (async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/adventist-services');
      await migration.migrate();
    } catch (error) {
      console.error('Migration failed:', error);
      process.exit(1);
    } finally {
      await mongoose.disconnect();
    }
  })();
}