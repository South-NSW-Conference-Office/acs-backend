const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
    const user = await User.findById(decoded.userId).populate(
      'organizations.organization organizations.role'
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
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);

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

const authorize = (requiredPermission, options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const organizationId =
        req.headers['x-organization-id'] || req.user.primaryOrganization;

      if (!organizationId) {
        return res.status(400).json({
          success: false,
          message: 'Organization context required',
        });
      }

      const userPermissions =
        await req.user.getPermissionsForOrganization(organizationId);

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
      console.error('Authorization error:', error);
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

module.exports = {
  authenticateToken,
  authorize,
  checkPermission,
};
