const Union = require('../models/Union');
const Conference = require('../models/Conference');
const Church = require('../models/Church');
const Team = require('../models/Team');
const Service = require('../models/Service');
const Role = require('../models/Role');
// const User = require('../models/User');
const HierarchyValidator = require('../utils/hierarchyValidator');
const authorizationService = require('./authorizationService');

// Permission resource name for each hierarchy level, matching how role
// permissions are written in models/Role.js ('churches.update:own').
const ENTITY_BY_LEVEL = {
  0: 'unions',
  1: 'conferences',
  2: 'churches',
  3: 'teams',
  4: 'services',
};

// Actions that mutate. Anything not listed here is treated as a read.
// `manage` is included so it is both a recognised action and, below, a verb that
// satisfies any other write — a role granting 'services.manage:own' can update.
const WRITE_ACTIONS = new Set(['create', 'update', 'delete', 'manage']);

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
      ...(user.churchAssignments || []),
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

    // Super admin users have access to all hierarchy levels.
    // Uses authorizationService so an assigned super_admin role counts, not
    // just the isSuperAdmin boolean.
    if (authorizationService.isSuperAdmin(user)) {
      return ''; // Empty path means system-level access
    }

    // Combine all hierarchical assignments
    const allAssignments = [
      ...(user.unionAssignments || []),
      ...(user.conferenceAssignments || []),
      ...(user.churchAssignments || []),
    ];

    if (allAssignments.length === 0) {
      return null;
    }

    let highestLevelPath = null;
    let highestLevel = 999;

    for (const orgAssignment of allAssignments) {
      const role = orgAssignment.role;
      // Get org reference based on assignment type, keeping track of which
      // model it belongs to so it can be resolved directly if it is only a ref.
      let org = null;
      let OrgModel = null;
      if (orgAssignment.union) {
        org = orgAssignment.union;
        OrgModel = Union;
      } else if (orgAssignment.conference) {
        org = orgAssignment.conference;
        OrgModel = Conference;
      } else if (orgAssignment.church) {
        org = orgAssignment.church;
        OrgModel = Church;
      }

      // Get role level. Note `typeof null === 'object'`, so the null check
      // matters: an assignment with no role would otherwise throw here and
      // take down the whole permission check.
      let roleLevel = 4;
      if (role && typeof role === 'object' && role.hierarchyLevel !== undefined) {
        roleLevel = role.hierarchyLevel;
      } else if (role) {
        const roleObj = await Role.findById(role);
        if (roleObj) roleLevel = roleObj.hierarchyLevel;
      }

      // If this is a higher level (lower number), update path
      if (roleLevel < highestLevel) {
        highestLevel = roleLevel;

        // Get organization hierarchy path.
        // The reference may already be a populated document, or it may be a
        // plain ObjectId/string. The previous `typeof org === 'string'` guard
        // never matched an ObjectId, so the lookup was skipped and this
        // returned null for every non-super-admin. Resolve whenever the value
        // does not already carry the field we need.
        let orgObj = org;
        if (org && !org.hierarchyPath && OrgModel) {
          orgObj = await OrgModel.findById(org._id || org);
        }

        if (orgObj && orgObj.hierarchyPath) {
          highestLevelPath = orgObj.hierarchyPath;
        }
      }
    }

    return highestLevelPath;
  }

  /**
   * Resolve the assignment a user acts under: their highest-level one.
   *
   * getUserHighestLevel and getUserHierarchyPath each walk the assignments
   * separately and return one field apiece, so a caller wanting the role too had
   * no way to be sure it belonged to the same assignment as the path. This
   * returns the three together.
   *
   * @param {Object} user - User object
   * @returns {Promise<{level: Number, path: String|null, role: Object}|null>}
   */
  async getUserHighestAssignment(user) {
    if (!user) return null;

    const allAssignments = [
      ...(user.unionAssignments || []),
      ...(user.conferenceAssignments || []),
      ...(user.churchAssignments || []),
    ];

    if (allAssignments.length === 0) return null;

    let best = null;
    let bestLevel = 999;

    for (const assignment of allAssignments) {
      const role = assignment.role;
      if (!role) continue;

      // Resolve the role unless it is already populated with the level.
      let roleObj = role;
      if (typeof role !== 'object' || role.hierarchyLevel === undefined) {
        roleObj = await Role.findById(role._id || role);
      }
      if (!roleObj || roleObj.hierarchyLevel === undefined) continue;

      if (roleObj.hierarchyLevel >= bestLevel) continue;

      let org = null;
      let OrgModel = null;
      if (assignment.union) {
        org = assignment.union;
        OrgModel = Union;
      } else if (assignment.conference) {
        org = assignment.conference;
        OrgModel = Conference;
      } else if (assignment.church) {
        org = assignment.church;
        OrgModel = Church;
      }

      // Same resolution as getUserHierarchyPath: an ObjectId is not a string, so
      // the value has to be looked up unless it already carries the path.
      let orgObj = org;
      if (org && !org.hierarchyPath && OrgModel) {
        orgObj = await OrgModel.findById(org._id || org);
      }

      bestLevel = roleObj.hierarchyLevel;
      best = {
        level: roleObj.hierarchyLevel,
        path: orgObj?.hierarchyPath ?? null,
        role: roleObj,
      };
    }

    return best;
  }

  /**
   * Check whether a role grants a write action against an entity.
   *
   * Split by where the entity sits relative to the role:
   * - Below it — the role's own `canManage` list is the authority, which is what
   *   that field already documents ("canManage: [3, 4] // Teams and services only").
   * - At the same level — that entity is the role's own, and the subtree check in
   *   canUserManageEntity has already established it *is* theirs rather than a
   *   sibling's. Require a permission naming it, so read-only roles that sit at a
   *   level (church_viewer) cannot write to it.
   *
   * Never reached for an entity above the role: canLevelManageLevel rejects that.
   *
   * @param {Object} role - Role document (permissions: [String], canManage: [Number])
   * @param {Number} userLevel - The role's hierarchy level
   * @param {Number} targetLevel - Hierarchy level of the target entity
   * @param {String} action - Write action being performed
   * @returns {Boolean}
   */
  roleAllowsWrite(role, userLevel, targetLevel, action) {
    if (!role) return false;

    const permissions = Array.isArray(role.permissions) ? role.permissions : [];
    if (permissions.includes('*')) return true;

    if (targetLevel > userLevel) {
      return Array.isArray(role.canManage) && role.canManage.includes(targetLevel);
    }

    const entity = ENTITY_BY_LEVEL[targetLevel];
    if (!entity) return false;

    return permissions.some((permission) => {
      // Drop the scope suffix ('churches.update:own' -> 'churches.update'); the
      // level and subtree checks already constrain which entity this can be.
      const [name] = String(permission).split(':');
      const [resource, verb] = name.split('.');
      return resource === entity && (verb === action || verb === 'manage');
    });
  }

  /**
   * Check if user can manage a specific entity
   * @param {Object} user - User object
   * @param {String} targetEntityPath - Target entity hierarchy path
   * @param {String} action - Action being performed. Defaults to a write, so a
   *   caller that omits it is gated more tightly rather than less.
   * @returns {Promise<Boolean>} - True if user can manage entity
   */
  async canUserManageEntity(user, targetEntityPath, action = 'manage') {
    try {
      // 1. Get user's highest role level
      const userLevel = await this.getUserHighestLevel(user);

      if (userLevel === 0) {
        return true; // Super admin can manage everything
      }

      const assignment = await this.getUserHighestAssignment(user);
      const userPath = assignment?.path ?? (await this.getUserHierarchyPath(user));

      if (!userPath || !targetEntityPath) {
        return false;
      }

      // 2. Parse target entity level from path
      const targetLevel = this.parseHierarchyLevel(targetEntityPath);

      // 3. Check if user level can manage target level
      if (!this.canLevelManageLevel(userLevel, targetLevel)) {
        return false;
      }

      // 4. Check if target is the user's own entity or sits inside its subtree.
      // A bare startsWith is not enough: it treats 'u1/c1/ch10' as inside
      // 'u1/c1/ch1', so a sibling whose id merely begins with the user's would
      // pass. HierarchyValidator.isInSubtree requires the '/' boundary; the
      // equality check covers the entity itself, which it deliberately excludes.
      const isOwnEntity = targetEntityPath === userPath;
      if (!isOwnEntity && !HierarchyValidator.isInSubtree(targetEntityPath, userPath)) {
        return false;
      }

      // 5. Reading anywhere inside your own subtree is allowed; writing has to be
      // granted by the role. Without this the `action` argument every caller
      // passes was accepted and discarded, so read and write were the same check.
      if (!WRITE_ACTIONS.has(action)) {
        return true;
      }

      return this.roleAllowsWrite(
        assignment?.role,
        userLevel,
        targetLevel,
        action
      );
    } catch (error) {
      // console.error('Error in canUserManageEntity:', error);
      return false;
    }
  }

  /**
   * Can `user` create a child of `childLevel` directly under `parentEntityPath`?
   *
   * canUserManageEntity(user, parentPath, 'create') cannot answer this. It derives
   * the target entity type from the path it is given, so "create a team under this
   * church" was tested as "create a church": roleAllowsWrite looked up level 2,
   * resolved it to `churches`, and searched the role for `churches.create`. A church
   * admin holds `teams.create:own` and deliberately no `churches.create` — creating
   * a church is conference_admin's job — so creating a team inside their own church
   * was refused with "Insufficient permissions to create team in this church".
   *
   * The same shape denied a team leader creating a service in their own team, which
   * was checked as `teams.create` while the role grants `services.create:team`.
   *
   * The parent still has to sit in the user's subtree; only the level used for the
   * write decision changes, so this grants nothing that roleAllowsWrite would not
   * already grant for that child level.
   *
   * @param {Object} user - User object
   * @param {String} parentEntityPath - Hierarchy path of the parent to create under
   * @param {Number} childLevel - Hierarchy level of the entity being created
   * @returns {Promise<Boolean>}
   */
  async canUserCreateUnder(user, parentEntityPath, childLevel) {
    return this.canUserActOnChildLevel(
      user,
      parentEntityPath,
      childLevel,
      'create'
    );
  }

  /**
   * canUserCreateUnder generalised to any action.
   *
   * Same reasoning: the entity being acted on is a child of `parentEntityPath`,
   * so the write decision belongs to the child's level, not the parent's. Used
   * for services (level 4) hanging off a team, where asking about the team's own
   * level answers a different question than the one being posed.
   *
   * @param {Object} user - User object
   * @param {String} parentEntityPath - Hierarchy path of the parent
   * @param {Number} childLevel - Hierarchy level of the entity being acted on
   * @param {String} action - Action being performed
   * @returns {Promise<Boolean>}
   */
  async canUserActOnChildLevel(user, parentEntityPath, childLevel, action) {
    try {
      const userLevel = await this.getUserHighestLevel(user);

      if (userLevel === 0) {
        return true; // Super admin can act anywhere
      }

      const assignment = await this.getUserHighestAssignment(user);
      const userPath = assignment?.path ?? (await this.getUserHierarchyPath(user));

      if (!userPath || !parentEntityPath || typeof childLevel !== 'number') {
        return false;
      }

      // The child sits inside the parent, so the parent itself being the user's
      // own entity is the ordinary case — a church admin acting on a team in
      // exactly their own church.
      const isOwnEntity = parentEntityPath === userPath;
      if (
        !isOwnEntity &&
        !HierarchyValidator.isInSubtree(parentEntityPath, userPath)
      ) {
        return false;
      }

      if (!this.canLevelManageLevel(userLevel, childLevel)) {
        return false;
      }

      // Reading anywhere inside your own subtree is allowed; writing has to be
      // granted by the role. Same split as canUserManageEntity — without it a
      // read-only church_viewer, which sits at the same level as a church_admin,
      // would be handed write access to everything below its church.
      if (!WRITE_ACTIONS.has(action)) {
        return true;
      }

      return this.roleAllowsWrite(assignment?.role, userLevel, childLevel, action);
    } catch (error) {
      return false;
    }
  }

  /**
   * canUserManageEntity, for callers holding an id rather than a hierarchy path.
   *
   * canUserManageEntity compares hierarchy paths — it derives the target's level
   * by counting path segments and tests subtree membership by prefix. Handing it
   * a bare ObjectId silently fails both: a value with no '/' parses as level 0,
   * and it can never be a prefix of the user's path, so the call returns false
   * for everyone except super admin (who short-circuits earlier). That reads as
   * "permission denied" rather than as the bug it is, which is why it survived.
   *
   * Resolving the entity here keeps callers from each repeating the lookup.
   *
   * @param {Object} user - User object
   * @param {String} entityType - 'union' | 'conference' | 'church' | 'team' | 'service'
   * @param {String|ObjectId} entityId - Id of the target entity
   * @param {String} action - Action being performed
   * @returns {Promise<Boolean>}
   */
  async canUserManageEntityById(user, entityType, entityId, action) {
    if (!entityId) return false;

    const entity = await this.getEntity(entityType, entityId);
    if (!entity || !entity.hierarchyPath) return false;

    return this.canUserManageEntity(user, entity.hierarchyPath, action);
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
      // console.error('Error in getAccessibleEntities:', error);
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
        return Service.find({ status: { $ne: 'archived' } }).populate(
          'teamId churchId'
        );
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
      hierarchyPath: { $regex: `^${hierarchyPath}` },
    };

    switch (entityType.toLowerCase()) {
      case 'union':
      case 'unions':
        return Union.find({ ...query, isActive: true });
      case 'conference':
      case 'conferences':
        return Conference.find({ ...query, isActive: true }).populate(
          'unionId',
          'name'
        );
      case 'church':
      case 'churches':
        return Church.find({ ...query, isActive: true }).populate(
          'conferenceId',
          'name'
        );
      case 'team':
      case 'teams':
        return Team.find({ ...query, isActive: true }).populate(
          'churchId',
          'name'
        );
      case 'service':
      case 'services':
        return Service.find({ ...query, status: { $ne: 'archived' } }).populate(
          'teamId churchId'
        );
      // Legacy support
      case 'organization':
      case 'organizations':
        return Church.find({ ...query, isActive: true }).populate(
          'conferenceId',
          'name'
        );
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

    // Levels: union=0, conference=1, church=2, team=3, service=4
    //
    // Organisation depth and entity type must be tracked separately. Previously
    // both shared one counter and the result was clamped with
    // `Math.min(level - 1, 2)`, which discarded the team=3 / service=4 values
    // the loop had just determined - so this could never return anything above
    // 2. A church admin (level 2) asked to manage a team therefore had it read
    // back as a church, and was refused management of teams and services inside
    // their own church by the level comparison that followed.
    let orgDepth = 0;
    let entityLevel = null;

    for (const segment of segments) {
      if (segment.startsWith('team_')) {
        entityLevel = 3;
      } else if (segment.startsWith('service_')) {
        entityLevel = 4;
      } else {
        // Organization IDs
        orgDepth++;
      }
    }

    if (entityLevel !== null) {
      return entityLevel;
    }

    return Math.min(orgDepth - 1, 2); // Organizations max at level 2 (church)
  }

  /**
   * Check if manager level can manage target level
   * @param {Number} managerLevel - Manager's hierarchy level
   * @param {Number} targetLevel - Target's hierarchy level
   * @returns {Boolean} - True if can manage
   */
  canLevelManageLevel(managerLevel, targetLevel) {
    // <=, not <: a role also acts on the entity at its own level — the church a
    // church_admin administers, the conference a conference_admin administers.
    // Strict < denied that, so conference_admin was refused its own conference
    // despite the role granting 'conferences.update:own'.
    //
    // This does not widen access to siblings: canUserManageEntity still requires
    // the target to sit inside the user's own subtree, and same-level writes
    // additionally need an explicit grant (see roleAllowsWrite). Both matter —
    // church_viewer also sits at level 2, and on this check alone would gain
    // write access to the church it can only read.
    return managerLevel <= targetLevel; // Higher levels (lower numbers) manage lower levels
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

        // Same defect as getUserHierarchyPath: an ObjectId is not a string, so
        // the lookup was skipped and callers received a bare ref instead of a
        // Church document. Resolve unless it is already populated.
        let churchObj = churchId;
        if (churchId && !churchId.hierarchyPath) {
          churchObj = await Church.findById(churchId._id || churchId);
        }

        return churchObj;
      }

      return null;
    } catch (error) {
      // console.error('Error in getUserChurch:', error);
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
      // console.error(`Error getting ${entityType}:`, error);
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
      // console.error('Error in canUserCreateEntity:', error);
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
      union: -1, // Only super admin can create unions
      conference: 0, // Union can create conferences
      church: 1, // Conference can create churches
      team: 2, // Church can create teams
      service: 3, // Team can create services
      // Legacy support
      organization: 1, // Treated as church creation
    };

    // `?? 4`, not `|| 4`: conference is 0, which is falsy, so `||` replaced it
    // with 4 and reported conferences as creatable by anyone above level 4 —
    // every role. A church_admin could create a conference two levels above
    // itself. Only an unknown entityType should fall through to 4.
    return creationLevels[entityType.toLowerCase()] ?? 4;
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
        ...(user.churchAssignments || []),
      ];

      for (const orgAssignment of allAssignments) {
        const rolePermissions = await this.getRolePermissions(
          orgAssignment.role,
          userLevel,
          userPath
        );
        rolePermissions.forEach((perm) => permissions.add(perm));
      }

      // Add level-based implicit permissions
      const implicitPermissions = this.getImplicitPermissions(userLevel);
      implicitPermissions.forEach((perm) => permissions.add(perm));

      return this.setCachedData(cacheKey, Array.from(permissions));
    } catch (error) {
      // console.error('Error getting inherited permissions:', error);
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
  async getRolePermissions(role, userLevel) {
    let roleObj = role;
    if (typeof role === 'string') {
      roleObj = await Role.findById(role).populate('permissions');
    } else if (!role.permissions || !role.permissions[0]?.name) {
      roleObj = await Role.findById(role._id).populate('permissions');
    }

    if (!roleObj) return [];

    const permissions = new Set();

    // Add base role permissions
    roleObj.permissions?.forEach((perm) => {
      if (typeof perm === 'object' && perm.name) {
        permissions.add(perm.name);
      }
    });

    // Add hierarchy-scoped permissions based on role level
    if (roleObj.canManage && Array.isArray(roleObj.canManage)) {
      roleObj.canManage.forEach((managedLevel) => {
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
        implicitPerms.push('services.view:own');
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
      // console.error('Error checking permission with scope:', error);
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

      case 'own': {
        if (!userPath || !targetPath) return false;
        // Target must be directly under user's path
        const targetParent = HierarchyValidator.getParentPath(targetPath);
        return targetParent === userPath;
      }

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
      ...(user.churchAssignments || []),
    ];

    // Get managed levels from roles
    for (const orgAssignment of allAssignments) {
      const role = orgAssignment.role;
      let roleObj = role;

      if (typeof role === 'string' || !role.canManage) {
        roleObj = await Role.findById(role._id || role);
      }

      if (roleObj && roleObj.canManage) {
        roleObj.canManage.forEach((level) => {
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
      timestamp: Date.now(),
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
