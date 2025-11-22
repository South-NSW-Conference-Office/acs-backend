const mongoose = require('mongoose');
const HierarchyValidator = require('../utils/hierarchyValidator');

/**
 * Middleware for maintaining hierarchy integrity across all models
 */
class HierarchyIntegrityMiddleware {
  /**
   * Pre-save middleware for organizations
   */
  static async organizationPreSave(next) {
    try {
      const Organization = mongoose.model('Organization');
      
      // Validate hierarchy path format
      if (this.hierarchyPath && !HierarchyValidator.isValidPathFormat(this.hierarchyPath)) {
        throw new Error('Invalid hierarchy path format');
      }
      
      // Check for circular dependencies
      if (this.isModified('parentOrganization') && this.parentOrganization) {
        const hasCircular = HierarchyValidator.hasCircularDependency(
          this._id.toString(),
          this.parentOrganization.toString()
        );
        
        if (hasCircular) {
          throw new Error('Circular dependency detected in organization hierarchy');
        }
      }
      
      // If parent changed, update all descendants' paths
      if (this.isModified('parentOrganization') && !this.isNew) {
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
   * Post-save middleware to handle cascade updates
   */
  static async organizationPostSave() {
    if (this._hierarchyPathChanged && this._oldHierarchyPath) {
      const Organization = mongoose.model('Organization');
      const Team = mongoose.model('Team');
      const Service = mongoose.model('Service');
      
      try {
        // Update all child organizations
        const childOrgs = await Organization.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` }
        });
        
        for (const child of childOrgs) {
          const newPath = child.hierarchyPath.replace(this._oldHierarchyPath, this.hierarchyPath);
          child.hierarchyPath = newPath;
          await child.save({ validateBeforeSave: false }); // Skip validation to avoid loops
        }
        
        // Update all teams in this organization's subtree
        const teams = await Team.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` }
        });
        
        for (const team of teams) {
          const newPath = team.hierarchyPath.replace(this._oldHierarchyPath, this.hierarchyPath);
          team.hierarchyPath = newPath;
          await team.save({ validateBeforeSave: false });
        }
        
        // Update all services in this organization's subtree
        const services = await Service.find({
          hierarchyPath: { $regex: `^${this._oldHierarchyPath}/` }
        });
        
        for (const service of services) {
          const newPath = service.hierarchyPath.replace(this._oldHierarchyPath, this.hierarchyPath);
          service.hierarchyPath = newPath;
          await service.save({ validateBeforeSave: false });
        }
        
      } catch (error) {
        console.error('Error updating hierarchy paths:', error);
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
      const Team = mongoose.model('Team');
      const Organization = mongoose.model('Organization');
      
      // Validate church assignment
      if (!this.churchId) {
        throw new Error('Teams must be assigned to a church');
      }
      
      // Ensure church exists and is actually a church
      const church = await Organization.findById(this.churchId);
      if (!church) {
        throw new Error('Church not found');
      }
      
      if (church.hierarchyLevel !== 'church') {
        throw new Error('Teams can only be assigned to churches');
      }
      
      // Validate hierarchy path
      const expectedPath = `${church.hierarchyPath}/team_${this._id}`;
      if (this.hierarchyPath !== expectedPath) {
        this.hierarchyPath = expectedPath;
      }
      
      // Validate hierarchy depth
      this.hierarchyDepth = 3; // Teams are always at depth 3
      
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
      const Service = mongoose.model('Service');
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
    const Organization = mongoose.model('Organization');
    const Team = mongoose.model('Team');
    const Service = mongoose.model('Service');
    
    try {
      let parent;
      let parentPath;
      
      // Get parent entity
      switch (parentModel.toLowerCase()) {
        case 'organization':
          parent = await Organization.findById(parentId);
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
      
      // Deactivate all subordinate organizations
      await Organization.updateMany(
        { 
          hierarchyPath: { $regex: `^${parentPath}/` },
          isActive: true
        },
        { 
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: parent.updatedBy || parent.createdBy,
          deactivationReason: 'Parent entity deactivated'
        }
      );
      
      // Deactivate all subordinate teams
      await Team.updateMany(
        { 
          hierarchyPath: { $regex: `^${parentPath}/` },
          isActive: true
        },
        { 
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: parent.updatedBy || parent.createdBy,
          deactivationReason: 'Parent entity deactivated'
        }
      );
      
      // Archive all subordinate services
      await Service.updateMany(
        { 
          hierarchyPath: { $regex: `^${parentPath}/` },
          status: { $ne: 'archived' }
        },
        { 
          status: 'archived',
          archivedAt: new Date(),
          archivedBy: parent.updatedBy || parent.createdBy,
          archiveReason: 'Parent entity deactivated'
        }
      );
      
      return true;
    } catch (error) {
      console.error('Error in cascade deactivation:', error);
      throw error;
    }
  }
  
  /**
   * Validate entity move within hierarchy
   */
  static async validateEntityMove(entityType, entityId, newParentId) {
    const Organization = mongoose.model('Organization');
    const Team = mongoose.model('Team');
    
    try {
      let entity, newParent;
      
      switch (entityType.toLowerCase()) {
        case 'organization':
          entity = await Organization.findById(entityId);
          newParent = await Organization.findById(newParentId);
          
          if (!entity || !newParent) {
            throw new Error('Entity or new parent not found');
          }
          
          // Validate organization can be moved
          const orgValidation = HierarchyValidator.validateOrganizationHierarchy(
            entity,
            newParent
          );
          
          if (!orgValidation.isValid) {
            throw new Error(orgValidation.errors.join(', '));
          }
          
          // Check circular dependency
          if (HierarchyValidator.hasCircularDependency(entityId, newParent.hierarchyPath)) {
            throw new Error('Move would create circular dependency');
          }
          
          break;
          
        case 'team':
          entity = await Team.findById(entityId);
          newParent = await Organization.findById(newParentId);
          
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
    const Organization = mongoose.model('Organization');
    const Team = mongoose.model('Team');
    const Service = mongoose.model('Service');
    
    // Organization middleware
    Organization.schema.pre('save', HierarchyIntegrityMiddleware.organizationPreSave);
    Organization.schema.post('save', HierarchyIntegrityMiddleware.organizationPostSave);
    
    // Team middleware
    Team.schema.pre('save', HierarchyIntegrityMiddleware.teamPreSave);
    
    // Service middleware
    Service.schema.pre('save', HierarchyIntegrityMiddleware.servicePreSave);
    
    // Add cascade deactivation method to models
    Organization.cascadeDeactivation = function(organizationId) {
      return HierarchyIntegrityMiddleware.cascadeDeactivation('organization', organizationId);
    };
    
    Team.cascadeDeactivation = function(teamId) {
      return HierarchyIntegrityMiddleware.cascadeDeactivation('team', teamId);
    };
  }
}

module.exports = HierarchyIntegrityMiddleware;