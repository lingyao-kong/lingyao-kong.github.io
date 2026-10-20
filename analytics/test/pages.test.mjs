import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../pages/gateway.mjs';
import worker from '../src/worker.mjs';

test('Pages gateway forwards the original request through a service binding, without an external redirect', async () => {
  const request = new Request('https://lingyao-visitor-stats.pages.dev/collect', { method: 'POST', headers: { Origin: 'https://lingyao-kong.github.io' }, body: '{"test":true}' });
  let received;
  const response = await gateway.fetch(request, { STATS: { async fetch(input) { received = input; return new Response(null, { status: 204 }); } } });
  assert.equal(response.status, 204);
  assert.equal(received, request);
  assert.equal(received.url, request.url);
  assert.equal(await received.text(), '{"test":true}');
  assert.equal(response.headers.get('Location'), null);
});

test('Pages gateway preserves same-origin owner login and private API authorization', async () => {
  const env = { ADMIN_KEY: 'd'.repeat(48), SITE_ORIGIN: 'https://lingyao-kong.github.io' };
  const proxy = { STATS: { fetch(request) { return worker.fetch(request, env); } } };
  const base = 'https://lingyao-visitor-stats.pages.dev';
  const unauthenticated = await gateway.fetch(new Request(base + '/api/summary'), proxy);
  assert.equal(unauthenticated.status, 401);
  const login = await gateway.fetch(new Request(base + '/api/login', { method: 'POST', headers: { Origin: base }, body: JSON.stringify({ key: env.ADMIN_KEY }) }), proxy);
  assert.equal(login.status, 200);
  assert.match(login.headers.get('Set-Cookie'), /Secure; HttpOnly; SameSite=Strict/);
});
