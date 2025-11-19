const Organization = require('../models/Organization');
const User = require('../models/User');

/**
 * Authorization Service
 * Handles all authorization logic following Single Responsibility Principle
 * Provides reusable methods for organization access validation
 */
class AuthorizationService {
  /**
   * Check if user is a superadmin (has super_admin role or wildcard permissions)
   * @param {Object} user - User object with populated organizations
   * @returns {Boolean} - True if user is superadmin
   */
  isSuperAdmin(user) {
    if (!user || !user.organizations || user.organizations.length === 0) {
      return false;
    }

    // Check if user has super_admin role
    const hasSuperAdminRole = user.organizations.some((org) => {
      const roleName = org.role?.name || org.role;
      return roleName === 'super_admin';
    });

    return hasSuperAdminRole;
  }

  /**
   * Check if user has wildcard permissions in any organization
   * @param {Object} user - User object
   * @returns {Promise<Boolean>} - True if user has wildcard permissions
   */
  async hasWildcardPermissions(user) {
    if (!user || !user.organizations || user.organizations.length === 0) {
      return false;
    }

    for (const userOrg of user.organizations) {
      const orgId = userOrg.organization?._id || userOrg.organization;
      try {
        const permissionData = await user.getPermissionsForOrganization(orgId);
        const permissions = permissionData.permissions || [];

        if (permissions.includes('*') || permissions.includes('all')) {
          return true;
        }
      } catch (error) {
        // Error checking permissions for organization
        // Continue checking other organizations
      }
    }

    return false;
  }

  /**
   * Check if user is superadmin (either by role or wildcard permissions)
   * @param {Object} user - User object
   * @returns {Promise<Boolean>} - True if user is superadmin
   */
  async isUserSuperAdmin(user) {
    // First check role-based superadmin (faster)
    if (this.isSuperAdmin(user)) {
      return true;
    }

    // Then check permission-based wildcard access
    return await this.hasWildcardPermissions(user);
  }
  /**
   * Validates if a user has access to a specific organization
   * @param {Object} user - User object with populated organizations
   * @param {String} organizationId - Organization ID to check access for
   * @returns {Promise<Boolean>} - True if user has access
   */
  async validateOrganizationAccess(user, organizationId) {
    if (!user || !organizationId) return false;

    // Superadmin has access to all organizations
    if (await this.isUserSuperAdmin(user)) {
      return true;
    }

    // Check direct membership
    const directAccess = user.organizations.some(
      (org) => org.organization?._id?.toString() === organizationId.toString()
    );
    if (directAccess) return true;

    // Check subordinate organization access
    const userOrgIds = user.organizations
      .map((org) => org.organization?._id || org.organization)
      .filter(Boolean);

    if (userOrgIds.length === 0) return false;

    const subordinateOrgs = await this.getSubordinateOrganizations(userOrgIds);
    return subordinateOrgs.some(
      (org) => org._id.toString() === organizationId.toString()
    );
  }

  /**
   * Get all organizations a user can access (direct + subordinate)
   * @param {Object} user - User object with populated organizations
   * @returns {Promise<Array>} - Array of organization IDs
   */
  async getAccessibleOrganizations(user) {
    if (!user) return [];

    // Superadmin check - return all active organizations
    if (await this.isUserSuperAdmin(user)) {
      const allOrganizations = await Organization.find({
        isActive: true,
      }).select('_id');
      return allOrganizations.map((org) => org._id.toString());
    }

    const userOrgIds = user.organizations
      .map((org) => org.organization?._id || org.organization)
      .filter(Boolean);

    if (userOrgIds.length === 0) return [];

    // Get subordinate organizations
    const subordinateOrgs = await this.getSubordinateOrganizations(userOrgIds);
    const subordinateOrgIds = subordinateOrgs.map((org) => org._id);

    // Return unique organization IDs
    return [
      ...new Set([
        ...userOrgIds.map((id) => id.toString()),
        ...subordinateOrgIds.map((id) => id.toString()),
      ]),
    ];
  }

  /**
   * Get all subordinate organizations for given organization IDs
   * @param {Array} organizationIds - Array of organization IDs
   * @returns {Promise<Array>} - Array of subordinate organizations
   */
  async getSubordinateOrganizations(organizationIds) {
    if (!organizationIds || organizationIds.length === 0) return [];

    // Get all subordinate organizations recursively
    const subordinates = [];
    const processedIds = new Set();
    const toProcess = [...organizationIds];

    while (toProcess.length > 0) {
      const currentId = toProcess.pop();
      if (processedIds.has(currentId.toString())) continue;

      processedIds.add(currentId.toString());

      // Find direct children
      const children = await Organization.find({
        parentOrganization: currentId,
        isActive: true,
      });

      for (const child of children) {
        subordinates.push(child);
        toProcess.push(child._id);
      }
    }

    return subordinates;
  }

  /**
   * Get organizations a user can manage based on permission
   * @param {Object} user - User object
   * @param {String} permission - Permission to check
   * @returns {Promise<Array>} - Array of manageable organization IDs
   */
  async getManageableOrganizations(user, permission = 'organizations.manage') {
    if (!user) return [];

    // Superadmin check - return all active organizations
    if (await this.isUserSuperAdmin(user)) {
      const allOrganizations = await Organization.find({
        isActive: true,
      }).select('_id');
      return allOrganizations.map((org) => org._id.toString());
    }

    const manageableOrgIds = [];

    for (const userOrg of user.organizations) {
      const orgId = userOrg.organization?._id || userOrg.organization;
      const permissionData = await user.getPermissionsForOrganization(orgId);
      const permissions = permissionData.permissions || [];

      // Check for wildcard permissions first
      if (permissions.includes('*') || permissions.includes('all')) {
        // Wildcard permissions grant access to all organizations
        const allOrganizations = await Organization.find({
          isActive: true,
        }).select('_id');
        return allOrganizations.map((org) => org._id.toString());
      }

      if (permissions.includes(permission)) {
        manageableOrgIds.push(orgId.toString());

        // Check for subordinate permissions
        if (permissions.includes(`${permission}:subordinate`)) {
          const subordinates = await this.getSubordinateOrganizations([orgId]);
          manageableOrgIds.push(
            ...subordinates.map((org) => org._id.toString())
          );
        }
      }
    }

    return [...new Set(manageableOrgIds)]; // Remove duplicates
  }

  /**
   * Filter query to only include accessible organizations
   * @param {Object} user - User object
   * @param {Object} query - MongoDB query object
   * @param {String} field - Field name for organization reference
   * @returns {Promise<Object>} - Modified query with organization filter
   */
  async addOrganizationFilter(user, query = {}, field = 'organization') {
    const accessibleOrgs = await this.getAccessibleOrganizations(user);

    if (accessibleOrgs.length === 0) {
      // User has no organization access, return impossible condition
      return { ...query, _id: null };
    }

    return {
      ...query,
      [field]: { $in: accessibleOrgs },
    };
  }

  /**
   * Check if user can access another user's data
   * @param {Object} requestingUser - User making the request
   * @param {String} targetUserId - ID of user being accessed
   * @returns {Promise<Boolean>} - True if access allowed
   */
  async canAccessUser(requestingUser, targetUserId) {
    if (!requestingUser || !targetUserId) return false;

    // Users can access their own data
    if (requestingUser._id.toString() === targetUserId.toString()) {
      return true;
    }

    // Superadmin can access any user
    if (await this.isUserSuperAdmin(requestingUser)) {
      return true;
    }

    // Check if requesting user has user management permissions
    const manageableOrgs = await this.getManageableOrganizations(
      requestingUser,
      'users.read'
    );
    if (manageableOrgs.length === 0) return false;

    // Check if target user belongs to any manageable organization
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) return false;

    const targetUserOrgs = targetUser.organizations.map((org) =>
      (org.organization?._id || org.organization).toString()
    );

    return targetUserOrgs.some((orgId) => manageableOrgs.includes(orgId));
  }

  /**
   * Validate organization context from request headers
   * @param {Object} user - User object
   * @param {String} organizationId - Organization ID from header
   * @returns {Promise<Object>} - Validation result with error message if invalid
   */
  async validateOrganizationContext(user, organizationId) {
    if (!organizationId) {
      return { valid: true }; // No organization context is valid
    }

    const hasAccess = await this.validateOrganizationAccess(
      user,
      organizationId
    );

    if (!hasAccess) {
      return {
        valid: false,
        error: 'You do not have access to the specified organization',
      };
    }

    return { valid: true };
  }
}

// Export singleton instance
module.exports = new AuthorizationService();
