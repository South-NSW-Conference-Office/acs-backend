const Team = require('../models/Team');
const { canManageService } = require('../middleware/serviceAuth');
const hierarchicalAuthService = require('../services/hierarchicalAuthService');

// canManageService decided hierarchy access with
// `team.hierarchyPath.startsWith(userHierarchyPath)`, which was wrong twice:
//
//   1. A bare startsWith treats 'u1/c1/ch10' as inside 'u1/c1/ch1', so a
//      neighbouring church whose id merely shares a prefix passed.
//   2. It ignored `permission` completely. Every caller passed one and none of
//      them changed the answer, so read-only church_viewer — which sits at the
//      same hierarchy level as church_admin — would have been handed service
//      update and delete the moment anything started trusting this function.
//
// That second point is why this matters now: routes/admin-services.js had
// canUpdate/canDelete/canManage hardcoded to isSuperAdmin, and wiring them to
// canManageService without fixing this would have granted viewers edit rights.
//
// Only the team lookup and the two hierarchy lookups are stubbed; the decision is
// the real code. Roles mirror the seeds in models/Role.js.

const CHURCH_ADMIN = {
  _id: 'role-church-admin',
  name: 'church_admin',
  hierarchyLevel: 2,
  canManage: [3, 4],
  permissions: ['teams.create:own', 'services.manage:own', 'churches.update:own'],
};

const CHURCH_VIEWER = {
  _id: 'role-church-viewer',
  name: 'church_viewer',
  hierarchyLevel: 2,
  canManage: [],
  permissions: ['services.read:public'],
};

const CHURCH_PATH = 'u1/c1/ch1';
const TEAM_ID = 'team-1';

function stubTeam({ hierarchyPath, isActive = true } = {}) {
  jest.spyOn(Team, 'findById').mockReturnValue({
    select: () => Promise.resolve({ hierarchyPath, isActive }),
  });
}

function actingAs(role, path = CHURCH_PATH) {
  jest
    .spyOn(hierarchicalAuthService, 'getUserHighestLevel')
    .mockResolvedValue(role.hierarchyLevel);
  jest
    .spyOn(hierarchicalAuthService, 'getUserHighestAssignment')
    .mockResolvedValue({ level: role.hierarchyLevel, path, role });

  return {
    _id: 'user-1',
    isSuperAdmin: false,
    teamAssignments: [],
    unionAssignments: [],
    conferenceAssignments: [],
    churchAssignments: [{ church: { hierarchyPath: path }, role }],
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('canManageService by hierarchy', () => {
  it('lets a church admin update a service on a team in their church', async () => {
    stubTeam({ hierarchyPath: `${CHURCH_PATH}/team_1` });
    const user = actingAs(CHURCH_ADMIN);

    await expect(
      canManageService(user, TEAM_ID, 'services.update')
    ).resolves.toBe(true);
  });

  it('refuses a read-only viewer the same update', async () => {
    // The regression the old path-prefix check would have introduced: viewer and
    // admin sit at the same level and share a hierarchy path.
    stubTeam({ hierarchyPath: `${CHURCH_PATH}/team_1` });
    const user = actingAs(CHURCH_VIEWER);

    await expect(
      canManageService(user, TEAM_ID, 'services.update')
    ).resolves.toBe(false);
  });

  it('refuses a read-only viewer delete as well', async () => {
    stubTeam({ hierarchyPath: `${CHURCH_PATH}/team_1` });
    const user = actingAs(CHURCH_VIEWER);

    await expect(
      canManageService(user, TEAM_ID, 'services.delete')
    ).resolves.toBe(false);
  });

  it('still lets that viewer read', async () => {
    stubTeam({ hierarchyPath: `${CHURCH_PATH}/team_1` });
    const user = actingAs(CHURCH_VIEWER);

    await expect(canManageService(user, TEAM_ID, 'services.read')).resolves.toBe(
      true
    );
  });

  it('refuses a team in a church whose id merely shares a prefix', async () => {
    // 'u1/c1/ch10' is not inside 'u1/c1/ch1'. The old startsWith said it was.
    stubTeam({ hierarchyPath: 'u1/c1/ch10/team_9' });
    const user = actingAs(CHURCH_ADMIN);

    await expect(
      canManageService(user, TEAM_ID, 'services.update')
    ).resolves.toBe(false);
  });

  it('refuses a team in another church entirely', async () => {
    stubTeam({ hierarchyPath: 'u1/c1/ch2/team_2' });
    const user = actingAs(CHURCH_ADMIN);

    await expect(
      canManageService(user, TEAM_ID, 'services.update')
    ).resolves.toBe(false);
  });

  it('refuses an inactive team', async () => {
    stubTeam({ hierarchyPath: `${CHURCH_PATH}/team_1`, isActive: false });
    const user = actingAs(CHURCH_ADMIN);

    await expect(
      canManageService(user, TEAM_ID, 'services.update')
    ).resolves.toBe(false);
  });

  it('lets a super admin through without consulting the hierarchy', async () => {
    stubTeam({ hierarchyPath: 'u9/c9/ch9/team_9' });
    const spy = jest.spyOn(hierarchicalAuthService, 'canUserActOnChildLevel');

    await expect(
      canManageService(
        { _id: 'u', isSuperAdmin: true, teamAssignments: [] },
        TEAM_ID,
        'services.delete'
      )
    ).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses when no team id is supplied', async () => {
    const user = actingAs(CHURCH_ADMIN);

    await expect(canManageService(user, null, 'services.read')).resolves.toBe(
      false
    );
  });
});
