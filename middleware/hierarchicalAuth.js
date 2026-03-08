const jwt = require('jsonwebtoken');
const User = require('../models/User');
const tokenService = require('../services/tokenService');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// =============================================================================
// User cache — avoids 4-level deep Atlas populate on every request.
// Keyed by userId, entries expire after 60s or on explicit invalidation.
// =============================================================================
const _userCache = new Map();
const USER_CACHE_TTL = 60_000; // 60 seconds

function getCachedUser(userId) {
  const entry = _userCache.get(String(userId));
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_CACHE_TTL) {
    _userCache.delete(String(userId));
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  _userCache.set(String(userId), { user, ts: Date.now() });
}

function invalidateUserCache(userId) {
  _userCache.delete(String(userId));
}

// Prune stale entries every 5 minutes to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _userCache) {
    if (now - entry.ts > USER_CACHE_TTL) _userCache.delete(key);
  }
}, 5 * 60_000);

/**
 * authenticateToken
 *
 * Improvements over original:
 * - User is cached in memory (60s TTL) so the 4-level Atlas populate only
 *   runs once per user per minute instead of on every single request.
 * - blacklistedToken check already uses in-memory cache (fast path).
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
        err: 'No token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
    });

    // Blacklist check — already has in-memory fast path in tokenService
    const isBlacklisted = await tokenService.isBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked',
        err: 'Token blacklisted',
      });
    }

    // User lookup — serve from cache when possible
    let user = getCachedUser(decoded.userId);
    if (!user) {
      user = await User.findById(decoded.userId).populate({
        path: 'teamAssignments.teamId',
        populate: {
          path: 'churchId',
          populate: {
            path: 'conferenceId',
            populate: { path: 'unionId' },
          },
        },
      });
      if (user) setCachedUser(decoded.userId, user);
    }

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
 * authorizeHierarchical
 *
 * Improvements over original:
 * - getUserHighestLevel + getUserHierarchyPath resolved in parallel (Promise.all)
 *   instead of sequentially.
 * - Results stored on req so route handlers can read req.userHierarchyLevel /
 *   req.userHierarchyPath directly without redundant re-computation.
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

      // 1. Resolve hierarchy context in parallel (single async barrier)
      const [userLevel, userPath] = await Promise.all([
        hierarchicalAuthService.getUserHighestLevel(user),
        hierarchicalAuthService.getUserHierarchyPath(user),
      ]);

      // Store on req so route handlers never need to call these again
      req.userHierarchyLevel = userLevel;
      req.userHierarchyPath = userPath;
      req.hierarchicalAccess = true;

      // 2. Determine target entity (only for routes with :id param)
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

      req.targetEntity = targetEntity;

      // 3. Check hierarchical access
      if (targetEntity && targetEntity.hierarchyPath) {
        const canAccess = await hierarchicalAuthService.canUserManageEntity(
          user,
          targetEntity.hierarchyPath,
          requiredAction
        );

        if (!canAccess) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      } else if (requiredAction === 'create') {
        const requiredLevel =
          hierarchicalAuthService.getEntityCreationLevel(targetEntityType);

        if (userLevel >= requiredLevel) {
          return res.status(403).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Hierarchical authorization error',
        error: error.message,
      });
    }
  };
};

/**
 * requireSuperAdmin — uses req.userHierarchyLevel set by authorizeHierarchical
 * when available, otherwise resolves it once.
 */
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
      });
    }

    const userLevel =
      req.userHierarchyLevel !== undefined
        ? req.userHierarchyLevel
        : await hierarchicalAuthService.getUserHighestLevel(req.user);

    if (userLevel !== 0) {
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

/**
 * validateOrganizationContext
 */
const validateOrganizationContext = async (req, res, next) => {
  try {
    const organizationId =
      req.headers['x-organization-id'] || req.params.organizationId;

    if (!organizationId) {
      return next();
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
 * authorizeTeamAccess
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
 * authorizeServiceAccess
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
  invalidateUserCache,
};
