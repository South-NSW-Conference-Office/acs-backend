/* eslint-disable no-console */
const mongoose = require('mongoose');
require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

const logger = require('./services/loggerService');
const { applyRateLimiters } = require('./middleware/rateLimiter');
const app = require('./app');

const PORT = process.env.PORT || 5000;

// Apply rate limiters (requires Redis — skipped in test environment)
try {
  logger.info('[RATE-LIMITER] Applying rate limiters...');
  applyRateLimiters(app);
  logger.info('[RATE-LIMITER] ✓ Rate limiters applied successfully');
} catch (error) {
  logger.error('[RATE-LIMITER] ✗ Failed to apply rate limiters:', error);
  throw error;
}

// Function to start the server after database connection
const startServer = () => {
  const server = app.listen(PORT, () => {
    logger.info(`[SERVER] ✓ Server successfully started on port ${PORT}`);
    logger.info(
      `[SERVER] Environment: ${process.env.NODE_ENV || 'development'}`
    );
    logger.info(`[SERVER] Health check: http://localhost:${PORT}/health`);
    logger.info(`[SERVER] Process ID: ${process.pid}`);
    logger.info(`[SERVER] Node version: ${process.version}`);
    logger.info(`[SERVER] Platform: ${process.platform}`);
    logger.info(`[SERVER] Memory usage:`, process.memoryUsage());
  });

  // Server error handling
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(`[SERVER] ✗ Port ${PORT} is already in use`);
    } else if (error.code === 'EACCES') {
      logger.error(`[SERVER] ✗ Permission denied to bind to port ${PORT}`);
    } else {
      logger.error(`[SERVER] ✗ Server error:`, error);
    }
    process.exit(1);
  });

  server.on('clientError', (error, socket) => {
    logger.error('[SERVER] Client error:', error);
    if (!socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  return server;
};

// Database connection with enhanced logging
logger.info('[DATABASE] Starting database connection...');
logger.info(
  '[DATABASE] MongoDB URI:',
  process.env.MONGO_URI
    ? `Set (${process.env.MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')})`
    : 'Not set'
);

const connectionOptions = {
  serverSelectionTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  bufferCommands: false,
  maxPoolSize: 10,
  minPoolSize: 5,
  connectTimeoutMS: 10000,
};

logger.info('[DATABASE] Connection options:', connectionOptions);

// Add mongoose connection event listeners
mongoose.connection.on('connecting', () => {
  logger.info('[DATABASE] Connecting to MongoDB...');
});

mongoose.connection.on('connected', () => {
  logger.info('[DATABASE] ✓ Connected to MongoDB');
});

mongoose.connection.on('open', () => {
  logger.info('[DATABASE] ✓ MongoDB connection opened');
});

mongoose.connection.on('disconnecting', () => {
  logger.warn('[DATABASE] ⚠ Disconnecting from MongoDB...');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('[DATABASE] ⚠ Disconnected from MongoDB');
});

mongoose.connection.on('close', () => {
  logger.warn('[DATABASE] ⚠ MongoDB connection closed');
});

mongoose.connection.on('error', (error) => {
  logger.error('[DATABASE] ✗ MongoDB connection error:', error);
});

mongoose.connection.on('reconnected', () => {
  logger.info('[DATABASE] ✓ Reconnected to MongoDB');
});

mongoose
  .connect(process.env.MONGO_URI, connectionOptions)
  .then(async () => {
    logger.info('[DATABASE] ✓ Database connected successfully');

    try {
      // Initialize database with system roles and permissions
      logger.info('[DATABASE] Starting database initialization...');
      const initializeDatabase = require('./utils/initializeDatabase');
      await initializeDatabase();
      logger.info('[DATABASE] ✓ Database initialization completed');

      // Start the server only after database is fully ready
      logger.info('[DATABASE] Database is ready, starting server...');
      startServer();
    } catch (initError) {
      logger.error('[DATABASE] ✗ Database initialization failed:', initError);
      process.exit(1);
    }
  })
  .catch((error) => {
    logger.error('[DATABASE] ✗ Database connection failed:', {
      message: error.message,
      code: error.code,
      codeName: error.codeName,
      stack: error.stack,
    });

    // Provide helpful error messages
    if (error.message.includes('ENOTFOUND')) {
      logger.error(
        '[DATABASE] ✗ DNS resolution failed - check your MongoDB URI hostname'
      );
    } else if (error.message.includes('ECONNREFUSED')) {
      logger.error(
        '[DATABASE] ✗ Connection refused - MongoDB server may not be running'
      );
    } else if (error.message.includes('Authentication failed')) {
      logger.error(
        '[DATABASE] ✗ Authentication failed - check your username/password'
      );
    } else if (error.message.includes('bad auth')) {
      logger.error(
        '[DATABASE] ✗ Authentication error - check your credentials'
      );
    }

    process.exit(1);
  });

// Handle uncaught exceptions with detailed logging
process.on('uncaughtException', (error) => {
  logger.error('[PROCESS] ✗ Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  });

  // Give logging a chance to finish before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('[PROCESS] ✗ Unhandled Promise Rejection:', {
    reason: reason,
    promise: promise,
    stack: reason?.stack,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  });

  // Give logging a chance to finish before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle process signals
process.on('SIGTERM', () => {
  logger.info('[PROCESS] ⚠ Received SIGTERM, shutting down gracefully...');
  mongoose.connection.close(false, () => {
    logger.info('[PROCESS] ✓ MongoDB connection closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('[PROCESS] ⚠ Received SIGINT, shutting down gracefully...');
  mongoose.connection.close(false, () => {
    logger.info('[PROCESS] ✓ MongoDB connection closed');
    process.exit(0);
  });
});

// Log process start
logger.info('[PROCESS] ✓ Process started', {
  pid: process.pid,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  cwd: process.cwd(),
  environment: process.env.NODE_ENV || 'development',
  timestamp: new Date().toISOString(),
});

module.exports = app;
