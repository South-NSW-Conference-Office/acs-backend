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
      'unionAssignments.role conferenceAssignments.role churchAssignments.role teamAssignments.teamId'
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

      // Check if user is super admin first
      if (req.user.isSuperAdmin) {
        // Super admins have all permissions regardless of hierarchical entity
        req.userPermissions = {
          role: {
            id: 'super_admin',
            name: 'super_admin',
            displayName: 'Super Administrator',
            level: 'system',
          },
          permissions: ['*'],
        };
        req.unionId = req.headers['x-union-id'] || null;
        req.conferenceId = req.headers['x-conference-id'] || null;
        req.churchId = req.headers['x-church-id'] || null;
        return next();
      }

      // For hierarchical context, try to get from headers
      const unionId = req.headers['x-union-id'];
      const conferenceId = req.headers['x-conference-id'];
      const churchId = req.headers['x-church-id'];

      // Determine the most specific context provided
      let entityType = null;
      let entityId = null;

      if (churchId) {
        entityType = 'church';
        entityId = churchId;
      } else if (conferenceId) {
        entityType = 'conference';
        entityId = conferenceId;
      } else if (unionId) {
        entityType = 'union';
        entityId = unionId;
      }

      let userPermissions = { role: null, permissions: [] };

      // Get permissions based on the most specific context
      if (entityType && entityId) {
        switch (entityType) {
          case 'church':
            userPermissions = await req.user.getPermissionsForChurch(entityId);
            break;
          case 'conference':
            userPermissions =
              await req.user.getPermissionsForConference(entityId);
            break;
          case 'union':
            userPermissions = await req.user.getPermissionsForUnion(entityId);
            break;
        }
      }

      // If no specific permissions found, try to find any role assignment
      if (!userPermissions.role) {
        // Check for any union assignment
        if (req.user.unionAssignments && req.user.unionAssignments.length > 0) {
          const assignment = req.user.unionAssignments[0];
          if (assignment.role) {
            userPermissions = {
              role: assignment.role,
              permissions: assignment.role.permissions || [],
            };
          }
        }
        // Check for any conference assignment
        else if (
          req.user.conferenceAssignments &&
          req.user.conferenceAssignments.length > 0
        ) {
          const assignment = req.user.conferenceAssignments[0];
          if (assignment.role) {
            userPermissions = {
              role: assignment.role,
              permissions: assignment.role.permissions || [],
            };
          }
        }
        // Check for any church assignment
        else if (
          req.user.churchAssignments &&
          req.user.churchAssignments.length > 0
        ) {
          const assignment = req.user.churchAssignments[0];
          if (assignment.role) {
            userPermissions = {
              role: assignment.role,
              permissions: assignment.role.permissions || [],
            };
          }
        }
      }

      if (!userPermissions.role) {
        return res.status(403).json({
          success: false,
          message: 'No role assigned',
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
      req.unionId = unionId;
      req.conferenceId = conferenceId;
      req.churchId = churchId;
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

    // Check if user has super admin role in any hierarchical entity
    const hasSuperAdminRole =
      req.user.isSuperAdmin ||
      (req.user.unionAssignments &&
        req.user.unionAssignments.some(
          (assignment) =>
            assignment.role && assignment.role.name === 'super_admin'
        )) ||
      (req.user.conferenceAssignments &&
        req.user.conferenceAssignments.some(
          (assignment) =>
            assignment.role && assignment.role.name === 'super_admin'
        )) ||
      (req.user.churchAssignments &&
        req.user.churchAssignments.some(
          (assignment) =>
            assignment.role && assignment.role.name === 'super_admin'
        ));

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
