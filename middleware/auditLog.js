const mongoose = require('mongoose');

/**
 * Audit Log Schema
 * Tracks all security-sensitive operations
 */
const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    method: {
      type: String,
      enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      required: true,
    },
    path: {
      type: String,
      required: true,
      index: true,
    },
    organizationContext: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
    },
    targetResource: {
      type: String, // Resource type (user, organization, service, etc.)
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    statusCode: {
      type: Number,
      required: true,
    },
    ipAddress: String,
    userAgent: String,
    requestBody: {
      type: mongoose.Schema.Types.Mixed, // Sanitized request body
    },
    responseTime: Number, // in milliseconds
    error: String,
    metadata: mongoose.Schema.Types.Mixed,
  },
  {
    timestamps: true,
  }
);

// Create compound indexes for efficient querying
auditLogSchema.index({ createdAt: -1, userId: 1 });
auditLogSchema.index({ createdAt: -1, action: 1 });
auditLogSchema.index({ targetResource: 1, targetId: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

/**
 * Audit Log Middleware
 * Logs security-sensitive operations
 */
const auditLogMiddleware = (options = {}) => {
  const {
    // Actions to log (default: all write operations and sensitive reads)
    actionsToLog = [
      'POST /api/auth/signin',
      'POST /api/auth/logout',
      'GET /api/users',
      'GET /api/users/:userId',
      'POST /api/users',
      'PUT /api/users/:userId',
      'DELETE /api/users/:userId',
      'POST /api/users/:userId/roles',
      'DELETE /api/users/:userId/roles',
      'GET /api/users/:userId/permissions',
      'GET /api/organizations',
      'POST /api/organizations',
      'PUT /api/organizations/:id',
      'DELETE /api/organizations/:id',
    ],
    // Paths to exclude from logging
    excludePaths = ['/api/health', '/api/status'],
    // Sensitive fields to redact from request body
    sensitiveFields = ['password', 'token', 'secret', 'creditCard', 'ssn'],
  } = options;

  return async (req, res, next) => {
    // Skip if path is excluded
    if (excludePaths.some((path) => req.path.startsWith(path))) {
      return next();
    }

    const startTime = Date.now();
    const originalSend = res.send;
    const originalJson = res.json;

    // Capture response and log
    const captureResponse = async function (body) {
      res.send = originalSend;
      res.json = originalJson;

      const responseTime = Date.now() - startTime;
      const shouldLog = shouldLogRequest(req, actionsToLog);

      if (shouldLog) {
        try {
          await logAuditEntry({
            req,
            res,
            responseTime,
            sensitiveFields,
            body,
          });
        } catch (error) {
          // Silently handle audit log errors to avoid disrupting the request flow
        }
      }

      // Call original method
      return originalSend.call(this, body);
    };

    res.send = captureResponse;
    res.json = function (body) {
      return captureResponse.call(this, JSON.stringify(body));
    };

    next();
  };
};

/**
 * Determine if request should be logged
 */
function shouldLogRequest(req, actionsToLog) {
  const action = `${req.method} ${req.route?.path || req.path}`;

  // Always log write operations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return true;
  }

  // Check if specific action is in the log list
  return actionsToLog.some((pattern) => {
    const regex = new RegExp(
      pattern.replace(/:[^/]+/g, '[^/]+'), // Convert :param to regex
      'i'
    );
    return regex.test(action);
  });
}

/**
 * Create audit log entry
 */
async function logAuditEntry({
  req,
  res,
  responseTime,
  sensitiveFields,
  body,
}) {
  try {
    // Extract target resource info from path
    const { targetResource, targetId } = extractTargetInfo(req);

    // Sanitize request body
    const sanitizedBody = sanitizeObject(req.body, sensitiveFields);

    // Parse response body for errors
    let error;
    if (res.statusCode >= 400 && body) {
      try {
        const responseBody = JSON.parse(body);
        error = responseBody.message || responseBody.error;
      } catch (e) {
        error = 'Request failed';
      }
    }

    const auditEntry = new AuditLog({
      userId: req.user?._id,
      action: `${req.method} ${req.route?.path || req.path}`,
      method: req.method,
      path: req.originalUrl,
      organizationContext:
        req.organizationId || req.headers['x-organization-id'],
      targetResource,
      targetId,
      statusCode: res.statusCode,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
      requestBody:
        Object.keys(sanitizedBody).length > 0 ? sanitizedBody : undefined,
      responseTime,
      error,
      metadata: {
        query: req.query,
        params: req.params,
      },
    });

    await auditEntry.save();
  } catch (error) {
    // Silently handle audit log creation errors
  }
}

/**
 * Extract target resource and ID from request
 */
function extractTargetInfo(req) {
  const path = req.route?.path || req.path;
  const params = req.params;

  // Map common patterns
  if (path.includes('/users/')) {
    return { targetResource: 'user', targetId: params.userId || params.id };
  }
  if (path.includes('/organizations/')) {
    return {
      targetResource: 'organization',
      targetId: params.organizationId || params.id,
    };
  }
  if (path.includes('/services/')) {
    return {
      targetResource: 'service',
      targetId: params.serviceId || params.id,
    };
  }
  if (path.includes('/roles/')) {
    return { targetResource: 'role', targetId: params.roleId || params.id };
  }

  return { targetResource: null, targetId: null };
}

/**
 * Sanitize object by removing sensitive fields
 */
function sanitizeObject(obj, sensitiveFields) {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = {};

  for (const [key, value] of Object.entries(obj)) {
    if (
      sensitiveFields.some((field) =>
        key.toLowerCase().includes(field.toLowerCase())
      )
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value, sensitiveFields);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Get client IP address
 */
function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip
  );
}

/**
 * Query audit logs with filters
 */
async function queryAuditLogs(filters = {}) {
  const {
    userId,
    action,
    targetResource,
    targetId,
    startDate,
    endDate,
    limit = 100,
    skip = 0,
  } = filters;

  const query = {};

  if (userId) query.userId = userId;
  if (action) query.action = new RegExp(action, 'i');
  if (targetResource) query.targetResource = targetResource;
  if (targetId) query.targetId = targetId;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = startDate;
    if (endDate) query.createdAt.$lte = endDate;
  }

  return AuditLog.find(query)
    .populate('userId', 'name email')
    .populate('organizationContext', 'name type')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .lean();
}

module.exports = {
  auditLogMiddleware,
  AuditLog,
  queryAuditLogs,
};
