// Jest `setupFiles` entry, referenced from package.json.
//
// The config has pointed at this path for a long time while the file did not
// exist, which made `npm test` — and therefore `npm run validate` and
// `npm run build`, which both call it — fail before collecting a single test.
//
// Environment only: no database connection and no network. The suites that run
// against this are unit tests over pure authorization logic.

process.env.NODE_ENV = 'test';

// Present so any module reading them at require-time gets a deterministic value
// rather than undefined. Not real credentials and not used to sign anything a
// caller would accept outside the test process.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
