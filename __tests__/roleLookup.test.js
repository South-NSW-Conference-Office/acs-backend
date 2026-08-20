const Role = require('../models/Role');
const { findRoleByIdOrName } = require('../middleware/quotaCheck');

// Regression tests for "Invalid role specified" when creating a church admin.
//
// The lookup used mongoose.Types.ObjectId.isValid to choose between findById and
// findOne({name}). isValid returns true for ANY 12-character string, because 12 bytes
// is a legal ObjectId encoding — so 'church_admin', which is exactly 12 characters,
// was sent to findById, converted from its bytes into a meaningless id, and matched
// nothing. Every other role name is a different length, so this broke exactly one
// role: the one a church administrator needs.
//
// Role.findById / findOne are stubbed; these cover the routing decision, which is
// where the defect was.

const SYSTEM_ROLE_NAMES = [
  'super_admin',
  'union_admin',
  'conference_admin',
  'church_admin',
  'church_viewer',
  'team_leader',
  'team_member',
  'service_coordinator',
];

const REAL_OBJECT_ID = '692153b24a9f617c6d55739e';

describe('findRoleByIdOrName', () => {
  let byId;
  let byName;

  beforeEach(() => {
    byId = jest
      .spyOn(Role, 'findById')
      .mockResolvedValue({ name: 'from-findById' });
    byName = jest
      .spyOn(Role, 'findOne')
      .mockResolvedValue({ name: 'from-findOne' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('looks every system role up by name, including the 12-character one', async () => {
    for (const name of SYSTEM_ROLE_NAMES) {
      byId.mockClear();
      byName.mockClear();

      await findRoleByIdOrName(name);

      expect(byName).toHaveBeenCalledWith({ name });
      // The assertion that would have failed before the fix, for 'church_admin' only.
      expect(byId).not.toHaveBeenCalled();
    }
  });

  it('routes church_admin by name — the exact case that broke user creation', async () => {
    // Called out on its own so a failure names the real-world symptom rather than
    // appearing as one iteration of a loop.
    expect('church_admin'.length).toBe(12);

    await findRoleByIdOrName('church_admin');

    expect(byName).toHaveBeenCalledWith({ name: 'church_admin' });
    expect(byId).not.toHaveBeenCalled();
  });

  it('still looks a real 24-character ObjectId up by id', async () => {
    await findRoleByIdOrName(REAL_OBJECT_ID);

    expect(byId).toHaveBeenCalledWith(REAL_OBJECT_ID);
    expect(byName).not.toHaveBeenCalled();
  });

  it('accepts an ObjectId instance, not just a string', async () => {
    // Callers pass whatever was on req.body, which may already be an ObjectId.
    const asObject = { toString: () => REAL_OBJECT_ID };

    await findRoleByIdOrName(asObject);

    expect(byId).toHaveBeenCalledWith(REAL_OBJECT_ID);
  });

  it('treats a 12-character non-hex string as a name, not an id', async () => {
    // The general form of the bug: any 12-character identifier hits it.
    await findRoleByIdOrName('abcdefghijkl');

    expect(byName).toHaveBeenCalledWith({ name: 'abcdefghijkl' });
    expect(byId).not.toHaveBeenCalled();
  });

  it('returns null for empty input without touching the database', async () => {
    expect(await findRoleByIdOrName(undefined)).toBeNull();
    expect(await findRoleByIdOrName('')).toBeNull();
    expect(byId).not.toHaveBeenCalled();
    expect(byName).not.toHaveBeenCalled();
  });
});
