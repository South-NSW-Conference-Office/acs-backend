const UserService = require('../services/userService');
const emailService = require('../services/emailService');
const logger = require('../services/loggerService');

// Creating a user swallowed invitation-email failures entirely: no log, no
// return value, and the panel reported "User created successfully" whether the
// invitation left or not. A colleague was invited, never received anything, and
// nobody could tell — the account looked correctly created from every angle.
//
// The account must still be created when mail fails (it is already saved, and
// the invitation can be re-sent), but the failure has to be visible.

jest.mock('../models/User', () => {
  function MockUser(fields) {
    Object.assign(this, fields);
    this._id = { toString: () => 'user-1' };
    this.teamAssignments = [];
    this.save = async () => this;
    // createUser calls user.populate(...) on the document itself
    this.populate = async () => this;
    this.toObject = () => {
      const { save, populate, toObject, ...rest } = this;
      return { ...rest, _id: this._id };
    };
  }
  MockUser.findOne = async () => null;
  return MockUser;
});

jest.mock('../models/Team', () => ({
  findById: () => ({ populate: async () => null }),
}));

jest.mock('../services/universalAssignmentService', () => ({
  assignUserToEntities: async () => {},
  updateTeamMemberCount: async () => {},
}));

const NEW_USER = { name: 'Moises', email: 'someone@example.com' };

afterEach(() => {
  jest.restoreAllMocks();
});

describe('UserService.createUser — invitation email failures', () => {
  it('still creates the user when the invitation cannot be sent', async () => {
    jest
      .spyOn(emailService, 'sendVerificationEmail')
      .mockRejectedValue(new Error('SMTP connection refused'));
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    const user = await UserService.createUser(NEW_USER, 'admin-1');

    expect(user.id).toBe('user-1');
    expect(user.email).toBe('someone@example.com');
  });

  it('reports that the invitation did not go out', async () => {
    // The regression: this used to be indistinguishable from success.
    jest
      .spyOn(emailService, 'sendVerificationEmail')
      .mockRejectedValue(new Error('SMTP connection refused'));
    jest.spyOn(logger, 'error').mockImplementation(() => {});

    const user = await UserService.createUser(NEW_USER, 'admin-1');

    expect(user.invitationSent).toBe(false);
    expect(user.invitationError).toMatch(/SMTP/);
  });

  it('logs the failure with the address that was attempted', async () => {
    jest
      .spyOn(emailService, 'sendVerificationEmail')
      .mockRejectedValue(new Error('SMTP connection refused'));
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {});

    await UserService.createUser(NEW_USER, 'admin-1');

    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(/invitation/i),
      expect.objectContaining({ email: 'someone@example.com' })
    );
  });

  it('reports success when the invitation does send', async () => {
    jest.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue();
    const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {});

    const user = await UserService.createUser(NEW_USER, 'admin-1');

    expect(user.invitationSent).toBe(true);
    expect(user.invitationError).toBeNull();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('distinguishes "not attempted" from "attempted and failed"', async () => {
    const send = jest
      .spyOn(emailService, 'sendVerificationEmail')
      .mockResolvedValue();

    const user = await UserService.createUser(
      { ...NEW_USER, sendInvitation: false },
      'admin-1'
    );

    // null, not false: nothing failed, nothing was tried.
    expect(user.invitationSent).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
