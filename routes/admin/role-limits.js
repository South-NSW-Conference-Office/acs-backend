const express = require('express');
const Role = require('../../models/Role');
const User = require('../../models/User');
const {
  authenticateToken,
  requireSuperAdmin,
} = require('../../middleware/auth');
const logger = require('../../services/loggerService');

const router = express.Router();

router.get('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const roles = await Role.find({
      'quotaLimits.maxUsers': { $exists: true },
    }).select('name displayName quotaLimits description isSystem');

    const roleLimitsWithCounts = await Promise.all(
      roles.map(async (role) => {
        const currentCount = await User.countDocuments({
          'organizations.role': role._id,
          isActive: { $ne: false },
        });

        return {
          role: role.name,
          displayName: role.displayName,
          currentLimit: role.quotaLimits.maxUsers,
          currentCount,
          description: role.description,
          isSystem: role.isSystem || role.name === 'super_admin',
        };
      })
    );

    roleLimitsWithCounts.sort((a, b) => {
      if (a.isSystem && !b.isSystem) return -1;
      if (!a.isSystem && b.isSystem) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    res.json(roleLimitsWithCounts);
  } catch (error) {
    logger.error('Error fetching role limits:', error);
    res.status(500).json({
      message: 'Failed to fetch role limits',
      error: error.message,
    });
  }
});

router.put('/', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const { role, maxUsers } = req.body;

    if (!role || !maxUsers || maxUsers < 1) {
      return res.status(400).json({
        message: 'Invalid input. Role and maxUsers (minimum 1) are required.',
      });
    }

    const roleDoc = await Role.findOne({ name: role });
    if (!roleDoc) {
      return res.status(404).json({ message: 'Role not found' });
    }

    const currentUserCount = await User.countDocuments({
      'organizations.role': roleDoc._id,
      isActive: { $ne: false },
    });

    if (maxUsers < currentUserCount) {
      return res.status(400).json({
        message: `Cannot set limit (${maxUsers}) below current user count (${currentUserCount})`,
      });
    }

    await Role.updateOne(
      { name: role },
      {
        $set: {
          'quotaLimits.maxUsers': maxUsers,
          updatedAt: new Date(),
          updatedBy: req.user.id,
        },
      }
    );

    res.json({
      message: 'Role limit updated successfully',
      role,
      maxUsers,
      previousLimit: roleDoc.quotaLimits.maxUsers,
    });
  } catch (error) {
    logger.error('Error updating role limit:', error);
    res.status(500).json({
      message: 'Failed to update role limit',
      error: error.message,
    });
  }
});

module.exports = router;
