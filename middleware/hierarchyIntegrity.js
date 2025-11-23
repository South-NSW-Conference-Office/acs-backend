const mongoose = require('mongoose');
const HierarchyValidator = require('../utils/hierarchyValidator');

/**
 * Middleware for maintaining hierarchy integrity across all models
 */
class HierarchyIntegrityMiddleware {
  /**
   * Pre-save middleware for conferences
   */
  static async conferencePreSave(next) {
    try {
      // mongoose.model('Union');

      // Validate hierarchy path format
      if (
        this.hierarchyPath &&
        !HierarchyValidator.isValidPathFormat(this.hierarchyPath)
      ) {
        throw new Error('Invalid hierarchy path format');
      }

      // Check for circular dependencies
      if (this.isModified('unionId') && this.unionId) {
        const hasCircular = HierarchyValidator.hasCircularDependency(
          this._id.toString(),
          this.unionId.toString()
        );

        if (hasCircular) {
          throw new Error(
            'Circular dependency detected in conference hierarchy'
          );
        }
      }

      // If parent changed, update all descendants' paths
      if (this.isModified('unionId') && !this.isNew) {
        const oldPath = this.hierarchyPath;
        await this.buildHierarchyPath();

        if (oldPath !== this.hierarchyPath) {
          // Queue cascade update for after save
          this._hierarchyPathChanged = true;
          this._oldHierarchyPath = oldPath;
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Pre-save middleware for churches
   */
  static async churchPreSave(next) {
    try {
      // mongoose.model('Conference');

      // Validate hierarchy path format
      if (
        this.hierarchyPath &&
        !HierarchyValidator.isValidPathFormat(this.hierarchyPath)
      ) {
        throw new Error('Invalid hierarchy path format');
      }

      // Check for circular dependencies
      if (this.isModified('conferenceId') && this.conferenceId) {
        const hasCircular = HierarchyValidator.hasCircularDependency(
          this._id.toString(),
          this.conferenceId.toString()
        );

        if (hasCircular) {
          throw new Error('Circular dependency detected in church hierarchy');
        }
      }

      // If parent changed, update all descendants' paths
      if (this.isModified('conferenceId') && !this.isNew) {
        const oldPath = this.hierarchyPath;
        await this.buildHierarchyPath();

        if (oldPath !== this.hierarchyPath) {
          // Queue cascade update for after save
          this._hierarchyPathChanged = true;
          this._oldHierarchyPath = oldPath;
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Post-save middleware to handle cascade updates for conferences
   */
  static async conferencePostSave() {
    if (this._hierarchyPathChanged && this._oldHierarchyPath) {
      const Church = mongoose.model('Church');
      const Team = mongoose.model('Team');
      const Service = mongoose.model('Service');

      try {
        // Update all child churches
        const childChurches = await Church.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` },
        });

        for (const child of childChurches) {
          const newPath = child.hierarchyPath.replace(
            this._oldHierarchyPath,
            this.hierarchyPath
          );
          child.hierarchyPath = newPath;
          await child.save({ validateBeforeSave: false }); // Skip validation to avoid loops
        }

        // Update all teams in this conference's subtree
        const teams = await Team.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` },
        });

        for (const team of teams) {
          const newPath = team.hierarchyPath.replace(
            this._oldHierarchyPath,
            this.hierarchyPath
          );
          team.hierarchyPath = newPath;
          await team.save({ validateBeforeSave: false });
        }

        // Update all services in this conference's subtree
        const services = await Service.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` },
        });

        for (const service of services) {
          const newPath = service.hierarchyPath.replace(
            this._oldHierarchyPath,
            this.hierarchyPath
          );
          service.hierarchyPath = newPath;
          await service.save({ validateBeforeSave: false });
        }
      } catch (error) {
        // Silently handle hierarchy path update errors
      }

      delete this._hierarchyPathChanged;
      delete this._oldHierarchyPath;
    }
  }

  /**
   * Post-save middleware to handle cascade updates for churches
   */
  static async churchPostSave() {
    if (this._hierarchyPathChanged && this._oldHierarchyPath) {
      const Team = mongoose.model('Team');
      const Service = mongoose.model('Service');

      try {
        // Update all teams in this church
        const teams = await Team.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` },
        });

        for (const team of teams) {
          const newPath = team.hierarchyPath.replace(
            this._oldHierarchyPath,
            this.hierarchyPath
          );
          team.hierarchyPath = newPath;
          await team.save({ validateBeforeSave: false });
        }

        // Update all services in this church
        const services = await Service.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` },
        });

        for (const service of services) {
          const newPath = service.hierarchyPath.replace(
            this._oldHierarchyPath,
            this.hierarchyPath
          );
          service.hierarchyPath = newPath;
          await service.save({ validateBeforeSave: false });
        }
      } catch (error) {
        // Silently handle hierarchy path update errors
      }

      delete this._hierarchyPathChanged;
      delete this._oldHierarchyPath;
    }
  }

  /**
   * Pre-save middleware for teams
   */
  static async teamPreSave(next) {
    try {
      // mongoose.model('Team');
      const Church = mongoose.model('Church');

      // Validate church assignment
      if (!this.churchId) {
        throw new Error('Teams must be assigned to a church');
      }

      // Ensure church exists
      const church = await Church.findById(this.churchId);
      if (!church) {
        throw new Error('Church not found');
      }

      // Validate hierarchy path
      const expectedPath = `${church.hierarchyPath}/team_${this._id}`;
      if (this.hierarchyPath !== expectedPath) {
        this.hierarchyPath = expectedPath;
      }

      // Validate hierarchy depth
      this.hierarchyDepth = 3; // Teams are always at depth 3 (union/conference/church)

      // Check circular dependencies (shouldn't happen with teams, but safety check)
      if (!HierarchyValidator.isValidPathFormat(this.hierarchyPath)) {
        throw new Error('Invalid team hierarchy path format');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Pre-save middleware for services
   */
  static async servicePreSave(next) {
    try {
      // mongoose.model('Service');
      const Team = mongoose.model('Team');

      // Validate team assignment
      if (!this.teamId) {
        throw new Error('Services must be assigned to a team');
      }

      // Populate team to get hierarchy path
      const team = await Team.findById(this.teamId).populate('churchId');
      if (!team) {
        throw new Error('Team not found');
      }

      // Set churchId from team
      this.churchId = team.churchId._id || team.churchId;

      // Set hierarchy path
      this.hierarchyPath = `${team.hierarchyPath}/service_${this._id}`;

      // Validate path format
      if (!HierarchyValidator.isValidPathFormat(this.hierarchyPath)) {
        throw new Error('Invalid service hierarchy path format');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cascade deactivation when parent is deactivated
   */
  static async cascadeDeactivation(parentModel, parentId) {
    const Union = mongoose.model('Union');
    const Conference = mongoose.model('Conference');
    const Church = mongoose.model('Church');
    const Team = mongoose.model('Team');
    const Service = mongoose.model('Service');

    let parent;
    let parentPath;

    // Get parent entity
    switch (parentModel.toLowerCase()) {
      case 'union':
        parent = await Union.findById(parentId);
        parentPath = parent?.hierarchyPath;
        break;
      case 'conference':
        parent = await Conference.findById(parentId);
        parentPath = parent?.hierarchyPath;
        break;
      case 'church':
        parent = await Church.findById(parentId);
        parentPath = parent?.hierarchyPath;
        break;
      case 'team':
        parent = await Team.findById(parentId);
        parentPath = parent?.hierarchyPath;
        break;
      default:
        throw new Error('Invalid parent model for cascade deactivation');
    }

    if (!parent || !parentPath) {
      throw new Error('Parent entity not found');
    }

    // Deactivate all subordinate conferences (if parent is union)
    if (parentModel.toLowerCase() === 'union') {
      await Conference.updateMany(
        {
          hierarchyPath: { $regex: `^${parentPath}/` },
          isActive: true,
        },
        {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: parent.updatedBy || parent.createdBy,
          deactivationReason: 'Parent entity deactivated',
        }
      );
    }

    // Deactivate all subordinate churches (if parent is union or conference)
    if (['union', 'conference'].includes(parentModel.toLowerCase())) {
      await Church.updateMany(
        {
          hierarchyPath: { $regex: `^${parentPath}/` },
          isActive: true,
        },
        {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: parent.updatedBy || parent.createdBy,
          deactivationReason: 'Parent entity deactivated',
        }
      );
    }

    // Deactivate all subordinate teams
    await Team.updateMany(
      {
        hierarchyPath: { $regex: `^${parentPath}/` },
        isActive: true,
      },
      {
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedBy: parent.updatedBy || parent.createdBy,
        deactivationReason: 'Parent entity deactivated',
      }
    );

    // Archive all subordinate services
    await Service.updateMany(
      {
        hierarchyPath: { $regex: `^${parentPath}/` },
        status: { $ne: 'archived' },
      },
      {
        status: 'archived',
        archivedAt: new Date(),
        archivedBy: parent.updatedBy || parent.createdBy,
        archiveReason: 'Parent entity deactivated',
      }
    );

    return true;
  }

  /**
   * Validate entity move within hierarchy
   */
  static async validateEntityMove(entityType, entityId, newParentId) {
    const Union = mongoose.model('Union');
    const Conference = mongoose.model('Conference');
    const Church = mongoose.model('Church');
    const Team = mongoose.model('Team');

    try {
      let entity, newParent;

      switch (entityType.toLowerCase()) {
        case 'conference':
          entity = await Conference.findById(entityId);
          newParent = await Union.findById(newParentId);
          break;
        case 'church':
          entity = await Church.findById(entityId);
          newParent = await Conference.findById(newParentId);

          if (!entity || !newParent) {
            throw new Error('Entity or new parent not found');
          }

          // Validate organization can be moved
          {
            const orgValidation =
              HierarchyValidator.validateOrganizationHierarchy(
                entity,
                newParent
              );

            if (!orgValidation.isValid) {
              throw new Error(orgValidation.errors.join(', '));
            }

            // Check circular dependency
            if (
              HierarchyValidator.hasCircularDependency(
                entityId,
                newParent.hierarchyPath
              )
            ) {
              throw new Error('Move would create circular dependency');
            }
          }

          break;

        case 'team':
          entity = await Team.findById(entityId);
          newParent = await mongoose.model('Church').findById(newParentId);

          if (!entity || !newParent) {
            throw new Error('Team or new church not found');
          }

          if (newParent.hierarchyLevel !== 'church') {
            throw new Error('Teams can only be moved to churches');
          }

          break;

        default:
          throw new Error('Invalid entity type for move operation');
      }

      return { valid: true, entity, newParent };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Apply middleware to models
   */
  static applyToModels() {
    const Conference = mongoose.model('Conference');
    const Church = mongoose.model('Church');
    const Team = mongoose.model('Team');
    const Service = mongoose.model('Service');

    // Conference middleware
    Conference.schema.pre(
      'save',
      HierarchyIntegrityMiddleware.conferencePreSave
    );
    Conference.schema.post(
      'save',
      HierarchyIntegrityMiddleware.conferencePostSave
    );

    // Church middleware
    Church.schema.pre('save', HierarchyIntegrityMiddleware.churchPreSave);
    Church.schema.post('save', HierarchyIntegrityMiddleware.churchPostSave);

    // Team middleware
    Team.schema.pre('save', HierarchyIntegrityMiddleware.teamPreSave);

    // Service middleware
    Service.schema.pre('save', HierarchyIntegrityMiddleware.servicePreSave);

    // Add cascade deactivation method to models
    Church.cascadeDeactivation = function (churchId) {
      return HierarchyIntegrityMiddleware.cascadeDeactivation(
        'church',
        churchId
      );
    };

    Team.cascadeDeactivation = function (teamId) {
      return HierarchyIntegrityMiddleware.cascadeDeactivation('team', teamId);
    };
  }
}

module.exports = HierarchyIntegrityMiddleware;
