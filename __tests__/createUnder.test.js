const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// Creating a child entity was authorized against the *parent* as the target:
// POST /teams asked canUserManageEntity(user, church.hierarchyPath, 'create'), and
// POST /services asked the same about the team's path. roleAllowsWrite derives the
// entity type from the level in that path, so those became "can you create a church?"
// and "can you create a team?" — questions the roles deliberately answer no to.
//
// church_admin holds `teams.create:own` and no `churches.create` (creating a church
// is conference_admin's job), so a church admin was refused a team in their own
// church. team_leader holds `services.create:team` and no `teams.create`, so the
// same shape refused it a service in its own team.
//
// Only the two lookups that feed the decision are stubbed; the decision is the real
// code. Roles mirror the seeds in models/Role.js.

const CHURCH_ADMIN = {
  _id: 'role-church-admin',
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
};

const CHURCH_VIEWER = {
  _id: 'role-church-viewer',
  name: 'church_viewer',
  hierarchyLevel: 2,
  canManage: [],
  permissions: ['services.read:public', 'stories.read:public'],
};

const TEAM_LEADER = {
  _id: 'role-team-leader',
  name: 'team_leader',
  hierarchyLevel: 3,
  canManage: [4],
  permissions: [
    'services.create:team',
    'services.read:team',
    'services.update:team',
    'services.delete:team',
    'teams.read:own',
    'teams.update:own',
  ],
};

const TEAM_LEVEL = 3;
const SERVICE_LEVEL = 4;

function actingAs(role, path, { isSuperAdmin = false } = {}) {
  jest
    .spyOn(hierarchicalAuthService, 'getUserHighestLevel')
    .mockResolvedValue(isSuperAdmin ? 0 : role.hierarchyLevel);
  jest
    .spyOn(hierarchicalAuthService, 'getUserHighestAssignment')
    .mockResolvedValue({ level: role.hierarchyLevel, path, role });

  return { _id: 'user-1', isSuperAdmin };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('canUserCreateUnder', () => {
  it('lets a church admin create a team in their own church', async () => {
    const user = actingAs(CHURCH_ADMIN, 'u1/c1/ch1');

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c1/ch1',
      TEAM_LEVEL
    );

    expect(allowed).toBe(true);
  });

  it('is the case the old parent-as-target check refused', async () => {
    // Documents the actual regression rather than asserting it in the abstract:
    // the previous call shape still returns false for the very same user.
    const user = actingAs(CHURCH_ADMIN, 'u1/c1/ch1');

    const viaOldShape = await hierarchicalAuthService.canUserManageEntity(
      user,
      'u1/c1/ch1',
      'create'
    );

    expect(viaOldShape).toBe(false);
  });

  it('lets a team leader create a service in their own team', async () => {
    const user = actingAs(TEAM_LEADER, 'u1/c1/ch1/t1');

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c1/ch1/t1',
      SERVICE_LEVEL
    );

    expect(allowed).toBe(true);
  });

  it("refuses a church admin a team in someone else's church", async () => {
    const user = actingAs(CHURCH_ADMIN, 'u1/c1/ch1');

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c1/ch2',
      TEAM_LEVEL
    );

    expect(allowed).toBe(false);
  });

  it('refuses a sibling church whose id merely starts with the same characters', async () => {
    // 'u1/c1/ch10' is not inside 'u1/c1/ch1'; a bare startsWith would say it is.
    const user = actingAs(CHURCH_ADMIN, 'u1/c1/ch1');

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c1/ch10',
      TEAM_LEVEL
    );

    expect(allowed).toBe(false);
  });

  it('refuses a read-only church viewer, who sits at the same level as a church admin', async () => {
    const user = actingAs(CHURCH_VIEWER, 'u1/c1/ch1');

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c1/ch1',
      TEAM_LEVEL
    );

    expect(allowed).toBe(false);
  });

  it('refuses a team leader a team, which is its own level and not its to create', async () => {
    const user = actingAs(TEAM_LEADER, 'u1/c1/ch1/t1');

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c1/ch1/t1',
      TEAM_LEVEL
    );

    expect(allowed).toBe(false);
  });

  it('lets a super admin create anywhere', async () => {
    const user = actingAs(CHURCH_VIEWER, 'u1/c1/ch1', { isSuperAdmin: true });

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c9/ch9',
      TEAM_LEVEL
    );

    expect(allowed).toBe(true);
  });

  it('refuses when the child level is missing rather than defaulting open', async () => {
    const user = actingAs(CHURCH_ADMIN, 'u1/c1/ch1');

    const allowed = await hierarchicalAuthService.canUserCreateUnder(
      user,
      'u1/c1/ch1',
      undefined
    );

    expect(allowed).toBe(false);
  });
});
