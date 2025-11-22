const HierarchyValidator = require('../utils/hierarchyValidator');
const { expect } = require('chai');

describe('HierarchyValidator', () => {
  describe('isValidPathFormat', () => {
    it('should accept valid hierarchy paths', () => {
      expect(HierarchyValidator.isValidPathFormat('union123')).to.be.true;
      expect(HierarchyValidator.isValidPathFormat('union123/conf456')).to.be.true;
      expect(HierarchyValidator.isValidPathFormat('union123/conf456/church789')).to.be.true;
      expect(HierarchyValidator.isValidPathFormat('union_123/conf_456')).to.be.true;
    });

    it('should accept empty path for root entities', () => {
      expect(HierarchyValidator.isValidPathFormat('')).to.be.true;
    });

    it('should reject invalid paths', () => {
      expect(HierarchyValidator.isValidPathFormat(null)).to.be.false;
      expect(HierarchyValidator.isValidPathFormat(undefined)).to.be.false;
      expect(HierarchyValidator.isValidPathFormat('union 123')).to.be.false;
      expect(HierarchyValidator.isValidPathFormat('union/123/')).to.be.false;
      expect(HierarchyValidator.isValidPathFormat('/union123')).to.be.false;
      expect(HierarchyValidator.isValidPathFormat('union@123')).to.be.false;
    });
  });

  describe('parseHierarchyPath', () => {
    it('should parse valid paths into segments', () => {
      const segments = HierarchyValidator.parseHierarchyPath('union123/conf456/church789');
      expect(segments).to.have.lengthOf(3);
      expect(segments[0]).to.deep.equal({ id: 'union123', level: 1 });
      expect(segments[1]).to.deep.equal({ id: 'conf456', level: 2 });
      expect(segments[2]).to.deep.equal({ id: 'church789', level: 3 });
    });

    it('should return empty array for empty path', () => {
      expect(HierarchyValidator.parseHierarchyPath('')).to.deep.equal([]);
      expect(HierarchyValidator.parseHierarchyPath(null)).to.deep.equal([]);
    });
  });

  describe('getHierarchyDepth', () => {
    it('should calculate correct depth', () => {
      expect(HierarchyValidator.getHierarchyDepth('')).to.equal(0);
      expect(HierarchyValidator.getHierarchyDepth('union123')).to.equal(1);
      expect(HierarchyValidator.getHierarchyDepth('union123/conf456')).to.equal(2);
      expect(HierarchyValidator.getHierarchyDepth('union123/conf456/church789')).to.equal(3);
    });
  });

  describe('isValidParentChildRelation', () => {
    it('should validate correct parent-child relationships', () => {
      expect(HierarchyValidator.isValidParentChildRelation(1, 0)).to.be.true; // Union under Super Admin
      expect(HierarchyValidator.isValidParentChildRelation(2, 1)).to.be.true; // Church under Conference
      expect(HierarchyValidator.isValidParentChildRelation(3, 2)).to.be.true; // Team under Church
      expect(HierarchyValidator.isValidParentChildRelation(4, 3)).to.be.true; // Service under Team
    });

    it('should reject invalid relationships', () => {
      expect(HierarchyValidator.isValidParentChildRelation(2, 0)).to.be.false; // Church under Super Admin
      expect(HierarchyValidator.isValidParentChildRelation(3, 1)).to.be.false; // Team under Conference
      expect(HierarchyValidator.isValidParentChildRelation(1, 1)).to.be.false; // Same level
      expect(HierarchyValidator.isValidParentChildRelation(0, 1)).to.be.false; // Parent below child
    });
  });

  describe('buildHierarchyPath', () => {
    it('should build correct hierarchy paths', () => {
      expect(HierarchyValidator.buildHierarchyPath('', 'union123')).to.equal('union123');
      expect(HierarchyValidator.buildHierarchyPath('union123', 'conf456')).to.equal('union123/conf456');
      expect(HierarchyValidator.buildHierarchyPath('union123/conf456', 'church789')).to.equal('union123/conf456/church789');
    });

    it('should throw error for missing entity ID', () => {
      expect(() => HierarchyValidator.buildHierarchyPath('parent', '')).to.throw();
      expect(() => HierarchyValidator.buildHierarchyPath('parent', null)).to.throw();
    });
  });

  describe('validateEntityTransition', () => {
    it('should validate valid transitions', () => {
      const entity = { _id: 'church123', hierarchyLevel: 2, hierarchyPath: 'union1/conf2/church123' };
      const result = HierarchyValidator.validateEntityTransition(entity, 'union1/conf3', 2);
      expect(result.isValid).to.be.true;
      expect(result.errors).to.be.empty;
    });

    it('should reject level skipping', () => {
      const entity = { _id: 'church123', hierarchyLevel: 2 };
      const result = HierarchyValidator.validateEntityTransition(entity, 'union1', 0);
      expect(result.isValid).to.be.false;
      expect(result.errors).to.include('Cannot skip hierarchy levels during transition');
    });

    it('should detect circular dependencies', () => {
      const entity = { _id: 'conf456', hierarchyLevel: 1 };
      const result = HierarchyValidator.validateEntityTransition(entity, 'union1/conf456/church789', 3);
      expect(result.isValid).to.be.false;
      expect(result.errors).to.include('Circular dependency detected in hierarchy');
    });
  });

  describe('isInSubtree', () => {
    it('should correctly identify subtree relationships', () => {
      expect(HierarchyValidator.isInSubtree('union1/conf2/church3', 'union1')).to.be.true;
      expect(HierarchyValidator.isInSubtree('union1/conf2/church3', 'union1/conf2')).to.be.true;
      expect(HierarchyValidator.isInSubtree('union1/conf2/church3', 'union2')).to.be.false;
      expect(HierarchyValidator.isInSubtree('union1/conf2', 'union1/conf2/church3')).to.be.false;
    });

    it('should handle edge cases', () => {
      expect(HierarchyValidator.isInSubtree('', 'union1')).to.be.false;
      expect(HierarchyValidator.isInSubtree('union1', '')).to.be.false;
      expect(HierarchyValidator.isInSubtree(null, 'union1')).to.be.false;
    });
  });

  describe('getAncestorPaths', () => {
    it('should return all ancestor paths', () => {
      const ancestors = HierarchyValidator.getAncestorPaths('union1/conf2/church3/team4');
      expect(ancestors).to.deep.equal([
        'union1',
        'union1/conf2',
        'union1/conf2/church3',
        'union1/conf2/church3/team4'
      ]);
    });

    it('should handle single segment paths', () => {
      const ancestors = HierarchyValidator.getAncestorPaths('union1');
      expect(ancestors).to.deep.equal(['union1']);
    });

    it('should return empty array for empty path', () => {
      expect(HierarchyValidator.getAncestorPaths('')).to.deep.equal([]);
      expect(HierarchyValidator.getAncestorPaths(null)).to.deep.equal([]);
    });
  });

  describe('validateOrganizationHierarchy', () => {
    it('should validate valid organization hierarchies', () => {
      const unionResult = HierarchyValidator.validateOrganizationHierarchy({ hierarchyLevel: 'union' });
      expect(unionResult.isValid).to.be.true;

      const confResult = HierarchyValidator.validateOrganizationHierarchy(
        { hierarchyLevel: 'conference' },
        { hierarchyLevel: 'union' }
      );
      expect(confResult.isValid).to.be.true;

      const churchResult = HierarchyValidator.validateOrganizationHierarchy(
        { hierarchyLevel: 'church' },
        { hierarchyLevel: 'conference' }
      );
      expect(churchResult.isValid).to.be.true;
    });

    it('should reject invalid hierarchies', () => {
      const invalidLevel = HierarchyValidator.validateOrganizationHierarchy({ hierarchyLevel: 'invalid' });
      expect(invalidLevel.isValid).to.be.false;

      const churchWithChild = HierarchyValidator.validateOrganizationHierarchy(
        { hierarchyLevel: 'church' },
        { hierarchyLevel: 'church' }
      );
      expect(churchWithChild.isValid).to.be.false;
      expect(churchWithChild.errors).to.include('Churches cannot have child organizations');

      const skipLevel = HierarchyValidator.validateOrganizationHierarchy(
        { hierarchyLevel: 'church' },
        { hierarchyLevel: 'union' }
      );
      expect(skipLevel.isValid).to.be.false;
      expect(skipLevel.errors).to.include('Invalid parent-child hierarchy relationship');
    });
  });

  describe('validateTeamHierarchy', () => {
    it('should validate valid team hierarchies', () => {
      const result = HierarchyValidator.validateTeamHierarchy(
        { hierarchyDepth: 3 },
        'church123'
      );
      expect(result.isValid).to.be.true;
    });

    it('should reject teams without churches', () => {
      const result = HierarchyValidator.validateTeamHierarchy({}, null);
      expect(result.isValid).to.be.false;
      expect(result.errors).to.include('Teams must belong to a church');
    });

    it('should reject teams at wrong depth', () => {
      const result = HierarchyValidator.validateTeamHierarchy(
        { hierarchyDepth: 2 },
        'church123'
      );
      expect(result.isValid).to.be.false;
      expect(result.errors).to.include('Teams must be at hierarchy depth 3');
    });
  });

  describe('validateServiceHierarchy', () => {
    it('should validate valid service hierarchies', () => {
      const result = HierarchyValidator.validateServiceHierarchy(
        { hierarchyDepth: 4 },
        'team123'
      );
      expect(result.isValid).to.be.true;
    });

    it('should reject services without teams', () => {
      const result = HierarchyValidator.validateServiceHierarchy({}, null);
      expect(result.isValid).to.be.false;
      expect(result.errors).to.include('Services must belong to a team');
    });

    it('should reject services at wrong depth', () => {
      const result = HierarchyValidator.validateServiceHierarchy(
        { hierarchyDepth: 3 },
        'team123'
      );
      expect(result.isValid).to.be.false;
      expect(result.errors).to.include('Services must be at hierarchy depth 4');
    });
  });

  describe('hasCircularDependency', () => {
    it('should detect simple circular dependencies', () => {
      expect(HierarchyValidator.hasCircularDependency('conf456', 'union1/conf456')).to.be.true;
      expect(HierarchyValidator.hasCircularDependency('church789', 'union1/conf2/church789/team1')).to.be.true;
    });

    it('should detect deep circular dependencies with entity list', () => {
      const entities = [
        { _id: 'conf456', hierarchyPath: 'union1/conf456' },
        { _id: 'church789', hierarchyPath: 'union1/conf456/church789' }
      ];
      
      expect(HierarchyValidator.hasCircularDependency('conf456', 'union1/conf456/church789', entities)).to.be.true;
    });

    it('should not flag valid hierarchies as circular', () => {
      expect(HierarchyValidator.hasCircularDependency('church789', 'union1/conf456')).to.be.false;
      expect(HierarchyValidator.hasCircularDependency('team123', 'union1/conf456/church789')).to.be.false;
    });

    it('should handle edge cases', () => {
      expect(HierarchyValidator.hasCircularDependency('entity1', '')).to.be.false;
      expect(HierarchyValidator.hasCircularDependency('entity1', null)).to.be.false;
    });
  });
});