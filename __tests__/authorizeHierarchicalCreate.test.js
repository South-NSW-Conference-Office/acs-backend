const { authorizeHierarchical } = require('../middleware/hierarchicalAuth');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// Exercises the create branch of authorizeHierarchical — the path taken by
// POST /teams, /churches, /conferences and the hierarchical service route, where
// there is no :id param so no target entity to compare paths against.
//
// The middleware is driven directly with fake req/res rather than reimplemented,
// so the assertions stay honest if its shape changes. Only the two hierarchy
// lookups are stubbed; the decision itself is the real code.

const LEVELS = {
  super_admin: 0,
  union_admin: 0,
  conference_admin: 1,
  church_admin: 2,
  team_leader: 3,
};

function runCreate(entityType, userLevel, { isSuperAdmin = false } = {}) {
  jest
    .spyOn(hierarchicalAuthService, 'getUserHighestLevel')
    .mockResolvedValue(userLevel);
  jest
    .spyOn(hierarchicalAuthService, 'getUserHierarchyPath')
    .mockResolvedValue('u1/c1');

  const req = { user: { _id: 'u', isSuperAdmin }, params: {} };
  let status = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  let nexted = false;

  return authorizeHierarchical('create', entityType)(req, res, () => {
    nexted = true;
  }).then(() => ({ allowed: nexted, status }));
}

afterEach(() => jest.restoreAllMocks());

describe('authorizeHierarchical — create', () => {
  it('lets a church_admin create a team', async () => {
    // The regression: `userLevel >= requiredLevel` refused this, because
    // creationLevels.team is 2 and a church_admin is level 2 — the role was
    // denied the very thing that entry names, despite holding 'teams.create:own'.
    const r = await runCreate('team', LEVELS.church_admin);
    expect(r.allowed).toBe(true);
  });

  it('lets a conference_admin create a church', async () => {
    const r = await runCreate('church', LEVELS.conference_admin);
    expect(r.allowed).toBe(true);
  });

  it('lets a team_leader create a service', async () => {
    const r = await runCreate('service', LEVELS.team_leader);
    expect(r.allowed).toBe(true);
  });

  it('lets a church_admin create a service, further below it', async () => {
    const r = await runCreate('service', LEVELS.church_admin);
    expect(r.allowed).toBe(true);
  });

  it('refuses a church_admin creating a church — that is conference level', async () => {
    const r = await runCreate('church', LEVELS.church_admin);
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
  });

  it('refuses a team_leader creating a team', async () => {
    const r = await runCreate('team', LEVELS.team_leader);
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
  });

  it('refuses a conference_admin creating a conference', async () => {
    const r = await runCreate('conference', LEVELS.conference_admin);
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe('authorizeHierarchical — create, super admin', () => {
  it('lets a super admin create a union', async () => {
    // creationLevels.union is -1, so every level comparison fails it. Without an
    // explicit bypass even a super admin could not create a union.
    const r = await runCreate('union', 0, { isSuperAdmin: true });
    expect(r.allowed).toBe(true);
  });

  it('lets a super admin create a conference', async () => {
    const r = await runCreate('conference', 0, { isSuperAdmin: true });
    expect(r.allowed).toBe(true);
  });

  it('refuses a union_admin creating a union, though it also sits at level 0', async () => {
    // Why the bypass is keyed on the super_admin role rather than `level === 0`:
    // union_admin shares that level, and creationLevels marks unions -1 to keep
    // them super-admin only.
    const r = await runCreate('union', LEVELS.union_admin);
    expect(r.allowed).toBe(false);
    expect(r.status).toBe(403);
  });

  it('lets a union_admin create a conference', async () => {
    const r = await runCreate('conference', LEVELS.union_admin);
    expect(r.allowed).toBe(true);
  });
});
