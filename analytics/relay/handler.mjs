const UPSTREAM = 'https://lingyao-visitor-stats.lingyao-visitor-analytics.workers.dev';
const ROUTES = new Set(['/', '/index.html', '/style.css', '/app.js', '/collect', '/api/login', '/api/logout', '/api/summary', '/api/visits']);

export async function relay(request, upstreamFetch = fetch) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  if (!ROUTES.has(url.pathname)) return new Response('Not found', { status: 404 });
  const headers = new Headers(request.headers);
  // Browsers may accept zstd, which Deno fetch does not automatically decode.
  headers.set('Accept-Encoding', 'identity');
  if (url.pathname.startsWith('/api/') && request.method !== 'GET') {
    if (headers.get('Origin') !== url.origin) return new Response('Origin not allowed', { status: 403 });
    headers.set('Origin', UPSTREAM);
  }
  // Do not attribute the relay server's country to a visitor.
  headers.set('X-Stats-Relay', 'deno');
  const target = new URL(UPSTREAM);
  target.pathname = url.pathname;
  target.search = url.search;
  const forwarded = new Request(new Request(target, request), { headers, redirect: 'manual' });
  try {
    const response = await upstreamFetch(forwarded);
    const outgoing = new Headers(response.headers);
    // Deno fetch decodes compressed bodies; the downstream server owns encoding.
    outgoing.delete('Content-Encoding');
    outgoing.delete('Content-Length');
    for (const name of ['Connection', 'Keep-Alive', 'Proxy-Authenticate', 'Proxy-Authorization', 'TE', 'Trailer', 'Transfer-Encoding', 'Upgrade']) outgoing.delete(name);
    const redirect = outgoing.get('Location');
    if (redirect) {
      const location = new URL(redirect, UPSTREAM);
      if (location.origin === UPSTREAM) { location.host = url.host; location.protocol = url.protocol; outgoing.set('Location', location.href); }
    }
    return new Response(response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ error: '服务暂时不可用，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
