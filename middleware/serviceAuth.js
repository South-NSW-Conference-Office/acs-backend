const Organization = require('../models/Organization');
const Service = require('../models/Service');
// const ServiceEvent = require('../models/ServiceEvent');
// const VolunteerRole = require('../models/VolunteerRole');
const Story = require('../models/Story');

/**
 * Check if user has permission to manage services for a given organization
 * @param {Object} user - The user object with populated organizations
 * @param {ObjectId|String} serviceOrgId - The organization ID that owns the service
 * @param {String} permission - The permission to check (e.g., 'services.manage', 'services.create')
 * @returns {Boolean} Whether the user has the permission
 */
async function canManageService(
  user,
  serviceOrgId,
  permission = 'services.manage'
) {
  console.log('canManageService called:', {
    user: user?.email,
    serviceOrgId,
    permission,
    userOrgs: user?.organizations?.length,
  });

  if (!user || !serviceOrgId) {
    console.log('canManageService: Missing user or serviceOrgId');
    return false;
  }

  // Check if user is super admin
  const isSuperAdmin = user.organizations.some(
    (assignment) =>
      assignment.role?.isSuperAdmin ||
      assignment.role?.permissions?.includes('*')
  );

  if (isSuperAdmin) {
    console.log('canManageService: User is super admin - granting permission');
    return true;
  }

  // Find user's assignment to ANY organization
  for (const assignment of user.organizations) {
    const userOrgId = assignment.organization._id || assignment.organization;
    const userRole = assignment.role;

    if (!userRole || !userRole.hasPermission) continue;

    // Check if role has the base permission
    const hasBasePermission = userRole.hasPermission(permission);
    const hasWildcardPermission = userRole.hasPermission('services.*');

    if (!hasBasePermission && !hasWildcardPermission) continue;

    // Get the permission details to check scope
    const permissionDetails = userRole.permissions.find(
      (p) =>
        p === permission || p.startsWith(`${permission}:`) || p === 'services.*'
    );

    // If no scope specified, it's a wildcard - allow if user is in the same org
    if (
      permissionDetails === permission ||
      permissionDetails === 'services.*'
    ) {
      if (userOrgId.toString() === serviceOrgId.toString()) {
        return true;
      }
    }

    // Check :own scope - user must be directly assigned to the service's org
    if (permissionDetails && permissionDetails.endsWith(':own')) {
      if (userOrgId.toString() === serviceOrgId.toString()) {
        return true;
      }
    }

    // Check :subordinate scope - service org must be a subordinate of user's org
    if (permissionDetails && permissionDetails.endsWith(':subordinate')) {
      const subordinateOrgs =
        await Organization.getSubordinateOrganizations(userOrgId);
      const subordinateOrgIds = subordinateOrgs.map((org) =>
        org._id.toString()
      );

      if (subordinateOrgIds.includes(serviceOrgId.toString())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if user can create content for a specific organization
 */
async function canCreateForOrganization(
  user,
  organizationId,
  contentType = 'services'
) {
  return canManageService(user, organizationId, `${contentType}.create`);
}

/**
 * Check if user can update content
 */
async function canUpdateContent(user, content, contentType = 'services') {
  const organizationId = content.organization._id || content.organization;
  return canManageService(user, organizationId, `${contentType}.update`);
}

/**
 * Check if user can delete content
 */
async function canDeleteContent(user, content, contentType = 'services') {
  const organizationId = content.organization._id || content.organization;
  return canManageService(user, organizationId, `${contentType}.delete`);
}

/**
 * Filter services based on user permissions
 */
async function filterServicesByPermission(
  user,
  services,
  permission = 'services.read'
) {
  if (!user) return services.filter((s) => s.status === 'active');

  const allowedServices = [];

  for (const service of services) {
    const canRead = await canManageService(
      user,
      service.organization._id || service.organization,
      permission
    );
    if (canRead || service.status === 'active') {
      allowedServices.push(service);
    }
  }

  return allowedServices;
}

/**
 * Get organizations where user can manage services
 */
async function getManageableOrganizations(
  user,
  permission = 'services.manage'
) {
  if (!user) return [];

  const manageableOrgs = new Set();

  console.log('getManageableOrganizations - permission:', permission);
  console.log('User organizations count:', user.organizations?.length || 0);

  // Check if user is a super admin
  const isSuperAdmin = user.organizations.some(
    (assignment) =>
      assignment.role?.isSuperAdmin ||
      assignment.role?.permissions?.includes('*')
  );

  if (isSuperAdmin) {
    console.log('User is super admin - returning all organizations');
    // Return all organizations for super admin
    const allOrgs = await Organization.find({}).select('_id');
    return allOrgs.map((org) => org._id.toString());
  }

  for (const assignment of user.organizations) {
    console.log('Checking assignment:', assignment);

    // Skip null organizations (e.g., super admin assignments)
    if (!assignment.organization) {
      console.log('Skipping assignment with null organization');
      continue;
    }

    const userOrgId = assignment.organization._id || assignment.organization;
    const userRole = assignment.role;

    if (!userRole) {
      console.log('No role found for assignment');
      continue;
    }

    if (!userRole.hasPermission) {
      console.log('Role missing hasPermission method:', userRole);
      continue;
    }

    const hasPermission =
      userRole.hasPermission(permission) ||
      userRole.hasPermission('services.*');
    console.log('Has permission:', hasPermission);
    if (!hasPermission) continue;

    // Get the permission details
    const permissionDetails = userRole.permissions.find(
      (p) =>
        p === permission || p.startsWith(`${permission}:`) || p === 'services.*'
    );

    // Add user's own organization if they have any service permission
    manageableOrgs.add(userOrgId.toString());

    // If they have subordinate scope, add all subordinate organizations
    if (permissionDetails && permissionDetails.endsWith(':subordinate')) {
      const subordinateOrgs =
        await Organization.getSubordinateOrganizations(userOrgId);
      subordinateOrgs.forEach((org) => manageableOrgs.add(org._id.toString()));
    }
  }

  return Array.from(manageableOrgs);
}

/**
 * Express middleware to check service permissions
 */
function requireServicePermission(permission) {
  return async (req, res, next) => {
    try {
      const { user } = req;
      const { organizationId } = req.body;
      const { serviceId } = req.params;

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      let orgIdToCheck = organizationId;

      // If updating/deleting existing service, get its organization
      if (serviceId && !orgIdToCheck) {
        const service =
          await Service.findById(serviceId).select('organization');
        if (!service) {
          return res.status(404).json({ error: 'Service not found' });
        }
        orgIdToCheck = service.organization;
      }

      if (!orgIdToCheck) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      const hasPermission = await canManageService(
        user,
        orgIdToCheck,
        permission
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: permission,
          organization: orgIdToCheck,
        });
      }

      // Store the organization ID for use in the route handler
      req.authorizedOrgId = orgIdToCheck;
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        user: user?.email,
        organizationId: orgIdToCheck,
        permission: permission,
      });
      res
        .status(500)
        .json({ error: 'Permission check failed', details: error.message });
    }
  };
}

/**
 * Middleware to check story permissions
 */
function requireStoryPermission(permission) {
  return async (req, res, next) => {
    try {
      const { user } = req;
      const { organizationId } = req.body;
      const { storyId } = req.params;

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      let orgIdToCheck = organizationId;

      if (storyId && !orgIdToCheck) {
        const story = await Story.findById(storyId).select('organization');
        if (!story) {
          return res.status(404).json({ error: 'Story not found' });
        }
        orgIdToCheck = story.organization;
      }

      if (!orgIdToCheck) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      // Use 'stories' permission namespace
      const storyPermission = permission.replace('services', 'stories');
      const hasPermission = await canManageService(
        user,
        orgIdToCheck,
        storyPermission
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: storyPermission,
          organization: orgIdToCheck,
        });
      }

      req.authorizedOrgId = orgIdToCheck;
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Get all services user can manage
 */
async function getManageableServices(user) {
  if (!user) return [];

  const manageableOrgIds = await getManageableOrganizations(user);

  return Service.find({
    organization: { $in: manageableOrgIds },
  }).populate('organization', 'name type');
}

module.exports = {
  canManageService,
  canCreateForOrganization,
  canUpdateContent,
  canDeleteContent,
  filterServicesByPermission,
  getManageableOrganizations,
  getManageableServices,
  requireServicePermission,
  requireStoryPermission,
};
