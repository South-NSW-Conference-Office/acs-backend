const express = require('express');
const request = require('supertest');

// Banners are wide and shallow, so cropping one to fit loses the top or the bottom —
// which is where faces are. The admin needs to say where to centre it vertically.
//
// The value is a number 0-100, not a raw object-position string, so it cannot carry
// arbitrary CSS into a style attribute, and so the panel can offer one slider.
//
// It has its own endpoint because PUT /:id assigns primaryImage wholesale from the
// body: sending a focal point through that route would blank the url, key and alt.

const mockState = { service: null, saved: null };

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    req.user = { _id: 'admin-1', isSuperAdmin: true };
    next();
  },
}));

jest.mock('../middleware/serviceAuth', () => ({
  canManageService: () => (req, res, next) => next(),
  requireServicePermission: () => (req, res, next) => next(),
  getManageableTeams: async () => [],
}));

jest.mock('../models/Service', () => ({
  findById: async () => mockState.service,
}));
jest.mock('../models/ServiceEvent', () => ({}));
jest.mock('../models/VolunteerRole', () => ({}));
jest.mock('../models/Story', () => ({}));

const adminServices = require('../routes/admin-services');

const app = express();
app.use(express.json());
app.use('/api/admin/services', adminServices);

const ID = '6a87a320b50dca029dd1ccbf';

function serviceWithBanner() {
  return {
    _id: ID,
    primaryImage: {
      url: 'https://example.test/banner.webp',
      key: 'general/banner.webp',
      alt: 'Crew on a trailer',
      focalX: 50,
      focalY: 50,
    },
    save: async function () {
      mockState.saved = this;
      return this;
    },
  };
}

beforeEach(() => {
  mockState.service = serviceWithBanner();
  mockState.saved = null;
});

const patch = (body) =>
  request(app)
    .patch(`/api/admin/services/${ID}/primary-image/focus`)
    .send(body);

describe('PATCH banner focal point', () => {
  it('stores a valid focal point', async () => {
    const res = await patch({ focalY: 20 });

    expect(res.status).toBe(200);
    expect(mockState.saved.primaryImage.focalY).toBe(20);
  });

  it('keeps the rest of the image intact — the reason this is not PUT /:id', async () => {
    await patch({ focalY: 20 });

    expect(mockState.saved.primaryImage.url).toBe(
      'https://example.test/banner.webp'
    );
    expect(mockState.saved.primaryImage.key).toBe('general/banner.webp');
    expect(mockState.saved.primaryImage.alt).toBe('Crew on a trailer');
  });

  it('accepts the boundaries', async () => {
    expect((await patch({ focalY: 0 })).status).toBe(200);
    expect((await patch({ focalY: 100 })).status).toBe(200);
  });

  // The horizontal axis is the one that matters in practice. Banners are uploaded
  // at the recommended 1200x400 (3:1) and the site renders them at roughly 16:10,
  // a taller box — so a compliant banner overflows sideways and not at all
  // vertically. focalY alone had nothing to move.
  it('stores a horizontal focal point', async () => {
    const res = await patch({ focalX: 25 });

    expect(res.status).toBe(200);
    expect(mockState.saved.primaryImage.focalX).toBe(25);
  });

  it('stores both axes at once', async () => {
    await patch({ focalX: 25, focalY: 75 });

    expect(mockState.saved.primaryImage.focalX).toBe(25);
    expect(mockState.saved.primaryImage.focalY).toBe(75);
  });

  it('leaves the other axis alone when only one is sent', async () => {
    // Otherwise adjusting sideways would silently recentre vertically.
    mockState.service.primaryImage.focalY = 80;

    await patch({ focalX: 10 });

    expect(mockState.saved.primaryImage.focalX).toBe(10);
    expect(mockState.saved.primaryImage.focalY).toBe(80);
  });

  it('still accepts a focalY-only call, as the first version did', async () => {
    const res = await patch({ focalY: 30 });

    expect(res.status).toBe(200);
    expect(mockState.saved.primaryImage.focalY).toBe(30);
  });

  it('rejects an out-of-range focalX', async () => {
    const res = await patch({ focalX: 140 });

    expect(res.status).toBe(400);
    expect(mockState.saved).toBeNull();
  });

  it('rejects a call with neither axis', async () => {
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(mockState.saved).toBeNull();
  });

  it.each([
    ['above the range', 101],
    ['below the range', -1],
    ['a string', '20'],
    ['not a number', NaN],
    ['missing', undefined],
  ])('rejects %s', async (_label, focalY) => {
    const res = await patch({ focalY });

    expect(res.status).toBe(400);
    expect(mockState.saved).toBeNull();
  });

  it('refuses to position a service that has no banner', async () => {
    mockState.service = { _id: ID, primaryImage: {}, save: async () => {} };

    const res = await patch({ focalY: 20 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no banner/i);
  });

  it('404s for a service that does not exist', async () => {
    mockState.service = null;

    expect((await patch({ focalY: 20 })).status).toBe(404);
  });
});
