const mongoose = require('mongoose');
require('dotenv').config();

/**
 * Migration to add performance indexes for hierarchical queries
 * Run with: node migrations/addHierarchyIndexes.js
 */

async function addHierarchyIndexes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/acs', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('Connected to MongoDB');
    console.log('Adding hierarchy indexes for performance optimization...\n');

    const db = mongoose.connection.db;

    // Organization indexes
    console.log('Creating indexes for Organizations collection...');
    const orgCollection = db.collection('organizations');
    
    await orgCollection.createIndex({ hierarchyPath: 1, isActive: 1 });
    console.log('✓ Added compound index on hierarchyPath + isActive');
    
    await orgCollection.createIndex({ hierarchyPath: 'text' });
    console.log('✓ Added text index on hierarchyPath for pattern matching');
    
    await orgCollection.createIndex({ 
      hierarchyLevel: 1, 
      isActive: 1 
    });
    console.log('✓ Added index on hierarchyLevel + isActive');
    
    // Partial index for active entities only
    await orgCollection.createIndex(
      { hierarchyPath: 1 },
      { 
        partialFilterExpression: { isActive: true },
        name: 'hierarchyPath_active_only'
      }
    );
    console.log('✓ Added partial index for active organizations');

    // Team indexes
    console.log('\nCreating indexes for Teams collection...');
    const teamCollection = db.collection('teams');
    
    await teamCollection.createIndex({ hierarchyPath: 1, isActive: 1 });
    console.log('✓ Added compound index on hierarchyPath + isActive');
    
    await teamCollection.createIndex({ churchId: 1, isActive: 1 });
    console.log('✓ Added index on churchId + isActive');
    
    await teamCollection.createIndex({ 
      hierarchyDepth: 1, 
      isActive: 1 
    });
    console.log('✓ Added index on hierarchyDepth + isActive');
    
    // Partial index for active teams
    await teamCollection.createIndex(
      { hierarchyPath: 1 },
      { 
        partialFilterExpression: { isActive: true },
        name: 'teams_hierarchyPath_active'
      }
    );
    console.log('✓ Added partial index for active teams');

    // Service indexes
    console.log('\nCreating indexes for Services collection...');
    const serviceCollection = db.collection('services');
    
    await serviceCollection.createIndex({ hierarchyPath: 1, isActive: 1 });
    console.log('✓ Added compound index on hierarchyPath + isActive');
    
    await serviceCollection.createIndex({ teamId: 1, isActive: 1 });
    console.log('✓ Added index on teamId + isActive');
    
    await serviceCollection.createIndex({ churchId: 1, isActive: 1 });
    console.log('✓ Added index on churchId + isActive');
    
    // Partial index for active services
    await serviceCollection.createIndex(
      { hierarchyPath: 1 },
      { 
        partialFilterExpression: { isActive: true },
        name: 'services_hierarchyPath_active'
      }
    );
    console.log('✓ Added partial index for active services');

    // User indexes for organization assignments
    console.log('\nCreating indexes for Users collection...');
    const userCollection = db.collection('users');
    
    await userCollection.createIndex({ 'organizations.organization': 1 });
    console.log('✓ Added index on organizations.organization');
    
    await userCollection.createIndex({ 'teamAssignments.teamId': 1 });
    console.log('✓ Added index on teamAssignments.teamId');
    
    await userCollection.createIndex({ 
      'organizations.organization': 1, 
      'organizations.role': 1 
    });
    console.log('✓ Added compound index on organization + role assignments');

    // Role indexes for hierarchy levels
    console.log('\nCreating indexes for Roles collection...');
    const roleCollection = db.collection('roles');
    
    await roleCollection.createIndex({ hierarchyLevel: 1 });
    console.log('✓ Added index on hierarchyLevel');
    
    await roleCollection.createIndex({ 
      'canManage': 1,
      hierarchyLevel: 1 
    });
    console.log('✓ Added compound index on canManage + hierarchyLevel');

    // Create indexes for hierarchy path queries
    console.log('\nCreating specialized indexes for hierarchy queries...');
    
    // Index for ancestor queries (starts with)
    await orgCollection.createIndex({ 
      hierarchyPath: 1,
      hierarchyDepth: -1 
    });
    console.log('✓ Added index for ancestor queries on organizations');
    
    await teamCollection.createIndex({ 
      hierarchyPath: 1,
      hierarchyDepth: -1 
    });
    console.log('✓ Added index for ancestor queries on teams');
    
    await serviceCollection.createIndex({ 
      hierarchyPath: 1,
      hierarchyDepth: -1 
    });
    console.log('✓ Added index for ancestor queries on services');

    // List all indexes
    console.log('\n=== Index Summary ===');
    
    const orgIndexes = await orgCollection.indexes();
    console.log(`\nOrganizations collection has ${orgIndexes.length} indexes`);
    
    const teamIndexes = await teamCollection.indexes();
    console.log(`Teams collection has ${teamIndexes.length} indexes`);
    
    const serviceIndexes = await serviceCollection.indexes();
    console.log(`Services collection has ${serviceIndexes.length} indexes`);
    
    const userIndexes = await userCollection.indexes();
    console.log(`Users collection has ${userIndexes.length} indexes`);
    
    const roleIndexes = await roleCollection.indexes();
    console.log(`Roles collection has ${roleIndexes.length} indexes`);

    console.log('\n✅ All hierarchy indexes created successfully!');
    
    // Analyze index usage
    console.log('\n=== Index Usage Tips ===');
    console.log('1. Use hierarchyPath for subtree queries: { hierarchyPath: /^parentPath\\// }');
    console.log('2. Use compound indexes for active entity queries: { hierarchyPath: "...", isActive: true }');
    console.log('3. Partial indexes reduce index size for active-only queries');
    console.log('4. Text indexes on hierarchyPath enable full-text search within paths');

  } catch (error) {
    console.error('Error adding hierarchy indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the migration
if (require.main === module) {
  addHierarchyIndexes()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { addHierarchyIndexes };