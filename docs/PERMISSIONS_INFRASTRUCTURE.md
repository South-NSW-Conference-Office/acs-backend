# Permission Infrastructure Documentation

## Overview

This document describes the permission infrastructure implemented in the Adventist Community Services backend application. The system provides role-based access control (RBAC) with hierarchical permissions and scoped authorization.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Components](#core-components)
3. [Permission Middleware](#permission-middleware)
4. [Role System](#role-system)
5. [Permission Checking Logic](#permission-checking-logic)
6. [API Endpoint Protection](#api-endpoint-protection)
7. [Database Models](#database-models)
8. [Usage Examples](#usage-examples)
9. [Troubleshooting](#troubleshooting)

## Architecture Overview

The permission system follows SOLID principles and implements a layered architecture:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Routes    │───▶│   Middleware     │───▶│  Permission     │
│                 │    │                  │    │  Checking       │
│ - Users         │    │ - authenticateToken │    │                 │
│ - Organizations │    │ - authorize      │    │ - checkPermission│
│ - Roles         │    │                  │    │ - Role methods  │
│ - Services      │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Database      │    │   User Model     │    │   Role Model    │
│                 │    │                  │    │                 │
│ - Users         │    │ - organizations  │    │ - permissions   │
│ - Organizations │    │ - primaryOrg     │    │ - hasPermission │
│ - Roles         │    │ - getPermissions │    │ - level         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Core Components

### 1. Authentication Middleware (`middleware/auth.js`)

**Purpose:** Validates JWT tokens and populates `req.user` with authenticated user data.

```javascript
const authenticateToken = async (req, res, next) => {
  // Extracts and validates JWT token
  // Populates req.user with user data including organizations and roles
  // Handles token expiration and invalid tokens
};
```

**Key Features:**

- JWT token validation
- User data population with organization assignments
- Error handling for expired/invalid tokens
- Populates `req.user` with complete user context

### 2. Authorization Middleware (`middleware/auth.js`)

**Purpose:** Checks if authenticated user has required permissions for specific actions.

```javascript
const authorize = (requiredPermission, options = {}) => {
  return async (req, res, next) => {
    // 1. Determines organization context
    // 2. Gets user permissions for that organization
    // 3. Validates required permission
    // 4. Handles fallbacks for super admins
  };
};
```

**Organization Context Resolution:**

```javascript
// Multiple fallback strategies
const organizationId =
  req.headers['x-organization-id'] || // Explicit header
  req.user.primaryOrganization?._id || // Primary org ID
  req.user.primaryOrganization; // Primary org reference

// Fallback to first organization if no context
if (!finalOrgId && req.user.organizations?.length > 0) {
  finalOrgId = req.user.organizations[0].organization._id;
}
```

**Permission Resolution Logic:**

```javascript
// 1. Get permissions for specific organization
const userPermissions =
  await req.user.getPermissionsForOrganization(finalOrgId);

// 2. Fallback for cross-organizational access (union admins)
if (!userPermissions.role) {
  const primaryAssignment =
    req.user.organizations.find(
      (org) =>
        org.organization._id?.toString() ===
        req.user.primaryOrganization?.toString()
    ) || req.user.organizations[0];
}

// 3. Validate permission using checkPermission function
const hasPermission = checkPermission(
  userPermissions.permissions,
  requiredPermission
);
```

## Permission Checking Logic

### Core Permission Function (`middleware/auth.js`)

```javascript
const checkPermission = (userPermissions, requiredPermission) => {
  // 1. Wildcard permissions (* or all)
  if (userPermissions.includes('*') || userPermissions.includes('all')) {
    return true;
  }

  // 2. Exact match
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  // 3. Resource wildcard (e.g., 'users.*' matches 'users.create')
  const [resource, action] = requiredPermission.split('.');
  if (userPermissions.includes(`${resource}.*`)) {
    return true;
  }

  // 4. Scoped permissions (e.g., 'users.create:subordinate' matches 'users.create')
  return userPermissions.some((permission) => {
    const [permResource, permActionWithScope] = permission.split('.');
    if (!permActionWithScope?.includes(':')) return false;

    const [permAction] = permActionWithScope.split(':');
    return permResource === resource && permAction === action;
  });
};
```

### Permission Scope Hierarchy

```javascript
// Scope levels (most restrictive to least restrictive)
'self'; // Only own user record
'acs_team'; // ACS team members only
'own'; // Own organization only
'subordinate'; // Own organization + children
'all'; // All organizations
'*'; // Wildcard - everything
```

## Role System

### Role Model (`models/Role.js`)

**Schema Structure:**

```javascript
{
  name: String,           // 'union_admin', 'church_pastor', etc.
  displayName: String,    // 'Union Administrator', 'Church Pastor'
  level: String,          // 'union', 'conference', 'church'
  permissions: [String],  // ['users.create', 'organizations.read:subordinate']
  description: String,    // Human-readable description
  isSystem: Boolean,      // Prevents modification of system roles
  isActive: Boolean       // Soft delete flag
}
```

**Built-in System Roles:**

1. **Union Administrator** (`union_admin`)

   ```javascript
   permissions: ['*']; // Full system access
   level: 'union';
   ```

2. **Conference Administrator** (`conference_admin`)

   ```javascript
   permissions: [
     'organizations.read:subordinate',
     'organizations.create:subordinate',
     'users.read:subordinate',
     'users.create:subordinate',
     'users.assign_role:subordinate',
     'roles.read',
     'services.manage:subordinate',
   ];
   level: 'conference';
   ```

3. **Church Pastor** (`church_pastor`)

   ```javascript
   permissions: [
     'organizations.read:own',
     'organizations.update:own',
     'users.read:own',
     'users.create:own',
     'users.assign_role:own',
     'services.manage:own',
   ];
   level: 'church';
   ```

4. **Church ACS Leader** (`church_acs_leader`)
   ```javascript
   permissions: [
     'users.read:acs_team',
     'users.create:acs_team',
     'services.manage:acs',
   ];
   level: 'church';
   ```

### Role Methods

```javascript
// Check if role has specific permission
roleSchema.methods.hasPermission = function (requiredPermission) {
  // Implements same logic as checkPermission function
  // Supports wildcards, exact matches, and scoped permissions
};

// Create system roles
roleSchema.statics.createSystemRoles = async function () {
  // Creates/updates all built-in system roles
  // Called during database initialization
};
```

## User Model Integration

### User-Organization-Role Relationship

```javascript
// User schema structure for permissions
{
  organizations: [{
    organization: ObjectId,     // Reference to Organization
    role: ObjectId,            // Reference to Role
    assignedAt: Date,          // When role was assigned
    assignedBy: ObjectId       // Who assigned the role
  }],
  primaryOrganization: ObjectId // Default organization context
}
```

### Permission Resolution Method

```javascript
userSchema.methods.getPermissionsForOrganization = async function (
  organizationId
) {
  // 1. Find organization assignment
  const assignment = this.organizations.find(
    (org) => org.organization.toString() === organizationId.toString()
  );

  // 2. Return permissions and role info
  if (!assignment) {
    return { role: null, permissions: [] };
  }

  await this.populate('organizations.role');
  return {
    role: assignment.role,
    permissions: assignment.role.permissions || [],
  };
};
```

## API Endpoint Protection

### Route Protection Pattern

```javascript
// Standard protection pattern for all routes
router.get(
  '/api/resource',
  authenticateToken, // 1. Validate JWT token
  authorize('resource.read'), // 2. Check read permission
  async (req, res) => {
    // 3. Handle request
    // Route implementation
  }
);

router.post(
  '/api/resource',
  authenticateToken,
  authorize('resource.create'),
  [
    /* validation middleware */
  ],
  async (req, res) => {
    // Route implementation
  }
);
```

### Protected Route Examples

**User Management Routes (`routes/users.js`):**

```javascript
// GET /api/users - List users
router.get('/', authorize('users.read'), ...)

// POST /api/users - Create user
router.post('/', authorize('users.create'), ...)

// PUT /api/users/:id - Update user
router.put('/:userId', authorize('users.update'), ...)

// DELETE /api/users/:id - Delete user
router.delete('/:userId', authorize('users.delete'), ...)

// POST /api/users/:userId/roles - Assign role
router.post('/:userId/roles', authorize('users.assign_role'), ...)
```

**Organization Management Routes (`routes/organizations.js`):**

```javascript
router.get('/', authorize('organizations.read'), ...)
router.post('/', authorize('organizations.create'), ...)
router.put('/:id', authorize('organizations.update'), ...)
router.delete('/:id', authorize('organizations.delete'), ...)
```

**Role Management Routes (`routes/roles.js`):**

```javascript
router.get('/', authorize('roles.read'), ...)
router.post('/', authorize('roles.create'), ...)
router.put('/:id', authorize('roles.update'), ...)
router.delete('/:id', authorize('roles.delete'), ...)
```

## Usage Examples

### Adding New Protected Route

```javascript
// 1. Define the route with protection
router.post(
  '/api/reports',
  authenticateToken, // Required for all protected routes
  authorize('reports.create'), // Specific permission required
  [
    body('title').notEmpty(), // Validation middleware
    body('content').notEmpty(),
  ],
  async (req, res) => {
    try {
      // Access user context
      const userId = req.user._id;
      const orgId = req.organizationId; // Set by authorize middleware

      // Create report with user context
      const report = new Report({
        title: req.body.title,
        content: req.body.content,
        createdBy: userId,
        organization: orgId,
      });

      await report.save();
      res.status(201).json({ success: true, data: report });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);
```

### Creating Custom Role

```javascript
// Create a new custom role
const customRole = new Role({
  name: 'district_coordinator',
  displayName: 'District Coordinator',
  level: 'conference',
  permissions: [
    'organizations.read:subordinate',
    'users.read:subordinate',
    'reports.read:subordinate',
    'services.read:subordinate',
  ],
  description: 'Coordinates multiple churches in a district',
  isSystem: false, // Custom role, can be modified
});

await customRole.save();
```

### Assigning Role to User

```javascript
// Add role assignment to user
user.organizations.push({
  organization: organizationId,
  role: roleId,
  assignedAt: new Date(),
  assignedBy: req.user._id,
});

// Set as primary if first assignment
if (!user.primaryOrganization) {
  user.primaryOrganization = organizationId;
}

await user.save();
```

## Error Handling

### Standard Error Responses

**Authentication Errors:**

```javascript
// 401 - No token provided
{ success: false, message: 'No token provided' }

// 401 - Invalid token
{ success: false, message: 'Invalid token' }

// 401 - Token expired
{ success: false, message: 'Token expired' }
```

**Authorization Errors:**

```javascript
// 403 - Insufficient permissions
{
  success: false,
  message: 'Insufficient permissions',
  required: 'users.create',
  userPermissions: ['users.read', 'users.update']
}

// 403 - No role in organization
{ success: false, message: 'No role assigned in this organization' }

// 400 - Missing organization context
{ success: false, message: 'Organization context required' }
```

## Troubleshooting

### Common Issues

1. **"No role assigned in this organization"**
   - User doesn't have role in the organization context being used
   - Check `primaryOrganization` field matches organization assignments
   - Verify organization assignments are properly populated

2. **"Organization context required"**
   - No organization context could be determined
   - Add `X-Organization-Id` header or ensure user has `primaryOrganization`

3. **"Insufficient permissions"**
   - User's role doesn't include required permission
   - Check role assignments and permission definitions
   - Verify permission scope matches request context

### Debugging Tips

**Check User Permissions:**

```javascript
// Get user's permissions for specific organization
const permissions = await user.getPermissionsForOrganization(orgId);
console.log('User permissions:', permissions);
```

**Verify Role Assignment:**

```javascript
// Check user's organization assignments
console.log('User organizations:', user.organizations);
console.log('Primary organization:', user.primaryOrganization);
```

**Test Permission Checking:**

```javascript
// Test permission logic manually
const hasPermission = checkPermission(userPermissions, 'users.create');
console.log('Has permission:', hasPermission);
```

## Security Considerations

1. **Principle of Least Privilege:** Users get minimum permissions needed for their role
2. **Hierarchical Control:** Higher levels can manage lower levels, but not vice versa
3. **Scoped Access:** Permissions are scoped to appropriate organizational levels
4. **Audit Trail:** All role assignments include `assignedBy` and `assignedAt`
5. **System Role Protection:** Critical system roles cannot be modified
6. **Token Security:** JWT tokens have expiration and proper validation

## Performance Considerations

1. **Middleware Optimization:** Permission checks happen early in request lifecycle
2. **Population Strategy:** Organization and role data populated only when needed
3. **Caching Opportunities:** Consider caching user permissions for high-traffic scenarios
4. **Database Indexes:** Ensure proper indexing on organization and role lookups

## Future Enhancements

1. **Permission Caching:** Redis cache for frequently accessed permissions
2. **Advanced Scoping:** More granular permission scopes
3. **Temporal Permissions:** Time-based permission assignments
4. **Permission Inheritance:** Automatic permission inheritance in organization hierarchy
5. **Audit Logging:** Comprehensive audit trail for all permission-related actions
