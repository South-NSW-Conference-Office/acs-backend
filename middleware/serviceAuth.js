// const Organization = require('../models/Organization'); // REMOVED - Using hierarchical models
const Service = require('../models/Service');
// const ServiceEvent = require('../models/ServiceEvent');
// const VolunteerRole = require('../models/VolunteerRole');
const Story = require('../models/Story');

/**
 * Check if user has permission to manage services for a given team
 * @param {Object} user - The user object
 * @param {ObjectId|String} teamId - The team ID that owns the service
 * @param {String} permission - The permission to check (e.g., 'services.manage', 'services.create')
 * @returns {Boolean} Whether the user has the permission
 */
async function canManageService(user, teamId) {
  if (!user || !teamId) {
    return false;
  }

  // Check if user is super admin
  if (user.isSuperAdmin) {
    return true;
  }

  // For non-super admin users, deny access for now
  // TODO: Implement proper hierarchy-based permissions
  return false;
}

/**
 * Check if user can create content for a specific team
 */
async function canCreateForTeam(user, teamId, contentType = 'services') {
  return canManageService(user, teamId, `${contentType}.create`);
}

/**
 * Check if user can update content
 */
async function canUpdateContent(user, content, contentType = 'services') {
  const teamId = content.teamId;
  return canManageService(user, teamId, `${contentType}.update`);
}

/**
 * Check if user can delete content
 */
async function canDeleteContent(user, content, contentType = 'services') {
  const teamId = content.teamId;
  return canManageService(user, teamId, `${contentType}.delete`);
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
    const canRead = await canManageService(user, service.teamId, permission);
    if (canRead || service.status === 'active') {
      allowedServices.push(service);
    }
  }

  return allowedServices;
}

/**
 * Get teams where user can manage services
 */
async function getManageableTeams(user) {
  if (!user) return [];

  // Check if user is a super admin
  if (user.isSuperAdmin) {
    // For super admin, return empty array to bypass team filtering
    return [];
  }

  // For non-super admin users, return empty array for now
  // TODO: Implement proper hierarchy-based permissions
  return [];
}

/**
 * Express middleware to check service permissions
 */
function requireServicePermission(permission) {
  return async (req, res, next) => {
    try {
      const { user } = req;
      const { teamId } = req.body;
      const serviceId = req.params.serviceId || req.params.id;

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Check if user is super admin - bypass all checks
      if (user.isSuperAdmin) {
        return next();
      }

      let teamIdToCheck = teamId;

      // If updating/deleting existing service, get its team
      if (serviceId && !teamIdToCheck) {
        const service = await Service.findById(serviceId).select('teamId');
        if (!service) {
          return res.status(404).json({ error: 'Service not found' });
        }
        teamIdToCheck = service.teamId;
      }

      if (!teamIdToCheck) {
        // Allow service creation without team ID for now
        return next();
      }

      const hasPermission = await canManageService(
        user,
        teamIdToCheck,
        permission
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: permission,
          teamId: teamIdToCheck,
        });
      }

      // Store the team ID for use in the route handler
      req.authorizedTeamId = teamIdToCheck;
      next();
    } catch (error) {
      // Permission check error
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
      const { teamId } = req.body;
      const { storyId } = req.params;

      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      let teamIdToCheck = teamId;

      if (storyId && !teamIdToCheck) {
        const story = await Story.findById(storyId).select('teamId');
        if (!story) {
          return res.status(404).json({ error: 'Story not found' });
        }
        teamIdToCheck = story.teamId;
      }

      if (!teamIdToCheck) {
        return res.status(400).json({ error: 'Team ID required' });
      }

      // Use 'stories' permission namespace
      const storyPermission = permission.replace('services', 'stories');
      const hasPermission = await canManageService(
        user,
        teamIdToCheck,
        storyPermission
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Insufficient permissions',
          required: storyPermission,
          teamId: teamIdToCheck,
        });
      }

      req.authorizedTeamId = teamIdToCheck;
      next();
    } catch (error) {
      // Permission check error
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Get all services user can manage
 */
async function getManageableServices(user) {
  if (!user) return [];

  const manageableTeamIds = await getManageableTeams(user);

  return Service.find({
    teamId: { $in: manageableTeamIds },
  });
}

module.exports = {
  canManageService,
  canCreateForTeam,
  canUpdateContent,
  canDeleteContent,
  filterServicesByPermission,
  getManageableTeams,
  getManageableServices,
  requireServicePermission,
  requireStoryPermission,
};
