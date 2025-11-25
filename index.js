const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const logger = require('./services/loggerService');
const { applyRateLimiters } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
// const organizationRoutes = require('./routes/organizations'); // REMOVED - Using hierarchical routes
const unionRoutes = require('./routes/unions');
const conferenceRoutes = require('./routes/conferences');
const churchRoutes = require('./routes/churches');
const roleRoutes = require('./routes/roles');
const serviceRoutes = require('./routes/servicesHierarchical');
const adminServiceRoutes = require('./routes/admin-services');
const adminEventRoutes = require('./routes/admin-events');
const adminVolunteerOpportunityRoutes = require('./routes/admin-volunteer-opportunities');
const serviceTypeRoutes = require('./routes/serviceTypes');
const permissionRoutes = require('./routes/permissions');
const teamRoutes = require('./routes/teams');
const teamTypeRoutes = require('./routes/teamTypes');
const assignmentRoutes = require('./routes/assignments');
const quotaRoutes = require('./routes/quota');
const profileRoutes = require('./routes/profile');
const roleLimitsRoutes = require('./routes/admin/role-limits');
const superAdminRoutes = require('./routes/superAdmin');
const mediaRoutes = require('./routes/media');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
// CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      logger.info(
        `[CORS] Processing request from origin: ${origin || 'no-origin'}`
      );

      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) {
        logger.info('[CORS] Allowing request with no origin');
        return callback(null, true);
      }

      const allowedOrigins = [
        process.env.FRONTEND_URL,
        process.env.ADMIN_URL,
        'https://acs-admin.adventhub.org',
        'https://admin.adventhub.org',
      ].filter(Boolean); // Remove undefined values

      logger.info(
        `[CORS] Configured allowed origins: ${JSON.stringify(allowedOrigins)}`
      );

      // Allow any localhost port for development
      const localhostRegex = /^http:\/\/localhost:\d+$/;
      const localhostIPRegex = /^http:\/\/127\.0\.0\.1:\d+$/;
      const localNetworkRegex = /^http:\/\/192\.168\.\d+\.\d+:\d+$/;

      const isAllowedOrigin = allowedOrigins.includes(origin);
      const isLocalhost = localhostRegex.test(origin);
      const isLocalhostIP = localhostIPRegex.test(origin);
      const isLocalNetwork = localNetworkRegex.test(origin);

      logger.info(`[CORS] Origin check results:`, {
        origin,
        isAllowedOrigin,
        isLocalhost,
        isLocalhostIP,
        isLocalNetwork,
      });

      if (isAllowedOrigin || isLocalhost || isLocalhostIP || isLocalNetwork) {
        logger.info(`[CORS] ✓ Origin allowed: ${origin}`);
        callback(null, true);
      } else {
        logger.error(`[CORS] ✗ Origin rejected: ${origin}`);
        callback(new Error(`CORS: Origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Union-Id',
      'X-Conference-Id',
      'X-Church-Id',
      'X-Team-Id',
      'X-Organization-Id',
    ],
  })
);

// Handle preflight OPTIONS requests with debugging
app.options('*', (req, res, next) => {
  logger.info(
    `[CORS] OPTIONS preflight request from ${req.get('Origin')} to ${req.path}`
  );
  logger.info(`[CORS] Request headers:`, req.headers);
  cors()(req, res, next);
});

// Body parsing middleware with error handling
app.use(
  express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
      logger.debug(
        `[JSON] Parsing body for ${req.method} ${req.path}, size: ${buf.length} bytes`
      );
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      logger.debug(
        `[URL-ENCODED] Parsing body for ${req.method} ${req.path}, size: ${buf.length} bytes`
      );
    },
  })
);

// Global error handling for body parsing
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    logger.error(
      `[BODY-PARSE] JSON syntax error in ${req.method} ${req.path}:`,
      error.message
    );
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON in request body',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
  next(error);
});

// Apply rate limiters with error handling
try {
  logger.info('[RATE-LIMITER] Applying rate limiters...');
  applyRateLimiters(app);
  logger.info('[RATE-LIMITER] ✓ Rate limiters applied successfully');
} catch (error) {
  logger.error('[RATE-LIMITER] ✗ Failed to apply rate limiters:', error);
  throw error;
}

// Logging middleware (disabled for cleaner terminal output)
// app.use(morgan('combined'));

// Function to start the server after database connection
const startServer = () => {
  logger.info('[SERVER] Starting route registration...');

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
      logger[logLevel](
        `[REQUEST] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`,
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
          origin: req.get('Origin'),
          ip: req.ip,
        }
      );
    });

    next();
  });

  // Routes with error handling
  const routes = [
    { path: '/api/auth', handler: authRoutes, name: 'auth' },
    { path: '/api/users', handler: userRoutes, name: 'users' },
    // { path: '/api/organizations', handler: organizationRoutes, name: 'organizations' }, // REMOVED - Using hierarchical routes
    { path: '/api/unions', handler: unionRoutes, name: 'unions' },
    {
      path: '/api/conferences',
      handler: conferenceRoutes,
      name: 'conferences',
    },
    { path: '/api/churches', handler: churchRoutes, name: 'churches' },
    { path: '/api/roles', handler: roleRoutes, name: 'roles' },
    { path: '/api/services', handler: serviceRoutes, name: 'services' },
    {
      path: '/api/admin/services',
      handler: adminServiceRoutes,
      name: 'admin-services',
    },
    {
      path: '/api/admin/events',
      handler: adminEventRoutes,
      name: 'admin-events',
    },
    {
      path: '/api/admin/volunteer-opportunities',
      handler: adminVolunteerOpportunityRoutes,
      name: 'admin-volunteer-opportunities',
    },
    {
      path: '/api/admin/service-types',
      handler: serviceTypeRoutes,
      name: 'admin-service-types',
    },
    {
      path: '/api/admin/role-limits',
      handler: roleLimitsRoutes,
      name: 'admin-role-limits',
    },
    {
      path: '/api/super-admin',
      handler: superAdminRoutes,
      name: 'super-admin',
    },
    {
      path: '/api/permissions',
      handler: permissionRoutes,
      name: 'permissions',
    },
    { path: '/api/teams', handler: teamRoutes, name: 'teams' },
    { path: '/api/team-types', handler: teamTypeRoutes, name: 'team-types' },
    {
      path: '/api/assignments',
      handler: assignmentRoutes,
      name: 'assignments',
    },
    { path: '/api/quota', handler: quotaRoutes, name: 'quota' },
    { path: '/api/profile', handler: profileRoutes, name: 'profile' },
    { path: '/api/media', handler: mediaRoutes, name: 'media' },
  ];

  routes.forEach(({ path, handler, name }) => {
    try {
      app.use(path, handler);
      logger.info(`[ROUTES] ✓ Registered ${name} routes at ${path}`);
    } catch (error) {
      logger.error(
        `[ROUTES] ✗ Failed to register ${name} routes at ${path}:`,
        error
      );
      throw new Error(`Failed to register ${name} routes: ${error.message}`);
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    logger.debug('[HEALTH] Health check requested');
    const healthData = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      mongodb:
        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    };
    logger.debug('[HEALTH] Health check response:', healthData);
    res.status(200).json(healthData);
  });

  // Error handling middleware with detailed logging
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger.error(`[ERROR] Unhandled error in ${req.method} ${req.path}:`, {
      error: error.message,
      stack: error.stack,
      method: req.method,
      path: req.path,
      body: req.body,
      query: req.query,
      params: req.params,
      headers: req.headers,
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin'),
      ip: req.ip,
    });

    const statusCode = error.statusCode || error.status || 500;

    res.status(statusCode).json({
      success: false,
      message: statusCode === 500 ? 'Internal server error' : error.message,
      error:
        process.env.NODE_ENV === 'development'
          ? {
              message: error.message,
              stack: error.stack,
              details: error,
            }
          : undefined,
      timestamp: new Date().toISOString(),
      path: req.path,
      method: req.method,
    });
  });

  // 404 handler with logging
  app.use('*', (req, res) => {
    logger.warn(`[404] Route not found: ${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      query: req.query,
      headers: req.headers,
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin'),
      ip: req.ip,
    });

    res.status(404).json({
      success: false,
      message: 'Route not found',
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
  });

  // Start server with enhanced logging
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
