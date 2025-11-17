const { validationResult } = require('express-validator');

// Enhanced validation middleware with detailed error responses
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorDetails = errors.array().map((error) => ({
      field: error.param,
      message: error.msg,
      value: error.value,
      location: error.location,
    }));

    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errorDetails,
      count: errorDetails.length,
    });
  }

  next();
};

// Sanitize request data
const sanitizeRequest = (req, res, next) => {
  // Remove any potentially dangerous characters from strings
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .trim()
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  };

  const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        sanitized[key] = sanitizeString(value);
      } else if (typeof value === 'object') {
        sanitized[key] = sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  };

  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  next();
};

// Validate MongoDB ObjectId
const validateObjectId = (paramName) => {
  return (req, res, next) => {
    const id = req.params[paramName];
    const objectIdRegex = /^[0-9a-fA-F]{24}$/;

    if (!objectIdRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName} format`,
        error: 'Must be a valid MongoDB ObjectId',
      });
    }

    next();
  };
};

// Request size limiter
const requestSizeLimiter = (maxSizeBytes = 10 * 1024 * 1024) => {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');

    if (contentLength > maxSizeBytes) {
      return res.status(413).json({
        success: false,
        message: 'Request too large',
        maxSize: `${Math.round(maxSizeBytes / 1024 / 1024)}MB`,
        received: `${Math.round(contentLength / 1024 / 1024)}MB`,
      });
    }

    next();
  };
};

// Input type validation
const validateRequestTypes = (schema) => {
  return (req, res, next) => {
    const validateType = (value, expectedType, path = '') => {
      switch (expectedType) {
        case 'string':
          return typeof value === 'string';
        case 'number':
          return typeof value === 'number' && !isNaN(value);
        case 'boolean':
          return typeof value === 'boolean';
        case 'array':
          return Array.isArray(value);
        case 'object':
          return (
            typeof value === 'object' && value !== null && !Array.isArray(value)
          );
        case 'email':
          return (
            typeof value === 'string' &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
          );
        case 'phone':
          return typeof value === 'string' && /^\+?[\d\s\-\(\)]+$/.test(value);
        case 'url':
          try {
            new URL(value);
            return true;
          } catch {
            return false;
          }
        default:
          return true;
      }
    };

    const errors = [];

    for (const [field, expectedType] of Object.entries(schema)) {
      const value = req.body[field];

      if (value !== undefined && !validateType(value, expectedType)) {
        errors.push({
          field,
          message: `Expected ${expectedType} but received ${typeof value}`,
          value,
          expectedType,
        });
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Type validation failed',
        errors,
      });
    }

    next();
  };
};

module.exports = {
  handleValidationErrors,
  sanitizeRequest,
  validateObjectId,
  requestSizeLimiter,
  validateRequestTypes,
};
