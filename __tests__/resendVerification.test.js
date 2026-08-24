const express = require('express');
const request = require('supertest');

// POST /api/auth/resend-verification read `req.userPermissions.permissions` to
// decide whether the caller may resend an invitation. But req.userPermissions is
// populated by the authorize() middleware, and this route only ran
// authenticateToken — so the property was read off undefined, threw a TypeError,
// and the handler answered 500. Resending an invitation had never worked for
// anyone, super admins included; the failure surfaced as a colleague waiting for
// an email that no one could re-send.
//
// Same shape as the login bug in routes/auth.js: a property read off an object
// that nothing ever set.
//
// The middleware chain is what is under test here, so authenticateToken and
// authorize are the real ones from middleware/auth; only the model and the mail
// transport are stubbed.

const mockState = { user: null, target: null, saved: false, emailed: false };

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    authenticateToken: (req, res, next) => {
      req.user = mockState.user;
      next();
    },
  };
});

jest.mock('../services/emailService', () => ({
  generateVerificationToken: () => 'tok_test',
  getExpirationTime: () => new Date(Date.now() + 3600000),
  sendVerificationEmail: jest.fn(async () => {
    mockState.emailed = true;
  }),
}));

jest.mock('../services/tokenService', () => ({
  isBlacklisted: jest.fn().mockResolvedValue(false),
}));

jest.mock('../models/User', () => ({
  findById: () => ({
    populate: async () => mockState.target,
  }),
}));

const authRouter = require('../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const VALID_ID = '6a8bb758f8dc259877e68885';

function targetUser(overrides = {}) {
  return {
    _id: VALID_ID,
    name: 'Moises',
    email: 'someone@example.com',
    verified: false,
    teamAssignments: [],
    unionAssignments: [],
    conferenceAssignments: [],
    churchAssignments: [],
    toObject() {
      return { ...this };
    },
    save: async () => {
      mockState.saved = true;
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockState.user = { _id: 'caller', isSuperAdmin: true };
  mockState.target = targetUser();
  mockState.saved = false;
  mockState.emailed = false;
});

describe('POST /api/auth/resend-verification', () => {
  it('resends for a super admin instead of throwing on unset permissions', async () => {
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ userId: VALID_ID });

    // The regression: this was a 500 "Internal server error".
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('actually sends the mail and stores the new token', async () => {
    await request(app)
      .post('/api/auth/resend-verification')
      .send({ userId: VALID_ID });

    expect(mockState.emailed).toBe(true);
    expect(mockState.saved).toBe(true);
    expect(mockState.target.emailVerificationToken).toBe('tok_test');
  });

  it('refuses a caller without permission rather than erroring', async () => {
    // A team member: authenticated, no users.update anywhere in their role.
    mockState.user = {
      _id: 'member',
      isSuperAdmin: false,
      unionAssignments: [],
      conferenceAssignments: [],
      churchAssignments: [],
      teamAssignments: [],
    };

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ userId: VALID_ID });

    expect(res.status).toBe(403);
    expect(mockState.emailed).toBe(false);
  });

  it('rejects an already-verified user', async () => {
    mockState.target = targetUser({ verified: true });

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ userId: VALID_ID });

    expect(res.status).toBe(400);
    expect(mockState.emailed).toBe(false);
  });

  it('404s for a user that does not exist', async () => {
    mockState.target = null;

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ userId: VALID_ID });

    expect(res.status).toBe(404);
  });

  it('rejects a malformed id before touching anything', async () => {
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ userId: 'not-an-object-id' });

    expect(res.status).toBe(400);
    expect(mockState.emailed).toBe(false);
  });
});
