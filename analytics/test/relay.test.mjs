import test from 'node:test';
import assert from 'node:assert/strict';
import { relay } from '../relay/handler.mjs';

const upstream = 'https://lingyao-visitor-stats.lingyao-visitor-analytics.workers.dev';

test('relay keeps collection body and source origin and uses a fixed upstream host', async () => {
  let forwarded;
  const request = new Request('https://stats.example.deno.net/collect', { method: 'POST', headers: { Origin: 'https://lingyao-kong.github.io', 'Accept-Encoding': 'gzip, br, zstd' }, body: '{"visit":1}' });
  const response = await relay(request, async input => { forwarded = input; return new Response(null, { status: 204 }); });
  assert.equal(response.status, 204);
  assert.equal(forwarded.url, upstream + '/collect');
  assert.equal(forwarded.headers.get('Origin'), 'https://lingyao-kong.github.io');
  assert.equal(forwarded.headers.get('Accept-Encoding'), 'identity');
  assert.equal(await forwarded.text(), '{"visit":1}');
});

test('relay rejects cross-origin owner actions instead of blessing their Origin', async () => {
  let forwarded = false;
  const request = new Request('https://stats.example.deno.net/api/login', { method: 'POST', headers: { Origin: 'https://evil.com' }, body: '{}' });
  const response = await relay(request, async () => { forwarded = true; });
  assert.equal(response.status, 403);
  assert.equal(forwarded, false);
});

test('relay translates same-origin owner actions and preserves secure session cookies', async () => {
  let forwarded;
  const request = new Request('https://stats.example.deno.net/api/login', { method: 'POST', headers: { Origin: 'https://stats.example.deno.net' }, body: '{}' });
  const response = await relay(request, async input => { forwarded = input; return new Response('{}', { headers: { 'Set-Cookie': '__Host-analytics=signed; Secure; HttpOnly; Path=/; SameSite=Strict' } }); });
  assert.equal(forwarded.headers.get('Origin'), upstream);
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly/);
});

test('relay never redirects the browser back to an unreachable upstream hostname', async () => {
  const response = await relay(new Request('https://stats.example.deno.net/index.html'), async () => new Response(null, { status: 301, headers: { Location: upstream + '/' } }));
  assert.equal(response.headers.get('Location'), 'https://stats.example.deno.net/');
});

test('relay refuses unknown paths rather than serving as a general purpose proxy', async () => {
  const response = await relay(new Request('https://stats.example.deno.net//evil.example/'), async () => { throw new Error('Must not forward'); });
  assert.equal(response.status, 404);
});

test('relay removes upstream compression metadata after fetch decodes the response body', async () => {
  const response = await relay(new Request('https://stats.example.deno.net/'), async () => new Response('<!doctype html>', { headers: { 'Content-Encoding': 'br', 'Content-Length': '9', 'Content-Type': 'text/html', 'Transfer-Encoding': 'chunked', Connection: 'keep-alive' } }));
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(response.headers.get('Content-Length'), null);
  assert.equal(response.headers.get('Transfer-Encoding'), null);
  assert.equal(response.headers.get('Connection'), null);
  assert.equal(await response.text(), '<!doctype html>');
});
