import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const script = readFileSync(new URL('../../public/visitor.js', import.meta.url), 'utf8');

function browser(hostname = 'lingyao-kong.github.io', privacy = false) {
  let now = 0, tick;
  const messages = [], listeners = new Map(), storage = new Map();
  const location = { hostname, pathname: '/' };
  const on = (name, callback) => listeners.set(name, callback);
  const document = { currentScript: { dataset: { endpoint: 'https://stats.test/collect' } }, referrer: 'https://github.com/lingyao-kong', visibilityState: 'visible', addEventListener: on };
  const history = {
    pushState(_state, _title, path) { location.pathname = path; },
    replaceState(_state, _title, path) { location.pathname = path; },
  };
  const context = {
    location, document, history, window: { addEventListener: on },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    navigator: { globalPrivacyControl: privacy, sendBeacon(_url, body) { messages.push(JSON.parse(body)); return true; } },
    crypto: { randomUUID }, performance: { now: () => now },
    fetch(_url, options) { messages.push(JSON.parse(options.body)); return Promise.resolve(); },
    setInterval(callback) { tick = callback; },
  };
  runInNewContext(script, context);
  return { messages, history, document, at(ms) { now = ms; }, tick() { tick(); }, fire(name, event = {}) { listeners.get(name)?.(event); } };
}

test('browser tracker excludes local previews and Global Privacy Control requests', () => {
  assert.equal(browser('localhost').messages.length, 0);
  assert.equal(browser('lingyao-kong.github.io', true).messages.length, 0);
});

test('browser tracker follows client navigation without counting heartbeats as new pageviews', () => {
  const b = browser();
  assert.equal(b.messages.length, 1);
  const first = b.messages[0];
  b.at(2000); b.tick();
  assert.equal(b.messages[1].id, first.id);
  assert.equal(b.messages[1].duration, 2000);
  b.at(5000); b.history.pushState({}, '', '/publications/');
  assert.equal(new Set(b.messages.map(m => m.id)).size, 2);
  const current = b.messages.at(-1);
  assert.equal(current.path, '/publications/');
  assert.equal(current.visitor, first.visitor);
  assert.equal(b.messages.findLast(m => m.id === first.id).duration, 5000);
  b.history.replaceState({}, '', '/publications/');
  assert.equal(new Set(b.messages.map(m => m.id)).size, 2);
});

test('browser tracker does not count time spent in a hidden tab as active duration', () => {
  const b = browser();
  b.at(2000); b.document.visibilityState = 'hidden'; b.fire('visibilitychange');
  b.at(12000); b.document.visibilityState = 'visible'; b.fire('visibilitychange');
  b.at(15000); b.tick();
  assert.equal(b.messages.at(-1).duration, 5000);
});
