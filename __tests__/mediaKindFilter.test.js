const express = require('express');
const request = require('supertest');

// The media library needs to show videos apart from photos. It cannot do that with
// the existing `type` filter: `type` is the file's *purpose* (banner, gallery,
// avatar, ...), so a video uploaded for a gallery and a photo uploaded for a gallery
// are both `type: 'gallery'`. The format only exists on `mimeType`.
//
// Hence a separate `mediaKind` parameter. It is deliberately an enum of two rather
// than a free-text mime prefix, so no caller can push a regex fragment into the
// query, and it is anchored at the start so 'image/x-video' is not mistaken for one.

const mockState = { lastFilter: null, files: [], total: 0 };

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: 'user-1', isSuperAdmin: mockState.isSuperAdmin };
    next();
  },
  requireSuperAdmin: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
}));

jest.mock('../middleware/auditLog', () => ({
  auditLogMiddleware: () => (req, res, next) => next(),
}));

jest.mock('../services/storageService', () => ({}));

jest.mock('../middleware/uploadMiddleware', () => ({
  upload: { single: (req, res, next) => next() },
  requireFile: () => (req, res, next) => next(),
}));

jest.mock('../models/MediaFile', () => ({
  find: (filter) => {
    mockState.lastFilter = filter;
    return {
      sort: () => ({
        limit: () => ({
          skip: () => ({
            populate: async () => mockState.files,
          }),
        }),
      }),
    };
  },
  countDocuments: async () => mockState.total,
}));

const mediaRoutes = require('../routes/media');

const app = express();
app.use(express.json());
app.use('/api/media', mediaRoutes);

beforeEach(() => {
  mockState.lastFilter = null;
  mockState.files = [];
  mockState.total = 0;
  mockState.isSuperAdmin = true;
});

describe('media list: mediaKind filter', () => {
  it('filters to videos by mime type, not by the purpose field', async () => {
    const res = await request(app).get('/api/media?mediaKind=video');

    expect(res.status).toBe(200);
    expect(mockState.lastFilter.mimeType).toEqual(/^video\//);
    // The purpose filter must stay untouched, or asking for videos would also
    // silently narrow to one purpose.
    expect(mockState.lastFilter.type).toBeUndefined();
  });

  it('filters to images by mime type', async () => {
    const res = await request(app).get('/api/media?mediaKind=image');

    expect(res.status).toBe(200);
    expect(mockState.lastFilter.mimeType).toEqual(/^image\//);
  });

  it('applies no mime filter when mediaKind is omitted', async () => {
    const res = await request(app).get('/api/media');

    expect(res.status).toBe(200);
    expect(mockState.lastFilter.mimeType).toBeUndefined();
  });

  it('combines with the purpose filter rather than replacing it', async () => {
    const res = await request(app).get(
      '/api/media?mediaKind=video&type=gallery'
    );

    expect(res.status).toBe(200);
    expect(mockState.lastFilter.mimeType).toEqual(/^video\//);
    expect(mockState.lastFilter.type).toBe('gallery');
  });

  it('rejects an unknown mediaKind instead of ignoring it', async () => {
    const res = await request(app).get('/api/media?mediaKind=audio');

    expect(res.status).toBe(400);
    expect(mockState.lastFilter).toBeNull();
  });

  it('rejects a mediaKind carrying a regex fragment', async () => {
    const res = await request(app).get('/api/media?mediaKind=.%2A');

    expect(res.status).toBe(400);
    expect(mockState.lastFilter).toBeNull();
  });

  it('still scopes a non-super-admin to their own files', async () => {
    mockState.isSuperAdmin = false;

    const res = await request(app).get('/api/media?mediaKind=video');

    expect(res.status).toBe(200);
    expect(mockState.lastFilter.uploadedBy).toBe('user-1');
    expect(mockState.lastFilter.mimeType).toEqual(/^video\//);
  });
});
