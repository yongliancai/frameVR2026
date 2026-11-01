/* FrameVR 學習行為後台 */
(function () {
  'use strict';

  // ---------- 對照表 ----------
  const EVENT_LABEL = {
    session_start: '進入', heartbeat: '心跳', session_end: '離開', click: '點擊',
    material_open: '開啟教材', material_close: '關閉教材',
    like: '喜歡', unlike: '取消喜歡', favorite: '收藏', unfavorite: '取消收藏',
  };
  const TYPE_LABEL = { board: '展板', model: '3D 模型', video: '影片', button: '互動按鈕', material: '教材', other: '其他' };
  const TYPE_SLOT = { board: 1, model: 2, video: 3, button: 4, material: 5, other: 7 }; // 顏色跟著物件類型，不跟排名

  const state = { range: '30', from: '', to: '', frame: '', view: 'overview', charts: [], timer: null, eventsOffset: 0, eventsType: '', eventsStudent: '', studentSort: { key: 'total_ms', dir: -1 } };
  const $ = (s, el = document) => el.querySelector(s);
  const view = $('#view');

  // ---------- 小工具 ----------
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const slot = (n) => css('--s' + n);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString('zh-TW'));
  function fmtDur(ms) {
    if (!ms || ms < 0) return '0 秒';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + ' 分' + (r ? ' ' + r + ' 秒' : '');
    const h = Math.floor(m / 60);
    return h + ' 小時 ' + (m % 60) + ' 分';
  }
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–');
  const fmtClock = (ms) => new Date(ms).toLocaleTimeString('zh-TW', { hour12: false });

  function query(extra) {
    const p = new URLSearchParams();
    if (state.from) p.set('from', state.from);
    if (state.to) p.set('to', state.to);
    if (state.frame) p.set('frame', state.frame);
    for (const [k, v] of Object.entries(extra || {})) if (v !== '' && v != null) p.set(k, v);
    const s = p.toString();
    return s ? '?' + s : '';
  }
  async function api(path, extra) {
    const r = await fetch('api/' + path + query(extra), { credentials: 'same-origin' });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  }

  function destroyCharts() { state.charts.forEach((c) => c.destroy()); state.charts = []; }

  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = css('font-family') || 'system-ui';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--grid');
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = css('--ink');
    Chart.defaults.plugins.tooltip.titleColor = css('--surface');
    Chart.defaults.plugins.tooltip.bodyColor = css('--surface');
    Chart.defaults.plugins.tooltip.padding = 8;
    Chart.defaults.plugins.tooltip.displayColors = false;
    Chart.defaults.maintainAspectRatio = false;
  }

  function makeChart(canvas, cfg) {
    if (!window.Chart) { canvas.parentElement.innerHTML = '<div class="empty">無法載入圖表程式庫（Chart.js）</div>'; return; }
    const c = new Chart(canvas, cfg);
    state.charts.push(c);
    return c;
  }

  const axisY = (title) => ({ beginAtZero: true, grid: { color: css('--grid') }, border: { display: false }, ticks: { precision: 0 }, title: title ? { display: true, text: title, color: css('--muted') } : undefined });
  const axisX = () => ({ grid: { display: false }, border: { color: css('--axis') } });

  // ---------- 篩選列 ----------
  function setRange(r) {
    state.range = r;
    const today = new Date();
    const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (r === 'today') { state.from = state.to = ymd(today); }
    else if (r === 'all') { state.from = state.to = ''; }
    else if (r !== 'custom') { const d = new Date(today); d.setDate(d.getDate() - (Number(r) - 1)); state.from = ymd(d); state.to = ymd(today); }
    $('#from').value = state.from; $('#to').value = state.to;
    document.querySelectorAll('#range button').forEach((b) => b.classList.toggle('on', b.dataset.range === r));
  }
  $('#range').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setRange(b.dataset.range); state.eventsOffset = 0; render(); });
  $('#from').addEventListener('change', (e) => { state.from = e.target.value; setRange('custom'); state.eventsOffset = 0; render(); });
  $('#to').addEventListener('change', (e) => { state.to = e.target.value; setRange('custom'); state.eventsOffset = 0; render(); });
  $('#frame').addEventListener('change', (e) => { state.frame = e.target.value; state.eventsOffset = 0; render(); });
  $('#auto').addEventListener('change', schedule);

  function schedule() {
    clearInterval(state.timer);
    if ($('#auto').checked) state.timer = setInterval(() => { if ($('#drawer').hidden) render(true); }, 30000);
  }

  async function loadFrames() {
    try {
      const frames = await fetch('api/frames').then((r) => r.json());
      const sel = $('#frame');
      sel.innerHTML = '<option value="">全部 Frame</option>' + frames.map((f) => `<option value="${esc(f.frame)}">${esc(f.frame)}（${f.sessions}）</option>`).join('');
      sel.value = state.frame;
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 路由 ----------
  const VIEWS = { overview: renderOverview, students: renderStudents, materials: renderMaterials, clicks: renderClicks, events: renderEvents, system: renderSystem };
  function route() {
    const v = (location.hash || '#overview').slice(1);
    state.view = VIEWS[v] ? v : 'overview';
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + state.view));
    render();
  }
  window.addEventListener('hashchange', route);

  let renderToken = 0;
  async function render(silent) {
    const token = ++renderToken;
    if (!silent) view.innerHTML = '<div class="empty">載入中…</div>';
    try {
      const html = await VIEWS[state.view]();
      if (token !== renderToken) return;
      destroyCharts();
      chartDefaults();
      view.innerHTML = html.html;
      html.after && html.after();
      $('#stamp').textContent = '更新於 ' + fmtClock(Date.now());
    } catch (e) {
      console.error(e);
      if (token === renderToken) view.innerHTML = `<div class="card empty">讀取資料失敗：${esc(e.message)}</div>`;
    }
  }

  // ---------- 總覽 ----------
  async function renderOverview() {
    const d = await api('overview');
    const k = d.kpi;
    const kpi = (label, value, unit, extra) => `<div class="kpi"><div class="label">${extra || ''}${label}</div><div class="value">${value}<span class="unit">${unit || ''}</span></div></div>`;
    const counts = Object.entries(d.event_counts).filter(([t]) => t !== 'heartbeat').sort((a, b) => b[1] - a[1]);
    return {
      html: `
        <div class="kpis">
          ${kpi('近 5 分鐘有動作', fmtNum(k.online_now), '人', '<span class="dot" aria-hidden="true"></span>')}
          ${kpi('學生數', fmtNum(k.students), '人')}
          ${kpi('使用次數', fmtNum(k.sessions), '次')}
          ${kpi('累積使用時長', fmtNum(k.total_minutes), '分鐘')}
          ${kpi('平均每次使用', k.avg_session_minutes, '分鐘')}
          ${kpi('物件點擊', fmtNum(k.clicks), '次')}
          ${kpi('教材開啟', fmtNum(k.material_opens), '次')}
          ${kpi('喜歡（扣除取消）', fmtNum(k.likes), '次')}
          ${kpi('收藏（扣除取消）', fmtNum(k.favorites), '次')}
        </div>
        <div class="grid g2">
          <div class="card"><h2>每日使用人數</h2><p class="sub">當天至少進入一次的學生數</p><div class="chart"><canvas id="c-students"></canvas></div></div>
          <div class="card"><h2>每日累積使用時長</h2><p class="sub">分鐘；未正常離開者以最後一次心跳估算</p><div class="chart"><canvas id="c-minutes"></canvas></div></div>
        </div>
        <div class="grid g3">
          <div class="card"><h2>互動熱度</h2><p class="sub">星期 × 時段的事件數（台灣時間，不含心跳）</p>${heatmap(d.heatmap)}</div>
          <div class="card"><h2>事件類型</h2><p class="sub">篩選範圍內的事件數</p><div class="chart"><canvas id="c-types"></canvas></div></div>
        </div>`,
      after() {
        const days = d.daily.map((r) => r.day.slice(5));
        if (!d.daily.length) { ['c-students', 'c-minutes'].forEach((id) => ($('#' + id).parentElement.innerHTML = '<div class="empty">此範圍沒有資料</div>')); }
        else {
          makeChart($('#c-students'), { type: 'bar', data: { labels: days, datasets: [{ data: d.daily.map((r) => r.students), backgroundColor: slot(1), borderRadius: 4, maxBarThickness: 28 }] },
            options: { scales: { x: axisX(), y: axisY('人') }, plugins: { tooltip: { callbacks: { title: (i) => d.daily[i[0].dataIndex].day, label: (i) => i.raw + ' 人，' + d.daily[i.dataIndex].sessions + ' 次進入' } } } } });
          makeChart($('#c-minutes'), { type: 'line', data: { labels: days, datasets: [{ data: d.daily.map((r) => r.minutes), borderColor: slot(1), backgroundColor: slot(1), borderWidth: 2, pointRadius: d.daily.length > 20 ? 0 : 4, pointHoverRadius: 5, tension: 0 }] },
            options: { interaction: { mode: 'index', intersect: false }, scales: { x: axisX(), y: axisY('分鐘') }, plugins: { tooltip: { callbacks: { title: (i) => d.daily[i[0].dataIndex].day, label: (i) => i.raw + ' 分鐘' } } } } });
        }
        if (counts.length) {
          makeChart($('#c-types'), { type: 'bar', data: { labels: counts.map(([t]) => EVENT_LABEL[t] || t), datasets: [{ data: counts.map(([, n]) => n), backgroundColor: slot(1), borderRadius: 4, barThickness: 14 }] },
            options: { indexAxis: 'y', scales: { x: axisY(), y: { grid: { display: false }, border: { display: false } } }, plugins: { tooltip: { callbacks: { label: (i) => fmtNum(i.raw) + ' 筆' } } } } });
        } else $('#c-types').parentElement.innerHTML = '<div class="empty">此範圍沒有資料</div>';
        bindHeatTips();
      },
    };
  }

  function heatmap(rows) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    rows.forEach((r) => { grid[r.dow][r.hour] = r.n; max = Math.max(max, r.n); });
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    const order = [1, 2, 3, 4, 5, 6, 0];
    const step = (n) => (n === 0 ? null : Math.min(7, Math.ceil((n / max) * 7)));
    let html = '<div class="heat" role="img" aria-label="星期與時段的互動熱度"><div></div>';
    for (let h = 0; h < 24; h++) html += `<div class="h">${h % 3 === 0 ? h : ''}</div>`;
    order.forEach((dw) => {
      html += `<div>週${days[dw]}</div>`;
      for (let h = 0; h < 24; h++) {
        const n = grid[dw][h], s = step(n);
        html += `<div class="c" data-tip="週${days[dw]} ${h}:00–${h + 1}:00　${n} 筆" style="${s ? 'background:var(--q' + s + ')' : ''}"></div>`;
      }
    });
    html += '</div><div class="heat-scale">少';
    for (let i = 1; i <= 7; i++) html += `<span class="c" style="background:var(--q${i})"></span>`;
    html += '多</div>';
    return html;
  }

  function bindHeatTips() {
    const tip = $('#tip');
    view.querySelectorAll('[data-tip]').forEach((el) => {
      el.addEventListener('mouseenter', () => { tip.textContent = el.dataset.tip; tip.hidden = false; });
      el.addEventListener('mousemove', (e) => { tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY + 12 + 'px'; });
      el.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }

  // ---------- 學生 ----------
  async function renderStudents() {
    const rows = await api('students');
    const { key, dir } = state.studentSort;
    rows.sort((a, b) => { const x = a[key], y = b[key]; return (typeof x === 'string' ? x.localeCompare(y) : (x || 0) - (y || 0)) * dir; });
    const maxMs = Math.max(1, ...rows.map((r) => r.total_ms || 0));
    const th = (k, label, num) => `<th class="sortable ${num ? 'num' : ''}" data-sort="${k}">${label}${key === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`;
    return {
      html: `<div class="card">
        <div class="card-head"><div><h2>學生使用紀錄</h2><p class="sub">${rows.length} 位學生；點一列查看工作階段與操作歷程</p></div>
          <div class="row"><a class="btn" href="api/export/sessions.csv${query()}">匯出工作階段 CSV</a></div></div>
        ${rows.length ? `<div class="table-wrap"><table>
          <thead><tr>${th('student_id', '學生識別碼')}${th('sessions', '使用次數', 1)}${th('total_ms', '累積使用時長')}${th('avg_session_ms', '平均每次', 1)}${th('clicks', '點擊', 1)}${th('opens', '開啟教材', 1)}${th('materials', '看過教材數', 1)}${th('material_ms', '教材互動時間', 1)}${th('likes', '喜歡', 1)}${th('favorites', '收藏', 1)}${th('last_seen', '最後使用', 1)}</tr></thead>
          <tbody>${rows.map((r) => `<tr class="clickable" data-student="${esc(r.student_id)}">
            <td>${r.online ? '<span class="dot" title="近 5 分鐘有動作"></span>' : ''}${esc(r.student_id)}</td>
            <td class="num">${fmtNum(r.sessions)}</td>
            <td><div class="bar-cell"><div class="bar" style="width:${Math.max(2, (r.total_ms / maxMs) * 120)}px"></div>${fmtDur(r.total_ms)}</div></td>
            <td class="num">${fmtDur(r.avg_session_ms)}</td>
            <td class="num">${fmtNum(r.clicks || 0)}</td>
            <td class="num">${fmtNum(r.opens || 0)}</td>
            <td class="num">${fmtNum(r.materials || 0)}</td>
            <td class="num">${fmtDur(r.material_ms || 0)}</td>
            <td class="num">${fmtNum(r.likes || 0)}</td>
            <td class="num">${fmtNum(r.favorites || 0)}</td>
            <td class="num">${fmtTime(r.last_seen)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">此範圍沒有學生資料</div>'}
      </div>`,
      after() {
        view.querySelectorAll('th[data-sort]').forEach((t) => t.addEventListener('click', () => {
          const k = t.dataset.sort;
          state.studentSort = { key: k, dir: state.studentSort.key === k ? -state.studentSort.dir : (k === 'student_id' ? 1 : -1) };
          render(true);
        }));
        view.querySelectorAll('tr[data-student]').forEach((tr) => tr.addEventListener('click', () => openStudent(tr.dataset.student)));
      },
    };
  }

  async function openStudent(id) {
    const drawer = $('#drawer'), body = $('#drawer-body');
    drawer.hidden = false;
    body.innerHTML = '<div class="empty">載入中…</div>';
    const d = await fetch('api/students/' + encodeURIComponent(id)).then((r) => r.json());
    const total = d.sessions.reduce((s, x) => s + x.duration_ms, 0);
    const bySession = new Map();
    d.events.forEach((e) => { if (!bySession.has(e.session_id)) bySession.set(e.session_id, []); bySession.get(e.session_id).push(e); });

    const maxDur = Math.max(1, ...d.sessions.map((s) => s.duration_ms));
    const timeline = d.sessions.slice(0, 30).map((s) => `
      <div class="tl-row">
        <div>${fmtTime(s.start_ts)}</div>
        <div class="tl-track" title="${esc(fmtTime(s.start_ts) + ' → ' + fmtTime(s.end_ts || s.last_ts))}"><div class="tl-bar ${s.end_ts && s.end_reason !== 'timeout' ? '' : 'open'}" style="left:0;width:${Math.max(1, (s.duration_ms / maxDur) * 100)}%"></div></div>
        <div style="text-align:right">${fmtDur(s.duration_ms)}</div>
      </div>`).join('');

    const sessionsHtml = d.sessions.slice(0, 20).map((s) => {
      const evs = bySession.get(s.session_id) || [];
      const items = evs.map((e) => `<li>
        <span class="t">#${e.seq ?? ''}</span>
        <span class="t">${fmtClock(e.ts)}</span>
        <span>${esc(EVENT_LABEL[e.event_type] || e.event_type)}</span>
        <span class="wrap">${e.target_type ? `<span class="sw" style="background:${slot(TYPE_SLOT[e.target_type] || 7)}"></span>` : ''}${esc(e.target_name || '')}${e.target_type ? ` <span class="pill">${esc(TYPE_LABEL[e.target_type] || e.target_type)}</span>` : ''}</span>
        <span class="t">${e.duration_ms ? fmtDur(e.duration_ms) : ''}</span></li>`).join('');
      return `<div class="card"><div class="card-head"><div><h2>${fmtTime(s.start_ts)}　${fmtDur(s.duration_ms)}</h2>
        <p class="sub">工作階段 ${esc(s.session_id)}・${s.end_ts && s.end_reason !== 'timeout' ? '離開 ' + fmtTime(s.end_ts) : (s.online ? '進行中' : '閒置逾時，以最後一次動作 ' + fmtTime(s.last_ts) + ' 當作離開時間')}・${s.frame ? esc(s.frame) : ''}</p></div></div>
        ${items ? `<ul class="seq">${items}</ul>` : '<div class="empty">沒有互動事件</div>'}</div>`;
    }).join('');

    body.innerHTML = `
      <h1 id="drawer-title">學生 ${esc(id)}</h1>
      <div class="kpis" style="margin-bottom:16px">
        <div class="kpi"><div class="label">使用次數</div><div class="value">${d.sessions.length}<span class="unit">次</span></div></div>
        <div class="kpi"><div class="label">累積使用時長</div><div class="value" style="font-size:22px">${fmtDur(total)}</div></div>
        <div class="kpi"><div class="label">喜歡的教材</div><div class="value">${d.preferences.filter((p) => p.liked).length}</div></div>
        <div class="kpi"><div class="label">收藏的教材</div><div class="value">${d.preferences.filter((p) => p.favorited).length}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><h2>每次使用時長</h2><p class="sub">最近 30 次；斜紋代表沒有點「離開」，時長以最後一次動作估算</p><div class="timeline">${timeline || '<div class="empty">沒有資料</div>'}</div></div>
      ${d.preferences.length ? `<div class="card" style="margin-bottom:16px"><h2>目前的喜好</h2><p class="sub">以最後一次操作為準</p>
        <table><thead><tr><th>教材</th><th>喜歡</th><th>收藏</th></tr></thead><tbody>${d.preferences.map((p) => `<tr><td>${esc(p.target_name || p.target_id)}</td><td>${p.liked ? '♥' : ''}</td><td>${p.favorited ? '★' : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="row" style="margin-bottom:10px"><h2 style="font-size:15px;margin:0">操作歷程</h2><span class="sub" style="margin:0;color:var(--muted)">每次工作階段內依先後順序（#）列出</span>
        <a class="btn" style="margin-left:auto" href="api/export/events.csv?student=${encodeURIComponent(id)}">匯出此學生事件 CSV</a></div>
      <div class="grid">${sessionsHtml}</div>`;
  }
  $('#drawer-close').addEventListener('click', () => ($('#drawer').hidden = true));
  $('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') $('#drawer').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#drawer').hidden = true; });

  // ---------- 教材 ----------
  async function renderMaterials() {
    const [rows, seq] = await Promise.all([api('materials'), api('sequences')]);
    const top = rows.slice(0, 15);
    return {
      html: `
        <div class="grid g2">
          <div class="card"><h2>教材開啟次數</h2><p class="sub">前 15 名；顏色代表物件類型</p>${typeLegend(top)}<div class="chart tall"><canvas id="c-opens"></canvas></div></div>
          <div class="card"><h2>平均互動時間</h2><p class="sub">每次開啟到關閉（或切換到下一份）的平均時間，秒</p>${typeLegend(top)}<div class="chart tall"><canvas id="c-dwell"></canvas></div></div>
        </div>
        <div class="card"><h2>教材互動明細</h2><p class="sub">喜歡／收藏「目前」為每位學生最後一次操作後的人數</p>
          ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>教材</th><th>類型</th><th class="num">開啟次數</th><th class="num">開啟人數</th><th class="num">累積互動</th><th class="num">平均互動</th><th class="num">喜歡（目前）</th><th class="num">取消喜歡次數</th><th class="num">收藏（目前）</th><th class="num">取消收藏次數</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.target_name || r.target_id)}</td><td><span class="sw" style="background:${slot(TYPE_SLOT[r.target_type] || 7)}"></span>${esc(TYPE_LABEL[r.target_type] || r.target_type || '')}</td>
            <td class="num">${fmtNum(r.opens)}</td><td class="num">${fmtNum(r.students)}</td><td class="num">${fmtDur(r.total_ms)}</td><td class="num">${fmtDur(r.avg_ms)}</td>
            <td class="num">${fmtNum(r.liked_now)}</td><td class="num">${fmtNum(r.unlike_events)}</td><td class="num">${fmtNum(r.favorited_now)}</td><td class="num">${fmtNum(r.unfavorite_events)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">此範圍沒有教材互動</div>'}
        </div>
        <div class="grid g2">
          <div class="card"><h2>最常見的瀏覽順序</h2><p class="sub">同一次使用中，從 A 教材接著開啟 B 教材的次數</p>
            ${seq.transitions.length ? `<div class="table-wrap"><table><thead><tr><th>先開啟</th><th></th><th>接著開啟</th><th class="num">次數</th></tr></thead><tbody>
            ${seq.transitions.map((t) => `<tr><td>${esc(t.from_name)}</td><td>→</td><td>${esc(t.to_name)}</td><td class="num">${t.count}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">尚無資料</div>'}</div>
          <div class="card"><h2>第一個開啟的教材</h2><p class="sub">每次使用時最先開啟的教材，次數</p>
            ${seq.first_opened.length ? `<table><thead><tr><th>教材</th><th class="num">次數</th></tr></thead><tbody>${seq.first_opened.map((f) => `<tr><td>${esc(f.target_name)}</td><td class="num">${f.sessions}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">尚無資料</div>'}</div>
        </div>`,
      after() {
        if (!top.length) { ['c-opens', 'c-dwell'].forEach((id) => ($('#' + id).parentElement.innerHTML = '<div class="empty">此範圍沒有教材互動</div>')); return; }
        const labels = top.map((r) => r.target_name || r.target_id);
        const colors = top.map((r) => slot(TYPE_SLOT[r.target_type] || 7));
        const hbar = (data, fmt) => ({ type: 'bar', data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, barThickness: 14 }] },
          options: { indexAxis: 'y', scales: { x: axisY(), y: { grid: { display: false }, border: { display: false } } }, plugins: { tooltip: { callbacks: { label: fmt } } } } });
        makeChart($('#c-opens'), hbar(top.map((r) => r.opens), (i) => i.raw + ' 次，' + top[i.dataIndex].students + ' 人'));
        makeChart($('#c-dwell'), hbar(top.map((r) => Math.round(r.avg_ms / 100) / 10), (i) => fmtDur(top[i.dataIndex].avg_ms)));
      },
    };
  }

  function typeLegend(rows) {
    const types = [...new Set(rows.map((r) => r.target_type || 'other'))];
    if (types.length < 2) return '';
    return `<div class="legend">${types.map((t) => `<span><span class="sw" style="background:${slot(TYPE_SLOT[t] || 7)}"></span>${esc(TYPE_LABEL[t] || t)}</span>`).join('')}</div>`;
  }

  // ---------- 點擊 ----------
  async function renderClicks() {
    const d = await api('clicks');
    return {
      html: `
        <div class="grid g3">
          <div class="card"><h2>點擊最多的物件</h2><p class="sub">前 15 名</p>${typeLegend(d.top.slice(0, 15))}<div class="chart tall"><canvas id="c-top"></canvas></div></div>
          <div class="card"><h2>依物件類型</h2><p class="sub">點擊次數</p>
            ${d.by_type.length ? `<table><thead><tr><th>類型</th><th class="num">點擊</th><th class="num">人數</th></tr></thead><tbody>${d.by_type.map((r) => `<tr><td><span class="sw" style="background:${slot(TYPE_SLOT[r.target_type] || 7)}"></span>${esc(TYPE_LABEL[r.target_type] || r.target_type)}</td><td class="num">${fmtNum(r.clicks)}</td><td class="num">${fmtNum(r.students)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">尚無點擊</div>'}
          </div>
        </div>
        <div class="card"><h2>物件點擊明細</h2><p class="sub">類型為「其他」的是尚未加入 tracker.js TARGETS 對照表的物件，可用這裡的名稱補進去</p>
          ${d.top.length ? `<div class="table-wrap"><table><thead><tr><th>物件</th><th>識別碼</th><th>類型</th><th class="num">點擊</th><th class="num">人數</th></tr></thead><tbody>
          ${d.top.map((r) => `<tr><td>${esc(r.target_name)}</td><td><code>${esc(r.target_id)}</code></td><td>${esc(TYPE_LABEL[r.target_type] || r.target_type || '')}</td><td class="num">${fmtNum(r.clicks)}</td><td class="num">${fmtNum(r.students)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">尚無點擊</div>'}
        </div>`,
      after() {
        const top = d.top.slice(0, 15);
        if (!top.length) { $('#c-top').parentElement.innerHTML = '<div class="empty">尚無點擊</div>'; return; }
        makeChart($('#c-top'), { type: 'bar', data: { labels: top.map((r) => r.target_name || r.target_id), datasets: [{ data: top.map((r) => r.clicks), backgroundColor: top.map((r) => slot(TYPE_SLOT[r.target_type] || 7)), borderRadius: 4, barThickness: 14 }] },
          options: { indexAxis: 'y', scales: { x: axisY(), y: { grid: { display: false }, border: { display: false } } }, plugins: { tooltip: { callbacks: { label: (i) => i.raw + ' 次，' + top[i.dataIndex].students + ' 人' } } } } });
      },
    };
  }

  // ---------- 事件紀錄 ----------
  async function renderEvents() {
    const limit = 100;
    const d = await api('event-list', { limit, offset: state.eventsOffset, type: state.eventsType, student: state.eventsStudent });
    const opts = Object.entries(EVENT_LABEL).map(([k, v]) => `<option value="${k}" ${state.eventsType === k ? 'selected' : ''}>${v}（${k}）</option>`).join('');
    return {
      html: `<div class="card">
        <div class="card-head"><div><h2>事件紀錄</h2><p class="sub">共 ${fmtNum(d.total)} 筆（預設不含心跳）；時間為事件發生時間</p></div>
          <div class="row">
            <select id="ev-type"><option value="">全部事件</option>${opts}</select>
            <input id="ev-student" placeholder="學生識別碼" value="${esc(state.eventsStudent)}" style="width:130px;padding:5px 8px;border:1px solid var(--ring);border-radius:8px;background:var(--surface)">
            <a class="btn" href="api/export/events.csv${query({ student: state.eventsStudent })}">匯出事件 CSV</a>
          </div></div>
        ${d.rows.length ? `<div class="table-wrap"><table><thead><tr><th>時間</th><th>學生</th><th>事件</th><th>物件</th><th>類型</th><th class="num">時長</th><th class="num">順序</th><th>工作階段</th><th>Frame</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td>${fmtTime(r.ts)}</td><td>${esc(r.student_id)}</td><td>${esc(EVENT_LABEL[r.event_type] || r.event_type)}</td><td>${esc(r.target_name || '')}</td><td>${esc(TYPE_LABEL[r.target_type] || r.target_type || '')}</td><td class="num">${r.duration_ms ? fmtDur(r.duration_ms) : ''}</td><td class="num">${r.seq ?? ''}</td><td><code title="${esc(r.session_id)}">${esc(String(r.session_id).slice(0, 8))}</code></td><td>${esc(r.frame || '')}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="pager"><button class="btn" id="prev" ${state.eventsOffset ? '' : 'disabled'}>上一頁</button><span>${state.eventsOffset + 1}–${state.eventsOffset + d.rows.length} / ${fmtNum(d.total)}</span><button class="btn" id="next" ${state.eventsOffset + limit < d.total ? '' : 'disabled'}>下一頁</button></div>` : '<div class="empty">沒有符合的事件</div>'}
      </div>`,
      after() {
        $('#ev-type').addEventListener('change', (e) => { state.eventsType = e.target.value; state.eventsOffset = 0; render(); });
        $('#ev-student').addEventListener('change', (e) => { state.eventsStudent = e.target.value.trim(); state.eventsOffset = 0; render(); });
        const p = $('#prev'), n = $('#next');
        p && p.addEventListener('click', () => { state.eventsOffset = Math.max(0, state.eventsOffset - limit); render(); });
        n && n.addEventListener('click', () => { state.eventsOffset += limit; render(); });
      },
    };
  }

  // ---------- 設定（FrameVR Action Editor） ----------
  const TEMPLATES = [
    { key: 'enter', title: '進入（出生點的靠近觸發）', trigger: 'Proximity（靠近）', note: '在出生點放一個透明的大方塊，學生一進場就會觸發，記錄「進入時間」。',
      body: { event: 'enter', student: '%nametag%', user: '%uniqueUserId%', frame: '%frameName%', asset_id: '%assetId%', asset_name: '%assetName%', asset_type: '%assetType%' } },
    { key: 'material', title: '開啟教材（展板／3D 模型／影片封面）', trigger: 'Click/Tap（點擊）', note: '每份教材都用同一段內容，教材名稱會自動帶入物件名稱（%assetName%），請先把物件取好名字。category 依物件改成 board、model 或 video。',
      body: { event: 'material', category: 'board', student: '%nametag%', user: '%uniqueUserId%', frame: '%frameName%', asset_id: '%assetId%', asset_name: '%assetName%', asset_type: '%assetType%' } },
    { key: 'click', title: '互動按鈕（非教材）', trigger: 'Click/Tap（點擊）', note: '例如測驗按鈕、傳送門，只記錄點擊次數。',
      body: { event: 'click', category: 'button', student: '%nametag%', user: '%uniqueUserId%', frame: '%frameName%', asset_id: '%assetId%', asset_name: '%assetName%', asset_type: '%assetType%' } },
    { key: 'like', title: '喜歡按鈕', trigger: 'Click/Tap（點擊）', note: '每按一次在「喜歡／取消喜歡」之間切換。material 填這顆按鈕對應的教材物件名稱（和教材的物件名稱完全一樣）。',
      body: { event: 'like', material: '教材物件名稱', student: '%nametag%', user: '%uniqueUserId%', frame: '%frameName%', asset_name: '%assetName%' } },
    { key: 'favorite', title: '收藏按鈕', trigger: 'Click/Tap（點擊）', note: '每按一次在「收藏／取消收藏」之間切換，material 同上。',
      body: { event: 'favorite', material: '教材物件名稱', student: '%nametag%', user: '%uniqueUserId%', frame: '%frameName%', asset_name: '%assetName%' } },
    { key: 'leave', title: '離開（選用）', trigger: 'Click/Tap 或 Proximity', note: '放在出口或「結束」按鈕上。沒有設定也沒關係，閒置超過設定時間會自動當作離開。',
      body: { event: 'leave', student: '%nametag%', user: '%uniqueUserId%', frame: '%frameName%', asset_name: '%assetName%' } },
  ];

  async function renderSystem() {
    const [probes, cfg] = await Promise.all([fetch('api/probes').then((r) => r.json()), fetch('api/config').then((r) => r.json())]);
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const url = base + 'api/frame-action';
    const tpl = TEMPLATES.map((t) => `
      <div class="card">
        <div class="card-head"><div><h2>${esc(t.title)}</h2><p class="sub">觸發：${esc(t.trigger)}　${esc(t.note)}</p></div>
          <button class="btn copy" data-copy="${esc(JSON.stringify(t.body, null, 2))}">複製 Body</button></div>
        <pre class="code">${esc(JSON.stringify(t.body, null, 2))}</pre>
      </div>`).join('');
    return {
      html: `
        <div class="card"><h2>FrameVR Action Editor 設定</h2>
          <p class="sub">右側選單 → FRAME SETTINGS → ACTION EDITOR → 選物件 → Add Trigger → Add Action → <b>API Call</b>，填入下面的值</p>
          <table><tbody>
            <tr><th>URL</th><td><code>${esc(url)}</code> <button class="btn copy" data-copy="${esc(url)}">複製</button></td></tr>
            <tr><th>HTTP Method</th><td><code>POST</code></td></tr>
            <tr><th>HTTP Header Name</th><td><code>X-API-Key</code></td></tr>
            <tr><th>API Key</th><td>選你在 FrameVR「PROFILE → API Keys」新增的金鑰（值＝伺服器 .env 的 INGEST_KEY）${cfg.key_set ? '' : '　<b>⚠ 伺服器尚未設定 INGEST_KEY</b>'}</td></tr>
            <tr><th>POST/PUT Body</th><td>依物件用途，複製下方對應的內容</td></tr>
          </tbody></table>
          <p class="sub" style="margin-top:10px">目前設定：超過 ${cfg.session_gap_min} 分鐘沒有動作就算下一次使用；單次教材互動時間上限 ${cfg.max_material_min} 分鐘。學生第一次觸發時，FrameVR 會詢問是否同意分享名牌，請提醒學生按同意。</p>
        </div>
        ${tpl}
        <div class="card"><h2>最近收到的請求</h2><p class="sub">FrameVR 每次呼叫 API 的原始內容（最近 30 筆，可用來檢查設定是否正確；%變數% 沒被替換代表該欄位沒有值）</p>
          ${probes.length ? probes.map((p) => `<p class="sub" style="margin:10px 0 4px">${fmtTime(p.server_ts)}</p><pre class="code">${esc(JSON.stringify(JSON.parse(p.payload), null, 2))}</pre>`).join('') : '<div class="empty">還沒有收到任何請求。設定好後，在 Action Editor 按 Test，或進入 Frame 點一下物件。</div>'}
        </div>`,
      after() {
        view.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '已複製'; }
          catch (e) { b.textContent = '請手動選取'; }
          setTimeout(() => { b.textContent = b.dataset.copy.startsWith('{') ? '複製 Body' : '複製'; }, 1500);
        }));
      },
    };
  }

  // ---------- 啟動 ----------
  setRange('30');
  loadFrames();
  schedule();
  route();
})();
