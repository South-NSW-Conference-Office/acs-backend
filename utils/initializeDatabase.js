const Role = require('../models/Role');
const Permission = require('../models/Permission');
const migratePermissions = require('../migrations/migratePermissions');

async function initializeDatabase() {
  try {
    // Checking database initialization

    // Check if permissions already exist
    const permissionCount = await Permission.countDocuments();
    if (permissionCount === 0) {
      // Initializing permissions
      await migratePermissions();
    } else {
      // Database already initialized with existing permissions
    }

    // Always ensure system roles exist (quick operation)
    await Role.createSystemRoles();

    // Database initialization completed
  } catch (error) {
    // Database initialization failed - logged for debugging
    // Don't exit the process, just log the error
  }
}

module.exports = initializeDatabase;
