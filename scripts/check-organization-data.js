#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();

async function checkOrganizationData() {
  try {
    console.log('🔍 Checking Organization Data Structure...');
    console.log('==========================================');
    
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MongoDB URI not found in environment variables');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    const Organization = require('../models/Organization');
    const orgs = await Organization.find({}).populate('parentOrganization').sort({ createdAt: 1 });
    
    console.log('📊 Current Organization Data:');
    console.log('=============================\n');
    
    orgs.forEach((org, index) => {
      console.log(`${index + 1}. ${org.name} (ID: ${org._id})`);
      console.log(`   Type: ${org.type || 'unknown'}`);
      console.log(`   HierarchyLevel: ${org.hierarchyLevel || 'unknown'}`);
      console.log(`   Parent: ${org.parentOrganization ? org.parentOrganization.name + ' (' + org.parentOrganization._id + ')' : 'None'}`);
      console.log(`   Active: ${org.isActive}`);
      console.log(`   Created: ${org.createdAt}`);
      console.log('');
    });
    
    console.log('📈 Summary by Type:');
    console.log('==================');
    const byType = {};
    const byHierarchyLevel = {};
    
    orgs.forEach(org => {
      const type = org.type || 'unknown';
      const hierarchyLevel = org.hierarchyLevel || 'unknown';
      
      byType[type] = (byType[type] || 0) + 1;
      byHierarchyLevel[hierarchyLevel] = (byHierarchyLevel[hierarchyLevel] || 0) + 1;
    });
    
    console.log('\nBy Type field:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    console.log('\nBy HierarchyLevel field:');
    Object.entries(byHierarchyLevel).forEach(([level, count]) => {
      console.log(`  ${level}: ${count}`);
    });
    
    console.log('\n🔗 Hierarchy Relationships:');
    console.log('===========================');
    
    // Find root organizations (no parent)
    const roots = orgs.filter(org => !org.parentOrganization);
    console.log(`\nRoot organizations (${roots.length}):`);
    roots.forEach(org => {
      console.log(`  - ${org.name} (${org.type || org.hierarchyLevel})`);
    });
    
    // Find organizations with parents
    const withParents = orgs.filter(org => org.parentOrganization);
    console.log(`\nOrganizations with parents (${withParents.length}):`);
    withParents.forEach(org => {
      console.log(`  - ${org.name} (${org.type || org.hierarchyLevel}) → Parent: ${org.parentOrganization.name}`);
    });
    
    console.log('\n💡 Migration Strategy Recommendation:');
    console.log('=====================================');
    
    if (roots.length > 0) {
      const potentialUnions = roots.filter(org => 
        (org.type === 'union' || org.hierarchyLevel === 'union') || 
        (!org.type && !org.hierarchyLevel) // Might be unions if they're root level
      );
      
      console.log(`\n1. Potential Unions (${potentialUnions.length}):`);
      potentialUnions.forEach(org => {
        console.log(`   - ${org.name} ${!org.type && !org.hierarchyLevel ? '(needs type assignment)' : ''}`);
      });
      
      // If we have root organizations without type, we need to assign them as unions
      const rootsWithoutType = roots.filter(org => !org.type && !org.hierarchyLevel);
      if (rootsWithoutType.length > 0) {
        console.log('\n⚠️  ISSUE: Root organizations without type detected!');
        console.log('   These should be assigned type "union" before migration:');
        rootsWithoutType.forEach(org => {
          console.log(`   - ${org.name} (${org._id})`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking organization data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Disconnected from MongoDB');
  }
}

checkOrganizationData();