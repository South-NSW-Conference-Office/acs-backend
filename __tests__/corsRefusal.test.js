const express = require('express');
const cors = require('cors');
const request = require('supertest');

// An unlisted origin used to be refused with `callback(new Error(...))`. cors passes
// that to next(err), so the request fell through to the global error handler and came
// back "500 Internal server error" — the same answer the API gives when it is genuinely
// broken. A sign-in from a dev origin looked like a server fault, and the browser's own
// CORS message (which names the problem precisely) never appeared.
//
// What must hold: an unlisted origin is refused *without* an error status, and without
// Access-Control-Allow-Origin, so the browser blocks it and says why.
//
// The middleware is rebuilt here rather than importing app.js, which connects to Mongo,
// seeds roles and requires JWT_SECRET on load. The origin function is the unit under
// test, so it is exercised directly against the real cors library.

function buildApp(originFn) {
  const app = express();
  app.use(cors({ origin: originFn, credentials: true }));
  app.get('/ping', (req, res) => res.json({ ok: true }));
  // Mirrors the global error handler: whatever reaches it becomes a 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ success: false, message: 'Internal server error' });
  });
  return app;
}

const ALLOWED = 'https://communityservices.org.au';

// The shape that shipped before the fix, kept so the test proves it would have caught it.
function oldOriginFn(origin, callback) {
  if (!origin) return callback(null, true);
  if (origin === ALLOWED) return callback(null, true);
  return callback(new Error(`CORS: Origin ${origin} not allowed`));
}

// The current shape.
function newOriginFn(origin, callback) {
  if (!origin) return callback(null, true);
  if (origin === ALLOWED) return callback(null, true);
  return callback(null, false);
}

describe('CORS refusal', () => {
  it('does not answer 500 for an unlisted origin', async () => {
    const res = await request(buildApp(newOriginFn))
      .get('/ping')
      .set('Origin', 'http://localhost:3001');

    expect(res.status).not.toBe(500);
  });

  it('withholds Access-Control-Allow-Origin so the browser blocks it', async () => {
    const res = await request(buildApp(newOriginFn))
      .get('/ping')
      .set('Origin', 'http://localhost:3001');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('still allows a listed origin, with the header', async () => {
    const res = await request(buildApp(newOriginFn))
      .get('/ping')
      .set('Origin', ALLOWED);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('still allows a request with no Origin at all (curl, server-to-server)', async () => {
    const res = await request(buildApp(newOriginFn)).get('/ping');

    expect(res.status).toBe(200);
  });

  it('the previous implementation did answer 500 — this is the regression', async () => {
    const res = await request(buildApp(oldOriginFn))
      .get('/ping')
      .set('Origin', 'http://localhost:3001');

    expect(res.status).toBe(500);
  });
});
