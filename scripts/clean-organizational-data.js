#!/usr/bin/env node

/**
 * Clean Organizational Data Script
 * 
 * This script removes all organizational data while preserving users,
 * allowing you to start fresh with the new hierarchical system.
 * 
 * REMOVES:
 * - organizations collection
 * - unions collection  
 * - conferences collection
 * - churches collection
 * - teams collection
 * - services collection
 * - User organization assignments
 * 
 * PRESERVES:
 * - users collection (but clears organization assignments)
 * - roles collection
 * - permissions
 * 
 * Usage:
 *   node scripts/clean-organizational-data.js
 *   npm run clean:org-data
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function cleanOrganizationalData() {
  console.log('🧹 Clean Organizational Data');
  console.log('============================');
  console.log('');
  console.log('⚠️  WARNING: This will permanently delete organizational data!');
  console.log('⚠️  Collections to be removed:');
  console.log('   - organizations');
  console.log('   - unions');
  console.log('   - conferences'); 
  console.log('   - churches');
  console.log('   - teams');
  console.log('   - services');
  console.log('');
  console.log('⚠️  User organization assignments will be cleared');
  console.log('⚠️  Users, roles, and permissions will be preserved');
  console.log('');
  
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in environment variables');
    }
    
    console.log(`📡 Connecting to MongoDB: ${mongoUri.replace(/\/\/.*:.*@/, '//***:***@')}`);
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
    console.log('');
    
    const db = mongoose.connection.db;
    const results = {
      dropped: [],
      notFound: [],
      errors: []
    };
    
    // Collections to drop
    const collectionsToClean = [
      'organizations',
      'unions', 
      'conferences',
      'churches',
      'teams',
      'services',
      'servicetypes', // Also clean service types if you want to start fresh
      'teamtypes'     // Also clean team types if you want to start fresh
    ];
    
    // Check existing collections
    const existingCollections = await db.listCollections().toArray();
    const existingNames = existingCollections.map(c => c.name);
    
    console.log('📋 Current collections:');
    existingNames.forEach(name => {
      console.log(`   - ${name}`);
    });
    console.log('');
    
    // Drop collections
    console.log('🗑️  Dropping organizational collections...');
    for (const collectionName of collectionsToClean) {
      try {
        if (existingNames.includes(collectionName)) {
          const collection = db.collection(collectionName);
          const count = await collection.countDocuments();
          
          await collection.drop();
          results.dropped.push({ name: collectionName, count });
          console.log(`   ✅ Dropped ${collectionName} (${count} documents)`);
        } else {
          results.notFound.push(collectionName);
          console.log(`   ⏭️  ${collectionName} not found, skipping`);
        }
      } catch (error) {
        if (error.message.includes('ns not found')) {
          results.notFound.push(collectionName);
          console.log(`   ⏭️  ${collectionName} not found, skipping`);
        } else {
          results.errors.push({ collection: collectionName, error: error.message });
          console.log(`   ❌ Error dropping ${collectionName}: ${error.message}`);
        }
      }
    }
    
    console.log('');
    console.log('👥 Cleaning user organization assignments...');
    
    // Clean user organization assignments
    try {
      const User = require('../models/User');
      const users = await User.find({ 'organizations.0': { $exists: true } });
      
      console.log(`   Found ${users.length} users with organization assignments`);
      
      let updatedUsers = 0;
      for (const user of users) {
        try {
          user.organizations = [];
          user.primaryOrganization = undefined;
          await user.save();
          updatedUsers++;
        } catch (error) {
          console.log(`   ⚠️  Error cleaning user ${user.email}: ${error.message}`);
        }
      }
      
      console.log(`   ✅ Cleaned ${updatedUsers} user assignments`);
      
    } catch (error) {
      console.log(`   ❌ Error cleaning user assignments: ${error.message}`);
      results.errors.push({ collection: 'users', error: error.message });
    }
    
    console.log('');
    console.log('📊 Cleanup Results:');
    console.log('===================');
    
    console.log(`\nDropped collections (${results.dropped.length}):`);
    results.dropped.forEach(({ name, count }) => {
      console.log(`   ✅ ${name}: ${count} documents removed`);
    });
    
    if (results.notFound.length > 0) {
      console.log(`\nCollections not found (${results.notFound.length}):`);
      results.notFound.forEach(name => {
        console.log(`   ⏭️  ${name}`);
      });
    }
    
    if (results.errors.length > 0) {
      console.log(`\nErrors (${results.errors.length}):`);
      results.errors.forEach(({ collection, error }) => {
        console.log(`   ❌ ${collection}: ${error}`);
      });
    }
    
    console.log('');
    console.log('✅ Organizational data cleanup completed!');
    console.log('');
    console.log('📋 What was preserved:');
    console.log('   ✅ Users (with cleaned assignments)');
    console.log('   ✅ Roles and permissions');
    console.log('   ✅ Authentication data');
    console.log('');
    console.log('📋 What was removed:');
    console.log('   🗑️  All organizational entities');
    console.log('   🗑️  All teams and services');
    console.log('   🗑️  User organization assignments');
    console.log('');
    console.log('🚀 Ready for fresh hierarchical data creation!');
    console.log('   You can now create new unions, conferences, and churches');
    console.log('   using the new hierarchical API endpoints.');
    
  } catch (error) {
    console.error('');
    console.error('❌ Cleanup failed:');
    console.error(error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('');
      console.log('📡 Disconnected from MongoDB');
    }
  }
}

// Handle CLI options
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Clean Organizational Data Script');
  console.log('');
  console.log('This script removes all organizational data while preserving users.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/clean-organizational-data.js');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h    Show this help message');
  console.log('  --force       Skip confirmation prompt');
  console.log('');
  console.log('Environment Variables:');
  console.log('  MONGODB_URI   MongoDB connection string');
  console.log('  MONGO_URI     Alternative MongoDB connection string');
  console.log('');
  process.exit(0);
}

// Confirmation unless force mode
if (!args.includes('--force')) {
  console.log('⚠️  This action cannot be undone!');
  console.log('   Type "DELETE ALL" to confirm cleanup:');
  
  process.stdin.setEncoding('utf8');
  process.stdin.on('readable', () => {
    const chunk = process.stdin.read();
    if (chunk !== null) {
      const input = chunk.trim();
      if (input === 'DELETE ALL') {
        console.log('✅ Confirmed. Proceeding with cleanup...');
        console.log('');
        runCleanup();
      } else {
        console.log('❌ Not confirmed. Exiting without cleanup.');
        process.exit(0);
      }
    }
  });
} else {
  runCleanup();
}

async function runCleanup() {
  try {
    await cleanOrganizationalData();
    process.exit(0);
  } catch (error) {
    console.error('Unhandled error:', error);
    process.exit(1);
  }
}

// If called directly with force
if (require.main === module && args.includes('--force')) {
  runCleanup();
}

module.exports = { cleanOrganizationalData };