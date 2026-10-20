import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { createSession } from '../src/worker.mjs';

function setup(observeCandidates = false) {
  const db = new DatabaseSync(':memory:');
  let scanned = 0;
  db.function('observe_candidate', () => { scanned++; return 1; });
  db.exec(readFileSync(new URL('../migrations/0001_visits.sql', import.meta.url), 'utf8'));
  const env = {
    ADMIN_KEY: 'b'.repeat(48), SITE_ORIGIN: 'https://lingyao-kong.github.io',
    DB: {
      prepare(sql) {
        if (observeCandidates && sql.startsWith('SELECT * FROM visits WHERE')) sql = sql.replace('WHERE ', 'WHERE observe_candidate() AND ');
        return { bind(...values) { return {
          async run() { return db.prepare(sql).run(...values); },
          async all() { return { results: db.prepare(sql).all(...values) }; },
        }; } };
      },
      async batch(statements) { return Promise.all(statements.map(s => s.all())); },
    },
  };
  return { env, db, scanned: () => scanned };
}

const visit = { id: '8df492c4-7baf-487a-aef9-302d51d49417', visitor: 'e3637e3e-42e6-4814-ac1d-97416a7f42b1', path: '/', source: 'https://github.com/profile', duration: 1000 };
const collect = body => new Request('https://stats.test/collect', { method: 'POST', headers: { Origin: 'https://lingyao-kong.github.io' }, body: JSON.stringify(body) });
async function report(route, env) { return worker.fetch(new Request('https://stats.test/api/' + route, { headers: { Cookie: '__Host-analytics=' + await createSession(env.ADMIN_KEY) } }), env); }

test('real SQLite: repeated duration updates keep one pageview and preserve its source and timestamp', async () => {
  const { env, db } = setup();
  assert.equal((await worker.fetch(collect(visit), env)).status, 204);
  const before = db.prepare('SELECT * FROM visits').get();
  assert.equal((await worker.fetch(collect({ ...visit, duration: 8000, source: 'https://evil.com' }), env)).status, 204);
  await worker.fetch(collect({ ...visit, duration: 2000 }), env);
  const after = db.prepare('SELECT * FROM visits').all();
  assert.equal(after.length, 1);
  assert.equal(after[0].duration_ms, 8000);
  assert.equal(after[0].source, 'github.com');
  assert.equal(after[0].created_at, before.created_at);
  await worker.fetch(collect({ ...visit, path: '/other', duration: 99000 }), env);
  assert.equal(db.prepare('SELECT duration_ms FROM visits').get().duration_ms, 8000);
  db.close();
});

test('real SQLite: full-history counts, date filters, and cursor pages retain old visits without duplicates', async () => {
  const { env, db } = setup();
  for (let index = 0; index < 3; index++) {
    const id = visit.id.slice(0, -1) + index;
    await worker.fetch(collect({ ...visit, id }), env);
    db.prepare('UPDATE visits SET created_at = ? WHERE id = ?').run(Date.UTC(2020 + index, 0, 1), id);
  }
  const summary = await (await report('summary', env)).json();
  assert.equal(summary.totals.pageviews, 3);
  assert.equal(summary.totals.visitors, 1);
  assert.equal(summary.sources[0].source, 'github.com');
  const filtered = await (await report('summary?from=2021-01-01&to=2021-12-31', env)).json();
  assert.equal(filtered.totals.pageviews, 1);
  const first = await (await report('visits?limit=2', env)).json();
  const second = await (await report('visits?limit=2&cursor=' + encodeURIComponent(first.next), env)).json();
  assert.equal(first.rows.length, 2);
  assert.equal(second.rows.length, 1);
  assert.equal(second.next, null);
  assert.equal(new Set([...first.rows, ...second.rows].map(r => r.id)).size, 3);
  db.close();
});

test('signed sessions reject extra components', async () => {
  const { verifySession } = await import('../src/worker.mjs');
  const key = 'c'.repeat(48);
  assert.equal(await verifySession(await createSession(key) + '.junk', key), false);
});

test('collector respects a denied rate limit before writing visitor data', async () => {
  const { env, db } = setup();
  env.COLLECT_LIMIT = { async limit() { return { success: false }; } };
  const result = await worker.fetch(collect(visit), env);
  assert.equal(result.status, 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM visits').get().count, 0);
  db.close();
});

test('large full-history export uses bounded index scans instead of repeatedly scanning exported rows', async () => {
  const { env, db, scanned } = setup(true);
  const insert = db.prepare('INSERT INTO visits (id, visitor_id, created_at, path, source, device, browser) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (let n = 0; n < 100000; n++) insert.run('00000000-0000-0000-0000-' + n.toString().padStart(12, '0'), visit.visitor, Date.UTC(2020, 0, 1) + n * 1000, '/', 'direct', 'Desktop', 'Chrome');
  db.exec('COMMIT');
  let cursor = null, rows = 0;
  do {
    const response = await report('visits?limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), env);
    const page = await response.json();
    rows += page.rows.length; cursor = page.next;
  } while (cursor);
  assert.equal(rows, 100000);
  assert.ok(scanned() < 200000, 'Index candidates scanned: ' + scanned());
  db.close();
});

test('collection IP throttle cannot be bypassed with a new anonymous visitor ID', async () => {
  const { env, db } = setup();
  env.INGEST_LIMIT = { async limit() { return { success: false }; } };
  const response = await worker.fetch(collect({ ...visit, visitor: '3cff3b90-cbce-45cc-9605-3b913e8a894e' }), env);
  assert.equal(response.status, 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM visits').get().count, 0);
  db.close();
});
