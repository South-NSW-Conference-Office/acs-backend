const AppError = require('./appError');

class HierarchyValidator {
  static HIERARCHY_LEVELS = {
    SUPER_ADMIN: 0,
    UNION: 1,
    CONFERENCE: 1,
    CHURCH: 2,
    TEAM: 3,
    SERVICE: 4,
  };

  static LEVEL_NAMES = {
    0: 'super_admin',
    1: 'conference', // Union and Conference share same level
    2: 'church',
    3: 'team',
    4: 'service',
  };

  static ENTITY_TYPES = {
    ORGANIZATION: 'organization',
    TEAM: 'team',
    SERVICE: 'service',
  };

  /**
   * Validates a hierarchy path format
   * @param {string} path - Hierarchy path (e.g., "union123/conference456/church789")
   * @returns {boolean}
   */
  static isValidPathFormat(path) {
    if (typeof path !== 'string') return false;

    // Empty path is valid for root entities
    if (path === '') return true;

    // Path segments should be alphanumeric with underscores
    const pathRegex = /^[a-zA-Z0-9_]+(\/[a-zA-Z0-9_]+)*$/;
    return pathRegex.test(path);
  }

  /**
   * Parses hierarchy path into segments
   * @param {string} path - Hierarchy path
   * @returns {Array<{id: string, level: number}>}
   */
  static parseHierarchyPath(path) {
    if (!path || path === '') return [];

    const segments = path.split('/');
    return segments.map((segment, index) => ({
      id: segment,
      level: index + 1, // Level starts at 1 for first segment
    }));
  }

  /**
   * Gets the depth of a hierarchy path
   * @param {string} path - Hierarchy path
   * @returns {number}
   */
  static getHierarchyDepth(path) {
    if (!path || path === '') return 0;
    return path.split('/').length;
  }

  /**
   * Validates if a parent-child relationship is valid
   * @param {number} childLevel - Child entity level
   * @param {number} parentLevel - Parent entity level
   * @returns {boolean}
   */
  static isValidParentChildRelation(childLevel, parentLevel) {
    // Child must be exactly one level below parent
    return childLevel === parentLevel + 1;
  }

  /**
   * Builds hierarchy path for a new entity
   * @param {string} parentPath - Parent's hierarchy path
   * @param {string} entityId - New entity's ID
   * @returns {string}
   */
  static buildHierarchyPath(parentPath, entityId) {
    if (!entityId) {
      throw new AppError('Entity ID is required to build hierarchy path', 400);
    }

    if (!parentPath || parentPath === '') {
      return entityId;
    }

    return `${parentPath}/${entityId}`;
  }

  /**
   * Validates entity transition between hierarchy levels
   * @param {Object} entity - Entity being updated
   * @param {string} newParentPath - New parent's hierarchy path
   * @param {number} newLevel - New hierarchy level
   * @returns {Object} Validation result
   */
  static validateEntityTransition(entity, newParentPath, newLevel) {
    const result = {
      isValid: true,
      errors: [],
    };

    // Check if level change is valid
    const currentLevel =
      entity.hierarchyLevel || this.getHierarchyDepth(entity.hierarchyPath);
    if (Math.abs(currentLevel - newLevel) > 1) {
      result.isValid = false;
      result.errors.push('Cannot skip hierarchy levels during transition');
    }

    // Validate new parent path
    if (newParentPath && !this.isValidPathFormat(newParentPath)) {
      result.isValid = false;
      result.errors.push('Invalid parent hierarchy path format');
    }

    // Check for circular dependencies
    if (newParentPath && newParentPath.includes(entity._id.toString())) {
      result.isValid = false;
      result.errors.push('Circular dependency detected in hierarchy');
    }

    return result;
  }

  /**
   * Checks if an entity is in the subtree of another entity
   * @param {string} entityPath - Entity's hierarchy path
   * @param {string} ancestorPath - Potential ancestor's path
   * @returns {boolean}
   */
  static isInSubtree(entityPath, ancestorPath) {
    if (!entityPath || !ancestorPath) return false;
    return entityPath.startsWith(ancestorPath + '/');
  }

  /**
   * Gets all ancestor paths from a hierarchy path
   * @param {string} path - Hierarchy path
   * @returns {Array<string>}
   */
  static getAncestorPaths(path) {
    if (!path || path === '') return [];

    const segments = path.split('/');
    const ancestors = [];

    for (let i = 1; i <= segments.length; i++) {
      ancestors.push(segments.slice(0, i).join('/'));
    }

    return ancestors;
  }

  /**
   * Validates organization hierarchy constraints
   * @param {Object} organization - Organization object
   * @param {Object} parentOrganization - Parent organization object (optional)
   * @returns {Object} Validation result
   */
  static validateOrganizationHierarchy(
    organization,
    parentOrganization = null
  ) {
    const result = {
      isValid: true,
      errors: [],
    };

    // Validate hierarchy level
    const validLevels = ['union', 'conference', 'church'];
    if (!validLevels.includes(organization.hierarchyLevel)) {
      result.isValid = false;
      result.errors.push(
        `Invalid hierarchy level: ${organization.hierarchyLevel}`
      );
    }

    // Validate parent-child relationship
    if (parentOrganization) {
      const parentLevel = validLevels.indexOf(
        parentOrganization.hierarchyLevel
      );
      const childLevel = validLevels.indexOf(organization.hierarchyLevel);

      if (childLevel !== parentLevel + 1) {
        result.isValid = false;
        result.errors.push('Invalid parent-child hierarchy relationship');
      }

      // Church cannot have children organizations
      if (parentOrganization.hierarchyLevel === 'church') {
        result.isValid = false;
        result.errors.push('Churches cannot have child organizations');
      }
    }

    return result;
  }

  /**
   * Validates team hierarchy constraints
   * @param {Object} team - Team object
   * @param {string} churchId - Church ID
   * @returns {Object} Validation result
   */
  static validateTeamHierarchy(team, churchId) {
    const result = {
      isValid: true,
      errors: [],
    };

    if (!churchId) {
      result.isValid = false;
      result.errors.push('Teams must belong to a church');
    }

    if (team.hierarchyDepth !== undefined && team.hierarchyDepth !== 3) {
      result.isValid = false;
      result.errors.push('Teams must be at hierarchy depth 3');
    }

    return result;
  }

  /**
   * Validates service hierarchy constraints
   * @param {Object} service - Service object
   * @param {string} teamId - Team ID
   * @returns {Object} Validation result
   */
  static validateServiceHierarchy(service, teamId) {
    const result = {
      isValid: true,
      errors: [],
    };

    if (!teamId) {
      result.isValid = false;
      result.errors.push('Services must belong to a team');
    }

    if (service.hierarchyDepth !== undefined && service.hierarchyDepth !== 4) {
      result.isValid = false;
      result.errors.push('Services must be at hierarchy depth 4');
    }

    return result;
  }

  /**
   * Detects potential circular dependencies in hierarchy update
   * @param {string} entityId - Entity being updated
   * @param {string} newParentPath - New parent's hierarchy path
   * @param {Array} allEntities - All entities in the system (for deep validation)
   * @returns {boolean}
   */
  static hasCircularDependency(entityId, newParentPath, allEntities = []) {
    if (!newParentPath) return false;

    // Simple check: entity ID should not be in its own parent path
    if (newParentPath.includes(entityId)) {
      return true;
    }

    // Deep check if entities provided
    if (allEntities.length > 0) {
      const entity = allEntities.find((e) => e._id.toString() === entityId);
      if (entity && entity.hierarchyPath) {
        // Check if new parent is currently a child of this entity
        const newParent = allEntities.find(
          (e) => e.hierarchyPath === newParentPath
        );
        if (
          newParent &&
          this.isInSubtree(newParent.hierarchyPath, entity.hierarchyPath)
        ) {
          return true;
        }
      }
    }

    return false;
  }
}

module.exports = HierarchyValidator;
