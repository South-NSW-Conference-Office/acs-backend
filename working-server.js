const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);

      // Allow localhost for development
      if (/^http:\/\/localhost:\d+$/.test(origin)) {
        return callback(null, true);
      }

      // Check allowed origins
      const allowedOrigins = [
        process.env.FRONTEND_URL,
        process.env.ADMIN_URL,
        'https://acs-admin.adventhub.org',
        'https://admin.adventhub.org',
      ].filter(Boolean);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error(`CORS: Origin ${origin} not allowed`));
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb:
      mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// Basic auth endpoints (non-authenticated for testing)
app.get('/api/auth/is-auth-hierarchical', (req, res) => {
  res.json({ success: false, message: 'Not authenticated (test mode)' });
});

app.get('/api/auth/is-auth', (req, res) => {
  res.json({ success: false, message: 'Not authenticated (test mode)' });
});

// Basic conferences endpoint
app.get('/api/conferences', (req, res) => {
  res.json({
    success: true,
    data: [
      { _id: 'test1', name: 'Test Conference 1', isActive: true },
      { _id: 'test2', name: 'Test Conference 2', isActive: true },
    ],
    message: 'Server is working - conferences loaded',
  });
});

// Error handling
app.use((error, req, res) => {
  res.status(500).json({
    success: false,
    message: 'Server error',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined,
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
  });
});

// Connect to database and start server
async function startWorkingServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    const server = app.listen(PORT, () => {});

    server.on('error', () => {
      process.exit(1);
    });
  } catch (error) {
    process.exit(1);
  }
}

startWorkingServer();
