# ACS Backend Infrastructure

## Overview

Comprehensive backend infrastructure for Adventist Community Services organizational management system with role-based access control (RBAC), hierarchical organization structure, and advanced security features.

## 🏗️ Architecture

### Core Features

- **Hierarchical Organizations**: Union → Conference → Church structure
- **Role-Based Access Control (RBAC)**: Granular permissions with scope-based authorization
- **JWT Authentication**: Secure token-based authentication
- **RESTful API**: Well-structured endpoints with consistent response format
- **Input Validation**: Comprehensive request validation and sanitization
- **Security Hardening**: Rate limiting, CORS, helmet, and security monitoring
- **Comprehensive Logging**: Structured logging with rotation and security auditing
- **Error Handling**: Global error handling with custom error classes

### Technology Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: JWT (jsonwebtoken)
- **Validation**: express-validator
- **Security**: helmet, cors, bcryptjs
- **Logging**: Custom logging service
- **Process Management**: PM2

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.x
- MongoDB >= 6.x
- npm or pnpm

### Installation

```bash
# Clone repository
git clone <repository-url>
cd backend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Initialize database
npm run init-db

# Start development server
npm run dev
```

### Environment Configuration

Copy `.env.example` to `.env` and configure:

```env
# Database
MONGO_URI=mongodb://localhost:27017/acs_admin

# JWT
JWT_SECRET=your-super-secret-jwt-key

# Email (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password

# Frontend URL
FRONTEND_URL=http://localhost:3001
```

## 📁 Project Structure

```
backend/
├── middleware/           # Custom middleware
│   ├── auth.js          # Authentication & authorization
│   ├── validation.js    # Input validation & sanitization
│   └── errorHandler.js  # Global error handling
├── models/              # MongoDB models
│   ├── User.js         # User model with RBAC
│   ├── Organization.js # Hierarchical organization model
│   └── Role.js         # Role model with permissions
├── routes/              # API route handlers
│   ├── auth.js         # Authentication routes
│   ├── users.js        # User management routes
│   ├── organizations.js # Organization CRUD routes
│   └── roles.js        # Role management routes
├── services/            # Business logic layer
│   ├── organizationService.js # Organization business logic
│   ├── userService.js        # User management logic
│   ├── loggerService.js      # Logging service
│   └── emailService.js       # Email service
├── scripts/             # Utility scripts
│   ├── init-db.js      # Database initialization
│   └── backup-db.js    # Database backup
├── logs/               # Log files
├── ecosystem.config.js # PM2 configuration
├── .env.example       # Environment template
└── index.js           # Application entry point
```

## 🔐 Authentication & Authorization

### Authentication Flow

1. User provides email/password
2. Server validates credentials
3. JWT token issued with user ID and email
4. Client includes token in Authorization header
5. Server validates token on protected routes

### Authorization System

#### Permission Format

```
resource.action[:scope]
```

**Examples:**

- `users.read` - Read users
- `organizations.create:subordinate` - Create subordinate organizations
- `users.update:own` - Update own user record
- `*` - All permissions (system admin)

#### Scope Hierarchy

- `all` → `subordinate` → `own` → `acs_team` → `acs` → `self`
- `assigned` → `self`
- `public` (lowest level)

### System Roles

| Role                 | Level      | Description                                |
| -------------------- | ---------- | ------------------------------------------ |
| `union_admin`        | Union      | Full system access                         |
| `conference_admin`   | Conference | Administrative access for conference level |
| `church_pastor`      | Church     | Full access within own church              |
| `church_acs_leader`  | Church     | ACS team leadership role                   |
| `church_team_member` | Church     | Basic team member access                   |
| `church_viewer`      | Church     | Read-only access to public information     |

## 🔗 API Endpoints

### Authentication

```
POST /api/auth/signin          # User login
GET  /api/auth/is-auth         # Verify authentication
POST /api/auth/register        # User registration (dev)
POST /api/auth/forgot-password # Password reset request
POST /api/auth/reset-password  # Password reset
```

### Organizations

```
GET    /api/organizations              # List organizations
POST   /api/organizations              # Create organization
GET    /api/organizations/:id          # Get organization
PUT    /api/organizations/:id          # Update organization
DELETE /api/organizations/:id          # Delete organization
GET    /api/organizations/:id/hierarchy # Get hierarchy
GET    /api/organizations/:id/subordinates # Get subordinates
```

### Users

```
GET    /api/users                          # List users
GET    /api/users/:id/roles               # Get user roles
POST   /api/users/:id/roles               # Assign role
DELETE /api/users/:id/roles/:orgId        # Revoke role
GET    /api/users/:id/permissions         # Get permissions
```

### Roles

```
GET    /api/roles                     # List roles
POST   /api/roles                     # Create role
GET    /api/roles/:id                 # Get role
PUT    /api/roles/:id                 # Update role
DELETE /api/roles/:id                 # Delete role
GET    /api/roles/permissions/available # Available permissions
```

### Response Format

All API responses follow this format:

```json
{
  "success": true|false,
  "message": "Human readable message",
  "data": { /* Response data */ },
  "error": "Error details (if applicable)",
  "errors": [ /* Validation errors (if applicable) */ ]
}
```

## 🛠️ Development

### Available Scripts

```bash
# Development
npm run dev              # Start with nodemon
npm run dev:debug        # Start with debug logging

# Database
npm run init-db          # Initialize database
npm run init-db:force    # Force reinitialize
npm run seed             # Seed database
npm run reset-db         # Reset database

# Testing
npm test                 # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage

# Code Quality
npm run lint             # Lint code
npm run lint:fix         # Fix linting issues
npm run format           # Format code
npm run validate         # Lint + format + test

# Production
npm run start:prod       # Start in production mode
npm run pm2:start        # Start with PM2
npm run pm2:stop         # Stop PM2 processes
npm run health           # Health check
```

### Database Initialization

The database initialization script creates:

- System roles with predefined permissions
- Sample organizational hierarchy (Union → Conference → Church)
- Sample users with different roles

**Default Login Credentials:**

```
System Admin: admin@adventist.org.au / Admin123!@#
Conference Admin: admin@gscsda.org.au / Conference123!@#
Pastor: pastor@hornsbysda.org.au / Pastor123!@#
ACS Leader: acs@wahroongasda.org.au / AcsLeader123!@#
```

### Testing

Test files should be placed in `__tests__/` directories or named `*.test.js` or `*.spec.js`.

```bash
# Run all tests
npm test

# Run specific test file
npm test auth.test.js

# Run tests with coverage
npm run test:coverage
```

## 🚀 Production Deployment

### PM2 Process Manager

```bash
# Start with PM2
npm run pm2:start

# Monitor processes
npm run monitor

# View logs
npm run logs

# Restart
npm run pm2:restart
```

### Docker Deployment

```bash
# Build Docker image
npm run docker:build

# Run with Docker Compose
npm run docker:compose:up

# View logs
npm run docker:compose:logs
```

### Health Monitoring

Health check endpoint: `GET /health`

```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "version": "1.0.0",
  "mongodb": "connected",
  "memory": {
    "rss": 67108864,
    "heapTotal": 26214400,
    "heapUsed": 18874368,
    "external": 1024
  }
}
```

## 🔒 Security Features

### Security Middleware

- **Helmet**: Sets security headers
- **CORS**: Configurable cross-origin resource sharing
- **Rate Limiting**: Prevents abuse (100 requests/15min)
- **Input Sanitization**: XSS protection
- **Request Size Limiting**: Prevents DoS attacks

### Security Monitoring

- Failed authentication attempts
- Unauthorized access attempts
- Rate limit violations
- Security events logging

### Password Security

- bcrypt with 12 salt rounds
- Password reset with secure tokens
- Token expiration (1 hour for reset tokens)

## 📊 Logging

### Log Levels

- **ERROR**: System errors, exceptions
- **WARN**: Security events, warnings
- **INFO**: General information, API requests
- **VERBOSE**: Detailed operational info
- **DEBUG**: Development debugging

### Log Types

- **Security**: Authentication, authorization events
- **Audit**: User actions, data changes
- **Performance**: Operation timing
- **Database**: DB operations
- **Request**: HTTP request/response logging

### Log Rotation

- Daily rotation or 10MB file size limit
- 30-day retention
- JSON format for structured logging

## 🔧 Configuration

### Environment Variables

See `.env.example` for all available configuration options.

### Database Configuration

```javascript
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
});
```

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Check MongoDB is running
   - Verify MONGO_URI in .env
   - Check network connectivity

2. **JWT Authentication Issues**
   - Verify JWT_SECRET is set
   - Check token expiration
   - Ensure proper Authorization header format

3. **Permission Denied**
   - Check user role assignments
   - Verify permission strings format
   - Check organization context headers

4. **Email Service Issues**
   - Verify SMTP configuration
   - Check email service credentials
   - Test with development mode

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm run dev

# Or set LOG_LEVEL
LOG_LEVEL=debug npm run dev
```

## 📝 API Documentation

For detailed API documentation, visit:

- Development: `http://localhost:5000/api`
- Health Check: `http://localhost:5000/health`

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Code Standards

- Follow ESLint configuration
- Use Prettier for formatting
- Write tests for new features
- Update documentation

## 📄 License

This project is licensed under the ISC License.

## 📞 Support

For technical support or questions:

- Email: support@adventist.org.au
- Documentation: https://docs.adventist.org.au

---

**Built with ❤️ for Adventist Community Services**
