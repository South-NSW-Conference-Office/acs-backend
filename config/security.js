const {
  authenticateToken,
  authorize,
  validateOrganizationContext,
} = require('../middleware/auth');
const { auditLogMiddleware } = require('../middleware/auditLog');
const { applyRateLimiters } = require('../middleware/rateLimiter');

/**
 * Security Configuration
 * Central configuration for all security features
 */
const securityConfig = {
  // JWT Configuration
  jwt: {
    accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
    algorithm: 'HS256',
  },

  // Session Configuration
  session: {
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 5,
    sessionTimeout: parseInt(process.env.SESSION_TIMEOUT) || 30 * 60 * 1000, // 30 minutes
    extendOnActivity: process.env.EXTEND_SESSION_ON_ACTIVITY !== 'false',
  },

  // Password Policy
  password: {
    minLength: parseInt(process.env.PASSWORD_MIN_LENGTH) || 8,
    requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE !== 'false',
    requireLowercase: process.env.PASSWORD_REQUIRE_LOWERCASE !== 'false',
    requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS !== 'false',
    requireSpecialChars: process.env.PASSWORD_REQUIRE_SPECIAL !== 'false',
    maxAge: parseInt(process.env.PASSWORD_MAX_AGE_DAYS) || 90,
    preventReuse: parseInt(process.env.PASSWORD_PREVENT_REUSE) || 5,
  },

  // Rate Limiting
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    redisUrl: process.env.REDIS_URL,
  },

  // Audit Logging
  audit: {
    enabled: process.env.AUDIT_LOG_ENABLED !== 'false',
    retentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS) || 90,
  },

  // CORS Configuration
  cors: {
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : ['http://localhost:3000'],
    credentials: true,
    maxAge: 86400, // 24 hours
  },

  // Security Headers
  headers: {
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: false, // Configure based on your needs
    frameguard: { action: 'deny' },
  },
};

/**
 * Apply security middleware to Express app
 * @param {Express.Application} app - Express application
 */
function applySecurityMiddleware(app) {
  const express = require('express');
  const helmet = require('helmet');
  const cors = require('cors');

  // Apply Helmet security headers
  app.use(helmet(securityConfig.headers));

  // Apply CORS
  app.use(cors(securityConfig.cors));

  // Apply rate limiting
  if (securityConfig.rateLimit.enabled) {
    applyRateLimiters(app);
  }

  // Apply audit logging
  if (securityConfig.audit.enabled) {
    app.use(
      auditLogMiddleware({
        excludePaths: ['/health', '/metrics', '/api/health'],
      })
    );
  }

  // Request sanitization
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Security monitoring
  app.use((req, res, next) => {
    // Add security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Remove sensitive headers
    res.removeHeader('X-Powered-By');

    next();
  });
}

/**
 * Secure route wrapper
 * Combines authentication, authorization, and organization validation
 * @param {String} permission - Required permission
 * @returns {Array} - Array of middleware functions
 */
function secureRoute(permission) {
  const middlewares = [authenticateToken, validateOrganizationContext];

  if (permission) {
    middlewares.push(authorize(permission));
  }

  return middlewares;
}

/**
 * Password validation helper
 * @param {String} password - Password to validate
 * @returns {Object} - Validation result
 */
function validatePassword(password) {
  const { password: config } = securityConfig;
  const errors = [];

  if (password.length < config.minLength) {
    errors.push(
      `Password must be at least ${config.minLength} characters long`
    );
  }

  if (config.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (config.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (config.requireNumbers && !/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (config.requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Security health check
 * @returns {Object} - Security status
 */
function getSecurityStatus() {
  return {
    rateLimiting: {
      enabled: securityConfig.rateLimit.enabled,
      backend: securityConfig.rateLimit.redisUrl ? 'redis' : 'memory',
    },
    auditLogging: {
      enabled: securityConfig.audit.enabled,
      retentionDays: securityConfig.audit.retentionDays,
    },
    authentication: {
      method: 'JWT',
      accessTokenExpiry: securityConfig.jwt.accessTokenExpiry,
      refreshTokenEnabled: true,
    },
    sessionManagement: {
      maxConcurrentSessions: securityConfig.session.maxConcurrentSessions,
      sessionTimeout: securityConfig.session.sessionTimeout,
    },
    passwordPolicy: {
      enforced: true,
      minLength: securityConfig.password.minLength,
      complexity: {
        uppercase: securityConfig.password.requireUppercase,
        lowercase: securityConfig.password.requireLowercase,
        numbers: securityConfig.password.requireNumbers,
        special: securityConfig.password.requireSpecialChars,
      },
    },
  };
}

module.exports = {
  securityConfig,
  applySecurityMiddleware,
  secureRoute,
  validatePassword,
  getSecurityStatus,
};
