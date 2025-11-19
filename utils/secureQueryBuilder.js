const authorizationService = require('../services/authorizationService');

/**
 * Secure Query Builder
 * Provides reusable methods for building secure database queries
 * Follows DRY principle by centralizing query security logic
 */
class SecureQueryBuilder {
  /**
   * Build a secure query for user data
   * @param {Object} user - User making the request
   * @param {Object} baseQuery - Initial query parameters
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Secure query object
   */
  async buildUserQuery(user, baseQuery = {}, options = {}) {
    const { includeOwnData = true } = options;

    // Check if user is superadmin - if so, return unrestricted query
    if (await authorizationService.isUserSuperAdmin(user)) {
      return { ...baseQuery }; // No restrictions for superadmin
    }

    // Get organizations user can manage
    const manageableOrgs =
      await authorizationService.getManageableOrganizations(user, 'users.read');

    if (manageableOrgs.length === 0 && !includeOwnData) {
      // User has no permission to view other users
      return { _id: null }; // Impossible condition
    }

    const conditions = [];

    // Include users from manageable organizations
    if (manageableOrgs.length > 0) {
      conditions.push({
        'organizations.organization': { $in: manageableOrgs },
      });
    }

    // Include own data if requested
    if (includeOwnData) {
      conditions.push({ _id: user._id });
    }

    // Combine with base query
    if (conditions.length === 0) {
      return { _id: null }; // No access conditions met
    }

    if (conditions.length === 1) {
      return { ...baseQuery, ...conditions[0] };
    }

    return {
      ...baseQuery,
      $or: conditions,
    };
  }

  /**
   * Build a secure query for organization data
   * @param {Object} user - User making the request
   * @param {Object} baseQuery - Initial query parameters
   * @returns {Promise<Object>} - Secure query object
   */
  async buildOrganizationQuery(user, baseQuery = {}) {
    // Check if user is superadmin - if so, return unrestricted query
    if (await authorizationService.isUserSuperAdmin(user)) {
      return { ...baseQuery, isActive: true }; // Only filter for active organizations
    }

    const accessibleOrgs =
      await authorizationService.getAccessibleOrganizations(user);

    if (accessibleOrgs.length === 0) {
      return { _id: null }; // Impossible condition
    }

    return {
      ...baseQuery,
      _id: { $in: accessibleOrgs },
    };
  }

  /**
   * Build a secure query for any model with organization reference
   * @param {Object} user - User making the request
   * @param {Object} baseQuery - Initial query parameters
   * @param {String} orgField - Field name for organization reference
   * @returns {Promise<Object>} - Secure query object
   */
  async buildOrganizationScopedQuery(
    user,
    baseQuery = {},
    orgField = 'organization'
  ) {
    return authorizationService.addOrganizationFilter(
      user,
      baseQuery,
      orgField
    );
  }

  /**
   * Add pagination to query
   * @param {Object} query - Query parameters
   * @param {Number} page - Page number (1-based)
   * @param {Number} limit - Items per page
   * @returns {Object} - Pagination parameters
   */
  addPagination(query, page = 1, limit = 10) {
    const skip = (Math.max(1, page) - 1) * limit;
    return {
      query,
      limit: Math.min(limit, 100), // Max 100 items per page
      skip,
    };
  }

  /**
   * Add sorting to query
   * @param {String} sortField - Field to sort by
   * @param {String} sortOrder - Sort order (asc/desc)
   * @returns {Object} - Sort parameters
   */
  buildSortParams(sortField = 'createdAt', sortOrder = 'desc') {
    const order = sortOrder === 'asc' ? 1 : -1;
    return { [sortField]: order };
  }

  /**
   * Build search conditions
   * @param {String} searchTerm - Search term
   * @param {Array} fields - Fields to search in
   * @returns {Object} - Search conditions
   */
  buildSearchConditions(searchTerm, fields = []) {
    if (!searchTerm || fields.length === 0) return {};

    const regex = new RegExp(searchTerm, 'i');
    const conditions = fields.map((field) => ({ [field]: regex }));

    return conditions.length === 1 ? conditions[0] : { $or: conditions };
  }

  /**
   * Combine multiple query conditions
   * @param {Array} conditions - Array of condition objects
   * @returns {Object} - Combined query
   */
  combineConditions(conditions = []) {
    const validConditions = conditions.filter(
      (c) => c && Object.keys(c).length > 0
    );

    if (validConditions.length === 0) return {};
    if (validConditions.length === 1) return validConditions[0];

    return { $and: validConditions };
  }
}

// Export singleton instance
module.exports = new SecureQueryBuilder();
