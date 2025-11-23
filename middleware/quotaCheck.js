const Role = require('../models/Role');
const User = require('../models/User');
const mongoose = require('mongoose');
const logger = require('../services/loggerService');

/**
 * Middleware to check role quotas before creating users or assigning roles
 */
const checkRoleQuota = async (req, res, next) => {
  try {
    // Extract role and organization info from request
    const roleId = req.body.roleId || req.body.role;
    const organizationId =
      req.body.organizationId ||
      req.organizationId ||
      req.headers['x-organization-id'];

    if (!roleId) {
      // No role specified, proceed without quota check
      return next();
    }

    // Get the role - handle both ObjectId and string role names
    const role = mongoose.Types.ObjectId.isValid(roleId)
      ? await Role.findById(roleId)
      : await Role.findOne({ name: roleId });
    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified',
      });
    }

    // Check if role has quota limits
    if (!role.quotaLimits || !role.quotaLimits.maxUsers) {
      // No quota limits, proceed
      return next();
    }

    // Check current quota status
    const quotaStatus = await role.checkQuota(organizationId);

    if (!quotaStatus.allowed) {
      return res.status(403).json({
        success: false,
        message: `Role quota exceeded for ${role.displayName}`,
        quota: {
          current: quotaStatus.current,
          max: quotaStatus.max,
          remaining: 0,
        },
      });
    }

    // Add quota info to request for potential use in response
    req.quotaInfo = {
      role: {
        id: role._id,
        name: role.name,
        displayName: role.displayName,
        category: role.roleCategory,
      },
      quota: quotaStatus,
    };

    // If near limit, add warning to response
    if (quotaStatus.nearLimit) {
      res.setHeader(
        'X-Quota-Warning',
        `Role ${role.displayName} is near quota limit: ${quotaStatus.current}/${quotaStatus.max}`
      );
    }

    next();
  } catch (error) {
    logger.error('Quota check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking role quota',
      err: error.message,
    });
  }
};

/**
 * Middleware to check quotas for bulk operations
 */
const checkBulkQuota = async (req, res, next) => {
  try {
    const { users, organizationId } = req.body;

    if (!users || !Array.isArray(users)) {
      return next();
    }

    // Group users by role
    const roleGroups = {};
    for (const user of users) {
      const roleId = user.roleId || user.role;
      if (roleId) {
        if (!roleGroups[roleId]) {
          roleGroups[roleId] = 0;
        }
        roleGroups[roleId]++;
      }
    }

    // Check quota for each role
    const quotaChecks = [];
    for (const [roleId, count] of Object.entries(roleGroups)) {
      const role = mongoose.Types.ObjectId.isValid(roleId)
        ? await Role.findById(roleId)
        : await Role.findOne({ name: roleId });
      if (!role || !role.quotaLimits || !role.quotaLimits.maxUsers) {
        continue;
      }

      const quotaStatus = await role.checkQuota(organizationId);
      const wouldExceed =
        quotaStatus.current + count > role.quotaLimits.maxUsers;

      if (wouldExceed) {
        quotaChecks.push({
          role: role.displayName,
          requested: count,
          available: quotaStatus.remaining,
          wouldExceed: true,
        });
      }
    }

    if (quotaChecks.some((check) => check.wouldExceed)) {
      return res.status(403).json({
        success: false,
        message: 'Bulk operation would exceed role quotas',
        quotaViolations: quotaChecks.filter((check) => check.wouldExceed),
      });
    }

    next();
  } catch (error) {
    logger.error('Bulk quota check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking bulk role quotas',
      err: error.message,
    });
  }
};

/**
 * Get quota status for all roles
 */
const getQuotaStatus = async (req, res) => {
  try {
    const organizationId =
      req.query.organizationId ||
      req.organizationId ||
      req.headers['x-organization-id'];

    const quotaStatuses = await Role.getQuotaStatus(organizationId);

    // Calculate overall system health
    const systemHealth = {
      totalRoles: quotaStatuses.length,
      rolesNearLimit: quotaStatuses.filter((s) => s.quota.nearLimit).length,
      rolesAtLimit: quotaStatuses.filter((s) => !s.quota.allowed).length,
      overallUsage:
        quotaStatuses.reduce((sum, s) => {
          return sum + (s.quota.percentage || 0);
        }, 0) / quotaStatuses.length,
    };

    res.json({
      success: true,
      data: {
        quotaStatuses,
        systemHealth,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    logger.error('Get quota status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving quota status',
      err: error.message,
    });
  }
};

/**
 * Middleware to validate role assignment changes don't exceed quotas
 */
const checkRoleChangeQuota = async (req, res, next) => {
  try {
    const { newRoleId, userId } = req.body;
    const organizationId = req.body.organizationId || req.organizationId;

    if (!newRoleId) {
      return next();
    }

    // Get current user's role
    const user = await User.findById(userId).populate(
      'unionAssignments.role conferenceAssignments.role churchAssignments.role'
    );
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if user already has this role in the organization
    const existingAssignment = user.organizations.find(
      (org) => org.organization.toString() === organizationId.toString()
    );

    if (
      existingAssignment &&
      existingAssignment.role._id.toString() === newRoleId
    ) {
      // No change, proceed
      return next();
    }

    // Get new role
    const newRole = await Role.findById(newRoleId);
    if (!newRole) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified',
      });
    }

    // Check quota for new role
    if (newRole.quotaLimits && newRole.quotaLimits.maxUsers) {
      const quotaStatus = await newRole.checkQuota(organizationId);

      if (!quotaStatus.allowed) {
        return res.status(403).json({
          success: false,
          message: `Cannot change role: ${newRole.displayName} quota exceeded`,
          quota: quotaStatus,
        });
      }
    }

    next();
  } catch (error) {
    logger.error('Role change quota check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking role change quota',
      err: error.message,
    });
  }
};

module.exports = {
  checkRoleQuota,
  checkBulkQuota,
  getQuotaStatus,
  checkRoleChangeQuota,
};
