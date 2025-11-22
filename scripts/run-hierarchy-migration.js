#!/usr/bin/env node

/**
 * Hierarchy Migration Runner
 * 
 * This script runs the hierarchy migration to ensure all organizations,
 * teams, and services have proper hierarchy paths and consistency.
 * 
 * Usage:
 *   node scripts/run-hierarchy-migration.js
 *   npm run migrate:hierarchy
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

// Import the migration
const { HierarchyMigration } = require('../migrations/2024-11-22-update-conference-hierarchy');

async function runMigration() {
  console.log('🚀 Starting Hierarchy Migration...');
  console.log('====================================');
  
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/adventist-services';
    console.log(`📡 Connecting to MongoDB: ${mongoUri.replace(/\/\/.*:.*@/, '//***:***@')}`);
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Run migration
    const migration = new HierarchyMigration();
    await migration.up();
    
    console.log('====================================');
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('Summary:');
    console.log('- Organizations: Hierarchy paths updated');
    console.log('- System Roles: Conference admin permissions ensured');
    console.log('- Teams: Hierarchy paths rebuilt');
    console.log('- Services: Hierarchy paths rebuilt');
    console.log('- Validation: Hierarchy consistency verified');
    console.log('');
    console.log('Your system now supports the Union → Conference → Church → Team → Service hierarchy!');
    
  } catch (error) {
    console.error('❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.disconnect();
    console.log('📡 Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  runMigration()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { runMigration };