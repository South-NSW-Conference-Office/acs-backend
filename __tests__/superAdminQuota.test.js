const Role = require('../models/Role');

// Assigning a further super administrator was refused: the role carries a quota and
// it was full at 5/5.
//
// The subtlety worth pinning is where that number lives. Settings > Role Limits
// writes quotaLimits straight to the database and takes effect immediately, so
// raising it there looks like it worked. But createSystemRoles runs on every boot
// and findOneAndUpdates the *whole* role object from the seed below — so the next
// deploy silently puts the old limit back, and nobody learns of it until an
// assignment is refused again, probably weeks later with no obvious cause.
//
// These assert the seeded value and, more importantly, that the seed really does
// overwrite rather than merely fill in a missing field.

function captureSeed() {
  const calls = [];
  const fakeModel = {
    findOneAndUpdate: async (filter, roleData, options) => {
      calls.push({ filter, roleData, options });
      return roleData;
    },
  };
  return { calls, run: () => Role.createSystemRoles.call(fakeModel) };
}

describe('super admin quota', () => {
  it('seeds a limit of 10', async () => {
    const { calls, run } = captureSeed();
    await run();

    const superAdmin = calls.find((c) => c.filter.name === 'super_admin');

    expect(superAdmin.roleData.quotaLimits.maxUsers).toBe(10);
  });

  it('writes the whole role object, so it overwrites whatever the panel set', async () => {
    // The trap: this is not a $setOnInsert. Every boot replaces quotaLimits, which
    // is why the seed has to be changed too and not just the database.
    const { calls, run } = captureSeed();
    await run();

    const superAdmin = calls.find((c) => c.filter.name === 'super_admin');

    expect(superAdmin.options.upsert).toBe(true);
    expect(superAdmin.roleData).toHaveProperty('quotaLimits');
    expect(superAdmin.roleData).toHaveProperty('permissions');
  });

  it('leaves the other roles untouched by this change', async () => {
    const { calls, run } = captureSeed();
    await run();

    const limits = Object.fromEntries(
      calls
        .filter((c) => c.roleData.quotaLimits?.maxUsers)
        .map((c) => [c.filter.name, c.roleData.quotaLimits.maxUsers])
    );

    expect(limits.union_admin).toBe(10);
    expect(limits.conference_admin).toBe(20);
  });

  it('keeps super admin scoped system-wide, not per conference', async () => {
    // A system scope counts holders across the whole install; anything narrower
    // would silently allow far more than ten.
    const { calls, run } = captureSeed();
    await run();

    const superAdmin = calls.find((c) => c.filter.name === 'super_admin');

    expect(superAdmin.roleData.quotaLimits.scope).toBe('system');
  });
});
