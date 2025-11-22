// Simplified Authorization Service for Hierarchical System
const Union = require('../models/Union');
const Conference = require('../models/Conference');
const Church = require('../models/Church');
const User = require('../models/User');

/**
 * Authorization Service
 * Simplified version for the new hierarchical Union/Conference/Church system
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
    return user.organizations.some(assignment => 
      assignment.role && 
      assignment.role.name === 'super_admin'
    );
  }

  /**
   * Check if user has specific permission
   * @param {Object} user - User object
   * @param {String} permission - Permission to check
   * @returns {Boolean} - True if user has permission
   */
  hasPermission(user, permission) {
    if (!user || !user.organizations || user.organizations.length === 0) {
      return false;
    }

    // Super admin has all permissions
    if (this.isSuperAdmin(user)) {
      return true;
    }

    // Check if user has the specific permission
    return user.organizations.some(assignment => 
      assignment.role && 
      assignment.role.permissions && 
      assignment.role.permissions.includes(permission)
    );
  }

  /**
   * Get user's accessible union IDs
   * @param {Object} user - User object
   * @returns {Array} - Array of union IDs user can access
   */
  async getUserUnionAccess(user) {
    if (!user || !user.organizations) return [];

    // Super admin can access all unions
    if (this.isSuperAdmin(user)) {
      const unions = await Union.find({ isActive: true });
      return unions.map(u => u._id.toString());
    }

    // Get union IDs from user assignments
    const unionIds = new Set();
    
    for (const assignment of user.organizations) {
      try {
        // Try to find as union first
        const union = await Union.findById(assignment.organization);
        if (union) {
          unionIds.add(union._id.toString());
          continue;
        }

        // Try to find as conference and get its union
        const conference = await Conference.findById(assignment.organization);
        if (conference) {
          unionIds.add(conference.unionId.toString());
          continue;
        }

        // Try to find as church and get its union
        const church = await Church.findById(assignment.organization);
        if (church) {
          unionIds.add(church.unionId.toString());
        }
      } catch (error) {
        console.warn(`Error resolving organization ${assignment.organization}:`, error.message);
      }
    }

    return Array.from(unionIds);
  }

  /**
   * Get user's accessible conference IDs
   * @param {Object} user - User object
   * @returns {Array} - Array of conference IDs user can access
   */
  async getUserConferenceAccess(user) {
    if (!user || !user.organizations) return [];

    // Super admin can access all conferences
    if (this.isSuperAdmin(user)) {
      const conferences = await Conference.find({ isActive: true });
      return conferences.map(c => c._id.toString());
    }

    const conferenceIds = new Set();

    for (const assignment of user.organizations) {
      try {
        // Try to find as union and get all its conferences
        const union = await Union.findById(assignment.organization);
        if (union) {
          const conferences = await Conference.find({ unionId: union._id, isActive: true });
          conferences.forEach(c => conferenceIds.add(c._id.toString()));
          continue;
        }

        // Try to find as conference directly
        const conference = await Conference.findById(assignment.organization);
        if (conference) {
          conferenceIds.add(conference._id.toString());
          continue;
        }

        // Try to find as church and get its conference
        const church = await Church.findById(assignment.organization);
        if (church) {
          conferenceIds.add(church.conferenceId.toString());
        }
      } catch (error) {
        console.warn(`Error resolving organization ${assignment.organization}:`, error.message);
      }
    }

    return Array.from(conferenceIds);
  }

  /**
   * Get user's accessible church IDs
   * @param {Object} user - User object
   * @returns {Array} - Array of church IDs user can access
   */
  async getUserChurchAccess(user) {
    if (!user || !user.organizations) return [];

    // Super admin can access all churches
    if (this.isSuperAdmin(user)) {
      const churches = await Church.find({ isActive: true });
      return churches.map(c => c._id.toString());
    }

    const churchIds = new Set();

    for (const assignment of user.organizations) {
      try {
        // Try to find as union and get all its churches
        const union = await Union.findById(assignment.organization);
        if (union) {
          const conferences = await Conference.find({ unionId: union._id, isActive: true });
          for (const conference of conferences) {
            const churches = await Church.find({ conferenceId: conference._id, isActive: true });
            churches.forEach(c => churchIds.add(c._id.toString()));
          }
          continue;
        }

        // Try to find as conference and get all its churches
        const conference = await Conference.findById(assignment.organization);
        if (conference) {
          const churches = await Church.find({ conferenceId: conference._id, isActive: true });
          churches.forEach(c => churchIds.add(c._id.toString()));
          continue;
        }

        // Try to find as church directly
        const church = await Church.findById(assignment.organization);
        if (church) {
          churchIds.add(church._id.toString());
        }
      } catch (error) {
        console.warn(`Error resolving organization ${assignment.organization}:`, error.message);
      }
    }

    return Array.from(churchIds);
  }

  /**
   * Check if user can access a specific union
   * @param {Object} user - User object
   * @param {String} unionId - Union ID to check
   * @returns {Boolean} - True if user can access the union
   */
  async canAccessUnion(user, unionId) {
    const accessibleUnions = await this.getUserUnionAccess(user);
    return accessibleUnions.includes(unionId.toString());
  }

  /**
   * Check if user can access a specific conference
   * @param {Object} user - User object
   * @param {String} conferenceId - Conference ID to check
   * @returns {Boolean} - True if user can access the conference
   */
  async canAccessConference(user, conferenceId) {
    const accessibleConferences = await this.getUserConferenceAccess(user);
    return accessibleConferences.includes(conferenceId.toString());
  }

  /**
   * Check if user can access a specific church
   * @param {Object} user - User object
   * @param {String} churchId - Church ID to check
   * @returns {Boolean} - True if user can access the church
   */
  async canAccessChurch(user, churchId) {
    const accessibleChurches = await this.getUserChurchAccess(user);
    return accessibleChurches.includes(churchId.toString());
  }

  /**
   * Legacy method for backward compatibility - now just returns empty array
   * @param {Object} user - User object
   * @returns {Array} - Empty array (organizations are now unions/conferences/churches)
   * @deprecated Use getUserUnionAccess, getUserConferenceAccess, or getUserChurchAccess instead
   */
  async getUserOrganizationAccess(user) {
    console.warn('getUserOrganizationAccess is deprecated. Use hierarchical access methods instead.');
    return [];
  }

  /**
   * Legacy method for backward compatibility - always returns false
   * @param {Object} user - User object
   * @param {String} organizationId - Organization ID
   * @returns {Boolean} - Always false (use hierarchical methods instead)
   * @deprecated Use canAccessUnion, canAccessConference, or canAccessChurch instead
   */
  async canAccessOrganization(user, organizationId) {
    console.warn('canAccessOrganization is deprecated. Use hierarchical access methods instead.');
    return false;
  }
}

module.exports = new AuthorizationService();