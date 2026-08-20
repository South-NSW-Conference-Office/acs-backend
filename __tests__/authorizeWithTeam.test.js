const { authorizeWithTeam } = require('../middleware/auth');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// authorizeWithTeam gated every team route on getPermissionsForTeam().teamRole,
// which reports one thing only: whether the user is a *member* of that team. A
// church admin governs every team in their church without belonging to any of
// them, so opening a team they had just created answered 403 "No access to this
// team" — which the admin panel renders as "Team Not Found".
//
// The middleware is driven directly with fake req/res rather than reimplemented.
// getPermissionsForTeam is stubbed on the user (it is a mongoose document method),
// and the hierarchy lookup is stubbed; the branch being asserted is the real code.

const TEAM_ID = 'team-1';

function run(requiredPermission, { teamRole = null, allowedByHierarchy = false }) {
  jest
    .spyOn(hierarchicalAuthService, 'canUserManageEntityById')
    .mockResolvedValue(allowedByHierarchy);

  const req = {
    user: {
      _id: 'user-1',
      getPermissionsForTeam: jest
        .fn()
        .mockResolvedValue(
          teamRole
            ? { teamRole, permissions: ['*'] }
            : { role: null, permissions: [] }
        ),
    },
    headers: {},
    params: { teamId: TEAM_ID },
    body: {},
  };

  let status = null;
  let payload = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  let nexted = false;
  const next = () => {
    nexted = true;
  };

  return authorizeWithTeam(requiredPermission)(req, res, next).then(() => ({
    status,
    payload,
    nexted,
    req,
  }));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('authorizeWithTeam without a team assignment', () => {
  it('lets a church admin read a team in their own church', async () => {
    const { nexted, status } = await run('teams.read', {
      allowedByHierarchy: true,
    });

    // The regression: this was 403 "No access to this team".
    expect(nexted).toBe(true);
    expect(status).toBeNull();
  });

  it('still refuses someone with no authority over the team', async () => {
    const { nexted, status, payload } = await run('teams.read', {
      allowedByHierarchy: false,
    });

    expect(nexted).toBe(false);
    expect(status).toBe(403);
    expect(payload.message).toBe('No access to this team');
  });

  it('asks for read authority on a read', async () => {
    await run('teams.read', { allowedByHierarchy: true });

    expect(hierarchicalAuthService.canUserManageEntityById).toHaveBeenCalledWith(
      expect.anything(),
      'team',
      TEAM_ID,
      'read'
    );
  });

  it('asks for write authority on an update', async () => {
    await run('teams.update', { allowedByHierarchy: true });

    expect(hierarchicalAuthService.canUserManageEntityById).toHaveBeenCalledWith(
      expect.anything(),
      'team',
      TEAM_ID,
      'manage'
    );
  });

  it('treats manage_members as a write, not a read', async () => {
    // 'manage_members' is not one of the actions the hierarchy layer knows, and
    // anything it does not recognise counts as a read there — so mapping it to
    // 'manage' here is what keeps a read-only role away from team membership.
    await run('teams.manage_members', { allowedByHierarchy: true });

    expect(hierarchicalAuthService.canUserManageEntityById).toHaveBeenCalledWith(
      expect.anything(),
      'team',
      TEAM_ID,
      'manage'
    );
  });

  it('does not attach a team role it did not earn', async () => {
    const { req } = await run('teams.read', { allowedByHierarchy: true });

    expect(req.teamId).toBe(TEAM_ID);
    expect(req.teamPermissions).toBeUndefined();
  });
});

describe('authorizeWithTeam with a team assignment', () => {
  it('takes the membership path and never consults the hierarchy', async () => {
    const { nexted } = await run('teams.read', {
      teamRole: 'leader',
      allowedByHierarchy: false,
    });

    expect(nexted).toBe(true);
    expect(
      hierarchicalAuthService.canUserManageEntityById
    ).not.toHaveBeenCalled();
  });
});
