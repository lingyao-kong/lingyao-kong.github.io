import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { normalizeVisit, createSession, verifySession, dateRange } from '../src/worker.mjs';

const env = { SITE_ORIGIN: 'https://lingyao-kong.github.io', ADMIN_KEY: 'a'.repeat(48) };
const event = { id: '8df492c4-7baf-487a-aef9-302d51d49417', visitor: 'e3637e3e-42e6-4814-ac1d-97416a7f42b1', path: '/publications/?secret=hidden#anchor', source: 'https://google.com/search?q=private', duration: 5000 };

test('collection strips query strings and never accepts visitor supplied timestamps', () => {
  const v = normalizeVisit({ ...event, timestamp: 1 }, new Headers(), {}, 1234567);
  assert.equal(v.path, '/publications/');
  assert.equal(v.source, 'google.com');
  assert.equal(v.created, 1234567);
  assert.equal(v.duration, 5000);
  assert.throws(() => normalizeVisit({ ...event, path: 'https://evil.com/' }));
  assert.throws(() => normalizeVisit({ ...event, visitor: 'not-a-uuid' }));
});

test('relay traffic does not report the relay server country as the visitor country', () => {
  const direct = normalizeVisit(event, new Headers(), { country: 'CN' });
  assert.equal(direct.country, 'CN');
  const relayed = normalizeVisit(event, new Headers({ 'X-Stats-Relay': 'deno' }), { country: 'US' });
  assert.equal(relayed.country, '');
});

test('rejects cross-site collection and oversized payloads before database access', async () => {
  const badOrigin = await worker.fetch(new Request('https://stats.test/collect', { method: 'POST', headers: { Origin: 'https://evil.com' }, body: JSON.stringify(event) }), env);
  assert.equal(badOrigin.status, 403);
  const oversized = await worker.fetch(new Request('https://stats.test/collect', { method: 'POST', headers: { Origin: env.SITE_ORIGIN }, body: 'a'.repeat(4097) }), env);
  assert.equal(oversized.status, 413);
});

test('private reports cannot be fetched without an authenticated session', async () => {
  for (const route of ['summary', 'visits', 'export']) {
    const response = await worker.fetch(new Request('https://stats.test/api/' + route), env);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('signed sessions reject tampering and expiry', async () => {
  const cookie = await createSession(env.ADMIN_KEY, 1000);
  assert.equal(await verifySession(cookie, env.ADMIN_KEY, 1001), true);
  assert.equal(await verifySession(cookie + 'x', env.ADMIN_KEY, 1001), false);
  assert.equal(await verifySession(cookie, env.ADMIN_KEY, 1000 + 8 * 86400000), false);
  assert.equal(await verifySession(cookie, 'different-key', 1001), false);
});

test('date filters accept full history and reject invalid or inverted dates', () => {
  assert.deepEqual(dateRange(new URL('https://stats.test/api/visits')), [0, 8640000000000000]);
  assert.throws(() => dateRange(new URL('https://stats.test/api/visits?from=bad')));
  assert.throws(() => dateRange(new URL('https://stats.test/api/visits?from=2026-10-21&to=2026-10-20')));
});

test('login issues a secure HttpOnly cookie and rejects incorrect credentials', async () => {
  const req = (key) => new Request('https://stats.test/api/login', { method: 'POST', headers: { Origin: 'https://stats.test' }, body: JSON.stringify({ key }) });
  assert.equal((await worker.fetch(req('incorrect'), env)).status, 401);
  const response = await worker.fetch(req(env.ADMIN_KEY), env);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  const foreign = new Request('https://stats.test/api/login', { method: 'POST', headers: { Origin: 'https://evil.com' }, body: JSON.stringify({ key: env.ADMIN_KEY }) });
  assert.equal((await worker.fetch(foreign, env)).status, 403);
});
