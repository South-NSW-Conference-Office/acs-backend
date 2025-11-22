#!/usr/bin/env node

/**
 * Organization Data Migration Script
 * 
 * This script migrates data from the deprecated Organization model 
 * to the new Union, Conference, and Church models.
 * 
 * IMPORTANT: Run this before removing the Organization model!
 * 
 * Usage:
 *   node scripts/migrate-organization-data.js
 *   npm run migrate:organization-data
 */

const mongoose = require('mongoose');
const { OrganizationToHierarchicalMigration } = require('../migrations/organizationToHierarchicalMigration');
require('dotenv').config();

async function runMigration() {
  console.log('🚀 Organization Data Migration');
  console.log('==============================');
  console.log('');
  console.log('This script will migrate data from the Organization collection');
  console.log('to the new Union, Conference, and Church collections.');
  console.log('');
  console.log('⚠️  IMPORTANT: This is a one-way migration!');
  console.log('⚠️  Make sure you have a database backup before proceeding.');
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
    
    // Check if Organization collection exists and has data
    const collections = await mongoose.connection.db.listCollections({ name: 'organizations' }).toArray();
    if (collections.length === 0) {
      console.log('ℹ️  Organization collection does not exist. Nothing to migrate.');
      return;
    }
    
    const Organization = require('../models/Organization');
    const orgCount = await Organization.countDocuments();
    
    if (orgCount === 0) {
      console.log('ℹ️  Organization collection is empty. Nothing to migrate.');
      return;
    }
    
    console.log(`📊 Found ${orgCount} organizations to migrate`);
    
    // Check if new collections already have data
    const Union = require('../models/Union');
    const Conference = require('../models/Conference');
    const Church = require('../models/Church');
    
    const unionCount = await Union.countDocuments();
    const conferenceCount = await Conference.countDocuments();
    const churchCount = await Church.countDocuments();
    
    if (unionCount > 0 || conferenceCount > 0 || churchCount > 0) {
      console.log('');
      console.log('⚠️  WARNING: New hierarchical collections already contain data:');
      console.log(`   - Unions: ${unionCount}`);
      console.log(`   - Conferences: ${conferenceCount}`);
      console.log(`   - Churches: ${churchCount}`);
      console.log('');
      console.log('The migration will skip existing entities and update references.');
    }
    
    console.log('');
    console.log('🔄 Starting migration...');
    console.log('');
    
    // Run the migration
    const migration = new OrganizationToHierarchicalMigration();
    await migration.migrate();
    
    console.log('');
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Review the migration results above');
    console.log('2. Test your application with the new hierarchical models');
    console.log('3. Update any remaining code that references the Organization model');
    console.log('4. Once everything is working, you can safely:');
    console.log('   - Remove the Organization model files');
    console.log('   - Drop the organizations collection from MongoDB');
    console.log('   - Remove /api/organizations routes');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:');
    console.error(error);
    console.error('');
    console.error('🔧 Troubleshooting:');
    console.error('- Check your database connection');
    console.error('- Ensure all required models are available');
    console.error('- Check the error details above');
    console.error('- You may need to fix data issues and re-run the migration');
    process.exit(1);
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
  console.log('Organization Data Migration Script');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/migrate-organization-data.js');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h    Show this help message');
  console.log('');
  console.log('Environment Variables:');
  console.log('  MONGODB_URI   MongoDB connection string');
  console.log('  MONGO_URI     Alternative MongoDB connection string');
  console.log('');
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

module.exports = { runMigration };