const express = require('express');
const request = require('supertest');

// The auth routes used to resolve a signed-in person's role and permissions from
// `user.organizations`. That field was removed from the User schema by the
// hierarchical refactor — routes/teams.js already carries a note saying it "only ever
// exists on built API responses" — so on a real user it is `undefined`, and
// `user.organizations.length` threw a TypeError. The handler caught it and answered
// 500, the admin panel read that as "not authenticated" and redirected to the login
// page. The symptom was a correct password appearing to sign in and then bouncing
// straight back out, for every account without the isSuperAdmin flag.
//
// These tests drive the real routers with fake req/res rather than reimplementing
// them. The roles and organizations below are given fully populated (exactly as
// authenticateToken populates them), which lets the real getUserHighestAssignment run
// without touching a database — so the selection being asserted is the shipping code.

const mockState = { user: null };

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = mockState.user;
    next();
  },
  authorize: () => (req, res, next) => next(),
  checkPermission: () => (req, res, next) => next(),
}));

// Neither is exercised here; mocked so requiring the router opens no mail or token
// connections.
jest.mock('../services/emailService', () => ({
  sendVerificationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(),
}));
jest.mock('../services/tokenService', () => ({
  isBlacklisted: jest.fn().mockResolvedValue(false),
  blacklistToken: jest.fn(),
}));

const authRouter = require('../routes/auth');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const CHURCH_ADMIN_ROLE = {
  _id: 'role-church-admin',
  name: 'church_admin',
  displayName: 'Church Administrator',
  level: 'church',
  hierarchyLevel: 2,
  permissions: ['services.update', 'services.create', 'teams.update'],
};

const CONFERENCE_ADMIN_ROLE = {
  _id: 'role-conference-admin',
  name: 'conference_admin',
  displayName: 'Conference Administrator',
  level: 'conference',
  hierarchyLevel: 1,
  permissions: ['churches.update', 'services.update'],
};

function churchAdmin() {
  return {
    _id: 'user-1',
    name: 'Church Admin',
    email: 'church.admin@example.com',
    verified: true,
    isSuperAdmin: false,
    unionAssignments: [],
    conferenceAssignments: [],
    churchAssignments: [
      {
        church: { _id: 'church-1', hierarchyPath: 'u1/c1/ch1' },
        role: CHURCH_ADMIN_ROLE,
        assignedAt: new Date('2026-01-01'),
      },
    ],
    teamAssignments: [],
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  mockState.user = null;
});

describe('GET /api/auth/is-auth', () => {
  it('answers for a church admin instead of throwing on the removed field', async () => {
    mockState.user = churchAdmin();

    const res = await request(app).get('/api/auth/is-auth');

    // The regression: this was a 500.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns the permissions the assignment actually grants', async () => {
    mockState.user = churchAdmin();

    const res = await request(app).get('/api/auth/is-auth');

    // An empty list here is the quieter half of the same bug: the panel loads and
    // every permission-gated control is hidden, so editing a service looks forbidden.
    expect(res.body.data.permissions).toEqual(
      expect.arrayContaining(['services.update'])
    );
    expect(res.body.data.role).toMatchObject({
      name: 'church_admin',
      displayName: 'Church Administrator',
    });
  });

  it('still gives super admins wildcard permissions', async () => {
    mockState.user = {
      ...churchAdmin(),
      isSuperAdmin: true,
      churchAssignments: [],
    };

    const res = await request(app).get('/api/auth/is-auth');

    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual(['*']);
    expect(res.body.data.role.name).toBe('super_admin');
  });

  it('answers for a user with no assignments at all', async () => {
    mockState.user = {
      ...churchAdmin(),
      churchAssignments: [],
    };

    const res = await request(app).get('/api/auth/is-auth');

    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual([]);
    expect(res.body.data.role).toBeNull();
  });
});

describe('GET /api/auth/is-auth-hierarchical', () => {
  // The endpoint the admin panel calls on every page load. Only the three hierarchy
  // lookups are stubbed; the role resolution under test is the real code.
  function stubHierarchy(level) {
    jest
      .spyOn(hierarchicalAuthService, 'getUserHighestLevel')
      .mockResolvedValue(level);
    jest
      .spyOn(hierarchicalAuthService, 'getUserHierarchyPath')
      .mockResolvedValue('u1/c1/ch1');
    jest
      .spyOn(hierarchicalAuthService, 'getUserManagedLevels')
      .mockResolvedValue([3, 4]);
  }

  it('answers for a church admin instead of throwing on the removed field', async () => {
    mockState.user = churchAdmin();
    stubHierarchy(2);

    const res = await request(app).get('/api/auth/is-auth-hierarchical');

    // The regression, on the endpoint that decides whether the panel stays open.
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual(
      expect.arrayContaining(['services.update'])
    );
    expect(res.body.data.role).toMatchObject({
      name: 'church_admin',
      hierarchyLevel: 2,
    });
  });

  it('picks the highest assignment when someone holds more than one', async () => {
    const user = churchAdmin();
    user.conferenceAssignments = [
      {
        conference: { _id: 'conf-1', hierarchyPath: 'u1/c1' },
        role: CONFERENCE_ADMIN_ROLE,
        assignedAt: new Date('2026-01-01'),
      },
    ];
    mockState.user = user;
    stubHierarchy(1);

    const res = await request(app).get('/api/auth/is-auth-hierarchical');

    // Conference (1) outranks church (2), so the conference role is the one that
    // should describe them.
    expect(res.body.data.role.name).toBe('conference_admin');
    expect(res.body.data.permissions).toEqual(
      expect.arrayContaining(['churches.update'])
    );
  });

  it('still gives super admins wildcard permissions', async () => {
    mockState.user = { ...churchAdmin(), isSuperAdmin: true };
    stubHierarchy(0);

    const res = await request(app).get('/api/auth/is-auth-hierarchical');

    expect(res.body.data.permissions).toEqual(['*']);
    expect(res.body.data.role.name).toBe('super_admin');
  });
});
