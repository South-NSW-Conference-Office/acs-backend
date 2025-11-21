const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

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
  // Pre-created limiters for role-based access
  static userEnumerationLimiters = new Map();
  static searchLimiters = new Map();
  static dynamicLimiters = new Map();

  /**
   * Initialize all role-based limiters
   */
  static initializeRoleBasedLimiters() {
    // Define role configurations
    const roles = [
      {
        name: 'super_admin',
        userEnum: { max: 1000, windowMs: 15 * 60 * 1000 },
        search: { max: 300, windowMs: 60 * 1000 },
      },
      {
        name: 'union_admin',
        userEnum: { max: 100, windowMs: 15 * 60 * 1000 },
        search: { max: 150, windowMs: 60 * 1000 },
      },
      {
        name: 'conference_admin',
        userEnum: { max: 100, windowMs: 15 * 60 * 1000 },
        search: { max: 150, windowMs: 60 * 1000 },
      },
      {
        name: 'church_pastor',
        userEnum: { max: 50, windowMs: 15 * 60 * 1000 },
        search: { max: 60, windowMs: 60 * 1000 },
      },
      {
        name: 'default',
        userEnum: { max: 100, windowMs: 15 * 60 * 1000 },
        search: { max: 60, windowMs: 60 * 1000 },
      },
    ];

    // Pre-create user enumeration limiters
    roles.forEach((role) => {
      this.userEnumerationLimiters.set(
        role.name,
        this.createLimiter({
          windowMs: role.userEnum.windowMs,
          max: role.userEnum.max,
          message: 'Too many user queries, please try again later.',
          keyGenerator: (req) => {
            const ip = ipKeyGenerator(req);
            return `users:${req.user?._id?.toString() || ip}`;
          },
        })
      );

      this.searchLimiters.set(
        role.name,
        this.createLimiter({
          windowMs: role.search.windowMs,
          max: role.search.max,
          message: 'Too many search requests, please slow down.',
          keyGenerator: (req) => {
            const ip = ipKeyGenerator(req);
            return `search:${req.user?._id?.toString() || ip}`;
          },
        })
      );
    });
  }

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
      const ip = ipKeyGenerator(req);
      return `auth:${ip}:${email}`;
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
   * User enumeration limiter - prevent data scraping (role-aware)
   */
  static userEnumerationLimiter = (req, res, next) => {
    // Initialize limiters if not already done
    if (this.userEnumerationLimiters.size === 0) {
      this.initializeRoleBasedLimiters();
    }

    // Determine rate limiter based on user role
    let limiterKey = 'default';

    if (req.user) {
      const userRole = req.user.organizations?.[0]?.role?.name;
      if (this.userEnumerationLimiters.has(userRole)) {
        limiterKey = userRole;
      }
    }

    const limiter = this.userEnumerationLimiters.get(limiterKey);
    return limiter(req, res, next);
  };

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
   * File upload limiter - prevent storage exhaustion
   */
  static fileUploadLimiter = this.createLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 uploads per hour
    message: 'Too many file uploads, please try again later.',
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req);
      return `upload:${req.user?._id?.toString() || ip}`;
    },
  });

  /**
   * Search/query limiter - for data-intensive operations (role-aware)
   */
  static searchLimiter = (req, res, next) => {
    // Initialize limiters if not already done
    if (this.searchLimiters.size === 0) {
      this.initializeRoleBasedLimiters();
    }

    // Determine rate limiter based on user role
    let limiterKey = 'default';

    if (req.user) {
      const userRole = req.user.organizations?.[0]?.role?.name;
      if (this.searchLimiters.has(userRole)) {
        limiterKey = userRole;
      }
    }

    const limiter = this.searchLimiters.get(limiterKey);
    return limiter(req, res, next);
  };

  /**
   * Admin operation limiter - for sensitive admin actions
   */
  static adminOperationLimiter = this.createLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 admin operations per hour
    message: 'Admin operation limit exceeded.',
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req);
      return `admin:${req.user?._id?.toString() || ip}:${req.method}`;
    },
  });

  /**
   * Public endpoint limiter - for unauthenticated access
   */
  static publicLimiter = this.createLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: 'Too many requests from this IP, please try again later.',
    skipSuccessfulRequests: true,
  });

  /**
   * Email operation limiter - prevent email bombing
   */
  static emailLimiter = this.createLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 emails per hour per recipient
    message: 'Too many email requests, please try again later.',
    keyGenerator: (req) => {
      const email = req.body?.email || req.params?.email || 'unknown';
      return `email:${email}`;
    },
  });

  /**
   * Dynamic rate limiter based on user role
   */
  static createDynamicLimiter(baseOptions = {}) {
    // Pre-create limiters for each role if not already done
    const optionsKey = JSON.stringify(baseOptions);
    if (!this.dynamicLimiters.has(optionsKey)) {
      const roleLimiters = new Map();

      const roles = [
        { name: 'super_admin', max: 1000 },
        { name: 'union_admin', max: 500 },
        { name: 'conference_admin', max: 500 },
        { name: 'church_admin', max: 200 },
        { name: 'default', max: 50 },
      ];

      roles.forEach((role) => {
        roleLimiters.set(
          role.name,
          this.createLimiter({
            ...baseOptions,
            max: role.max,
            keyGenerator: (req) =>
              req.user?._id?.toString() || ipKeyGenerator(req),
          })
        );
      });

      this.dynamicLimiters.set(optionsKey, roleLimiters);
    }

    return (req, res, next) => {
      const roleLimiters = this.dynamicLimiters.get(optionsKey);
      let limiterKey = 'default';

      if (req.user) {
        const userRole = req.user.organizations?.[0]?.role?.name;
        if (roleLimiters.has(userRole)) {
          limiterKey = userRole;
        }
      }

      const limiter = roleLimiters.get(limiterKey);
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
  // Initialize role-based limiters at app startup
  RateLimiterFactory.initializeRoleBasedLimiters();
  // Health check endpoint can have basic rate limiting to prevent abuse
  app.use('/health', RateLimiterFactory.publicLimiter);

  // Auth routes - most restrictive limits
  app.use('/api/auth/signin', RateLimiterFactory.authLimiter);
  app.use('/api/auth/register', RateLimiterFactory.authLimiter);
  app.use('/api/auth/forgot-password', RateLimiterFactory.passwordResetLimiter);
  app.use('/api/auth/reset-password', RateLimiterFactory.passwordResetLimiter);
  app.use('/api/auth/verify-email', RateLimiterFactory.emailLimiter);
  app.use(
    '/api/auth/verify-email-and-set-password',
    RateLimiterFactory.emailLimiter
  );

  // File upload endpoints
  app.use('/api/profile/avatar', RateLimiterFactory.fileUploadLimiter);
  app.use('/api/services/:id/images', RateLimiterFactory.fileUploadLimiter);

  // Admin routes
  app.use('/api/admin/*', RateLimiterFactory.adminOperationLimiter);
  app.use('/api/users/:userId/roles', RateLimiterFactory.adminOperationLimiter);
  app.delete(
    '/api/organizations/:id',
    RateLimiterFactory.adminOperationLimiter
  );
  app.delete('/api/users/:userId', RateLimiterFactory.adminOperationLimiter);

  // No rate limiting for GET/read operations - users should be able to browse data freely

  // Organization context switching
  app.use('/api/auth/validate-org-access', RateLimiterFactory.orgSwitchLimiter);

  // Write operations (POST, PUT, PATCH requests) - protect against abuse
  app.post('/api/*', RateLimiterFactory.createOperationLimiter);
  app.put('/api/*', RateLimiterFactory.createOperationLimiter);
  app.patch('/api/*', RateLimiterFactory.createOperationLimiter);
}

module.exports = {
  RateLimiterFactory,
  applyRateLimiters,
};
