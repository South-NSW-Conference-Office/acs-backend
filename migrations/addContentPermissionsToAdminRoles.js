require('dotenv').config();
const mongoose = require('mongoose');
const Role = require('../models/Role');
const logger = require('../services/loggerService');

/**
 * Grant website-content and media permissions to the admin roles.
 *
 * Why this migration exists:
 * Roles are documents in MongoDB, not code. The definitions in models/Role.js
 * are applied by roleSchema.statics.createSystemRoles, which runs on every
 * server start via utils/initializeDatabase.js and upserts each role - so the
 * permission grants in Role.js do reach a running system on deploy.
 *
 * This migration is therefore a safety net rather than a requirement: it
 * applies the same change explicitly, without needing a restart, and makes the
 * intent auditable.
 *
 * Background: no role in the system granted page_content.manage, media.upload
 * or media.manage, so every route in routes/admin/page-content.js and the
 * upload route in routes/media.js were reachable only by a super admin. That
 * is why no administrator could edit website text or upload media.
 *
 * Idempotent: uses $addToSet, so re-running adds nothing and removes nothing.
 *
 * Usage:  node migrations/addContentPermissionsToAdminRoles.js
 */

const CONTENT_PERMISSIONS = [
  'page_content.manage',
  'media.upload',
  'media.manage',
];

const TARGET_ROLES = ['union_admin', 'conference_admin', 'church_admin'];

async function addContentPermissionsToAdminRoles() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not set');
    }

    await mongoose.connect(process.env.MONGO_URI);
    logger.info('Connected to database');

    for (const roleName of TARGET_ROLES) {
      const role = await Role.findOne({ name: roleName });

      if (!role) {
        logger.warn(`Role not found, skipping: ${roleName}`);
        continue;
      }

      const missing = CONTENT_PERMISSIONS.filter(
        (permission) => !(role.permissions || []).includes(permission)
      );

      if (missing.length === 0) {
        logger.info(`${roleName}: already has content permissions, skipping`);
        continue;
      }

      await Role.updateOne(
        { _id: role._id },
        { $addToSet: { permissions: { $each: CONTENT_PERMISSIONS } } }
      );

      logger.info(`${roleName}: added ${missing.join(', ')}`);
    }

    logger.info('Content permissions migration complete');
  } catch (error) {
    logger.error('Error adding content permissions:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info('Database connection closed');
  }
}

if (require.main === module) {
  addContentPermissionsToAdminRoles()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(error);
      process.exit(1);
    });
}

module.exports = addContentPermissionsToAdminRoles;
