const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// Unit tests over the authorization predicates. No database: every user is built
// with its role already populated (carrying hierarchyLevel) and its org already
// carrying hierarchyPath, which is exactly the shape authenticateToken produces
// after its populate chain — so no lookup is attempted.

const PATHS = {
  union: 'u1',
  conference: 'u1/c1',
  church: 'u1/c1/ch1',
  otherChurch: 'u1/c1/ch2',
  team: 'u1/c1/ch1/team_t1',
  service: 'u1/c1/ch1/team_t1/service_s1',
  otherConference: 'u1/c2',
  otherChurchTeam: 'u1/c1/ch2/team_t9',
};

// Mirrors models/Role.js. Kept literal rather than imported so a change to the
// seed shows up here as a failing expectation instead of silently redefining
// what the tests assert.
const ROLES = {
  conference_admin: {
    name: 'conference_admin',
    hierarchyLevel: 1,
    canManage: [2, 3, 4],
    permissions: [
      'churches.create:subordinate',
      'churches.read:subordinate',
      'churches.update:subordinate',
      'churches.delete:subordinate',
      'conferences.read:own',
      'conferences.update:own',
      'teams.read:subordinate',
      'teams.manage:subordinate',
      'services.read:subordinate',
      'services.manage:subordinate',
    ],
  },
  church_admin: {
    name: 'church_admin',
    hierarchyLevel: 2,
    canManage: [3, 4],
    permissions: [
      'churches.read:own',
      'churches.update:own',
      'teams.create:own',
      'teams.read:own',
      'teams.update:own',
      'teams.delete:own',
      'services.read:own',
      'services.manage:own',
    ],
  },
  church_viewer: {
    name: 'church_viewer',
    hierarchyLevel: 2,
    canManage: [],
    permissions: ['services.read:public', 'stories.read:public'],
  },
};

function userWithChurchRole(role, churchPath = PATHS.church) {
  return {
    _id: 'user-1',
    churchAssignments: [
      { role, church: { _id: 'ch1', hierarchyPath: churchPath } },
    ],
  };
}

function userWithConferenceRole(role, conferencePath = PATHS.conference) {
  return {
    _id: 'user-2',
    conferenceAssignments: [
      { role, conference: { _id: 'c1', hierarchyPath: conferencePath } },
    ],
  };
}

describe('parseHierarchyLevel', () => {
  it('maps each path shape to its level', () => {
    const parse = (p) => hierarchicalAuthService.parseHierarchyLevel(p);
    expect(parse(PATHS.union)).toBe(0);
    expect(parse(PATHS.conference)).toBe(1);
    expect(parse(PATHS.church)).toBe(2);
    expect(parse(PATHS.team)).toBe(3);
    expect(parse(PATHS.service)).toBe(4);
  });
});

describe('canLevelManageLevel', () => {
  const can = (m, t) => hierarchicalAuthService.canLevelManageLevel(m, t);

  it('allows a level to act on its own entity', () => {
    // The regression: strict < returned false here, so a conference_admin was
    // refused its own conference and a church_admin its own church.
    expect(can(1, 1)).toBe(true);
    expect(can(2, 2)).toBe(true);
    expect(can(3, 3)).toBe(true);
  });

  it('allows acting on levels below', () => {
    expect(can(1, 2)).toBe(true);
    expect(can(2, 3)).toBe(true);
    expect(can(2, 4)).toBe(true);
  });

  it('refuses acting on levels above', () => {
    expect(can(2, 1)).toBe(false);
    expect(can(2, 0)).toBe(false);
    expect(can(4, 3)).toBe(false);
  });
});

describe('canUserManageEntity — church_admin', () => {
  const user = () => userWithChurchRole(ROLES.church_admin);

  it('updates its own church', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.church,
        'update'
      )
    ).resolves.toBe(true);
  });

  it('reads its own church', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(user(), PATHS.church, 'read')
    ).resolves.toBe(true);
  });

  it('does not delete its own church — that stays with conference_admin', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.church,
        'delete'
      )
    ).resolves.toBe(false);
  });

  it('manages teams and services inside its church', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(user(), PATHS.team, 'update')
    ).resolves.toBe(true);
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.service,
        'update'
      )
    ).resolves.toBe(true);
  });

  it('cannot touch a sibling church or anything inside it', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.otherChurch,
        'update'
      )
    ).resolves.toBe(false);
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.otherChurch,
        'read'
      )
    ).resolves.toBe(false);
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.otherChurchTeam,
        'update'
      )
    ).resolves.toBe(false);
  });

  it('cannot act on the conference or union above it', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.conference,
        'update'
      )
    ).resolves.toBe(false);
    await expect(
      hierarchicalAuthService.canUserManageEntity(user(), PATHS.union, 'update')
    ).resolves.toBe(false);
  });
});

describe('canUserManageEntity — conference_admin', () => {
  const user = () => userWithConferenceRole(ROLES.conference_admin);

  it('updates its own conference', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.conference,
        'update'
      )
    ).resolves.toBe(true);
  });

  it('manages churches beneath it', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.church,
        'update'
      )
    ).resolves.toBe(true);
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.church,
        'delete'
      )
    ).resolves.toBe(true);
  });

  it('cannot reach a sibling conference', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.otherConference,
        'update'
      )
    ).resolves.toBe(false);
  });

  it('cannot act on the union above it', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(user(), PATHS.union, 'update')
    ).resolves.toBe(false);
  });
});

describe('canUserManageEntity — church_viewer is read-only', () => {
  const user = () => userWithChurchRole(ROLES.church_viewer);

  it('reads within its church', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(user(), PATHS.church, 'read')
    ).resolves.toBe(true);
    await expect(
      hierarchicalAuthService.canUserManageEntity(user(), PATHS.team, 'read')
    ).resolves.toBe(true);
  });

  it('cannot write to its own church', async () => {
    // church_viewer sits at level 2 like church_admin, so relaxing
    // canLevelManageLevel to <= is what would hand it write access if the action
    // were still ignored.
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        user(),
        PATHS.church,
        'update'
      )
    ).resolves.toBe(false);
  });

  it('cannot write to teams or services, which sit below it', async () => {
    // canManage is [], and under the old code `2 < 3` alone granted this.
    for (const action of ['create', 'update', 'delete']) {
      await expect(
        hierarchicalAuthService.canUserManageEntity(user(), PATHS.team, action)
      ).resolves.toBe(false);
      await expect(
        hierarchicalAuthService.canUserManageEntity(
          user(),
          PATHS.service,
          action
        )
      ).resolves.toBe(false);
    }
  });
});

describe('canUserManageEntity — general', () => {
  it('lets a super admin through', async () => {
    const superAdmin = { _id: 'sa', isSuperAdmin: true };
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        superAdmin,
        PATHS.union,
        'delete'
      )
    ).resolves.toBe(true);
  });

  it('denies a user with no assignments', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        { _id: 'nobody' },
        PATHS.church,
        'read'
      )
    ).resolves.toBe(false);
  });

  it('denies when either the user or the target path is missing', async () => {
    await expect(
      hierarchicalAuthService.canUserManageEntity(null, PATHS.church, 'read')
    ).resolves.toBe(false);
    await expect(
      hierarchicalAuthService.canUserManageEntity(
        userWithChurchRole(ROLES.church_admin),
        null,
        'read'
      )
    ).resolves.toBe(false);
  });

  it('treats an omitted action as a write, not a read', async () => {
    // routes/teams.js DELETE /:teamId calls with no action argument. Defaulting
    // to a read there would leave a delete ungated.
    const viewer = userWithChurchRole(ROLES.church_viewer);
    await expect(
      hierarchicalAuthService.canUserManageEntity(viewer, PATHS.team)
    ).resolves.toBe(false);

    const admin = userWithChurchRole(ROLES.church_admin);
    await expect(
      hierarchicalAuthService.canUserManageEntity(admin, PATHS.team)
    ).resolves.toBe(true);
  });

  it('does not confuse a sibling whose id shares a prefix', async () => {
    const user = userWithChurchRole(ROLES.church_admin, 'u1/c1/ch1');
    await expect(
      hierarchicalAuthService.canUserManageEntity(user, 'u1/c1/ch10', 'update')
    ).resolves.toBe(false);
  });
});

describe('roleAllowsWrite', () => {
  const allows = (...args) => hierarchicalAuthService.roleAllowsWrite(...args);

  it('accepts `manage` as covering the other write verbs', () => {
    // church_admin holds 'services.manage:own' rather than 'services.update:own'.
    const role = {
      hierarchyLevel: 4,
      canManage: [],
      permissions: ['services.manage:own'],
    };
    expect(allows(role, 4, 4, 'update')).toBe(true);
    expect(allows(role, 4, 4, 'delete')).toBe(true);
  });

  it('accepts a wildcard', () => {
    expect(allows({ permissions: ['*'] }, 2, 2, 'delete')).toBe(true);
  });

  it('denies when the role is missing', () => {
    expect(allows(null, 2, 2, 'update')).toBe(false);
    expect(allows(undefined, 2, 2, 'update')).toBe(false);
  });

  it('ignores the scope suffix when matching the resource and verb', () => {
    const role = { permissions: ['churches.update:own'] };
    expect(allows(role, 2, 2, 'update')).toBe(true);
    expect(allows(role, 2, 2, 'create')).toBe(false);
  });

  it('uses canManage for levels below, not the permission list', () => {
    const role = { canManage: [3], permissions: [] };
    expect(allows(role, 2, 3, 'update')).toBe(true);
    expect(allows(role, 2, 4, 'update')).toBe(false);
  });
});
