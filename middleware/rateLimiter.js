const rateLimit = require('express-rate-limit');

// Note: Redis store setup commented out to avoid dependency issues
// Uncomment when Redis is available in production
// const RedisStore = require('rate-limit-redis');
// const Redis = require('ioredis');
// const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

/**
 * Rate Limiter Factory
 * Creates rate limiters for different endpoints
 */
class RateLimiterFactory {
  /**
   * Create a basic rate limiter
   * @param {Object} options - Rate limiter options
   * @returns {Function} - Express middleware
   */
  static createLimiter(options = {}) {
    const baseConfig = {
      windowMs: 15 * 60 * 1000, // 15 minutes default
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        res.status(429).json({
          success: false,
          message: 'Too many requests, please try again later.',
          retryAfter: res.getHeader('Retry-After'),
        });
      },
    };

    // Note: Redis store commented out - using memory store
    // Uncomment when Redis is available
    // if (redisClient && options.useRedis !== false) {
    //   baseConfig.store = new RedisStore({
    //     client: redisClient,
    //     prefix: options.keyPrefix || 'rl:',
    //   });
    // }

    return rateLimit({ ...baseConfig, ...options });
  }

  /**
   * Auth endpoint limiter - strict limits for authentication
   */
  static authLimiter = this.createLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    message: 'Too many authentication attempts, please try again later.',
    skipSuccessfulRequests: false,
    keyGenerator: (req) => {
      // Rate limit by IP + email combo for auth endpoints
      const email = req.body?.email || 'unknown';
      return `auth:${req.ip}:${email}`;
    },
  });

  /**
   * Password reset limiter - prevent abuse
   */
  static passwordResetLimiter = this.createLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 requests per hour
    message: 'Too many password reset attempts, please try again later.',
  });

  /**
   * User enumeration limiter - prevent data scraping
   */
  static userEnumerationLimiter = this.createLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    message: 'Too many user queries, please try again later.',
    keyGenerator: (req) => {
      // Rate limit by authenticated user ID
      return `users:${req.user?._id?.toString() || req.ip}`;
    },
  });

  /**
   * API general limiter - standard rate limiting
   */
  static apiLimiter = this.createLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: 'Too many API requests, please try again later.',
    skip: (req) => {
      // Skip rate limiting for certain paths
      const skipPaths = ['/api/health', '/api/status'];
      return skipPaths.some((path) => req.path.startsWith(path));
    },
  });

  /**
   * Create operation limiter - for resource creation
   */
  static createOperationLimiter = this.createLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 create operations per hour
    message: 'Too many create operations, please try again later.',
    keyGenerator: (req) => {
      // Rate limit by user and resource type
      const resource = req.path.split('/')[2] || 'unknown';
      return `create:${req.user?._id}:${resource}`;
    },
  });

  /**
   * Organization context switching limiter
   */
  static orgSwitchLimiter = this.createLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 switches per 5 minutes
    message: 'Too many organization switches, please slow down.',
  });

  /**
   * Dynamic rate limiter based on user role
   */
  static createDynamicLimiter(baseOptions = {}) {
    return (req, res, next) => {
      // Determine rate limit based on user role
      let maxRequests = 50; // Default for regular users

      if (req.user) {
        const userRole = req.user.organizations?.[0]?.role?.name;

        if (userRole === 'super_admin') {
          maxRequests = 1000; // Higher limit for super admins
        } else if (
          userRole === 'union_admin' ||
          userRole === 'conference_admin'
        ) {
          maxRequests = 500; // Medium limit for admins
        } else if (userRole === 'church_admin') {
          maxRequests = 200; // Lower limit for church admins
        }
      }

      const limiter = this.createLimiter({
        ...baseOptions,
        max: maxRequests,
        keyGenerator: (req) => req.user?._id?.toString() || req.ip,
      });

      return limiter(req, res, next);
    };
  }

  /**
   * Sliding window rate limiter for more accurate limiting
   */
  static createSlidingWindowLimiter(options = {}) {
    // Note: Sliding window requires Redis - fallback to standard limiter
    return this.createLimiter(options);

    // Redis-based implementation (currently disabled)
    /*
    return async (req, res, next) => {
      const {
        windowMs = 60 * 1000, // 1 minute
        max = 10,
        keyGenerator = (req) => req.ip,
      } = options;

      const key = `sw:${keyGenerator(req)}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      try {
        // Remove old entries and count requests in window
        await redisClient.zremrangebyscore(key, '-inf', windowStart);
        const count = await redisClient.zcard(key);

        if (count >= max) {
          res.status(429).json({
            success: false,
            message: 'Rate limit exceeded',
            retryAfter: Math.ceil(windowMs / 1000),
          });
          return;
        }

        // Add current request
        await redisClient.zadd(key, now, `${now}:${Math.random()}`);
        await redisClient.expire(key, Math.ceil(windowMs / 1000));

        next();
      } catch (error) {
        // Silently handle rate limit error and continue
        next();
      }
    };
    */
  }
}

/**
 * Apply rate limiters to routes
 * @param {Express.Application} app - Express app
 */
function applyRateLimiters(app) {
  // Auth routes
  app.use('/api/auth/signin', RateLimiterFactory.authLimiter);
  app.use('/api/auth/register', RateLimiterFactory.authLimiter);
  app.use('/api/auth/forgot-password', RateLimiterFactory.passwordResetLimiter);
  app.use('/api/auth/reset-password', RateLimiterFactory.passwordResetLimiter);

  // User enumeration protection
  app.use('/api/users', RateLimiterFactory.userEnumerationLimiter);
  app.use('/api/organizations', RateLimiterFactory.userEnumerationLimiter);

  // Organization context switching
  app.use('/api/auth/validate-org-access', RateLimiterFactory.orgSwitchLimiter);

  // Create operations
  app.post('/api/*', RateLimiterFactory.createOperationLimiter);

  // General API rate limiting
  app.use('/api/', RateLimiterFactory.apiLimiter);
}

module.exports = {
  RateLimiterFactory,
  applyRateLimiters,
};
