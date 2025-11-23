const mongoose = require('mongoose');
const HierarchyValidator = require('../utils/hierarchyValidator');

/**
 * Service for bulk hierarchy updates and migrations
 */
class HierarchyMigrationService {
  constructor() {
    // this.Organization = mongoose.model('Organization'); // REMOVED - Using hierarchical models
    this.Union = mongoose.model('Union');
    this.Conference = mongoose.model('Conference');
    this.Church = mongoose.model('Church');
    this.Team = mongoose.model('Team');
    this.Service = mongoose.model('Service');
    this.User = mongoose.model('User');
  }

  /**
   * Rebuild all hierarchy paths in the system
   * Useful after major structural changes or data corruption
   */
  async rebuildAllHierarchyPaths(options = {}) {
    const { dryRun = false, verbose = true } = options;
    const results = {
      processed: 0,
      updated: 0,
      errors: [],
      changes: []
    };

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Step 1: Rebuild hierarchical paths (top-down)
      if (verbose) console.log('Rebuilding hierarchy paths...');
      
      // Start with unions
      const unions = await this.Union.find({}).session(session);
      
      for (const union of unions) {
        const oldPath = union.hierarchyPath;
        union.hierarchyPath = union._id.toString();
        
        if (oldPath !== union.hierarchyPath) {
          results.changes.push({
            type: 'union',
            id: union._id,
            oldPath,
            newPath: union.hierarchyPath
          });
          
          if (!dryRun) {
            await union.save({ session, validateBeforeSave: false });
          }
          results.updated++;
        }
        results.processed++;
      }
      
      // Then conferences
      const conferences = await this.Conference.find({}).populate('unionId').session(session);
      
      for (const conf of conferences) {
        if (!conf.unionId) {
          results.errors.push({
            type: 'conference',
            id: conf._id,
            error: 'Conference missing parent union'
          });
          continue;
        }
        
        const oldPath = conf.hierarchyPath;
        const expectedPath = `${conf.unionId.hierarchyPath || conf.unionId._id}/${conf._id}`;
        
        if (oldPath !== expectedPath) {
          conf.hierarchyPath = expectedPath;
          results.changes.push({
            type: 'conference',
            id: conf._id,
            oldPath,
            newPath: conf.hierarchyPath
          });
          
          if (!dryRun) {
            await conf.save({ session, validateBeforeSave: false });
          }
          results.updated++;
        }
        results.processed++;
      }
      
      // Finally churches
      const churches = await this.Church.find({}).populate('conferenceId').session(session);
      
      for (const church of churches) {
        if (!church.conferenceId) {
          results.errors.push({
            type: 'church',
            id: church._id,
            error: 'Church missing parent conference'
          });
          continue;
        }
        
        const parent = await this.Conference.findById(church.conferenceId._id).session(session);
        const oldPath = church.hierarchyPath;
        const expectedPath = `${parent.hierarchyPath}/${church._id}`;
        
        if (oldPath !== expectedPath) {
          church.hierarchyPath = expectedPath;
          results.changes.push({
            type: 'church',
            id: church._id,
            oldPath,
            newPath: church.hierarchyPath
          });
          
          if (!dryRun) {
            await church.save({ session, validateBeforeSave: false });
          }
          results.updated++;
        }
        results.processed++;
      }
      
      // Step 2: Rebuild team paths
      if (verbose) console.log('Rebuilding team hierarchy paths...');
      
      const teams = await this.Team.find({}).populate('churchId').session(session);
      
      for (const team of teams) {
        if (!team.churchId) {
          results.errors.push({
            type: 'team',
            id: team._id,
            error: 'Team missing church assignment'
          });
          continue;
        }
        
        const oldPath = team.hierarchyPath;
        const expectedPath = `${team.churchId.hierarchyPath}/team_${team._id}`;
        
        if (oldPath !== expectedPath) {
          team.hierarchyPath = expectedPath;
          team.hierarchyDepth = 3;
          results.changes.push({
            type: 'team',
            id: team._id,
            oldPath,
            newPath: team.hierarchyPath
          });
          
          if (!dryRun) {
            await team.save({ session, validateBeforeSave: false });
          }
          results.updated++;
        }
        results.processed++;
      }
      
      // Step 3: Rebuild service paths
      if (verbose) console.log('Rebuilding service hierarchy paths...');
      
      const services = await this.Service.find({}).populate('teamId').session(session);
      
      for (const service of services) {
        if (!service.teamId) {
          results.errors.push({
            type: 'service',
            id: service._id,
            error: 'Service missing team assignment'
          });
          continue;
        }
        
        const team = await this.Team.findById(service.teamId._id).session(session);
        const oldPath = service.hierarchyPath;
        const expectedPath = `${team.hierarchyPath}/service_${service._id}`;
        
        if (oldPath !== expectedPath) {
          service.hierarchyPath = expectedPath;
          results.changes.push({
            type: 'service',
            id: service._id,
            oldPath,
            newPath: service.hierarchyPath
          });
          
          if (!dryRun) {
            await service.save({ session, validateBeforeSave: false });
          }
          results.updated++;
        }
        results.processed++;
      }
      
      if (!dryRun) {
        await session.commitTransaction();
        if (verbose) console.log('Hierarchy paths rebuilt successfully');
      } else {
        await session.abortTransaction();
        if (verbose) console.log('Dry run completed - no changes made');
      }
      
      return results;
      
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Move an entity to a new parent
   */
  async moveEntity(entityType, entityId, newParentId, options = {}) {
    const { userId, reason = 'Administrative move' } = options;
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      let entity, newParent, oldPath;
      const affectedPaths = [];
      
      switch (entityType.toLowerCase()) {
        case 'organization':
          entity = await this.Organization.findById(entityId).session(session);
          newParent = await this.Organization.findById(newParentId).session(session);
          
          if (!entity || !newParent) {
            throw new Error('Entity or new parent not found');
          }
          
          // Validate the move
          const validation = HierarchyValidator.validateOrganizationHierarchy(entity, newParent);
          if (!validation.isValid) {
            throw new Error(validation.errors.join(', '));
          }
          
          // Check circular dependency
          if (HierarchyValidator.hasCircularDependency(entityId, newParent.hierarchyPath)) {
            throw new Error('Move would create circular dependency');
          }
          
          oldPath = entity.hierarchyPath;
          entity.parentOrganization = newParentId;
          await entity.buildHierarchyPath();
          await entity.save({ session });
          
          // Update all descendants
          affectedPaths.push({
            oldPath,
            newPath: entity.hierarchyPath,
            type: 'organization'
          });
          
          break;
          
        case 'team':
          entity = await this.Team.findById(entityId).session(session);
          newParent = await this.Organization.findById(newParentId).session(session);
          
          if (!entity || !newParent) {
            throw new Error('Team or new church not found');
          }
          
          if (newParent.hierarchyLevel !== 'church') {
            throw new Error('Teams can only be moved to churches');
          }
          
          oldPath = entity.hierarchyPath;
          entity.churchId = newParentId;
          entity.hierarchyPath = `${newParent.hierarchyPath}/team_${entity._id}`;
          await entity.save({ session });
          
          // Update all services under this team
          affectedPaths.push({
            oldPath,
            newPath: entity.hierarchyPath,
            type: 'team'
          });
          
          break;
          
        default:
          throw new Error('Invalid entity type for move operation');
      }
      
      // Update all affected paths
      for (const pathUpdate of affectedPaths) {
        await this._updateDescendantPaths(pathUpdate, session);
      }
      
      // Create audit log entry
      if (userId) {
        await this._createAuditLog({
          action: 'hierarchy.move',
          userId,
          targetType: entityType,
          targetId: entityId,
          changes: {
            oldParent: entity.parentOrganization || entity.churchId,
            newParent: newParentId,
            oldPath,
            newPath: entity.hierarchyPath
          },
          reason
        }, session);
      }
      
      await session.commitTransaction();
      
      return {
        success: true,
        entity,
        oldPath,
        newPath: entity.hierarchyPath
      };
      
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Batch update hierarchy paths
   */
  async batchUpdatePaths(updates, options = {}) {
    const { userId, reason = 'Batch hierarchy update' } = options;
    const results = {
      successful: 0,
      failed: 0,
      errors: []
    };
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      for (const update of updates) {
        try {
          await this.moveEntity(
            update.entityType,
            update.entityId,
            update.newParentId,
            { userId, reason, session }
          );
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            entityId: update.entityId,
            error: error.message
          });
        }
      }
      
      if (results.failed === 0) {
        await session.commitTransaction();
      } else {
        await session.abortTransaction();
        throw new Error(`Batch update failed: ${results.failed} errors`);
      }
      
      return results;
      
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Validate hierarchy integrity
   */
  async validateHierarchyIntegrity() {
    const issues = {
      orphanedEntities: [],
      circularDependencies: [],
      invalidPaths: [],
      depthMismatches: [],
      missingParents: []
    };
    
    // Check organizations
    const organizations = await this.Organization.find({});
    
    for (const org of organizations) {
      // Check path format
      if (!HierarchyValidator.isValidPathFormat(org.hierarchyPath)) {
        issues.invalidPaths.push({
          type: 'organization',
          id: org._id,
          path: org.hierarchyPath
        });
      }
      
      // Check depth matches level
      const expectedDepth = { 'union': 0, 'conference': 1, 'church': 2 }[org.hierarchyLevel];
      if (org.hierarchyDepth !== expectedDepth) {
        issues.depthMismatches.push({
          type: 'organization',
          id: org._id,
          expected: expectedDepth,
          actual: org.hierarchyDepth
        });
      }
      
      // Check parent exists
      if (org.hierarchyLevel !== 'union' && !org.parentOrganization) {
        issues.missingParents.push({
          type: 'organization',
          id: org._id,
          level: org.hierarchyLevel
        });
      }
    }
    
    // Check teams
    const teams = await this.Team.find({});
    
    for (const team of teams) {
      if (!team.churchId) {
        issues.orphanedEntities.push({
          type: 'team',
          id: team._id,
          name: team.name
        });
      }
      
      if (!HierarchyValidator.isValidPathFormat(team.hierarchyPath)) {
        issues.invalidPaths.push({
          type: 'team',
          id: team._id,
          path: team.hierarchyPath
        });
      }
    }
    
    // Check services
    const services = await this.Service.find({});
    
    for (const service of services) {
      if (!service.teamId) {
        issues.orphanedEntities.push({
          type: 'service',
          id: service._id,
          name: service.name
        });
      }
      
      if (!HierarchyValidator.isValidPathFormat(service.hierarchyPath)) {
        issues.invalidPaths.push({
          type: 'service',
          id: service._id,
          path: service.hierarchyPath
        });
      }
    }
    
    return issues;
  }

  /**
   * Update descendant paths after a move
   */
  async _updateDescendantPaths(pathUpdate, session) {
    const { oldPath, newPath, type } = pathUpdate;
    
    // Update organizations
    if (type === 'organization') {
      await this.Organization.updateMany(
        { hierarchyPath: { $regex: `^${oldPath}/` } },
        [{ 
          $set: { 
            hierarchyPath: {
              $concat: [
                newPath,
                { $substr: ['$hierarchyPath', oldPath.length, -1] }
              ]
            }
          }
        }],
        { session }
      );
    }
    
    // Update teams
    await this.Team.updateMany(
      { hierarchyPath: { $regex: `^${oldPath}/` } },
      [{ 
        $set: { 
          hierarchyPath: {
            $concat: [
              newPath,
              { $substr: ['$hierarchyPath', oldPath.length, -1] }
            ]
          }
        }
      }],
      { session }
    );
    
    // Update services
    await this.Service.updateMany(
      { hierarchyPath: { $regex: `^${oldPath}/` } },
      [{ 
        $set: { 
          hierarchyPath: {
            $concat: [
              newPath,
              { $substr: ['$hierarchyPath', oldPath.length, -1] }
            ]
          }
        }
      }],
      { session }
    );
  }

  /**
   * Create audit log entry (placeholder - implement when AuditLog model exists)
   */
  async _createAuditLog(entry, session) {
    // TODO: Implement when AuditLog model is created
    console.log('Audit log entry:', entry);
  }
}

module.exports = new HierarchyMigrationService();