const AuditLog = require('../models/AuditLog');
const geoip = require('geoip-lite');

/**
 * Audit logging middleware for tracking all significant actions
 */
class AuditLogger {
  /**
   * Main audit logging middleware
   */
  static middleware() {
    return async (req, res, next) => {
      // Skip audit logging for certain paths
      const skipPaths = ['/api/health', '/api/metrics', '/api/audit/logs'];
      if (skipPaths.some((path) => req.path.startsWith(path))) {
        return next();
      }

      // Capture start time
      const startTime = Date.now();

      // Store original methods
      const originalJson = res.json;
      const originalSend = res.send;
      const originalStatus = res.status;

      let statusCode = 200;
      let responseData = null;

      // Override response methods to capture data
      res.status = function (code) {
        statusCode = code;
        return originalStatus.call(this, code);
      };

      res.json = function (data) {
        responseData = data;
        return originalJson.call(this, data);
      };

      res.send = function (data) {
        responseData = data;
        return originalSend.call(this, data);
      };

      // Add audit logging function to request
      req.auditLog = async (action, targetInfo, additionalData = {}) => {
        try {
          const duration = Date.now() - startTime;
          const geo = geoip.lookup(req.ip);

          const auditData = {
            action,
            actor: AuditLogger._getActorInfo(req),
            target: targetInfo,
            hierarchyContext: AuditLogger._getHierarchyContext(req, targetInfo),
            request: {
              method: req.method,
              path: req.path,
              query: req.query,
              body: AuditLogger._sanitizeRequestBody(req.body),
              headers: {
                userAgent: req.get('user-agent'),
                referer: req.get('referer'),
              },
            },
            network: {
              ipAddress: req.ip,
              location: geo
                ? {
                    country: geo.country,
                    region: geo.region,
                    city: geo.city,
                    coordinates: [geo.ll[1], geo.ll[0]], // [longitude, latitude]
                  }
                : undefined,
            },
            result: {
              success: statusCode < 400,
              duration,
              error:
                statusCode >= 400
                  ? {
                      code: statusCode.toString(),
                      message: responseData?.message || responseData?.error,
                    }
                  : undefined,
            },
            session: {
              id: req.sessionID || req.get('x-session-id'),
              deviceType: AuditLogger._getDeviceType(req.get('user-agent')),
            },
            compliance: additionalData.compliance,
            retention: {
              category: AuditLogger._determineRetentionCategory(action),
            },
            timestamp: new Date(),
          };

          // Merge additional data
          if (additionalData.changes) {
            auditData.changes = additionalData.changes;
          }
          if (additionalData.affectedCount !== undefined) {
            auditData.result.affectedCount = additionalData.affectedCount;
          }

          await AuditLog.logAction(auditData);
        } catch (error) {
          // Silently handle audit logging errors to prevent affecting main request
          // Don't let audit logging errors affect the main request
        }
      };

      // Continue with request
      next();
    };
  }

  /**
   * Permission check audit middleware
   */
  static permissionAudit() {
    return async (req, res, next) => {
      const originalCheckPermission = req.checkPermission;

      if (originalCheckPermission) {
        req.checkPermission = async function (permission, targetEntity) {
          Date.now(); // Track timing if needed
          const result = await originalCheckPermission.call(
            this,
            permission,
            targetEntity
          );

          // Log permission escalations and failures
          if (
            !result ||
            (targetEntity &&
              AuditLogger._isPermissionEscalation(req.user, targetEntity))
          ) {
            const action = result
              ? 'permission.escalation'
              : 'permission.check_failed';

            req.auditLog(
              action,
              {
                type: 'permission',
                id: permission,
                name: permission,
                hierarchyPath: targetEntity?.hierarchyPath,
              },
              {
                compliance: {
                  reason: `Permission check for ${permission}`,
                  sensitive: true,
                },
              }
            );
          }

          return result;
        };
      }

      next();
    };
  }

  /**
   * Authentication audit middleware
   */
  static authAudit() {
    return async (req, res, next) => {
      // Audit failed authentication attempts
      if (req.path === '/api/auth/login' && req.method === 'POST') {
        const originalEnd = res.end;

        res.end = function (...args) {
          if (res.statusCode === 401) {
            AuditLog.logAction({
              action: 'auth.failed_login',
              actor: {
                type: 'anonymous',
                email: req.body?.email,
              },
              target: {
                type: 'system',
                name: 'authentication',
              },
              network: {
                ipAddress: req.ip,
              },
              result: {
                success: false,
                error: {
                  code: '401',
                  message: 'Invalid credentials',
                },
              },
              retention: {
                category: 'security',
              },
            });
          } else if (res.statusCode === 200) {
            // Log successful login in the auth controller
          }

          return originalEnd.apply(this, args);
        };
      }

      next();
    };
  }

  /**
   * Hierarchy change audit middleware
   */
  static hierarchyAudit() {
    return async (req, res, next) => {
      // Track hierarchy-related endpoints
      const hierarchyEndpoints = {
        '/api/organizations': 'organization',
        '/api/teams': 'team',
        '/api/services': 'service',
      };

      const entityType = Object.keys(hierarchyEndpoints).find((path) =>
        req.path.startsWith(path)
      );

      if (
        entityType &&
        ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
      ) {
        const originalEnd = res.end;

        res.end = function (...args) {
          if (res.statusCode < 400) {
            const action = AuditLogger._getActionFromMethod(
              req.method,
              hierarchyEndpoints[entityType]
            );

            // Parse response to get entity details
            try {
              const responseBody = JSON.parse(args[0]);
              const entity = responseBody.data || responseBody;

              if (entity && entity._id) {
                req.auditLog(
                  action,
                  {
                    type: hierarchyEndpoints[entityType],
                    id: entity._id,
                    name: entity.name,
                    hierarchyPath: entity.hierarchyPath,
                  },
                  {
                    changes:
                      req.method === 'PUT' || req.method === 'PATCH'
                        ? AuditLogger._extractChanges(req.body)
                        : undefined,
                  }
                );
              }
            } catch (e) {
              // Couldn't parse response
            }
          }

          return originalEnd.apply(this, args);
        };
      }

      next();
    };
  }

  /**
   * Helper methods
   */
  static _getActorInfo(req) {
    if (!req.user) {
      return {
        type: 'anonymous',
      };
    }

    return {
      type: 'user',
      userId: req.user._id || req.user.id,
      email: req.user.email,
      name: req.user.name,
      hierarchyLevel: req.user.hierarchyLevel,
      hierarchyPath: req.user.hierarchyPath,
      impersonatedBy: req.impersonatedBy,
    };
  }

  static _getHierarchyContext(req, targetInfo) {
    if (!req.user || !targetInfo?.hierarchyPath) {
      return {};
    }

    const actorPath = req.user.hierarchyPath || '';
    const targetPath = targetInfo.hierarchyPath || '';

    return {
      actorPath,
      targetPath,
      crossHierarchy: targetPath && !targetPath.startsWith(actorPath),
      hierarchyViolation: false, // Will be set by specific checks
    };
  }

  static _sanitizeRequestBody(body) {
    if (!body) return undefined;

    const sanitized = { ...body };
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'apiKey',
      'creditCard',
    ];

    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  static _getDeviceType(userAgent) {
    if (!userAgent) return 'unknown';

    const ua = userAgent.toLowerCase();
    if (ua.includes('mobile')) return 'mobile';
    if (ua.includes('tablet')) return 'tablet';
    if (ua.includes('api') || ua.includes('postman')) return 'api';
    return 'desktop';
  }

  static _determineRetentionCategory(action) {
    // Security-related actions
    if (action.includes('auth.') || action.includes('permission.')) {
      return 'security';
    }

    // Compliance-related actions
    if (
      action.includes('.delete') ||
      action.includes('.role') ||
      action.includes('hierarchy.')
    ) {
      return 'compliance';
    }

    // Debug actions
    if (action.includes('debug.') || action.includes('test.')) {
      return 'debug';
    }

    // Default to operational
    return 'operational';
  }

  static _getActionFromMethod(method, entityType) {
    const methodMap = {
      POST: 'create',
      PUT: 'update',
      PATCH: 'update',
      DELETE: 'delete',
    };

    return `${entityType}.${methodMap[method] || 'unknown'}`;
  }

  static _extractChanges(body) {
    // Extract only the fields that were actually changed
    // This would need to compare with original values in a real implementation
    const changes = {};

    const trackedFields = [
      'name',
      'status',
      'hierarchyLevel',
      'parentOrganization',
      'churchId',
      'teamId',
    ];

    trackedFields.forEach((field) => {
      if (body[field] !== undefined) {
        changes[field] = { new: body[field] };
      }
    });

    return Object.keys(changes).length > 0 ? changes : undefined;
  }

  static _isPermissionEscalation(user, targetEntity) {
    if (!user || !targetEntity) return false;

    // Check if user is accessing entity outside their hierarchy
    if (targetEntity.hierarchyPath && user.hierarchyPath) {
      return !targetEntity.hierarchyPath.startsWith(user.hierarchyPath);
    }

    // Check if user is accessing higher level entity
    if (
      targetEntity.hierarchyLevel !== undefined &&
      user.hierarchyLevel !== undefined
    ) {
      return targetEntity.hierarchyLevel < user.hierarchyLevel;
    }

    return false;
  }

  /**
   * Express route for querying audit logs
   */
  static auditQueryRoutes() {
    const express = require('express');
    const router = express.Router();

    // Get audit logs (admin only)
    router.get('/api/audit/logs', async (req, res, next) => {
      try {
        if (!req.user || req.user.hierarchyLevel > 1) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const {
          action,
          actor,
          target,
          startDate,
          endDate,
          limit = 100,
          offset = 0,
        } = req.query;

        const query = {};

        if (action) query.action = new RegExp(action, 'i');
        if (actor) query['actor.userId'] = actor;
        if (target) query['target.id'] = target;
        if (startDate || endDate) {
          query.timestamp = {};
          if (startDate) query.timestamp.$gte = new Date(startDate);
          if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const logs = await AuditLog.find(query)
          .sort({ timestamp: -1 })
          .limit(parseInt(limit))
          .skip(parseInt(offset))
          .populate('actor.userId', 'name email')
          .lean();

        const total = await AuditLog.countDocuments(query);

        res.json({
          success: true,
          data: logs,
          pagination: {
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
          },
        });
      } catch (error) {
        next(error);
      }
    });

    // Get security events
    router.get('/api/audit/security-events', async (req, res, next) => {
      try {
        if (!req.user || req.user.hierarchyLevel > 2) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const events = await AuditLog.getSecurityEvents(req.query);

        res.json({
          success: true,
          data: events,
        });
      } catch (error) {
        next(error);
      }
    });

    // Get hierarchy violations
    router.get('/api/audit/hierarchy-violations', async (req, res, next) => {
      try {
        if (!req.user || req.user.hierarchyLevel > 1) {
          return res.status(403).json({ error: 'Access denied' });
        }

        const violations = await AuditLog.getHierarchyViolations(req.query);

        res.json({
          success: true,
          data: violations,
        });
      } catch (error) {
        next(error);
      }
    });

    return router;
  }
}

module.exports = AuditLogger;
