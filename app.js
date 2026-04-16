/* eslint-disable no-console */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const logger = require('./services/loggerService');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
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
const contactRoutes = require('./routes/contact');
const pageContentRoutes = require('./routes/page-content');
const adminPageContentRoutes = require('./routes/admin/page-content');
const testimoniesRoutes = require('./routes/testimonies');
const adminTestimoniesRoutes = require('./routes/admin/testimonies');
const publicFellowshipRoutes = require('./routes/public-fellowship');

const app = express();

// Trust proxy when behind reverse proxy (nginx, docker, etc.)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      const allowedOrigins = [
        process.env.FRONTEND_URL,
        process.env.ADMIN_URL,
        'https://acs-admin.adventhub.org',
        'https://admin.adventhub.org',
      ].filter(Boolean);

      const localhostRegex = /^http:\/\/localhost:\d+$/;
      const localhostIPRegex = /^http:\/\/127\.0\.0\.1:\d+$/;
      const localNetworkRegex = /^http:\/\/192\.168\.\d+\.\d+:\d+$/;

      const isAllowedOrigin = allowedOrigins.includes(origin);
      const isLocalDev =
        process.env.NODE_ENV !== 'production' &&
        (localhostRegex.test(origin) ||
          localhostIPRegex.test(origin) ||
          localNetworkRegex.test(origin));

      if (isAllowedOrigin || isLocalDev) {
        callback(null, true);
      } else {
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

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Global error handling for body parsing
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON in request body',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
  next(error);
});

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
      }
    );
  });

  next();
});

// Routes
const routes = [
  { path: '/api/auth', handler: authRoutes, name: 'auth' },
  { path: '/api/users', handler: userRoutes, name: 'users' },
  { path: '/api/unions', handler: unionRoutes, name: 'unions' },
  { path: '/api/conferences', handler: conferenceRoutes, name: 'conferences' },
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
  { path: '/api/permissions', handler: permissionRoutes, name: 'permissions' },
  { path: '/api/teams', handler: teamRoutes, name: 'teams' },
  { path: '/api/team-types', handler: teamTypeRoutes, name: 'team-types' },
  { path: '/api/assignments', handler: assignmentRoutes, name: 'assignments' },
  { path: '/api/quota', handler: quotaRoutes, name: 'quota' },
  { path: '/api/profile', handler: profileRoutes, name: 'profile' },
  { path: '/api/media', handler: mediaRoutes, name: 'media' },
  { path: '/api/contact', handler: contactRoutes, name: 'contact' },
  {
    path: '/api/page-content',
    handler: pageContentRoutes,
    name: 'page-content',
  },
  {
    path: '/api/admin/page-content',
    handler: adminPageContentRoutes,
    name: 'admin-page-content',
  },
  {
    path: '/api/testimonies',
    handler: testimoniesRoutes,
    name: 'testimonies',
  },
  {
    path: '/api/admin/testimonies',
    handler: adminTestimoniesRoutes,
    name: 'admin-testimonies',
  },
  {
    path: '/api/public/fellowship',
    handler: publicFellowshipRoutes,
    name: 'public-fellowship',
  },
];

routes.forEach(({ path, handler, name }) => {
  try {
    app.use(path, handler);
  } catch (error) {
    throw new Error(`Failed to register ${name} routes: ${error.message}`);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  logger.error(`[ERROR] Unhandled error in ${req.method} ${req.path}:`, {
    error: error.message,
    stack: error.stack,
  });

  const statusCode = error.statusCode || error.status || 500;

  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal server error' : error.message,
    error:
      process.env.NODE_ENV === 'development'
        ? { message: error.message, stack: error.stack }
        : undefined,
    timestamp: new Date().toISOString(),
    path: req.path,
    method: req.method,
  });
});

module.exports = app;
