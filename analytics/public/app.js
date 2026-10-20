(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let cursors = [null], page = 0, next = null, loading = false;
  let appliedRange = new URLSearchParams();
  const number = n => Number(n || 0).toLocaleString('zh-CN');
  const duration = ms => ms < 60000 ? Math.round(ms / 1000) + ' 秒' : Math.round(ms / 60000) + ' 分钟';
  const time = ms => new Date(ms).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const today = offset => new Date(Date.now() + 8 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  function message(text = '') { $('message').textContent = text; }
  function showLogin() { $('login').hidden = false; $('dashboard').hidden = true; $('logout').hidden = true; }
  function showDashboard() { $('login').hidden = true; $('dashboard').hidden = false; $('logout').hidden = false; }
  async function api(path, options) {
    const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) showLogin();
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败，请稍后重试');
    return data;
  }
  function range() {
    const params = new URLSearchParams();
    if ($('from').value) params.set('from', $('from').value);
    if ($('to').value) params.set('to', $('to').value);
    return params;
  }
  function empty(container) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '这个范围内还没有记录'; container.replaceChildren(p); }
  function rank(container, rows, key) {
    container.replaceChildren();
    if (!rows.length) return empty(container);
    for (const row of rows) {
      const line = document.createElement('div'); line.className = 'rank';
      const label = document.createElement('span'); label.textContent = row[key] === 'direct' ? '直接访问 / 未提供来源' : row[key];
      const count = document.createElement('strong'); count.textContent = number(row.visits);
      line.append(label, count); container.append(line);
    }
  }
  function trend(rows) {
    const container = $('trend'); container.replaceChildren();
    if (!rows.length) return empty(container);
    const max = Math.max(...rows.map(r => r.pageviews));
    for (const row of rows) {
      const bar = document.createElement('div'); bar.className = 'bar';
      bar.style.setProperty('--height', Math.max(2, row.pageviews / max * 100) + '%');
      bar.title = `${row.day}：${row.visitors} 位访客，${row.pageviews} 次浏览`;
      bar.setAttribute('aria-label', bar.title); container.append(bar);
    }
  }
  async function visits(params = new URLSearchParams(appliedRange)) {
    if (cursors[page]) params.set('cursor', cursors[page]);
    const data = await api('/api/visits?' + params);
    next = data.next;
    const body = $('visits'); body.replaceChildren();
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      const values = [time(row.created_at), row.visitor_id.slice(0, 8), row.path, row.source === 'direct' ? '直接 / 未知' : row.source, row.country || '未知', row.device + ' / ' + row.browser, duration(row.duration_ms)];
      for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      body.append(tr);
    }
    if (!data.rows.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 7; td.className = 'empty'; td.textContent = '还没有采集到访问记录'; tr.append(td); body.append(tr); }
    $('previous').disabled = page === 0; $('next').disabled = !next; $('page-number').textContent = '第 ' + (page + 1) + ' 页';
  }
  async function load() {
    if (loading) return;
    loading = true; $('refresh').disabled = true; message('正在读取记录…');
    try {
      const params = range();
      const summary = await api('/api/summary?' + params);
      appliedRange = new URLSearchParams(params);
      showDashboard();
      $('visitors').textContent = number(summary.totals.visitors); $('pageviews').textContent = number(summary.totals.pageviews); $('duration').textContent = duration(summary.totals.duration_ms);
      $('range-note').textContent = params.size ? '所选日期范围' : '全部已保存历史';
      rank($('sources'), summary.sources, 'source'); rank($('pages'), summary.pages, 'path'); trend(summary.daily);
      cursors = [null]; page = 0; await visits(); message();
    } catch (error) { message(error.message); }
    finally { loading = false; $('refresh').disabled = false; }
  }
  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: $('key').value }) }); $('key').value = ''; await load(); }
    catch (error) { message(error.message); }
  });
  $('logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); showLogin(); message(); } catch (e) { message(e.message); } });
  $('period').addEventListener('change', () => {
    const value = $('period').value;
    if (value === 'all') { $('from').value = ''; $('to').value = ''; }
    else if (value !== 'custom') { $('from').value = today(-(Number(value) - 1)); $('to').value = today(0); }
  });
  for (const id of ['from', 'to']) $(id).addEventListener('change', () => { $('period').value = 'custom'; });
  $('refresh').addEventListener('click', load);
  for (const id of ['previous', 'next']) $(id).addEventListener('click', async () => {
    if (loading) return;
    loading = true;
    try {
      if (id === 'next' && next) { page++; cursors[page] = next; } else if (id === 'previous' && page > 0) page--;
      await visits(); message();
    } catch (e) { message(e.message); } finally { loading = false; }
  });
  $('export').addEventListener('click', async () => {
    const button = $('export'); button.disabled = true;
    const header = ['记录编号', '匿名访客编号', '访问时间（北京时间）', '页面', '来源', '国家地区', '设备', '浏览器', '活跃停留毫秒'];
    function cell(value) { let s = String(value ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; }
    const chunks = ['\uFEFF' + header.map(cell).join(',') + '\r\n'];
    const exportRange = new URLSearchParams(appliedRange);
    let cursor = null, count = 0;
    try {
      do {
        const params = new URLSearchParams(exportRange); params.set('limit', '1000'); if (cursor) params.set('cursor', cursor);
        const data = await api('/api/visits?' + params);
        chunks.push(data.rows.map(r => [r.id, r.visitor_id, time(r.created_at), r.path, r.source, r.country, r.device, r.browser, r.duration_ms].map(cell).join(',')).join('\r\n') + (data.rows.length ? '\r\n' : ''));
        count += data.rows.length; cursor = data.next; message('正在导出 ' + number(count) + ' 条记录…');
      } while (cursor);
      const href = URL.createObjectURL(new Blob(chunks, { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = href; link.download = 'lingyao-visits-' + today(0) + '.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(href), 10000);
      message('已导出 ' + number(count) + ' 条记录。');
    } catch (e) { message(e.message); }
    finally { button.disabled = false; }
  });
  load();
})();
