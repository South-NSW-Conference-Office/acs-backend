const express = require('express');
const { body, query, validationResult } = require('express-validator');
const User = require('../models/User');
const Role = require('../models/Role');
const { authenticateToken } = require('../middleware/auth');
const authorizationService = require('../services/authorizationService');
const { AuditLog } = require('../middleware/auditLog');

const router = express.Router();

// The hierarchical assignment arrays that replaced the removed `organizations`
// field, and the role paths worth populating on them. Populating
// 'organizations.role' instead threw outright: mongoose 7 rejects a populate on
// a path that is not in the schema (strictPopulate).
const ASSIGNMENT_ROLE_PATHS = [
  'unionAssignments.role',
  'conferenceAssignments.role',
  'churchAssignments.role',
].join(' ');

/**
 * The role assignments a user holds, in the shape the rest of the API reports
 * them (see routes/auth.js). Replaces reads of `user.organizations`, which is not
 * a field on the User schema — it only ever exists on built API responses, so
 * every read of it here was undefined.
 */
function assignmentSummary(user) {
  return [
    ...(user.unionAssignments || []),
    ...(user.conferenceAssignments || []),
    ...(user.churchAssignments || []),
  ]
    .filter((assignment) => assignment.role)
    .map((assignment) => ({
      role: {
        _id: assignment.role._id,
        name: assignment.role.name,
        displayName: assignment.role.displayName,
        level: assignment.role.level,
      },
      assignedAt: assignment.assignedAt,
    }));
}

// Middleware to ensure only super admins can access these routes
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Super admin access required',
      });
    }
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message,
    });
  }
};

// Log super admin actions for audit trail
const logSuperAdminAction = async (
  action,
  targetUser,
  performedBy,
  req,
  details = {}
) => {
  try {
    const auditEntry = new AuditLog({
      userId: performedBy._id,
      action: action,
      method: req.method,
      path: req.originalUrl,
      targetResource: 'super_admin',
      targetId: targetUser._id,
      statusCode: 200,
      ipAddress: req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
      userAgent: req.get('user-agent'),
      metadata: {
        targetUserEmail: targetUser.email,
        targetUserName: targetUser.name,
        ...details,
      },
    });
    await auditEntry.save();
  } catch (error) {
    // Error logging super admin action
  }
};

// GET /api/super-admin/users - Get all users with super admin status
router.get('/users', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    // Someone can be a super admin two ways: the isSuperAdmin flag, or a
    // super_admin role on one of their hierarchical assignments. The second half
    // used to be `{ 'organizations.role': { $exists: true } }`, a path that is not
    // on the User schema, so it matched nobody — a super admin who holds the role
    // by assignment rather than the flag was missing from this list entirely.
    const superAdminRole = await Role.findOne({ name: 'super_admin' })
      .select('_id')
      .lean();

    const holdsSuperAdminRole = superAdminRole
      ? [
          { 'unionAssignments.role': superAdminRole._id },
          { 'conferenceAssignments.role': superAdminRole._id },
          { 'churchAssignments.role': superAdminRole._id },
        ]
      : [];

    const superAdminUsers = await User.find({
      $or: [{ isSuperAdmin: true }, ...holdsSuperAdminRole],
    })
      .populate(ASSIGNMENT_ROLE_PATHS)
      .select('-password')
      .sort({ createdAt: -1 });

    // Second pass in code, so the flag and the role are judged by the same rule
    // the rest of the API uses rather than a copy of it here.
    const filteredUsers = superAdminUsers.filter((user) =>
      authorizationService.isSuperAdmin(user)
    );

    // Everyone else who could be promoted. Excluding the role-holders in the query
    // keeps the list accurate even before the code-side filter runs.
    const eligibleQuery = {
      isSuperAdmin: { $ne: true },
      isActive: true,
      verified: true,
    };
    if (holdsSuperAdminRole.length > 0) {
      eligibleQuery.$nor = holdsSuperAdminRole;
    }

    const regularUsers = await User.find(eligibleQuery)
      .populate(ASSIGNMENT_ROLE_PATHS)
      .select('-password')
      .sort({ name: 1 });

    const eligibleUsers = regularUsers.filter(
      (user) => !authorizationService.isSuperAdmin(user)
    );

    res.json({
      success: true,
      data: {
        superAdmins: filteredUsers.map((user) => ({
          id: user._id,
          name: user.name,
          email: user.email,
          isSuperAdmin: user.isSuperAdmin || false,
          avatar: user.avatar,
          organizations: assignmentSummary(user),
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
          isActive: user.isActive,
        })),
        eligibleUsers: eligibleUsers.map((user) => ({
          id: user._id,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          organizations: assignmentSummary(user),
          verified: user.verified,
        })),
      },
    });
  } catch (error) {
    // Error fetching super admin users
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message,
    });
  }
});

// POST /api/super-admin/grant - Grant super admin privileges
router.post(
  '/grant',
  authenticateToken,
  requireSuperAdmin,
  [
    body('userId').isMongoId().withMessage('Valid user ID required'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { userId, reason } = req.body;

      // Prevent self-modification
      if (userId === req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot modify your own super admin status',
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Check if already super admin
      if (user.isSuperAdmin) {
        return res.status(400).json({
          success: false,
          message: 'User is already a super admin',
        });
      }

      // Grant super admin privileges
      user.isSuperAdmin = true;
      await user.save();

      // Log the action
      await logSuperAdminAction('grant_super_admin', user, req.user, req, {
        reason,
      });

      // Send notification email (if email service is configured)
      // await emailService.sendSuperAdminGrantedEmail(user, req.user, reason);

      res.json({
        success: true,
        message: `Super admin privileges granted to ${user.name}`,
        data: {
          id: user._id,
          name: user.name,
          email: user.email,
          isSuperAdmin: user.isSuperAdmin,
        },
      });
    } catch (error) {
      // Error granting super admin privileges
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// POST /api/super-admin/revoke - Revoke super admin privileges
router.post(
  '/revoke',
  authenticateToken,
  requireSuperAdmin,
  [
    body('userId').isMongoId().withMessage('Valid user ID required'),
    body('reason').optional().isString().withMessage('Reason must be a string'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const { userId, reason } = req.body;

      // Prevent self-modification
      if (userId === req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Cannot revoke your own super admin status',
        });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Check if not super admin
      if (!user.isSuperAdmin) {
        return res.status(400).json({
          success: false,
          message: 'User is not a super admin',
        });
      }

      // Count remaining super admins
      const superAdminCount = await User.countDocuments({
        isSuperAdmin: true,
        _id: { $ne: userId },
      });

      if (superAdminCount < 1) {
        return res.status(400).json({
          success: false,
          message:
            'Cannot revoke super admin privileges. At least one super admin must remain in the system.',
        });
      }

      // Revoke super admin privileges
      user.isSuperAdmin = false;
      await user.save();

      // Log the action
      await logSuperAdminAction('revoke_super_admin', user, req.user, req, {
        reason,
      });

      // Send notification email (if email service is configured)
      // await emailService.sendSuperAdminRevokedEmail(user, req.user, reason);

      res.json({
        success: true,
        message: `Super admin privileges revoked from ${user.name}`,
        data: {
          id: user._id,
          name: user.name,
          email: user.email,
          isSuperAdmin: user.isSuperAdmin,
        },
      });
    } catch (error) {
      // Error revoking super admin privileges
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// GET /api/super-admin/audit-logs - Get super admin action audit logs
router.get(
  '/audit-logs',
  authenticateToken,
  requireSuperAdmin,
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1-100'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array(),
        });
      }

      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;

      const logs = await AuditLog.find({
        targetResource: 'super_admin',
      })
        .populate('userId', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const totalCount = await AuditLog.countDocuments({
        targetResource: 'super_admin',
      });

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            page,
            limit,
            totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        },
      });
    } catch (error) {
      // Error fetching audit logs
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        err: error.message,
      });
    }
  }
);

// GET /api/super-admin/stats - Get super admin statistics
router.get('/stats', authenticateToken, requireSuperAdmin, async (req, res) => {
  try {
    const superAdminCount = await User.countDocuments({ isSuperAdmin: true });
    const totalUsers = await User.countDocuments({ isActive: true });
    const verifiedUsers = await User.countDocuments({
      isActive: true,
      verified: true,
    });

    // Get recent super admin actions
    const recentActions = await AuditLog.find({
      targetResource: 'super_admin',
    })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      success: true,
      data: {
        stats: {
          superAdminCount,
          totalUsers,
          verifiedUsers,
          percentageSuperAdmins:
            totalUsers > 0
              ? ((superAdminCount / totalUsers) * 100).toFixed(2)
              : 0,
        },
        recentActions,
      },
    });
  } catch (error) {
    // Error fetching super admin stats
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      err: error.message,
    });
  }
});

module.exports = router;
