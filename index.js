const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const organizationRoutes = require('./routes/organizations');
const roleRoutes = require('./routes/roles');
const serviceRoutes = require('./routes/services');
const adminServiceRoutes = require('./routes/admin-services');
const permissionRoutes = require('./routes/permissions');

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id'],
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware (disabled for cleaner terminal output)
// app.use(morgan('combined'));

// Database connection
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  })
  .then(async () => {
    // Initialize database with system roles and permissions
    const initializeDatabase = require('./utils/initializeDatabase');
    await initializeDatabase();
  })
  .catch((error) => {
    console.error('Database connection error:', error);
    process.exit(1);
  });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/admin/services', adminServiceRoutes);
app.use('/api/permissions', permissionRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
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

app.listen(PORT, () => {});

module.exports = app;
