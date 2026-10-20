const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEK = 7 * 86400000;
const MAX_BODY = 4096;
const COOKIE = '__Host-analytics';
const encoder = new TextEncoder();

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function equals(left, right) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let different = 0;
  for (let n = 0; n < a.length; n++) different |= a[n] ^ b[n];
  return different === 0;
}

async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createSession(secret, now = Date.now()) {
  const expiry = String(now + WEEK);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(expiry)));
  return expiry + '.' + Array.from(signed, b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySession(value, secret, now = Date.now()) {
  if (!secret || typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 2) return false;
  const [expiry, signature] = parts;
  if (!/^\d{1,16}$/.test(expiry || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
  if (Number(expiry) <= now || Number(expiry) > now + WEEK) return false;
  const bytes = Uint8Array.from(signature.match(/../g), b => parseInt(b, 16));
  return crypto.subtle.verify('HMAC', await signingKey(secret), bytes, encoder.encode(expiry));
}

export function normalizeVisit(input, headers = new Headers(), cf = {}, now = Date.now()) {
  if (!input || !UUID.test(input.id) || !UUID.test(input.visitor)) throw new Error('Invalid visit ID');
  if (typeof input.path !== 'string' || !input.path.startsWith('/') || input.path.startsWith('//') || input.path.includes('\\') || input.path.length > 2048) throw new Error('Invalid page');
  const path = input.path.split(/[?#]/)[0].slice(0, 512);
  let source = 'direct';
  if (input.source) {
    try {
      const url = new URL(input.source);
      if (url.protocol === 'https:' || url.protocol === 'http:') source = url.hostname.toLowerCase().slice(0, 253);
    } catch { /* Missing or withheld referrers count as direct. */ }
  }
  const ua = headers.get('User-Agent') || '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobile|Android|iPhone/i.test(ua) ? 'Mobile' : 'Desktop';
  const country = /^[A-Z]{2}$/.test(cf.country || '') ? cf.country : '';
  return { id: input.id.toLowerCase(), visitor: input.visitor.toLowerCase(), path, source, created: now, duration: Math.max(0, Math.min(Number.isFinite(input.duration) ? Math.round(input.duration) : 0, 86400000)), browser, device, country };
}

export function dateRange(url) {
  function day(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date');
    const time = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Invalid date');
    return time - 8 * 3600000;
  }
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const start = from ? day(from) : 0;
  const end = to ? day(to) + 86400000 - 1 : 8640000000000000;
  if (end < start) throw new Error('Invalid date range');
  return [start, end];
}

function cursorFor(row) {
  return btoa(JSON.stringify([row.created_at, row.id]));
}

function parseCursor(value) {
  if (!value) return null;
  if (value.length > 200) throw new Error('Invalid cursor');
  const parsed = JSON.parse(atob(value));
  if (!Array.isArray(parsed) || !Number.isSafeInteger(parsed[0]) || !UUID.test(parsed[1])) throw new Error('Invalid cursor');
  return parsed;
}

async function readJson(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY) return { error: json({ error: 'Payload too large' }, 413) };
  const reader = request.body?.getReader();
  if (!reader) return { error: json({ error: 'Body required' }, 400) };
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return { error: json({ error: 'Payload too large' }, 413) };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { value: JSON.parse(new TextDecoder().decode(bytes)) }; }
  catch { return { error: json({ error: 'Invalid JSON' }, 400) }; }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (url.pathname === '/collect') {
    if (origin !== env.SITE_ORIGIN) return json({ error: 'Origin not allowed' }, 403);
    const cors = { 'Access-Control-Allow-Origin': env.SITE_ORIGIN, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
    if (env.INGEST_LIMIT && !(await env.INGEST_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return json({ error: 'Too many requests' }, 429, cors);
    const body = await readJson(request);
    if (body.error) return body.error;
    let visit;
    try { visit = normalizeVisit(body.value, request.headers, request.cf); }
    catch { return json({ error: 'Invalid visit' }, 400, cors); }
    if (env.COLLECT_LIMIT && !(await env.COLLECT_LIMIT.limit({ key: visit.visitor })).success) return json({ error: 'Too many requests' }, 429, cors);
    await env.DB.prepare(`INSERT INTO visits (id, visitor_id, created_at, path, source, country, device, browser, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET duration_ms = MAX(visits.duration_ms, excluded.duration_ms)
      WHERE visits.visitor_id = excluded.visitor_id AND visits.path = excluded.path`).bind(visit.id, visit.visitor, visit.created, visit.path, visit.source, visit.country, visit.device, visit.browser, visit.duration).run();
    return new Response(null, { status: 204, headers: { ...cors, 'Cache-Control': 'no-store' } });
  }

  if (url.pathname.startsWith('/api/')) {
    if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 32) return json({ error: 'Administrator key is not configured' }, 503);
    if (request.method !== 'GET' && origin !== url.origin) return json({ error: 'Origin not allowed' }, 403);
    if (url.pathname === '/api/login' && request.method === 'POST') {
      if (env.LOGIN_LIMIT && !(await env.LOGIN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return json({ error: '尝试次数过多，请一分钟后再试' }, 429);
      const body = await readJson(request);
      if (body.error) return body.error;
      if (typeof body.value?.key !== 'string' || !await equals(body.value.key, env.ADMIN_KEY)) return json({ error: '管理密钥不正确' }, 401);
      const session = await createSession(env.ADMIN_KEY);
      return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800` });
    }
    const cookies = Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(s => s.trim().split('=')));
    if (!await verifySession(cookies[COOKIE], env.ADMIN_KEY)) return json({ error: '请先登录' }, 401);
    if (url.pathname === '/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    let range;
    try { range = dateRange(url); } catch { return json({ error: '日期范围无效' }, 400); }
    const where = 'created_at BETWEEN ? AND ?';
    if (url.pathname === '/api/summary') {
      const data = await env.DB.batch([
        env.DB.prepare(`SELECT COUNT(*) AS pageviews, COUNT(DISTINCT visitor_id) AS visitors, COALESCE(ROUND(AVG(duration_ms)), 0) AS duration_ms, MIN(created_at) AS first_visit FROM visits WHERE ${where}`).bind(...range),
        env.DB.prepare(`SELECT source, COUNT(*) AS visits FROM visits WHERE ${where} GROUP BY source ORDER BY visits DESC LIMIT 20`).bind(...range),
        env.DB.prepare(`SELECT date(created_at / 1000, 'unixepoch', '+8 hours') AS day, COUNT(*) AS pageviews, COUNT(DISTINCT visitor_id) AS visitors FROM visits WHERE ${where} GROUP BY day ORDER BY day`).bind(...range),
        env.DB.prepare(`SELECT path, COUNT(*) AS visits FROM visits WHERE ${where} GROUP BY path ORDER BY visits DESC LIMIT 20`).bind(...range),
      ]);
      return json({ totals: data[0].results[0], sources: data[1].results, daily: data[2].results, pages: data[3].results, timezone: 'Asia/Shanghai' });
    }
    if (url.pathname === '/api/visits') {
      let cursor;
      try { cursor = parseCursor(url.searchParams.get('cursor')); } catch { return json({ error: 'Invalid cursor' }, 400); }
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 50, 1000));
      let params = [...range];
      let pageWhere = where;
      if (cursor && cursor[0] <= range[1]) {
        pageWhere = 'created_at >= ? AND (created_at, id) < (?, ?)';
        params = [range[0], cursor[0], cursor[1]];
      }
      const { results } = await env.DB.prepare(`SELECT * FROM visits WHERE ${pageWhere} ORDER BY created_at DESC, id DESC LIMIT ?`).bind(...params, Math.floor(limit) + 1).all();
      const more = results.length > limit;
      const rows = results.slice(0, limit);
      return json({ rows, next: more ? cursorFor(rows[rows.length - 1]) : null });
    }
    return json({ error: 'Not found' }, 404);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      console.error('Analytics request failed:', error?.message || 'Unknown error');
      return json({ error: '暂时无法处理请求，请稍后重试' }, 503);
    }
  },
};
