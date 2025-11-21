# Rate Limiting Implementation Guide

## Overview

This document describes the rate limiting implementation for the ACS backend API. Rate limiting helps protect the API from abuse, prevents DoS attacks, and ensures fair usage across all users.

## Rate Limits by Endpoint Type

### Authentication Endpoints

- **Limit**: 5 requests per 15 minutes per IP/email combination
- **Applies to**:
  - `/api/auth/signin`
  - `/api/auth/register`
- **Purpose**: Prevent brute force attacks and credential stuffing

### Password Reset

- **Limit**: 3 requests per hour per IP
- **Applies to**:
  - `/api/auth/forgot-password`
  - `/api/auth/reset-password`
- **Purpose**: Prevent email bombing and password reset abuse

### Email Verification

- **Limit**: 5 emails per hour per recipient
- **Applies to**:
  - `/api/auth/verify-email`
  - `/api/auth/verify-email-and-set-password`
- **Purpose**: Prevent email flooding

### File Uploads

- **Limit**: 10 uploads per hour per user
- **Applies to**:
  - `/api/profile/avatar`
  - `/api/services/:id/images`
- **Purpose**: Prevent storage exhaustion and DoS attacks

### Admin Operations

- **Limit**: 50 operations per hour per user
- **Applies to**:
  - All `/api/admin/*` endpoints
  - `/api/users/:userId/roles`
  - DELETE operations on organizations and users
- **Purpose**: Protect sensitive administrative functions

### Search/Query Operations

- **Limit**: 30 requests per minute per user
- **Applies to**:
  - `/api/users` (with query parameters)
  - `/api/services` (with filters)
  - `/api/teams/search`
  - `/api/admin/services/dashboard-stats`
- **Purpose**: Prevent database overload from complex queries

### Public Endpoints

- **Limit**: 60 requests per minute per IP
- **Applies to**:
  - Unauthenticated `/api/services` requests
  - `/health` endpoint
- **Purpose**: Allow reasonable public access while preventing abuse

### Organization Switching

- **Limit**: 10 switches per 5 minutes per user
- **Applies to**:
  - `/api/auth/validate-org-access`
- **Purpose**: Prevent rapid context switching abuse

### Create Operations

- **Limit**: 20 create operations per hour per user/resource
- **Applies to**:
  - All POST requests to `/api/*`
- **Purpose**: Prevent spam and resource exhaustion

### General API

- **Limit**: 100 requests per 15 minutes per user
- **Applies to**:
  - All `/api/` endpoints (fallback)
- **Purpose**: General protection for all API endpoints

## Implementation Details

### Middleware Stack Order

The rate limiters are applied in the following order in `index.js`:

1. Body parsing middleware
2. Rate limiting middleware (`applyRateLimiters`)
3. Route handlers

### Rate Limiter Configuration

Rate limiters are configured in `/backend/middleware/rateLimiter.js` using the `express-rate-limit` package.

#### Key Generator Strategies

Different endpoints use different key generation strategies:

- **Auth endpoints**: Combination of IP + email
- **User-based endpoints**: User ID (from JWT)
- **Public endpoints**: IP address only
- **Resource-specific**: User ID + resource type

### Response Format

When rate limit is exceeded, the API returns:

```json
{
  "success": false,
  "message": "Too many requests, please try again later.",
  "retryAfter": "900"
}
```

The `retryAfter` header indicates seconds until the limit resets.

## Testing Rate Limits

A test script is provided at `/backend/tests/rateLimitTest.js`:

```bash
cd backend
node tests/rateLimitTest.js
```

This script tests various endpoints and verifies rate limiting is working correctly.

## Production Considerations

### Redis Integration

The current implementation uses in-memory storage, which has limitations:

- Rate limits are not shared across server instances
- Limits reset on server restart

For production, uncomment the Redis configuration in `rateLimiter.js`:

```javascript
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');
const redisClient = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL)
  : null;
```

### Monitoring

Monitor rate limit hits to identify:

- Legitimate users being blocked
- Potential attacks or abuse
- Need for limit adjustments

### Dynamic Limits

The system supports role-based dynamic limits:

- Super Admin: 1000 requests per window
- Union/Conference Admin: 500 requests per window
- Church Admin: 200 requests per window
- Regular users: 50 requests per window

## Bypassing Rate Limits

In development, you can temporarily disable rate limiting by commenting out the `applyRateLimiters(app)` line in `index.js`.

**Never disable rate limiting in production!**

## Adjusting Limits

To adjust rate limits:

1. Edit the specific limiter in `/backend/middleware/rateLimiter.js`
2. Update the `windowMs` (time window) or `max` (request count)
3. Restart the server

Example:

```javascript
static authLimiter = this.createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Increase from 5 to 10 requests
  // ...
});
```

## Troubleshooting

### Common Issues

1. **"Too many requests" for legitimate users**
   - Check if limits are too restrictive
   - Consider implementing user-based rather than IP-based limiting
   - Add whitelisting for trusted IPs

2. **Rate limits not working**
   - Ensure `applyRateLimiters(app)` is called after body parsing
   - Check middleware order in `index.js`
   - Verify route paths match the configured patterns

3. **Inconsistent limiting**
   - Switch to Redis for consistent limits across instances
   - Check if multiple instances are running without shared storage

### Debug Mode

Enable debug logging by setting:

```javascript
standardHeaders: true, // Return rate limit info in headers
legacyHeaders: false,
```

This adds headers like:

- `X-RateLimit-Limit`: Request limit
- `X-RateLimit-Remaining`: Remaining requests
- `X-RateLimit-Reset`: Reset timestamp
