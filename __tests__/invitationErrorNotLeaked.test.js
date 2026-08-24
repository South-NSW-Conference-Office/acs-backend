const express = require('express');
const request = require('supertest');

// Surfacing invitation-email failures to the admin (so nobody waits on an email
// that never left) came with a detail that should not have travelled: the raw
// nodemailer message was returned in the response body. Those read like
// `connect ECONNREFUSED mail.internal:587` and name the mail host and port.
//
// Only holders of users.create reach this route, so the exposure is narrow — but
// the admin can act on none of it, and the human-readable message already tells
// them what to do. It belongs in the logs, which is where userService puts it.
//
// What must NOT regress: the admin still has to be told the invitation failed.
// Hiding the detail is only correct if the signal survives.

const mockState = { created: null };

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => next(),
  authorize: () => (req, res, next) => {
    req.user = { _id: 'admin-1' };
    next();
  },
  validateOrganizationContext: (req, res, next) => next(),
}));

jest.mock('../middleware/quotaCheck', () => ({
  checkRoleQuota: (req, res, next) => next(),
}));

jest.mock('../services/userService', () => ({
  createUser: jest.fn(async () => mockState.created),
}));

jest.mock('../models/User', () => ({}));
jest.mock('../models/Role', () => ({ findOne: async () => null }));

const usersRouter = require('../routes/users');

const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);

const NEW_USER = { name: 'Moises', email: 'someone@example.com' };

function createdUser(overrides = {}) {
  return {
    _id: 'user-1',
    id: 'user-1',
    name: 'Moises',
    email: 'someone@example.com',
    invitationSent: true,
    invitationError: null,
    ...overrides,
  };
}

describe('POST /api/users — invitation error detail', () => {
  it('does not return the transport error when the invitation fails', async () => {
    mockState.created = createdUser({
      invitationSent: false,
      invitationError: 'connect ECONNREFUSED mail.internal:587',
    });

    const res = await request(app).post('/api/users').send(NEW_USER);

    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('invitationError');
    // Belt and braces: the host must not reach the client by any other path.
    expect(JSON.stringify(res.body)).not.toMatch(/mail\.internal|ECONNREFUSED/);
  });

  it('still tells the admin the invitation did not go out', async () => {
    // The point of the original fix. Hiding the detail must not hide the signal.
    mockState.created = createdUser({
      invitationSent: false,
      invitationError: 'connect ECONNREFUSED mail.internal:587',
    });

    const res = await request(app).post('/api/users').send(NEW_USER);

    expect(res.body.invitationSent).toBe(false);
    expect(res.body.message).toMatch(/could not be sent/i);
  });

  it('still returns the created user itself', async () => {
    mockState.created = createdUser({
      invitationSent: false,
      invitationError: 'connect ECONNREFUSED mail.internal:587',
    });

    const res = await request(app).post('/api/users').send(NEW_USER);

    expect(res.body.data.id).toBe('user-1');
    expect(res.body.data.email).toBe('someone@example.com');
  });

  it('reports success normally when the invitation sends', async () => {
    mockState.created = createdUser();

    const res = await request(app).post('/api/users').send(NEW_USER);

    expect(res.status).toBe(201);
    expect(res.body.invitationSent).toBe(true);
    expect(res.body.message).toBe('User created successfully');
    expect(res.body.data).not.toHaveProperty('invitationError');
  });
});
