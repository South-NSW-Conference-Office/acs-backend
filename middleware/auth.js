const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authorizationService = require('../services/authorizationService');
const tokenService = require('../services/tokenService');

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
        err: 'No token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if token is blacklisted
    const isBlacklisted = await tokenService.isBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked',
        err: 'Token blacklisted',
      });
    }

    const user = await User.findById(decoded.userId).populate(
      'organizations.organization organizations.role teamAssignments.teamId'
    );

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not found',
        err: 'User not found or inactive',
      });
    }

    req.user = user;
    req.token = token;
    req.decoded = decoded;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
        err: 'Token verification failed',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
        err: 'Token has expired',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication error',
      err: error.message,
    });
  }
};

const authorize = (requiredPermission = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      // For organization context, try multiple fallbacks
      const organizationId =
        req.headers['x-organization-id'] ||
        req.user.primaryOrganization?._id ||
        req.user.primaryOrganization;

      // Validate organization context if provided via header
      if (req.headers['x-organization-id']) {
        const validation =
          await authorizationService.validateOrganizationContext(
            req.user,
            req.headers['x-organization-id']
          );

        if (!validation.valid) {
          return res.status(403).json({
            success: false,
            message: validation.error,
          });
        }
      }

      // If still no organization context, try to use the user's first organization
      let finalOrgId = organizationId;
      if (
        !finalOrgId &&
        req.user.organizations &&
        req.user.organizations.length > 0
      ) {
        finalOrgId =
          req.user.organizations[0].organization._id ||
          req.user.organizations[0].organization;
      }

      if (!finalOrgId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
        });
      }

      const userPermissions =
        await req.user.getPermissionsForOrganization(finalOrgId);

      // If no role found for specific org, but user has any role assignments, use the primary one
      if (
        !userPermissions.role &&
        req.user.organizations &&
        req.user.organizations.length > 0
      ) {
        await req.user.populate('organizations.role');
        const primaryAssignment =
          req.user.organizations.find(
            (org) =>
              org.organization._id?.toString() ===
                req.user.primaryOrganization?.toString() ||
              org.organization?.toString() ===
                req.user.primaryOrganization?.toString()
          ) || req.user.organizations[0];

        if (primaryAssignment && primaryAssignment.role) {
          userPermissions.role = primaryAssignment.role;
          userPermissions.permissions =
            primaryAssignment.role.permissions || [];
        } else {
          return res.status(403).json({
            success: false,
            message: 'No role assigned in this organization',
          });
        }
      }

      if (!userPermissions.role) {
        return res.status(403).json({
          success: false,
          message: 'No role assigned in this organization',
        });
      }

      // Check if user has the required permission
      const hasPermission = checkPermission(
        userPermissions.permissions,
        requiredPermission
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Insufficient permissions',
          required: requiredPermission,
          userPermissions: userPermissions.permissions,
        });
      }

      req.userPermissions = userPermissions;
      req.organizationId = organizationId;
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Authorization error',
        err: error.message,
      });
    }
  };
};

const checkPermission = (userPermissions, requiredPermission) => {
  if (!userPermissions || userPermissions.length === 0) {
    return false;
  }

  // Check for wildcard permissions
  if (userPermissions.includes('*') || userPermissions.includes('all')) {
    return true;
  }

  // Check exact match
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  // Check resource wildcard (e.g., 'users.*' matches 'users.create')
  const [resource, action] = requiredPermission.split('.');
  if (userPermissions.includes(`${resource}.*`)) {
    return true;
  }

  // Check for scoped permissions (e.g., 'organizations.create:subordinate' matches 'organizations.create')
  const matchesScoped = userPermissions.some((permission) => {
    const [permResource, permActionWithScope] = permission.split('.');
    if (!permActionWithScope || !permActionWithScope.includes(':')) {
      return false;
    }

    const [permAction] = permActionWithScope.split(':');
    return permResource === resource && permAction === action;
  });

  return matchesScoped;
};

// Middleware to ensure only super admins can access system-level operations
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    // Check if user has super admin role in any organization
    const hasSuperAdminRole = req.user.organizations.some(
      (org) => org.role && org.role.name === 'super_admin'
    );

    if (!hasSuperAdminRole) {
      return res.status(403).json({
        success: false,
        message: 'Super admin access required',
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authorization error',
      err: error.message,
    });
  }
};

// Middleware to validate organization context
const validateOrganizationContext = async (req, res, next) => {
  try {
    const organizationId = req.headers['x-organization-id'];

    if (!organizationId) {
      return next(); // No organization context is valid
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const validation = await authorizationService.validateOrganizationContext(
      req.user,
      organizationId
    );

    if (!validation.valid) {
      return res.status(403).json({
        success: false,
        message: validation.error,
      });
    }

    req.organizationId = organizationId;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Organization validation error',
      err: error.message,
    });
  }
};

// New middleware to authorize with team context
const authorizeWithTeam = (requiredPermission = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const teamId =
        req.headers['x-team-id'] || req.params.teamId || req.body.teamId;

      // If team context is provided
      if (teamId) {
        const teamPermissions = await req.user.getPermissionsForTeam(teamId);

        if (!teamPermissions.orgRole) {
          return res.status(403).json({
            success: false,
            message: 'No access to this team',
          });
        }

        // Check team-scoped permissions
        const hasPermission = checkPermissionWithScope(
          teamPermissions.permissions,
          requiredPermission,
          'team',
          { teamId, teamRole: teamPermissions.teamRole }
        );

        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient team permissions',
            required: requiredPermission,
          });
        }

        req.teamPermissions = teamPermissions;
        req.teamId = teamId;
        req.organizationId = teamPermissions.organization;
        next();
      } else {
        // Fall back to organization authorization
        return authorize(requiredPermission)(req, res, next);
      }
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Team authorization error',
        err: error.message,
      });
    }
  };
};

// Enhanced permission check with scope support
const checkPermissionWithScope = (
  userPermissions,
  requiredPermission,
  scope,
  context = {}
) => {
  if (!userPermissions || userPermissions.length === 0) {
    return false;
  }

  // Check for wildcard permissions
  if (userPermissions.includes('*') || userPermissions.includes('all')) {
    return true;
  }

  // Parse required permission
  const [reqResource, reqAction] = requiredPermission.split('.');

  // Check each user permission
  for (const permission of userPermissions) {
    const [permResource, permActionWithScope] = permission.split('.');

    if (!permActionWithScope) continue;

    // Check resource match or wildcard
    if (permResource !== reqResource && permResource !== '*') continue;

    // Parse action and scope
    let permAction, permScope;
    if (permActionWithScope.includes(':')) {
      [permAction, permScope] = permActionWithScope.split(':');
    } else {
      permAction = permActionWithScope;
      permScope = null;
    }

    // Check action match or wildcard
    if (permAction !== reqAction && permAction !== '*') continue;

    // Check scope compatibility
    if (scope && permScope) {
      // Team scope checks
      if (scope === 'team') {
        if (permScope === 'team' || permScope === 'all') return true;
        if (permScope === 'team_subordinate' && context.teamRole === 'leader')
          return true;
      }
      // Region scope checks
      else if (scope === 'region') {
        if (
          permScope === 'region' ||
          permScope === 'all' ||
          permScope === 'subordinate'
        )
          return true;
      }
    } else if (!permScope) {
      // Permission has no scope restriction
      return true;
    }
  }

  return false;
};

module.exports = {
  authenticateToken,
  authorize,
  authorizeWithTeam,
  checkPermission,
  checkPermissionWithScope,
  requireSuperAdmin,
  validateOrganizationContext,
};
