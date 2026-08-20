const hierarchicalAuthService = require('../services/hierarchicalAuthService');
const { checkPermission } = require('../middleware/auth');

// A capability matrix over the real authorization code: every role that is meant
// to administer anything, against the actions people actually reported being
// unable to do — add a service, add images, edit.
//
// The point is coverage, not any single case. Six separate faults this week each
// blocked one role on one action while leaving the others working, and each was
// found only when somebody hit it by hand. This pins all of them at once, so a
// change that quietly re-breaks one role fails here instead.
//
// Roles mirror the seeds in models/Role.js. Only the two hierarchy lookups are
// stubbed; every decision below is the shipping code.

const ROLES = {
  union_admin: {
    hierarchyLevel: 0,
    canManage: [1, 2, 3, 4],
    permissions: [
      'teams.read:subordinate',
      'teams.manage:subordinate',
      'services.read:subordinate',
      'services.manage:subordinate',
      'media.upload',
      'media.manage',
    ],
  },
  conference_admin: {
    hierarchyLevel: 1,
    canManage: [2, 3, 4],
    permissions: [
      'teams.read:subordinate',
      'teams.manage:subordinate',
      'services.read:subordinate',
      'services.manage:subordinate',
      'media.upload',
      'media.manage',
    ],
  },
  church_admin: {
    hierarchyLevel: 2,
    canManage: [3, 4],
    permissions: [
      'teams.create:own',
      'teams.read:own',
      'teams.update:own',
      'teams.delete:own',
      'services.read:own',
      'services.manage:own',
      'media.upload',
      'media.manage',
    ],
  },
  team_leader: {
    hierarchyLevel: 3,
    canManage: [4],
    permissions: [
      'services.create:team',
      'services.read:team',
      'services.update:team',
      'services.delete:team',
      'teams.read:own',
      'teams.update:own',
      'media.upload',
      'media.manage',
    ],
  },
  service_coordinator: {
    hierarchyLevel: 4,
    canManage: [],
    permissions: [
      'services.read:own',
      'services.update:own',
      'media.upload',
      'media.manage',
    ],
  },
};

const READ_ONLY_ROLES = {
  team_member: {
    hierarchyLevel: 3,
    canManage: [],
    permissions: ['services.read:team', 'teams.read:own'],
  },
  church_viewer: {
    hierarchyLevel: 2,
    canManage: [],
    permissions: ['services.read:public'],
  },
};

// Paths in one church, one team, one service, all nested.
const CHURCH_PATH = 'u1/c1/ch1';
const TEAM_PATH = `${CHURCH_PATH}/team_1`;
const SERVICE_PATH = `${TEAM_PATH}/service_1`;

// Where each role sits. An admin governs from its own level down; a team leader
// is assigned at the team.
const PATH_FOR_LEVEL = {
  0: 'u1',
  1: 'u1/c1',
  2: CHURCH_PATH,
  3: TEAM_PATH,
};

function actingAs(role) {
  const path = PATH_FOR_LEVEL[role.hierarchyLevel] ?? CHURCH_PATH;

  jest
    .spyOn(hierarchicalAuthService, 'getUserHighestLevel')
    .mockResolvedValue(role.hierarchyLevel);
  jest
    .spyOn(hierarchicalAuthService, 'getUserHighestAssignment')
    .mockResolvedValue({ level: role.hierarchyLevel, path, role });

  return { _id: 'user-1', isSuperAdmin: false, teamAssignments: [] };
}

// The four capabilities, each exercised through the function the route calls.
const CAPABILITIES = {
  'create a service': (user) =>
    hierarchicalAuthService.canUserCreateUnder(user, TEAM_PATH, 4),

  'edit a service': (user) =>
    hierarchicalAuthService.canUserManageEntity(user, SERVICE_PATH, 'update'),

  'set a service banner': (user) =>
    // requireServicePermission('services.update') -> canManageService, which
    // decides at the service's level under the team.
    hierarchicalAuthService.canUserActOnChildLevel(user, TEAM_PATH, 4, 'update'),

  'create a team': (user) =>
    hierarchicalAuthService.canUserCreateUnder(user, CHURCH_PATH, 3),
};

// What each role is deliberately NOT meant to do. Creating teams belongs to the
// church and above — a team leader runs a team rather than founding one — and a
// service coordinator edits its own service without creating anything.
// Everything else in CAPABILITIES is expected to work.
const NOT_EXPECTED = {
  team_leader: ['create a team'],
  service_coordinator: ['create a service', 'create a team'],
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(Object.entries(ROLES))('%s', (roleName, role) => {
  const withheld = NOT_EXPECTED[roleName] || [];
  const expected = Object.keys(CAPABILITIES).filter(
    (c) => !withheld.includes(c)
  );

  it.each(expected)('can %s', async (capability) => {
    const user = actingAs(role);
    await expect(CAPABILITIES[capability](user)).resolves.toBe(true);
  });

  // Asserted rather than merely skipped, so a change that over-grants shows up
  // here too.
  if (withheld.length > 0) {
    it.each(withheld)('cannot %s', async (capability) => {
      const user = actingAs(role);
      await expect(CAPABILITIES[capability](user)).resolves.toBe(false);
    });
  }

  it('can upload to the media library', () => {
    // routes/media.js POST /upload -> authorize('media.upload')
    expect(checkPermission(role.permissions, 'media.upload')).toBe(true);
  });

  it('can list the media library', () => {
    // routes/media.js GET / -> authorize('media.read'). No role is seeded with
    // media.read; it is reached through media.manage.
    expect(checkPermission(role.permissions, 'media.read')).toBe(true);
  });
});

describe.each(Object.entries(READ_ONLY_ROLES))('%s stays read-only', (roleName, role) => {
  it.each(Object.keys(CAPABILITIES))('cannot %s', async (capability) => {
    const user = actingAs(role);
    await expect(CAPABILITIES[capability](user)).resolves.toBe(false);
  });

  it('cannot upload media', () => {
    expect(checkPermission(role.permissions, 'media.upload')).toBe(false);
  });
});

describe('scope is still enforced for the roles that can write', () => {
  it('refuses a church admin a service in another church', async () => {
    const user = actingAs(ROLES.church_admin);

    await expect(
      hierarchicalAuthService.canUserCreateUnder(user, 'u1/c1/ch2/team_9', 4)
    ).resolves.toBe(false);
  });

  it('refuses a church admin a neighbouring church whose id shares a prefix', async () => {
    const user = actingAs(ROLES.church_admin);

    await expect(
      hierarchicalAuthService.canUserCreateUnder(user, 'u1/c1/ch10/team_9', 4)
    ).resolves.toBe(false);
  });

  it('refuses a team leader a service under a different team', async () => {
    const user = actingAs(ROLES.team_leader);

    await expect(
      hierarchicalAuthService.canUserCreateUnder(user, `${CHURCH_PATH}/team_2`, 4)
    ).resolves.toBe(false);
  });

  it('refuses a team leader the creation of a team', async () => {
    // Teams are the church admin's to create; a team leader runs one.
    const user = actingAs(ROLES.team_leader);

    await expect(
      hierarchicalAuthService.canUserCreateUnder(user, CHURCH_PATH, 3)
    ).resolves.toBe(false);
  });
});
