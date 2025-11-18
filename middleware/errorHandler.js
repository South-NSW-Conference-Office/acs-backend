const mongoose = require('mongoose');

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode, errorCode = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.errorCode = errorCode;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND_ERROR');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT_ERROR');
  }
}

// MongoDB error handlers
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400, 'INVALID_ID');
};

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  const message = `${field} '${value}' already exists. Please use a different value.`;
  return new ConflictError(message);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => ({
    field: el.path,
    message: el.message,
    value: el.value,
  }));

  const message = 'Invalid input data';
  const validationError = new ValidationError(message, errors);
  return validationError;
};

const handleJWTError = () =>
  new AuthenticationError('Invalid token. Please log in again!');

const handleJWTExpiredError = () =>
  new AuthenticationError('Your token has expired! Please log in again.');

// Send error response for development
const sendErrorDev = (err, req, res) => {
  return res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    errorCode: err.errorCode,
    stack: err.stack,
    errors: err.errors || undefined,
  });
};

// Send error response for production
const sendErrorProd = (err, req, res) => {
  // Log error for monitoring
  // Log error for monitoring

  // Operational, trusted error: send message to client
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errorCode: err.errorCode,
      errors: err.errors || undefined,
    });
  }

  // Programming or other unknown error: don't leak error details
  return res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    errorCode: 'INTERNAL_SERVER_ERROR',
  });
};

// Main error handling middleware
const globalErrorHandler = (err, req, res) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    // Handle specific MongoDB errors
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError')
      error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();

    sendErrorProd(error, req, res);
  }
};

// Async error wrapper
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

// 404 handler for undefined routes
const notFoundHandler = (req, res, next) => {
  const err = new NotFoundError(`Route ${req.originalUrl} not found`);
  next(err);
};

// Graceful shutdown handler
const gracefulShutdown = (server) => {
  return () => {
    // Starting graceful shutdown

    server.close(() => {
      // HTTP server closed

      // Close database connections
      mongoose.connection.close(false, () => {
        // MongoDB connection closed
        process.exit(0);
      });
    });

    // Force close after 30 seconds
    setTimeout(() => {
      // Could not close connections in time, forcefully shutting down
      process.exit(1);
    }, 30000);
  };
};

// Unhandled promise rejection handler
process.on('unhandledRejection', () => {
  // Unhandled Promise Rejection

  // Close server & exit process
  process.exit(1);
});

// Uncaught exception handler
process.on('uncaughtException', () => {
  // Uncaught Exception

  process.exit(1);
});

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  globalErrorHandler,
  catchAsync,
  notFoundHandler,
  gracefulShutdown,
};
