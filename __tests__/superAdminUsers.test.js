const express = require('express');
const request = require('supertest');

// GET /api/super-admin/users read `user.organizations` three ways, and that field
// was removed from the User schema by the hierarchical refactor — routes/teams.js
// carries a note saying it "only ever exists on built API responses". So:
//
//   1. The query's `{ 'organizations.role': { $exists: true } }` branch matched
//      nobody, hiding any super admin who holds the role by assignment rather
//      than by the isSuperAdmin flag.
//   2. `.populate('organizations.organization')` targets a path that is not in
//      the schema; mongoose 7 rejects that outright (strictPopulate).
//   3. `user.organizations.some(...)` threw a TypeError on undefined, which the
//      handler turned into a 500 — the super-admin user page failed to load.
//
// The models are mocked so the route's own logic is what runs. Roles are given
// populated, exactly as the real populate would leave them.

const mockState = { superAdminDocs: [], regularDocs: [], lastQueries: [] };

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { _id: 'caller', isSuperAdmin: true };
    next();
  },
}));

jest.mock('../middleware/auditLog', () => ({
  AuditLog: function AuditLog() {
    return { save: jest.fn().mockResolvedValue(undefined) };
  },
}));

jest.mock('../models/Role', () => ({
  findOne: () => ({
    select: () => ({ lean: async () => ({ _id: 'role-super-admin' }) }),
  }),
}));

jest.mock('../models/User', () => ({
  find: (query) => {
    mockState.lastQueries.push(query);
    // The super-admin query uses $or; the eligible query does not.
    const docs = query.$or ? mockState.superAdminDocs : mockState.regularDocs;
    const chain = {
      populate: () => chain,
      select: () => chain,
      sort: async () => docs,
    };
    return chain;
  },
}));

const superAdminRouter = require('../routes/superAdmin');

const app = express();
app.use(express.json());
app.use('/api/super-admin', superAdminRouter);

const SUPER_ADMIN_ROLE = {
  _id: 'role-super-admin',
  name: 'super_admin',
  displayName: 'Super Administrator',
  level: 'union',
};

const CHURCH_ADMIN_ROLE = {
  _id: 'role-church-admin',
  name: 'church_admin',
  displayName: 'Church Administrator',
  level: 'church',
};

function user(overrides) {
  return {
    _id: 'u',
    name: 'Someone',
    email: 'someone@example.com',
    isActive: true,
    verified: true,
    unionAssignments: [],
    conferenceAssignments: [],
    churchAssignments: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockState.superAdminDocs = [];
  mockState.regularDocs = [];
  mockState.lastQueries = [];
});

describe('GET /api/super-admin/users', () => {
  it('answers instead of throwing on the removed field', async () => {
    // The unflagged user is the point: the old filter returned early on
    // isSuperAdmin, so a list of only flag-holders never reached
    // `user.organizations.some(...)` and never threw. It takes someone without
    // the flag to hit the TypeError that became a 500.
    mockState.superAdminDocs = [
      user({ _id: 'flagged', name: 'Flagged Admin', isSuperAdmin: true }),
      user({
        _id: 'unflagged',
        name: 'Assigned Admin',
        isSuperAdmin: false,
        churchAssignments: [
          { church: 'ch1', role: CHURCH_ADMIN_ROLE, assignedAt: new Date() },
        ],
      }),
    ];

    const res = await request(app).get('/api/super-admin/users');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('finds a super admin who holds the role by assignment, not the flag', async () => {
    mockState.superAdminDocs = [
      user({
        _id: 'by-role',
        name: 'Role Admin',
        isSuperAdmin: false,
        unionAssignments: [
          { union: 'u1', role: SUPER_ADMIN_ROLE, assignedAt: new Date() },
        ],
      }),
    ];

    const res = await request(app).get('/api/super-admin/users');

    expect(res.body.data.superAdmins.map((u) => u.id)).toEqual(['by-role']);
  });

  it('queries the assignment arrays, not the removed organizations path', async () => {
    await request(app).get('/api/super-admin/users');

    const orClause = mockState.lastQueries.find((q) => q.$or).$or;
    const keys = orClause.flatMap((c) => Object.keys(c));

    expect(keys).toEqual(
      expect.arrayContaining([
        'unionAssignments.role',
        'conferenceAssignments.role',
        'churchAssignments.role',
      ])
    );
    expect(keys.some((k) => k.startsWith('organizations'))).toBe(false);
  });

  it('drops a candidate who is neither flagged nor assigned the role', async () => {
    mockState.superAdminDocs = [
      user({ _id: 'flagged', isSuperAdmin: true }),
      user({
        _id: 'not-really',
        isSuperAdmin: false,
        churchAssignments: [
          { church: 'ch1', role: CHURCH_ADMIN_ROLE, assignedAt: new Date() },
        ],
      }),
    ];

    const res = await request(app).get('/api/super-admin/users');

    expect(res.body.data.superAdmins.map((u) => u.id)).toEqual(['flagged']);
  });

  it('reports assignments in the organizations field rather than undefined', async () => {
    mockState.superAdminDocs = [
      user({
        _id: 'by-role',
        isSuperAdmin: false,
        churchAssignments: [
          { church: 'ch1', role: SUPER_ADMIN_ROLE, assignedAt: new Date() },
        ],
      }),
    ];

    const res = await request(app).get('/api/super-admin/users');

    expect(res.body.data.superAdmins[0].organizations).toEqual([
      expect.objectContaining({
        role: expect.objectContaining({ name: 'super_admin' }),
      }),
    ]);
  });

  it('lists ordinary users as eligible for promotion', async () => {
    mockState.regularDocs = [
      user({
        _id: 'church-admin',
        name: 'Church Admin',
        churchAssignments: [
          { church: 'ch1', role: CHURCH_ADMIN_ROLE, assignedAt: new Date() },
        ],
      }),
    ];

    const res = await request(app).get('/api/super-admin/users');

    expect(res.body.data.eligibleUsers.map((u) => u.id)).toEqual([
      'church-admin',
    ]);
  });

  it('keeps an existing super admin out of the eligible list', async () => {
    mockState.regularDocs = [
      user({
        _id: 'already-super',
        unionAssignments: [
          { union: 'u1', role: SUPER_ADMIN_ROLE, assignedAt: new Date() },
        ],
      }),
    ];

    const res = await request(app).get('/api/super-admin/users');

    expect(res.body.data.eligibleUsers).toEqual([]);
  });
});
