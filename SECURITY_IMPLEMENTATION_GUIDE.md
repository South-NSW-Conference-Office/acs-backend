# Security Implementation Guide

## Overview

This guide shows how to integrate all the security components created to fix user data isolation vulnerabilities.

## Required Changes to index.js or app.js

```javascript
const express = require('express');
const { applySecurityMiddleware } = require('./config/security');

const app = express();

// Apply all security middleware (must be before routes)
applySecurityMiddleware(app);

// Your existing middleware...
// Your routes...

// Example of using secure routes:
const { secureRoute } = require('./config/security');
const usersRouter = require('./routes/users');
const organizationsRouter = require('./routes/organizations');

// Apply secure routes
app.use('/api/users', secureRoute('users.read'), usersRouter);
app.use(
  '/api/organizations',
  secureRoute('organizations.read'),
  organizationsRouter
);
```

## Environment Variables to Add

Add these to your `.env` file:

```env
# JWT Configuration
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
JWT_REFRESH_SECRET=your-refresh-secret-key

# Session Configuration
MAX_CONCURRENT_SESSIONS=5
SESSION_TIMEOUT=1800000
EXTEND_SESSION_ON_ACTIVITY=true

# Password Policy
PASSWORD_MIN_LENGTH=8
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBERS=true
PASSWORD_REQUIRE_SPECIAL=true
PASSWORD_MAX_AGE_DAYS=90
PASSWORD_PREVENT_REUSE=5

# Rate Limiting
RATE_LIMIT_ENABLED=true
REDIS_URL=redis://localhost:6379

# Audit Logging
AUDIT_LOG_ENABLED=true
AUDIT_LOG_RETENTION_DAYS=90

# CORS
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com
```

## Frontend Updates Required

### 1. Update Auth Service Usage

Replace `AuthService` with `SecureAuthService`:

```typescript
// Before:
import { AuthService } from '@/lib/auth';

// After:
import { SecureAuthService } from '@/lib/secureAuth';

// Update all references
await SecureAuthService.setSecureOrganizationContext(orgId);
await SecureAuthService.secureLogout();
```

### 2. Update RBAC Service Usage

Replace `RBACService` with `SecureRBACService`:

```typescript
// Before:
import { RBACService } from '@/lib/rbac';

// After:
import { SecureRBACService } from '@/lib/secureRbac';

// Update all references
const users = await SecureRBACService.getUsers();
const user = await SecureRBACService.getSecureUser(userId);
```

### 3. Update Organization Context Switching

```typescript
// In OrganizationSelector or similar component
const handleOrganizationChange = async (orgId: string) => {
  const success = await SecureAuthService.setSecureOrganizationContext(orgId);
  if (!success) {
    showError('You do not have access to this organization');
    return;
  }
  // Continue with organization switch...
};
```

## Migration Steps

### Step 1: Database Indexes

Add indexes for audit logs:

```javascript
// Run in MongoDB shell or migration script
db.auditlogs.createIndex({ userId: 1, createdAt: -1 });
db.auditlogs.createIndex({ targetResource: 1, targetId: 1 });
db.auditlogs.createIndex({ action: 1, createdAt: -1 });
```

### Step 2: Test Security Features

1. **Test User Isolation**:

   ```bash
   # Try to access users from another organization
   curl -H "Authorization: Bearer TOKEN" \
        -H "X-Organization-Id: OTHER_ORG_ID" \
        http://localhost:5000/api/users
   ```

2. **Test Rate Limiting**:

   ```bash
   # Make multiple requests quickly
   for i in {1..10}; do
     curl -X POST http://localhost:5000/api/auth/signin \
          -d '{"email":"test@example.com","password":"wrong"}';
   done
   ```

3. **Test Audit Logging**:
   ```bash
   # Check audit logs collection
   # Should see entries for sensitive operations
   ```

### Step 3: Monitor Security

1. **Security Status Endpoint**:

   ```javascript
   // Add to your routes
   router.get(
     '/api/admin/security-status',
     secureRoute('admin.security'),
     (req, res) => {
       const { getSecurityStatus } = require('./config/security');
       res.json(getSecurityStatus());
     }
   );
   ```

2. **Audit Log Query Endpoint**:
   ```javascript
   // Add to admin routes
   router.get(
     '/api/admin/audit-logs',
     secureRoute('admin.audit'),
     async (req, res) => {
       const { queryAuditLogs } = require('./middleware/auditLog');
       const logs = await queryAuditLogs(req.query);
       res.json(logs);
     }
   );
   ```

## Security Checklist

- [ ] All routes use `authenticateToken` middleware
- [ ] Organization context validation is applied
- [ ] User routes filter by organization access
- [ ] Organization routes validate access
- [ ] Rate limiting is enabled on sensitive endpoints
- [ ] Audit logging captures security events
- [ ] Frontend validates organization context
- [ ] Tokens are blacklisted on logout
- [ ] Session validation occurs on each request
- [ ] Password policy is enforced

## Rollback Plan

If issues occur:

1. **Feature Flags**: Each security feature can be disabled via environment variables
2. **Middleware Order**: Security middleware can be commented out temporarily
3. **Database**: Audit logs are in separate collection, won't affect existing data
4. **Frontend**: Can fallback to original services if needed

## Testing

Run these tests after implementation:

```bash
# Backend tests
npm test

# Security audit
npm run security:audit

# Check for vulnerabilities
npm audit
```

## Monitoring

Monitor these metrics:

- Failed authentication attempts
- Rate limit violations
- Organization context mismatches
- Audit log volume
- Token blacklist size

## Support

If you encounter issues:

1. Check audit logs for security events
2. Review rate limit configurations
3. Verify organization assignments
4. Check JWT token validity
