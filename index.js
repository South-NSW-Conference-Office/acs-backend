const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const logger = require('./services/loggerService');
const { applyRateLimiters } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const organizationRoutes = require('./routes/organizations');
const roleRoutes = require('./routes/roles');
const serviceRoutes = require('./routes/services');
const adminServiceRoutes = require('./routes/admin-services');
const adminEventRoutes = require('./routes/admin-events');
const adminVolunteerOpportunityRoutes = require('./routes/admin-volunteer-opportunities');
const serviceTypeRoutes = require('./routes/serviceTypes');
const permissionRoutes = require('./routes/permissions');
const teamRoutes = require('./routes/teams');
const teamTypeRoutes = require('./routes/teamTypes');
const quotaRoutes = require('./routes/quota');
const profileRoutes = require('./routes/profile');
const roleLimitsRoutes = require('./routes/admin/role-limits');

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        process.env.FRONTEND_URL,
        process.env.ADMIN_URL,
        'https://acs-admin.adventhub.org',
        'https://admin.adventhub.org',
      ].filter(Boolean); // Remove undefined values

      // Allow any localhost port for development
      const localhostRegex = /^http:\/\/localhost:\d+$/;
      const localhostIPRegex = /^http:\/\/127\.0\.0\.1:\d+$/;
      const localNetworkRegex = /^http:\/\/192\.168\.\d+\.\d+:\d+$/;

      if (
        allowedOrigins.includes(origin) ||
        localhostRegex.test(origin) ||
        localhostIPRegex.test(origin) ||
        localNetworkRegex.test(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Organization-Id',
      'X-Team-Id',
    ],
  })
);

// Handle preflight OPTIONS requests
app.options('*', cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply rate limiters
applyRateLimiters(app);

// Logging middleware (disabled for cleaner terminal output)
// app.use(morgan('combined'));

// Function to start the server after database connection
const startServer = () => {
  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/organizations', organizationRoutes);
  app.use('/api/roles', roleRoutes);
  app.use('/api/services', serviceRoutes);
  app.use('/api/admin/services', adminServiceRoutes);
  app.use('/api/admin/events', adminEventRoutes);
  app.use(
    '/api/admin/volunteer-opportunities',
    adminVolunteerOpportunityRoutes
  );
  app.use('/api/admin/service-types', serviceTypeRoutes);
  app.use('/api/admin/role-limits', roleLimitsRoutes);
  app.use('/api/permissions', permissionRoutes);
  app.use('/api/teams', teamRoutes);
  app.use('/api/team-types', teamTypeRoutes);
  app.use('/api/quota', quotaRoutes);
  app.use('/api/profile', profileRoutes);

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  // Error handling middleware
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      message: 'Route not found',
    });
  });

  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Health check: http://localhost:${PORT}/health`);
  });
};

// Database connection
logger.info('Starting database connection...');
logger.info('MongoDB URI:', process.env.MONGO_URI ? 'Set' : 'Not set');

mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    bufferCommands: false,
    maxPoolSize: 10,
    minPoolSize: 5,
    connectTimeoutMS: 10000,
  })
  .then(async () => {
    logger.info('Database connected successfully');
    // Initialize database with system roles and permissions
    const initializeDatabase = require('./utils/initializeDatabase');
    await initializeDatabase();
    logger.info('Database initialization completed');

    // Start the server only after database is fully ready
    startServer();
  })
  .catch((error) => {
    logger.error('Database connection failed:', error.message);
    logger.error('Full error:', error);
    logger.error('Database connection failed:', { error: error.message });
    process.exit(1);
  });

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
