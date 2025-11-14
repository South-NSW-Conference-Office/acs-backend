# ACS Backend API

Backend authentication and RBAC system for the Adventist Community Services Admin application.

## Features

- JWT-based authentication
- Role-based access control (RBAC) 
- Organization hierarchy management
- User management with role assignments
- RESTful API endpoints
- MongoDB with Mongoose ODM
- Express.js server with security middleware

## Quick Start

### 1. Environment Setup

Create a `.env` file in the backend directory with the following variables:

```env
MONGO_URI=your_mongodb_connection_string
PORT=5000
JWT_SECRET=your_super_secret_jwt_key
NODE_ENV=development

# Wasabi S3 Configuration (optional)
WASABI_ACCESS_KEY_ID=your_access_key
WASABI_SECRET_ACCESS_KEY=your_secret_key
WASABI_REGION=ap-southeast-2
WASABI_ENDPOINT=https://s3.ap-southeast-2.wasabisys.com
WASABI_BUCKET=your_bucket_name
WASABI_FORCE_PATH_STYLE=true
WASABI_MAX_RETRIES=3
WASABI_TIMEOUT=30000
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Initialize Database

```bash
npm run init-db
```

This will create:
- System roles (union_admin, conference_admin, church_pastor, etc.)
- Sample organization hierarchy (Union → Conference → Church)
- Sample users with different roles

### 4. Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server will start on `http://localhost:5000`

## Sample Login Credentials

After running `npm run init-db`, you can use these credentials:

- **Admin User**: `admin@nqc.org.au` / `admin123`
- **Pastor User**: `pastor@hornsbysda.org.au` / `pastor123`

## API Endpoints

### Authentication
- `POST /api/auth/signin` - Login with email/password
- `GET /api/auth/is-auth` - Verify authentication token
- `POST /api/auth/register` - Register new user (development only)

### Users
- `GET /api/users` - Get all users (with pagination)
- `GET /api/users/:id/roles` - Get user's role assignments
- `POST /api/users/:id/roles` - Assign role to user
- `DELETE /api/users/:id/roles/:orgId` - Revoke user role
- `GET /api/users/:id/permissions` - Get user permissions for organization

### Organizations
- `GET /api/organizations` - Get all organizations
- `GET /api/organizations/:id` - Get specific organization
- `POST /api/organizations` - Create new organization
- `PUT /api/organizations/:id` - Update organization
- `DELETE /api/organizations/:id` - Delete organization (soft delete)
- `GET /api/organizations/:id/hierarchy` - Get organization hierarchy
- `GET /api/organizations/:id/subordinates` - Get subordinate organizations

### Roles
- `GET /api/roles` - Get all roles
- `GET /api/roles/:id` - Get specific role
- `POST /api/roles` - Create new role
- `PUT /api/roles/:id` - Update role
- `DELETE /api/roles/:id` - Delete role (soft delete)
- `GET /api/roles/permissions/available` - Get available permissions

## Organization Hierarchy

The system supports a 3-level hierarchy:
1. **Union** - Top level organization (no parent)
2. **Conference** - Must have a Union parent
3. **Church** - Must have a Conference parent

## System Roles

### Union Level
- `union_admin` - Full system access

### Conference Level
- `conference_admin` - Administrative access for conference and subordinate churches

### Church Level
- `church_pastor` - Full access within own church
- `church_acs_leader` - ACS team leadership role
- `church_team_member` - Basic team member access
- `church_viewer` - Read-only access to public information

## Permission System

Permissions follow the format: `resource.action` or `resource.action:scope`

### Resources
- `organizations` - Organization management
- `users` - User management
- `roles` - Role management
- `reports` - Reporting access
- `services` - Service management
- `settings` - System settings
- `audit` - Audit logs
- `notifications` - Notification system

### Actions
- `create` - Create new resources
- `read` - View resources
- `update` - Modify resources
- `delete` - Delete resources
- `assign_role` - Assign roles to users
- `revoke_role` - Remove role assignments
- `export` - Export data
- `manage` - Full management access

### Scopes
- `self` - Own user record only
- `own` - Own organization only
- `subordinate` - Own organization and subordinates
- `all` - All organizations
- `assigned` - Assigned organizations only
- `acs_team` - ACS team members only
- `acs` - ACS-related data only
- `public` - Public information only

### Examples
- `users.read:subordinate` - Read users in own and subordinate organizations
- `organizations.create:subordinate` - Create child organizations
- `reports.export:own` - Export reports for own organization
- `*` - All permissions (admin access)

## Security Features

- JWT token authentication
- Password hashing with bcrypt
- Request validation with express-validator
- CORS protection
- Helmet security headers
- Request logging with Morgan
- Environment-based configuration

## Development

### Project Structure
```
backend/
├── models/           # Mongoose models
├── routes/           # Express route handlers
├── middleware/       # Authentication and authorization middleware
├── scripts/          # Database initialization scripts
├── .env              # Environment variables
├── index.js          # Main server file
└── package.json      # Dependencies and scripts
```

### Adding New Routes
1. Create route file in `/routes`
2. Import and use authentication middleware
3. Add route to main server file (`index.js`)

### Database Models
- **User** - User accounts with role assignments
- **Organization** - Hierarchical organization structure
- **Role** - Permission-based roles

## Production Deployment

1. Set `NODE_ENV=production` in environment
2. Use a strong `JWT_SECRET`
3. Configure MongoDB with authentication
4. Use HTTPS in production
5. Set up proper logging and monitoring
6. Configure CORS for production domains

## Health Check

The server provides a health check endpoint at `/health` that returns:
```json
{
  "status": "OK",
  "timestamp": "2023-11-14T10:30:00.000Z"
}
```