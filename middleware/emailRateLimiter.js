const { RateLimiterFactory } = require('./rateLimiter');

/**
 * Middleware to apply rate limiting to email operations
 * This wraps around email sending functions to prevent email bombing
 */
const emailRateLimitMiddleware = () => {
  return async (req, res, next) => {
    // Create a mock request object for the rate limiter
    const rateLimitReq = {
      ...req,
      body: {
        email: req.body?.email || req.user?.email || 'unknown',
      },
    };

    // Apply the email limiter
    RateLimiterFactory.emailLimiter(rateLimitReq, res, (err) => {
      if (err) {
        return next(err);
      }
      next();
    });
  };
};

/**
 * Wrapper for email service methods to apply rate limiting
 * @param {Function} emailFunction - The email sending function
 * @param {string} email - The recipient email
 * @returns {Promise} - The result of the email function
 */
const rateLimitedEmailSend = async (emailFunction, email, ...args) => {
  // Create mock req/res objects for rate limiter
  const req = {
    body: { email },
    ip: '127.0.0.1', // Internal call
    get: () => null, // Mock for ipKeyGenerator
    headers: {},
    connection: { remoteAddress: '127.0.0.1' },
  };

  const res = {
    status: () => res,
    json: () => {},
    getHeader: () => null,
  };

  return new Promise((resolve, reject) => {
    RateLimiterFactory.emailLimiter(req, res, async (err) => {
      if (err) {
        reject(new Error('Email rate limit exceeded. Please try again later.'));
      } else {
        try {
          const result = await emailFunction(email, ...args);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }
    });
  });
};

module.exports = {
  emailRateLimitMiddleware,
  rateLimitedEmailSend,
};
