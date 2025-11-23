const Union = require('../models/Union');
const Conference = require('../models/Conference');
const Church = require('../models/Church');
const Team = require('../models/Team');
const Service = require('../models/Service');
const Role = require('../models/Role');
const User = require('../models/User');
const HierarchyValidator = require('../utils/hierarchyValidator');

/**
 * Hierarchical Authorization Service
 * Enforces strict hierarchical permissions: Super Admin → Regions/Conferences → Churches → Teams → Services
 * Implements permission inheritance and scope-based access control
 */
class HierarchicalAuthorizationService {
  constructor() {
    // Cache for user permissions to reduce DB queries
    this.permissionCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }
  
  /**
   * Get user's highest hierarchy level (lowest number = highest level)
   * @param {Object} user - User object with populated organizations
   * @returns {Promise<Number>} - Hierarchy level (0=super_admin, 1=conference, 2=church, 3=team, 4=service)
   */
  async getUserHighestLevel(user) {
    if (!user) {
      return 999; // No access
    }

    // Check if user has isSuperAdmin flag set directly
    if (user.isSuperAdmin === true) {
      return 0; // Super admin is highest level
    }

    // Combine all hierarchical assignments 
    const allAssignments = [
      ...(user.unionAssignments || []),
      ...(user.conferenceAssignments || []),
      ...(user.churchAssignments || [])
    ];

    if (allAssignments.length === 0) {
      return 999; // No access
    }

    let highestLevel = 999;
    
    for (const orgAssignment of allAssignments) {
      const role = orgAssignment.role;
      
      // Handle both populated and string role references
      const roleName = role?.name || role;
      
      if (roleName === 'super_admin') {
        return 0; // Super admin is highest level
      }
      
      // Get role object if we have string reference
      let roleObj = role;
      if (typeof role === 'string') {
        roleObj = await Role.findById(role);
      } else if (!role.hierarchyLevel && role._id) {
        roleObj = await Role.findById(role._id);
      }
      
      if (roleObj && roleObj.hierarchyLevel !== undefined) {
        highestLevel = Math.min(highestLevel, roleObj.hierarchyLevel);
      }
    }
    
    return highestLevel === 999 ? 4 : highestLevel; // Default to lowest level if unclear
  }
  
  /**
   * Get user's hierarchy path for their highest-level assignment
   * @param {Object} user - User object
   * @returns {Promise<String>} - Hierarchy path (e.g., "union123/conference456")
   */
  async getUserHierarchyPath(user) {
    if (!user) {
      return null;
    }

    // Super admin users have access to all hierarchy levels
    if (user.isSuperAdmin === true) {
      return ''; // Empty path means system-level access
    }

    // Combine all hierarchical assignments
    const allAssignments = [
      ...(user.unionAssignments || []),
      ...(user.conferenceAssignments || []),
      ...(user.churchAssignments || [])
    ];

    if (allAssignments.length === 0) {
      return null;
    }
    
    let highestLevelPath = null;
    let highestLevel = 999;
    
    for (const orgAssignment of allAssignments) {
      const role = orgAssignment.role;
      // Get org reference based on assignment type
      const org = orgAssignment.union || orgAssignment.conference || orgAssignment.church;
      
      // Get role level
      let roleLevel = 4;
      if (typeof role === 'object' && role.hierarchyLevel !== undefined) {
        roleLevel = role.hierarchyLevel;
      } else {
        const roleObj = await Role.findById(role);
        if (roleObj) roleLevel = roleObj.hierarchyLevel;
      }
      
      // If this is a higher level (lower number), update path
      if (roleLevel < highestLevel) {
        highestLevel = roleLevel;
        
        // Get organization hierarchy path
        let orgObj = org;
        if (typeof org === 'string') {
          // Try to find in hierarchical models
          orgObj = await Union.findById(org);
          if (!orgObj) {
            orgObj = await Conference.findById(org);
          }
          if (!orgObj) {
            orgObj = await Church.findById(org);
          }
        }
        
        if (orgObj && orgObj.hierarchyPath) {
          highestLevelPath = orgObj.hierarchyPath;
        }
      }
    }
    
    return highestLevelPath;
  }
  
  /**
   * Check if user can manage a specific entity
   * @param {Object} user - User object
   * @param {String} targetEntityPath - Target entity hierarchy path
   * @param {String} action - Action being performed
   * @returns {Promise<Boolean>} - True if user can manage entity
   */
  async canUserManageEntity(user, targetEntityPath, action) {
    try {
      // 1. Get user's highest role level  
      const userLevel = await this.getUserHighestLevel(user);
      const userPath = await this.getUserHierarchyPath(user);
      
      if (userLevel === 0) {
        return true; // Super admin can manage everything
      }
      
      if (!userPath || !targetEntityPath) {
        return false;
      }
      
      // 2. Parse target entity level from path
      const targetLevel = this.parseHierarchyLevel(targetEntityPath);
      
      // 3. Check if user level can manage target level
      if (!this.canLevelManageLevel(userLevel, targetLevel)) {
        return false;
      }
      
      // 4. Check if target is in user's subtree
      if (!targetEntityPath.startsWith(userPath)) {
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error in canUserManageEntity:', error);
      return false;
    }
  }
  
  /**
   * Get entities user can access based on hierarchy
   * @param {Object} user - User object
   * @param {String} entityType - Type of entity ('organization', 'team', 'service')
   * @returns {Promise<Array>} - Array of accessible entities
   */
  async getAccessibleEntities(user, entityType) {
    try {
      const userLevel = await this.getUserHighestLevel(user);
      const userPath = await this.getUserHierarchyPath(user);
      
      // Super admin sees everything
      if (userLevel === 0) {
        return await this.getAllEntities(entityType);
      }
      
      if (!userPath) {
        return [];
      }
      
      // Others see only their subtree
      return await this.getEntitiesInSubtree(entityType, userPath);
    } catch (error) {
      console.error('Error in getAccessibleEntities:', error);
      return [];
    }
  }
  
  /**
   * Get all entities of a specific type
   * @param {String} entityType - Type of entity
   * @returns {Promise<Array>} - All active entities
   */
  async getAllEntities(entityType) {
    switch (entityType.toLowerCase()) {
      case 'union':
      case 'unions':
        return Union.find({ isActive: true });
      case 'conference':
      case 'conferences':
        return Conference.find({ isActive: true }).populate('unionId', 'name');
      case 'church':
      case 'churches':
        return Church.find({ isActive: true }).populate('conferenceId', 'name');
      case 'team':
      case 'teams':
        return Team.find({ isActive: true }).populate('churchId', 'name');
      case 'service':
      case 'services':
        return Service.find({ status: { $ne: 'archived' } }).populate('teamId churchId');
      // Legacy support
      case 'organization':
      case 'organizations':
        // Return all churches for backward compatibility
        return Church.find({ isActive: true }).populate('conferenceId', 'name');
      default:
        return [];
    }
  }
  
  /**
   * Get entities in a specific subtree
   * @param {String} entityType - Type of entity
   * @param {String} hierarchyPath - Root hierarchy path
   * @returns {Promise<Array>} - Entities in subtree
   */
  async getEntitiesInSubtree(entityType, hierarchyPath) {
    const query = {
      hierarchyPath: { $regex: `^${hierarchyPath}` }
    };
    
    switch (entityType.toLowerCase()) {
      case 'union':
      case 'unions':
        return Union.find({ ...query, isActive: true });
      case 'conference':
      case 'conferences':
        return Conference.find({ ...query, isActive: true }).populate('unionId', 'name');
      case 'church':
      case 'churches':
        return Church.find({ ...query, isActive: true }).populate('conferenceId', 'name');
      case 'team':
      case 'teams':
        return Team.find({ ...query, isActive: true }).populate('churchId', 'name');
      case 'service':
      case 'services':
        return Service.find({ ...query, status: { $ne: 'archived' } }).populate('teamId churchId');
      // Legacy support
      case 'organization':
      case 'organizations':
        return Church.find({ ...query, isActive: true }).populate('conferenceId', 'name');
      default:
        return [];
    }
  }
  
  /**
   * Parse hierarchy level from path
   * @param {String} path - Hierarchy path
   * @returns {Number} - Hierarchy level
   */
  parseHierarchyLevel(path) {
    const segments = path.split('/');
    
    // Count actual levels: union=0, conference=1, church=2, team=3, service=4
    let level = 0;
    
    for (const segment of segments) {
      if (segment.includes('_')) {
        // team_xxx or service_xxx
        if (segment.startsWith('team_')) level = 3;
        else if (segment.startsWith('service_')) level = 4;
      } else {
        // Organization IDs
        level++;
      }
    }
    
    return Math.min(level - 1, 2); // Organizations max at level 2 (church)
  }
  
  /**
   * Check if manager level can manage target level
   * @param {Number} managerLevel - Manager's hierarchy level
   * @param {Number} targetLevel - Target's hierarchy level
   * @returns {Boolean} - True if can manage
   */
  canLevelManageLevel(managerLevel, targetLevel) {
    return managerLevel < targetLevel; // Higher levels (lower numbers) manage lower levels
  }
  
  /**
   * Get user's church assignment (for team/service creation)
   * @param {Object} user - User object
   * @returns {Promise<Object>} - Church entity
   */
  async getUserChurch(user) {
    try {
      if (!user) return null;
      
      // Check church assignments first
      if (user.churchAssignments && user.churchAssignments.length > 0) {
        const churchAssignment = user.churchAssignments[0];
        const churchId = churchAssignment.church;
        
        let churchObj = churchId;
        if (typeof churchId === 'string') {
          churchObj = await Church.findById(churchId);
        }
        
        return churchObj;
      }
      
      return null;
    } catch (error) {
      console.error('Error in getUserChurch:', error);
      return null;
    }
  }
  
  /**
   * Get specific entity by type and ID
   * @param {String} entityType - Type of entity
   * @param {String} entityId - Entity ID
   * @returns {Promise<Object>} - Entity object
   */
  async getEntity(entityType, entityId) {
    if (!entityId) return null;
    
    try {
      switch (entityType.toLowerCase()) {
        case 'union':
          return Union.findById(entityId);
        case 'conference':
          return Conference.findById(entityId);
        case 'church':
          return Church.findById(entityId);
        case 'team':
          return Team.findById(entityId);
        case 'service':
          return Service.findById(entityId);
        // Legacy support
        case 'organization':
          return Church.findById(entityId);
        default:
          return null;
      }
    } catch (error) {
      console.error(`Error getting ${entityType}:`, error);
      return null;
    }
  }
  
  /**
   * Validate if user can create entity at specific level
   * @param {Object} user - User object  
   * @param {String} entityType - Type of entity to create
   * @param {String} parentPath - Parent entity hierarchy path
   * @returns {Promise<Boolean>} - True if can create
   */
  async canUserCreateEntity(user, entityType, parentPath) {
    try {
      const userLevel = await this.getUserHighestLevel(user);
      const userPath = await this.getUserHierarchyPath(user);
      
      // Super admin can create anything
      if (userLevel === 0) {
        return true;
      }
      
      if (!userPath || !parentPath) {
        return false;
      }
      
      // Must be in user's subtree
      if (!parentPath.startsWith(userPath)) {
        return false;
      }
      
      // Check specific creation rules
      const targetLevel = this.getEntityCreationLevel(entityType);
      return this.canLevelManageLevel(userLevel, targetLevel);
      
    } catch (error) {
      console.error('Error in canUserCreateEntity:', error);
      return false;
    }
  }
  
  /**
   * Get the level required to create a specific entity type
   * @param {String} entityType - Type of entity
   * @returns {Number} - Required hierarchy level
   */
  getEntityCreationLevel(entityType) {
    const creationLevels = {
      'union': -1,       // Only super admin can create unions
      'conference': 0,   // Union can create conferences
      'church': 1,       // Conference can create churches
      'team': 2,         // Church can create teams
      'service': 3,      // Team can create services
      // Legacy support
      'organization': 1  // Treated as church creation
    };
    
    return creationLevels[entityType.toLowerCase()] || 4;
  }

  /**
   * Get inherited permissions for a user based on hierarchy
   * @param {Object} user - User object with populated organizations
   * @returns {Promise<Array>} - Array of permission strings
   */
  async getInheritedPermissions(user) {
    if (!user || !user._id) return [];
    
    const cacheKey = `permissions_${user._id}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    
    try {
      const permissions = new Set();
      
      // Get user's highest level and path
      const userLevel = await this.getUserHighestLevel(user);
      const userPath = await this.getUserHierarchyPath(user);
      
      // Super admin gets all permissions
      if (userLevel === 0) {
        permissions.add('*');
        return this.setCachedData(cacheKey, Array.from(permissions));
      }
      
      // Get permissions from all role assignments
      const allAssignments = [
        ...(user.unionAssignments || []),
        ...(user.conferenceAssignments || []),
        ...(user.churchAssignments || [])
      ];
      
      for (const orgAssignment of allAssignments) {
        const rolePermissions = await this.getRolePermissions(
          orgAssignment.role,
          userLevel,
          userPath
        );
        rolePermissions.forEach(perm => permissions.add(perm));
      }
      
      // Add level-based implicit permissions
      const implicitPermissions = this.getImplicitPermissions(userLevel);
      implicitPermissions.forEach(perm => permissions.add(perm));
      
      return this.setCachedData(cacheKey, Array.from(permissions));
    } catch (error) {
      console.error('Error getting inherited permissions:', error);
      return [];
    }
  }
  
  /**
   * Get permissions for a specific role with inheritance
   * @param {Object|String} role - Role object or ID
   * @param {Number} userLevel - User's hierarchy level
   * @param {String} userPath - User's hierarchy path
   * @returns {Promise<Array>} - Array of permissions
   */
  async getRolePermissions(role, userLevel, userPath) {
    let roleObj = role;
    if (typeof role === 'string') {
      roleObj = await Role.findById(role).populate('permissions');
    } else if (!role.permissions || !role.permissions[0]?.name) {
      roleObj = await Role.findById(role._id).populate('permissions');
    }
    
    if (!roleObj) return [];
    
    const permissions = new Set();
    
    // Add base role permissions
    roleObj.permissions?.forEach(perm => {
      if (typeof perm === 'object' && perm.name) {
        permissions.add(perm.name);
      }
    });
    
    // Add hierarchy-scoped permissions based on role level
    if (roleObj.canManage && Array.isArray(roleObj.canManage)) {
      roleObj.canManage.forEach(managedLevel => {
        if (managedLevel > userLevel) {
          // Add scoped permissions for lower levels
          permissions.add(`organizations.manage:subordinate`);
          permissions.add(`teams.manage:subordinate`);
          permissions.add(`services.manage:subordinate`);
        }
      });
    }
    
    return Array.from(permissions);
  }
  
  /**
   * Get implicit permissions based on hierarchy level
   * @param {Number} level - Hierarchy level
   * @returns {Array} - Implicit permissions
   */
  getImplicitPermissions(level) {
    const implicitPerms = [];
    
    switch (level) {
      case 0: // Super Admin
        implicitPerms.push('*');
        break;
      case 1: // Conference
        implicitPerms.push(
          'organizations.view:subordinate',
          'organizations.create:subordinate',
          'teams.view:subordinate',
          'services.view:subordinate'
        );
        break;
      case 2: // Church
        implicitPerms.push(
          'teams.view:own',
          'teams.create:own',
          'services.view:subordinate',
          'users.invite:own'
        );
        break;
      case 3: // Team
        implicitPerms.push(
          'services.view:own',
          'services.create:own',
          'users.view:own'
        );
        break;
      case 4: // Service
        implicitPerms.push(
          'services.view:own'
        );
        break;
    }
    
    return implicitPerms;
  }
  
  /**
   * Check if user has a specific permission with scope
   * @param {Object} user - User object
   * @param {String} permission - Permission string (e.g., 'organizations.create')
   * @param {String} scope - Permission scope ('own', 'subordinate', 'all')
   * @param {String} targetPath - Target entity hierarchy path
   * @returns {Promise<Boolean>} - True if user has permission
   */
  async hasPermissionWithScope(user, permission, scope, targetPath) {
    try {
      const userPermissions = await this.getInheritedPermissions(user);
      
      // Check for wildcard permissions
      if (userPermissions.includes('*')) return true;
      
      // Check exact permission
      if (userPermissions.includes(permission)) return true;
      
      // Check scoped permission
      const scopedPermission = `${permission}:${scope}`;
      if (userPermissions.includes(scopedPermission)) {
        // Validate scope constraints
        return await this.validatePermissionScope(user, scope, targetPath);
      }
      
      // Check resource wildcard (e.g., 'organizations.*')
      const [resource] = permission.split('.');
      if (userPermissions.includes(`${resource}.*`)) return true;
      if (userPermissions.includes(`${resource}.*:${scope}`)) {
        return await this.validatePermissionScope(user, scope, targetPath);
      }
      
      return false;
    } catch (error) {
      console.error('Error checking permission with scope:', error);
      return false;
    }
  }
  
  /**
   * Validate permission scope constraints
   * @param {Object} user - User object
   * @param {String} scope - Permission scope
   * @param {String} targetPath - Target entity path
   * @returns {Promise<Boolean>} - True if scope is valid
   */
  async validatePermissionScope(user, scope, targetPath) {
    const userPath = await this.getUserHierarchyPath(user);
    
    switch (scope) {
      case 'all':
        return true;
        
      case 'subordinate':
        if (!userPath || !targetPath) return false;
        // Target must be in user's subtree
        return HierarchyValidator.isInSubtree(targetPath, userPath);
        
      case 'own':
        if (!userPath || !targetPath) return false;
        // Target must be directly under user's path
        const targetParent = HierarchyValidator.getParentPath(targetPath);
        return targetParent === userPath;
        
      default:
        return false;
    }
  }
  
  /**
   * Get managed levels for a user
   * @param {Object} user - User object
   * @returns {Promise<Array>} - Array of manageable hierarchy levels
   */
  async getUserManagedLevels(user) {
    if (!user) return [];
    
    const managedLevels = new Set();
    const userLevel = await this.getUserHighestLevel(user);
    
    // Super admin manages all levels
    if (userLevel === 0) {
      return [0, 1, 2, 3, 4];
    }
    
    // Get all assignments
    const allAssignments = [
      ...(user.unionAssignments || []),
      ...(user.conferenceAssignments || []),
      ...(user.churchAssignments || [])
    ];
    
    // Get managed levels from roles
    for (const orgAssignment of allAssignments) {
      const role = orgAssignment.role;
      let roleObj = role;
      
      if (typeof role === 'string' || !role.canManage) {
        roleObj = await Role.findById(role._id || role);
      }
      
      if (roleObj && roleObj.canManage) {
        roleObj.canManage.forEach(level => {
          if (level > userLevel) {
            managedLevels.add(level);
          }
        });
      }
    }
    
    // Add implicit managed levels
    for (let level = userLevel + 1; level <= 4; level++) {
      managedLevels.add(level);
    }
    
    return Array.from(managedLevels).sort();
  }
  
  /**
   * Cache management methods
   */
  getCachedData(key) {
    const cached = this.permissionCache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.cacheTimeout) {
      this.permissionCache.delete(key);
      return null;
    }
    
    return cached.data;
  }
  
  setCachedData(key, data) {
    this.permissionCache.set(key, {
      data,
      timestamp: Date.now()
    });
    return data;
  }
  
  /**
   * Clear cache for a specific user
   * @param {String} userId - User ID
   */
  clearUserCache(userId) {
    const cacheKey = `permissions_${userId}`;
    this.permissionCache.delete(cacheKey);
  }
  
  /**
   * Clear entire permission cache
   */
  clearAllCache() {
    this.permissionCache.clear();
  }
}

// Export singleton instance
module.exports = new HierarchicalAuthorizationService();