const { checkPermission } = require('../middleware/auth');

// routes/media.js gates listing on authorize('media.read'). No role in the seed
// grants media.read — union_admin, conference_admin and church_admin each get
// media.upload and media.manage and nothing else — so opening the Media Gallery
// answered 403 "Insufficient permissions" for every admin except a super admin.
//
// checkPermission understood exact matches, 'resource.*', and scoped permissions,
// but not that '<resource>.manage' covers the other verbs on that resource.
// hierarchicalAuthService.roleAllowsWrite already reads it that way
// ("verb === action || verb === 'manage'"); the two layers disagreed.

const CHURCH_ADMIN_MEDIA = ['media.upload', 'media.manage'];

describe('checkPermission and <resource>.manage', () => {
  it('lets media.manage satisfy media.read', () => {
    // The regression: this was false, and it is what the gallery asks for.
    expect(checkPermission(CHURCH_ADMIN_MEDIA, 'media.read')).toBe(true);
  });

  it('lets media.manage satisfy media.update and media.delete', () => {
    expect(checkPermission(CHURCH_ADMIN_MEDIA, 'media.update')).toBe(true);
    expect(checkPermission(CHURCH_ADMIN_MEDIA, 'media.delete')).toBe(true);
  });

  it('honours a scoped manage, e.g. services.manage:own', () => {
    expect(checkPermission(['services.manage:own'], 'services.delete')).toBe(
      true
    );
  });

  it('does not leak across resources', () => {
    // media.manage must say nothing about services.
    expect(checkPermission(CHURCH_ADMIN_MEDIA, 'services.read')).toBe(false);
    expect(checkPermission(['services.manage:own'], 'media.delete')).toBe(false);
  });

  it('does not treat a non-manage verb as covering others', () => {
    // media.upload alone is not permission to delete media.
    expect(checkPermission(['media.upload'], 'media.delete')).toBe(false);
    expect(checkPermission(['media.upload'], 'media.read')).toBe(false);
  });

  it('does not let update imply delete', () => {
    // church_admin holds churches.update:own and deliberately not a delete —
    // retiring a church stays with conference_admin. Only 'manage' is broad.
    expect(
      checkPermission(['churches.read:own', 'churches.update:own'], 'churches.delete')
    ).toBe(false);
  });

  it('still honours the behaviours that already worked', () => {
    expect(checkPermission(['*'], 'anything.at.all')).toBe(true);
    expect(checkPermission(['media.read'], 'media.read')).toBe(true);
    expect(checkPermission(['media.*'], 'media.delete')).toBe(true);
    expect(checkPermission(['teams.create:own'], 'teams.create')).toBe(true);
  });

  it('still refuses an empty or missing permission set', () => {
    expect(checkPermission([], 'media.read')).toBe(false);
    expect(checkPermission(null, 'media.read')).toBe(false);
  });
});
