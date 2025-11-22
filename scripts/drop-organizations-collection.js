#!/usr/bin/env node

/**
 * Drop Organizations Collection Script
 * 
 * This script safely drops the deprecated 'organizations' collection
 * from MongoDB after data has been migrated to Union, Conference, Church collections.
 * 
 * IMPORTANT: Only run this AFTER successfully migrating data!
 * 
 * Usage:
 *   node scripts/drop-organizations-collection.js
 *   npm run drop:organizations
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function dropOrganizationsCollection() {
  console.log('🗑️  Drop Organizations Collection');
  console.log('=================================');
  console.log('');
  console.log('⚠️  WARNING: This will permanently delete the organizations collection!');
  console.log('⚠️  Make sure you have:');
  console.log('   1. Successfully migrated data to Union/Conference/Church collections');
  console.log('   2. Verified the migration worked correctly');
  console.log('   3. Updated all code to use the new models');
  console.log('   4. Created a database backup');
  console.log('');
  
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/adventist-services';
    console.log(`📡 Connecting to MongoDB: ${mongoUri.replace(/\/\/.*:.*@/, '//***:***@')}`);
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to MongoDB');
    console.log('');
    
    // Check if organizations collection exists
    const collections = await mongoose.connection.db.listCollections({ name: 'organizations' }).toArray();
    if (collections.length === 0) {
      console.log('ℹ️  Organizations collection does not exist. Nothing to drop.');
      return;
    }
    
    // Count documents in organizations collection
    const orgCount = await mongoose.connection.db.collection('organizations').countDocuments();
    console.log(`📊 Found ${orgCount} documents in organizations collection`);
    
    if (orgCount > 0) {
      console.log('');
      console.log('⚠️  Collection contains data! Performing safety checks...');
      
      // Verify new collections have data
      const Union = require('../models/Union');
      const Conference = require('../models/Conference');
      const Church = require('../models/Church');
      
      const unionCount = await Union.countDocuments();
      const conferenceCount = await Conference.countDocuments();
      const churchCount = await Church.countDocuments();
      
      console.log(`📋 New collections:
   - Unions: ${unionCount}
   - Conferences: ${conferenceCount}
   - Churches: ${churchCount}`);
      
      if (unionCount === 0 && conferenceCount === 0 && churchCount === 0) {
        console.log('');
        console.log('❌ SAFETY CHECK FAILED:');
        console.log('   New hierarchical collections are empty!');
        console.log('   You must run the migration first:');
        console.log('   npm run migrate:organization-data');
        console.log('');
        process.exit(1);
      }
      
      // Check if the total entities roughly match
      const totalNewEntities = unionCount + conferenceCount + churchCount;
      if (totalNewEntities < orgCount * 0.8) { // Allow some variance
        console.log('');
        console.log(`⚠️  WARNING: Entity count mismatch!`);
        console.log(`   Organizations: ${orgCount}`);
        console.log(`   New entities: ${totalNewEntities}`);
        console.log('   This might indicate incomplete migration.');
        console.log('');
        
        // Don't exit, but warn user
        console.log('   Proceeding anyway... (you can stop with Ctrl+C)');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    console.log('');
    console.log('🗑️  Dropping organizations collection...');
    
    // Drop the collection
    await mongoose.connection.db.collection('organizations').drop();
    
    console.log('✅ Organizations collection dropped successfully!');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Remove Organization model files:');
    console.log('   - models/Organization.js');
    console.log('   - models/Organization.deprecated.js');
    console.log('2. Remove /api/organizations routes');
    console.log('3. Update any remaining code references');
    console.log('4. Remove organizationId fields from other models');
    console.log('');
    
  } catch (error) {
    if (error.message.includes('ns not found')) {
      console.log('ℹ️  Organizations collection does not exist. Nothing to drop.');
    } else {
      console.error('');
      console.error('❌ Failed to drop organizations collection:');
      console.error(error);
      console.error('');
      console.error('🔧 Troubleshooting:');
      console.error('- Check your database connection');
      console.error('- Ensure you have permission to drop collections');
      console.error('- Verify the collection name is correct');
      process.exit(1);
    }
  } finally {
    // Close database connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('📡 Disconnected from MongoDB');
    }
  }
}

// Handle CLI options
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Drop Organizations Collection Script');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/drop-organizations-collection.js');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h    Show this help message');
  console.log('  --force       Skip safety checks (dangerous!)');
  console.log('');
  console.log('Environment Variables:');
  console.log('  MONGODB_URI   MongoDB connection string');
  console.log('  MONGO_URI     Alternative MongoDB connection string');
  console.log('');
  console.log('IMPORTANT: Run migration first with:');
  console.log('  npm run migrate:organization-data');
  console.log('');
  process.exit(0);
}

if (args.includes('--force')) {
  console.log('⚠️  FORCE MODE: Skipping safety checks!');
}

// Confirm with user unless force mode
if (!args.includes('--force')) {
  console.log('⚠️  This action cannot be undone!');
  console.log('   Type "YES" to confirm dropping the organizations collection:');
  
  process.stdin.setEncoding('utf8');
  process.stdin.on('readable', () => {
    const chunk = process.stdin.read();
    if (chunk !== null) {
      const input = chunk.trim().toUpperCase();
      if (input === 'YES') {
        console.log('✅ Confirmed. Proceeding with collection drop...');
        console.log('');
        runMigration();
      } else {
        console.log('❌ Not confirmed. Exiting without dropping collection.');
        process.exit(0);
      }
    }
  });
} else {
  runMigration();
}

async function runMigration() {
  try {
    await dropOrganizationsCollection();
    process.exit(0);
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
}

// If called directly without interactive mode
if (require.main === module && args.includes('--force')) {
  runMigration();
}

module.exports = { dropOrganizationsCollection };