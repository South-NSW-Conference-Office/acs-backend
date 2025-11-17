# ACS Service Model Integration - Complete Documentation

## Overview

This document describes the complete integration of the ACS Service Model into the existing backend and admin frontend. All models, routes, and frontend components have been properly integrated with the existing Organization/Role/User RBAC system.

## Backend Structure

### Models (backend/models/)

1. **Service.js**
   - Main service model with embedded ServiceLocation
   - Relationships: belongs to Organization, created by User
   - Features: geospatial search, text search, status management

2. **ServiceEvent.js**
   - Events associated with services
   - Auto-inherits organization from parent service
   - Supports recurring patterns and registration

3. **VolunteerRole.js**
   - Volunteer opportunities for services
   - Tracks positions available/filled
   - Includes requirements and application process

4. **Story.js**
   - Impact stories and testimonials
   - Publishing workflow with draft/review/published states
   - SEO optimization fields

### Middleware (backend/middleware/)

- **serviceAuth.js**
  - Deep integration with existing RBAC system
  - Supports scoped permissions (:own, :subordinate)
  - Helper functions: `canManageService()`, `requireServicePermission()`
  - Works with existing `user.getPermissionsForOrganization()` and `role.hasPermission()`

### Routes (backend/routes/)

1. **services.js** - Main service routes
   - Public endpoints (no auth required)
   - Protected endpoints (auth + permissions)
   - Handles services, events, volunteer roles, and stories

2. **admin-services.js** - Admin-specific routes
   - Dashboard statistics
   - Permission checking
   - Simplified interface for admin frontend

### Integration Points (backend/index.js)

```javascript
const serviceRoutes = require('./routes/services');
const adminServiceRoutes = require('./routes/admin-services');

app.use('/api/services', serviceRoutes);
app.use('/api/admin/services', adminServiceRoutes);
```

## Admin Frontend Integration

### New Components

1. **admin/src/app/services/page.tsx**
   - Service management dashboard
   - Permission-based UI rendering
   - Integrates with DataTable, PermissionGate components

2. **admin/src/lib/serviceManagement.ts**
   - API client for service endpoints
   - TypeScript interfaces for type safety
   - Handles authentication headers

### Updated Components

- **Sidebar.tsx** - Added Services menu item

## Permission System

### Service Permissions

- `services.create` - Create new services
- `services.read` - View services
- `services.update` - Edit existing services
- `services.delete` - Archive services
- `services.manage` - Full management (events, volunteers, etc.)

### Story Permissions

- `stories.create` - Create stories
- `stories.update` - Edit stories
- `stories.manage` - Publish/unpublish stories

### Scope Modifiers

- No scope - User must be in the same organization
- `:own` - User must be directly assigned to that organization
- `:subordinate` - User can manage child organizations

## API Endpoints

### Public Endpoints (No Auth)

- `GET /api/services` - List active services
- `GET /api/services/:id` - Get service details
- `GET /api/services/:id/events` - Get service events
- `GET /api/services/:id/volunteer-roles` - Get volunteer opportunities
- `GET /api/services/:id/stories` - Get service stories

### Protected Endpoints (Auth Required)

- `POST /api/services` - Create service
- `PUT /api/services/:id` - Update service
- `DELETE /api/services/:id` - Archive service
- `POST /api/services/:id/events` - Create event
- `POST /api/services/:id/upload-image` - Upload image

### Admin Endpoints

- `GET /api/admin/services/permissions` - Get user permissions
- `GET /api/admin/services/dashboard-stats` - Get statistics
- `GET /api/admin/services` - List manageable services
- `GET /api/admin/services/:id/full` - Get full service details
- `POST /api/admin/services/:id/toggle-status` - Toggle status

## Usage Examples

### Backend: Check Service Permissions

```javascript
const { canManageService } = require('./middleware/serviceAuth');

// Check if user can update a service
const hasPermission = await canManageService(
  user,
  service.organization,
  'services.update'
);
```

### Frontend: Service Management

```typescript
import { serviceManagement } from '@/lib/serviceManagement';

// Get services user can manage
const { services } = await serviceManagement.getServices({
  page: 1,
  limit: 10,
  status: 'active',
});

// Create new service
const service = await serviceManagement.createService({
  name: 'Food Pantry',
  type: 'food_pantry',
  organization: orgId,
  descriptionShort: 'Weekly food distribution',
});
```

### Frontend: Permission-Based UI

```tsx
<PermissionGate
  requiredPermission="services.create"
  organizationId={selectedOrgId}
>
  <Button onClick={handleCreateService}>Add Service</Button>
</PermissionGate>
```

## Database Indexes

Services are optimized with the following indexes:

- Text search: `name`, `description`, `tags`
- Geospatial: `locations.coordinates` (2dsphere)
- Query optimization: `organization + status`, `type + status`

## Security Considerations

1. **Organization Isolation** - Users can only access services from their assigned organizations
2. **Permission Validation** - All routes validate permissions before allowing actions
3. **Data Sanitization** - Input validation on all endpoints
4. **File Upload Security** - Image uploads restricted to authenticated users with update permissions

## Next Steps

1. **Frontend Development**
   - Create service creation/edit forms
   - Implement event management interface
   - Build volunteer role management
   - Add story creation and publishing workflow

2. **Additional Features**
   - Email notifications for events
   - Public API documentation
   - Service analytics and reporting
   - Mobile app API endpoints

3. **Testing**
   - Unit tests for permission logic
   - Integration tests for API endpoints
   - E2E tests for admin workflows
