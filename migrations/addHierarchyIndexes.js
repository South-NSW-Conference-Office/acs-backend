const mongoose = require('mongoose');
require('dotenv').config();
const logger = require('../services/loggerService');

/**
 * Migration to add performance indexes for hierarchical queries
 * Run with: node migrations/addHierarchyIndexes.js
 */

class HierarchyIndexMigration {
  constructor() {
    this.isVerbose = process.env.MIGRATION_VERBOSE === 'true';
    this.logPrefix = '[AddHierarchyIndexes]';
  }

  log(message) {
    if (this.isVerbose) {
      logger.info(`${this.logPrefix} ${message}`);
    }
  }

  error(message, error) {
    logger.error(`${this.logPrefix} ${message}`, error);
  }

  async run() {
    try {
      // Connect to MongoDB
      await mongoose.connect(
        process.env.MONGODB_URI || 'mongodb://localhost:27017/acs',
        {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        }
      );

      this.log('Connected to MongoDB');
      this.log('Adding hierarchy indexes for performance optimization...');

      const db = mongoose.connection.db;

      // Organization indexes
      this.log('Creating indexes for Organizations collection...');
      const orgCollection = db.collection('organizations');

      await orgCollection.createIndex({ hierarchyPath: 1, isActive: 1 });
      this.log('✓ Added compound index on hierarchyPath + isActive');

      await orgCollection.createIndex({ hierarchyPath: 'text' });
      this.log('✓ Added text index on hierarchyPath for pattern matching');

      await orgCollection.createIndex({
        hierarchyLevel: 1,
        isActive: 1,
      });
      this.log('✓ Added index on hierarchyLevel + isActive');

      // Partial index for active entities only
      await orgCollection.createIndex(
        { hierarchyPath: 1 },
        {
          partialFilterExpression: { isActive: true },
          name: 'hierarchyPath_active_only',
        }
      );
      this.log('✓ Added partial index for active organizations');

      // Team indexes
      this.log('Creating indexes for Teams collection...');
      const teamCollection = db.collection('teams');

      await teamCollection.createIndex({ hierarchyPath: 1, isActive: 1 });
      this.log('✓ Added compound index on hierarchyPath + isActive');

      await teamCollection.createIndex({ churchId: 1, isActive: 1 });
      this.log('✓ Added index on churchId + isActive');

      await teamCollection.createIndex({
        hierarchyDepth: 1,
        isActive: 1,
      });
      this.log('✓ Added index on hierarchyDepth + isActive');

      // Partial index for active teams
      await teamCollection.createIndex(
        { hierarchyPath: 1 },
        {
          partialFilterExpression: { isActive: true },
          name: 'teams_hierarchyPath_active',
        }
      );
      this.log('✓ Added partial index for active teams');

      // Service indexes
      this.log('Creating indexes for Services collection...');
      const serviceCollection = db.collection('services');

      await serviceCollection.createIndex({ hierarchyPath: 1, isActive: 1 });
      this.log('✓ Added compound index on hierarchyPath + isActive');

      await serviceCollection.createIndex({ teamId: 1, isActive: 1 });
      this.log('✓ Added index on teamId + isActive');

      await serviceCollection.createIndex({ churchId: 1, isActive: 1 });
      this.log('✓ Added index on churchId + isActive');

      // Partial index for active services
      await serviceCollection.createIndex(
        { hierarchyPath: 1 },
        {
          partialFilterExpression: { isActive: true },
          name: 'services_hierarchyPath_active',
        }
      );
      this.log('✓ Added partial index for active services');

      // User indexes for organization assignments
      this.log('Creating indexes for Users collection...');
      const userCollection = db.collection('users');

      await userCollection.createIndex({ 'organizations.organization': 1 });
      this.log('✓ Added index on organizations.organization');

      await userCollection.createIndex({ 'teamAssignments.teamId': 1 });
      this.log('✓ Added index on teamAssignments.teamId');

      await userCollection.createIndex({
        'organizations.organization': 1,
        'organizations.role': 1,
      });
      this.log('✓ Added compound index on organization + role assignments');

      // Role indexes for hierarchy levels
      this.log('Creating indexes for Roles collection...');
      const roleCollection = db.collection('roles');

      await roleCollection.createIndex({ hierarchyLevel: 1 });
      this.log('✓ Added index on hierarchyLevel');

      await roleCollection.createIndex({
        canManage: 1,
        hierarchyLevel: 1,
      });
      this.log('✓ Added compound index on canManage + hierarchyLevel');

      // Create indexes for hierarchy path queries
      this.log('Creating specialized indexes for hierarchy queries...');

      // Index for ancestor queries (starts with)
      await orgCollection.createIndex({
        hierarchyPath: 1,
        hierarchyDepth: -1,
      });
      this.log('✓ Added index for ancestor queries on organizations');

      await teamCollection.createIndex({
        hierarchyPath: 1,
        hierarchyDepth: -1,
      });
      this.log('✓ Added index for ancestor queries on teams');

      await serviceCollection.createIndex({
        hierarchyPath: 1,
        hierarchyDepth: -1,
      });
      this.log('✓ Added index for ancestor queries on services');

      // List all indexes
      this.log('=== Index Summary ===');

      const orgIndexes = await orgCollection.indexes();
      this.log(`Organizations collection has ${orgIndexes.length} indexes`);

      const teamIndexes = await teamCollection.indexes();
      this.log(`Teams collection has ${teamIndexes.length} indexes`);

      const serviceIndexes = await serviceCollection.indexes();
      this.log(`Services collection has ${serviceIndexes.length} indexes`);

      const userIndexes = await userCollection.indexes();
      this.log(`Users collection has ${userIndexes.length} indexes`);

      const roleIndexes = await roleCollection.indexes();
      this.log(`Roles collection has ${roleIndexes.length} indexes`);

      this.log('✅ All hierarchy indexes created successfully!');

      this.log('=== Index Usage Tips ===');
      this.log(
        '1. Use hierarchyPath for subtree queries: { hierarchyPath: /^parentPath\\// }'
      );
      this.log(
        '2. Use compound indexes for active entity queries: { hierarchyPath: "...", isActive: true }'
      );
      this.log('3. Partial indexes reduce index size for active-only queries');
      this.log(
        '4. Text indexes on hierarchyPath enable full-text search within paths'
      );
    } catch (error) {
      this.error('Error adding hierarchy indexes:', error);
      process.exit(1);
    } finally {
      await mongoose.disconnect();
      this.log('Disconnected from MongoDB');
    }
  }
}

async function addHierarchyIndexes() {
  const migration = new HierarchyIndexMigration();
  return migration.run();
}

// Run the migration
if (require.main === module) {
  addHierarchyIndexes()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addHierarchyIndexes };
