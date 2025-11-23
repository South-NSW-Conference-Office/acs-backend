const jwt = require('jsonwebtoken');
const User = require('../models/User');
const tokenService = require('../services/tokenService');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

/**
 * Enhanced authentication token middleware with hierarchical support
 */
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

    const user = await User.findById(decoded.userId).populate({
      path: 'teamAssignments.teamId',
      populate: {
        path: 'churchId',
        populate: {
          path: 'conferenceId',
          populate: { path: 'unionId' }
        }
      }
    });

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

/**
 * Hierarchical authorization middleware
 * Enforces strict hierarchy: Super Admin → Conference → Church → Team → Service
 */
const authorizeHierarchical = (requiredAction, targetEntityType) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      // 1. Determine target entity
      const entityId =
        req.params.id ||
        req.params.teamId ||
        req.params.serviceId ||
        req.params.organizationId;
      let targetEntity = null;

      if (entityId && targetEntityType) {
        targetEntity = await hierarchicalAuthService.getEntity(
          targetEntityType,
          entityId
        );

        if (!targetEntity) {
          return res.status(404).json({
            success: false,
            message: `${targetEntityType} not found`,
          });
        }
      }

      // 2. Check hierarchical access
      if (targetEntity && targetEntity.hierarchyPath) {
        const canAccess = await hierarchicalAuthService.canUserManageEntity(
          user,
          targetEntity.hierarchyPath,
          requiredAction
        );

        if (!canAccess) {
          return res.status(403).json({
            success: false,
            message: `Insufficient hierarchical permissions for ${requiredAction} on ${targetEntityType}`,
            userLevel: await hierarchicalAuthService.getUserHighestLevel(user),
            targetLevel: hierarchicalAuthService.parseHierarchyLevel(
              targetEntity.hierarchyPath
            ),
            debug: {
              userPath:
                await hierarchicalAuthService.getUserHierarchyPath(user),
              targetPath: targetEntity.hierarchyPath,
            },
          });
        }
      } else if (requiredAction === 'create') {
        // For creation, check if user can create this type of entity
        const userLevel =
          await hierarchicalAuthService.getUserHighestLevel(user);
        const requiredLevel =
          hierarchicalAuthService.getEntityCreationLevel(targetEntityType);

        if (userLevel >= requiredLevel) {
          return res.status(403).json({
            success: false,
            message: `Insufficient permissions to create ${targetEntityType}`,
            userLevel,
            requiredLevel,
          });
        }
      }

      // 3. Store hierarchy context for route handlers
      req.targetEntity = targetEntity;
      req.hierarchicalAccess = true;
      req.userHierarchyLevel =
        await hierarchicalAuthService.getUserHighestLevel(user);
      req.userHierarchyPath =
        await hierarchicalAuthService.getUserHierarchyPath(user);

      next();
    } catch (error) {
      // Log hierarchical authorization error silently
      return res.status(500).json({
        success: false,
        message: 'Hierarchical authorization error',
        error: error.message,
      });
    }
  };
};

/**
 * Middleware to ensure only super admins can access system-level operations
 */
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userLevel = await hierarchicalAuthService.getUserHighestLevel(
      req.user
    );

    if (userLevel !== 0) {
      return res.status(403).json({
        success: false,
        message: 'Super admin access required',
        userLevel,
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

/**
 * Middleware to validate that user can access organization context
 */
const validateOrganizationContext = async (req, res, next) => {
  try {
    const organizationId =
      req.headers['x-organization-id'] || req.params.organizationId;

    if (!organizationId) {
      return next(); // No organization context is valid for some operations
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const organization = await hierarchicalAuthService.getEntity(
      'organization',
      organizationId
    );

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found',
      });
    }

    const canAccess = await hierarchicalAuthService.canUserManageEntity(
      req.user,
      organization.hierarchyPath,
      'read'
    );

    if (!canAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to specified organization',
      });
    }

    req.organizationContext = organization;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Organization validation error',
      err: error.message,
    });
  }
};

/**
 * Middleware for team-specific authorization
 */
const authorizeTeamAccess = (requiredAction = 'read') => {
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

      if (!teamId) {
        return res.status(400).json({
          success: false,
          message: 'Team context required',
        });
      }

      const team = await hierarchicalAuthService.getEntity('team', teamId);

      if (!team) {
        return res.status(404).json({
          success: false,
          message: 'Team not found',
        });
      }

      const canAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        team.hierarchyPath,
        requiredAction
      );

      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: `Insufficient permissions for ${requiredAction} on team`,
        });
      }

      req.teamContext = team;
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Team authorization error',
        err: error.message,
      });
    }
  };
};

/**
 * Middleware for service-specific authorization
 */
const authorizeServiceAccess = (requiredAction = 'read') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const serviceId =
        req.params.serviceId || req.params.id || req.body.serviceId;

      if (!serviceId) {
        return res.status(400).json({
          success: false,
          message: 'Service context required',
        });
      }

      const service = await hierarchicalAuthService.getEntity(
        'service',
        serviceId
      );

      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      const canAccess = await hierarchicalAuthService.canUserManageEntity(
        req.user,
        service.hierarchyPath,
        requiredAction
      );

      if (!canAccess) {
        return res.status(403).json({
          success: false,
          message: `Insufficient permissions for ${requiredAction} on service`,
        });
      }

      req.serviceContext = service;
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Service authorization error',
        err: error.message,
      });
    }
  };
};

module.exports = {
  authenticateToken,
  authorizeHierarchical,
  requireSuperAdmin,
  validateOrganizationContext,
  authorizeTeamAccess,
  authorizeServiceAccess,
};
