(function () {
  'use strict';
  if (location.hostname !== 'lingyao-kong.github.io' || window.__lingyaoStats || navigator.globalPrivacyControl === true) return;
  var endpoint = document.currentScript && document.currentScript.dataset.endpoint;
  if (!endpoint) return;
  window.__lingyaoStats = true;
  var visitor;
  try {
    visitor = localStorage.getItem('lingyao-visitor-id');
    if (!/^[a-f0-9-]{36}$/i.test(visitor || '')) { visitor = crypto.randomUUID(); localStorage.setItem('lingyao-visitor-id', visitor); }
  } catch (_) { visitor = crypto.randomUUID(); }
  var event, active = 0, since = performance.now(), visible = document.visibilityState === 'visible';
  function clock() { var now = performance.now(); if (visible) active += now - since; since = now; }
  function send(beacon) {
    if (!event) return;
    clock();
    event.duration = Math.round(active);
    var body = JSON.stringify(event);
    if (beacon && navigator.sendBeacon && navigator.sendBeacon(endpoint, body)) return;
    fetch(endpoint, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, mode: 'cors', credentials: 'omit', keepalive: true }).catch(function () {});
  }
  function start() {
    if (event && event.path === location.pathname) return;
    if (event) send(true);
    active = 0; since = performance.now(); visible = document.visibilityState === 'visible';
    event = { id: crypto.randomUUID(), visitor: visitor, path: location.pathname, source: document.referrer, duration: 0 };
    send(false);
  }
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    history[method] = function () { var value = original.apply(this, arguments); start(); return value; };
  });
  window.addEventListener('popstate', start);
  window.addEventListener('pagehide', function () { send(true); visible = false; });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { visible = document.visibilityState === 'visible'; since = performance.now(); } });
  document.addEventListener('visibilitychange', function () { clock(); visible = document.visibilityState === 'visible'; send(!visible); });
  setInterval(function () { if (visible) send(false); }, 30000);
  start();
})();
