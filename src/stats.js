// 後台查詢：總覽、學生、教材、點擊、順序、事件列表
const db = require('./db');

const TZ_OFFSET_MS = Number(process.env.TZ_OFFSET_MIN ?? 480) * 60 * 1000; // 預設 UTC+8（台灣）
const ONLINE_WINDOW_MS = 90 * 1000; // 90 秒內有心跳視為在線

// 共用篩選條件：from / to（毫秒或日期字串）、frame、student
function filters(q, alias = 'e', tsCol = 'ts') {
  const where = [];
  const params = {};
  const from = parseTime(q.from, false);
  const to = parseTime(q.to, true);
  if (from) { where.push(`${alias}.${tsCol} >= @from`); params.from = from; }
  if (to) { where.push(`${alias}.${tsCol} <= @to`); params.to = to; }
  if (q.frame) { where.push(`${alias}.frame = @frame`); params.frame = String(q.frame); }
  if (q.student) { where.push(`${alias}.student_id = @student`); params.student = String(q.student); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', and: where.length ? ' AND ' + where.join(' AND ') : '', params };
}

function parseTime(v, endOfDay) {
  if (!v) return null;
  if (/^\d+$/.test(String(v))) return Number(v);
  // YYYY-MM-DD 視為台灣時間的日期
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    const base = Date.parse(v + 'T00:00:00Z') - TZ_OFFSET_MS;
    return endOfDay ? base + 86400000 - 1 : base;
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

const dayExpr = (col) => `strftime('%Y-%m-%d', (${col} + ${TZ_OFFSET_MS}) / 1000, 'unixepoch')`;
const DUR = `(COALESCE(s.end_ts, s.last_ts) - s.start_ts)`;

function overview(q) {
  const ef = filters(q, 'e');
  const sf = filters(q, 's', 'start_ts');
  const now = Date.now();

  const k = db.prepare(`
    SELECT COUNT(DISTINCT s.student_id) AS students,
           COUNT(*)                     AS sessions,
           COALESCE(SUM(${DUR}), 0)     AS total_ms,
           COALESCE(AVG(${DUR}), 0)     AS avg_ms
    FROM sessions s ${sf.sql}`).get(sf.params);

  const counts = Object.fromEntries(
    db.prepare(`SELECT e.event_type t, COUNT(*) n FROM events e ${ef.sql} GROUP BY e.event_type`)
      .all(ef.params).map((r) => [r.t, r.n]));

  const online = db.prepare(`
    SELECT COUNT(*) n FROM sessions s
    WHERE s.end_ts IS NULL AND s.last_ts >= @since ${q.frame ? 'AND s.frame = @frame' : ''}`)
    .get({ since: now - ONLINE_WINDOW_MS, ...(q.frame ? { frame: q.frame } : {}) }).n;

  const daily = db.prepare(`
    SELECT ${dayExpr('s.start_ts')} AS day,
           COUNT(*) AS sessions,
           COUNT(DISTINCT s.student_id) AS students,
           ROUND(SUM(${DUR}) / 60000.0, 1) AS minutes
    FROM sessions s ${sf.sql}
    GROUP BY day ORDER BY day`).all(sf.params);

  const dailyEvents = db.prepare(`
    SELECT ${dayExpr('e.ts')} AS day,
           SUM(e.event_type = 'click') AS clicks,
           SUM(e.event_type = 'material_open') AS opens,
           SUM(e.event_type IN ('like','favorite')) AS likes
    FROM events e ${ef.sql}
    GROUP BY day ORDER BY day`).all(ef.params);

  // 星期 × 小時（台灣時間）互動熱度，不含心跳
  const heat = db.prepare(`
    SELECT CAST(strftime('%w', (e.ts + ${TZ_OFFSET_MS}) / 1000, 'unixepoch') AS INTEGER) AS dow,
           CAST(strftime('%H', (e.ts + ${TZ_OFFSET_MS}) / 1000, 'unixepoch') AS INTEGER) AS hour,
           COUNT(*) AS n
    FROM events e
    WHERE e.event_type NOT IN ('heartbeat') ${ef.and}
    GROUP BY dow, hour`).all(ef.params);

  return {
    kpi: {
      students: k.students,
      sessions: k.sessions,
      total_minutes: Math.round(k.total_ms / 60000),
      avg_session_minutes: +(k.avg_ms / 60000).toFixed(1),
      clicks: counts.click || 0,
      material_opens: counts.material_open || 0,
      likes: (counts.like || 0) - (counts.unlike || 0),
      favorites: (counts.favorite || 0) - (counts.unfavorite || 0),
      online_now: online,
    },
    event_counts: counts,
    daily: mergeDaily(daily, dailyEvents),
    heatmap: heat,
  };
}

function mergeDaily(a, b) {
  const map = new Map();
  for (const r of a) map.set(r.day, { day: r.day, sessions: r.sessions, students: r.students, minutes: r.minutes, clicks: 0, opens: 0, likes: 0 });
  for (const r of b) {
    const d = map.get(r.day) || { day: r.day, sessions: 0, students: 0, minutes: 0 };
    Object.assign(d, { clicks: r.clicks || 0, opens: r.opens || 0, likes: r.likes || 0 });
    map.set(r.day, d);
  }
  return [...map.values()].sort((x, y) => x.day.localeCompare(y.day));
}

function students(q) {
  const sf = filters(q, 's', 'start_ts');
  const ef = filters(q, 'e');
  const base = db.prepare(`
    SELECT s.student_id,
           COUNT(*) AS sessions,
           SUM(${DUR}) AS total_ms,
           MIN(s.start_ts) AS first_seen,
           MAX(COALESCE(s.end_ts, s.last_ts)) AS last_seen,
           MAX(CASE WHEN s.end_ts IS NULL AND s.last_ts >= @since THEN 1 ELSE 0 END) AS online
    FROM sessions s ${sf.sql}
    GROUP BY s.student_id`).all({ ...sf.params, since: Date.now() - ONLINE_WINDOW_MS });

  const ev = new Map(db.prepare(`
    SELECT e.student_id,
           SUM(e.event_type = 'click') AS clicks,
           SUM(e.event_type = 'material_open') AS opens,
           COUNT(DISTINCT CASE WHEN e.event_type = 'material_open' THEN e.target_id END) AS materials,
           COALESCE(SUM(CASE WHEN e.event_type = 'material_close' THEN e.duration_ms END), 0) AS material_ms,
           SUM(e.event_type = 'like') - SUM(e.event_type = 'unlike') AS likes,
           SUM(e.event_type = 'favorite') - SUM(e.event_type = 'unfavorite') AS favorites
    FROM events e ${ef.sql}
    GROUP BY e.student_id`).all(ef.params).map((r) => [r.student_id, r]));

  return base.map((s) => ({ ...s, ...(ev.get(s.student_id) || {}), avg_session_ms: Math.round(s.total_ms / s.sessions) }))
    .sort((a, b) => b.total_ms - a.total_ms);
}

function studentDetail(id, q) {
  const params = { id };
  const sessions = db.prepare(`
    SELECT s.*, ${DUR} AS duration_ms,
           CASE WHEN s.end_ts IS NULL AND s.last_ts >= @since THEN 1 ELSE 0 END AS online
    FROM sessions s WHERE s.student_id = @id ORDER BY s.start_ts DESC`)
    .all({ ...params, since: Date.now() - ONLINE_WINDOW_MS });

  const events = db.prepare(`
    SELECT e.session_id, e.seq, e.event_type, e.target_id, e.target_type, e.target_name, e.duration_ms, e.ts, e.meta
    FROM events e WHERE e.student_id = @id AND e.event_type != 'heartbeat'
    ORDER BY e.ts, e.seq`).all(params);

  // 目前喜好狀態（最後一次 like/unlike、favorite/unfavorite 為準）
  const prefs = currentPrefs({ student: id });
  return { student_id: id, sessions, events, preferences: prefs.filter((p) => p.liked || p.favorited) };
}

// 每位學生 × 每個物件 的最終喜歡 / 收藏狀態
function currentPrefs(q) {
  const ef = filters(q, 'e');
  return db.prepare(`
    WITH ranked AS (
      SELECT e.student_id, e.target_id, e.target_name, e.event_type,
             CASE WHEN e.event_type IN ('like','unlike') THEN 'like' ELSE 'fav' END AS kind,
             ROW_NUMBER() OVER (PARTITION BY e.student_id, e.target_id,
                                CASE WHEN e.event_type IN ('like','unlike') THEN 'like' ELSE 'fav' END
                                ORDER BY e.ts DESC, e.id DESC) AS rn
      FROM events e
      WHERE e.event_type IN ('like','unlike','favorite','unfavorite') ${ef.and}
    )
    SELECT student_id, target_id, MAX(target_name) AS target_name,
           MAX(CASE WHEN kind = 'like' AND event_type = 'like' THEN 1 ELSE 0 END) AS liked,
           MAX(CASE WHEN kind = 'fav'  AND event_type = 'favorite' THEN 1 ELSE 0 END) AS favorited
    FROM ranked WHERE rn = 1
    GROUP BY student_id, target_id`).all(ef.params);
}

function materials(q) {
  const ef = filters(q, 'e');
  const rows = db.prepare(`
    SELECT e.target_id,
           MAX(e.target_name) AS target_name,
           MAX(e.target_type) AS target_type,
           SUM(e.event_type = 'material_open') AS opens,
           COUNT(DISTINCT CASE WHEN e.event_type = 'material_open' THEN e.student_id END) AS students,
           COALESCE(SUM(CASE WHEN e.event_type = 'material_close' THEN e.duration_ms END), 0) AS total_ms,
           AVG(CASE WHEN e.event_type = 'material_close' THEN e.duration_ms END) AS avg_ms,
           SUM(e.event_type = 'click') AS clicks,
           SUM(e.event_type = 'like') AS like_events,
           SUM(e.event_type = 'unlike') AS unlike_events,
           SUM(e.event_type = 'favorite') AS favorite_events,
           SUM(e.event_type = 'unfavorite') AS unfavorite_events
    FROM events e
    WHERE e.target_id IS NOT NULL
      AND e.event_type IN ('material_open','material_close','click','like','unlike','favorite','unfavorite') ${ef.and}
    GROUP BY e.target_id`).all(ef.params);

  const prefs = currentPrefs(q);
  const liked = new Map(); const faved = new Map();
  for (const p of prefs) {
    if (p.liked) liked.set(p.target_id, (liked.get(p.target_id) || 0) + 1);
    if (p.favorited) faved.set(p.target_id, (faved.get(p.target_id) || 0) + 1);
  }
  return rows
    .filter((r) => r.opens > 0 || r.like_events > 0 || r.favorite_events > 0)
    .map((r) => ({ ...r, avg_ms: r.avg_ms ? Math.round(r.avg_ms) : 0, liked_now: liked.get(r.target_id) || 0, favorited_now: faved.get(r.target_id) || 0 }))
    .sort((a, b) => b.opens - a.opens);
}

function clicks(q) {
  const ef = filters(q, 'e');
  const byType = db.prepare(`
    SELECT COALESCE(e.target_type, 'other') AS target_type, COUNT(*) AS clicks, COUNT(DISTINCT e.student_id) AS students
    FROM events e WHERE e.event_type = 'click' ${ef.and}
    GROUP BY 1 ORDER BY clicks DESC`).all(ef.params);
  const top = db.prepare(`
    SELECT e.target_id, MAX(e.target_name) AS target_name, MAX(e.target_type) AS target_type,
           COUNT(*) AS clicks, COUNT(DISTINCT e.student_id) AS students
    FROM events e WHERE e.event_type = 'click' ${ef.and}
    GROUP BY e.target_id ORDER BY clicks DESC LIMIT 50`).all(ef.params);
  return { by_type: byType, top };
}

// 教材操作先後順序：每個工作階段內 material_open 的轉移次數（A → B）與第一個開啟的教材
function sequences(q) {
  const ef = filters(q, 'e');
  const rows = db.prepare(`
    SELECT e.session_id, e.target_id, e.target_name
    FROM events e WHERE e.event_type = 'material_open' ${ef.and}
    ORDER BY e.session_id, e.ts, e.seq`).all(ef.params);
  const trans = new Map(); const first = new Map(); const names = new Map();
  let prev = null; let prevSession = null;
  for (const r of rows) {
    names.set(r.target_id, r.target_name || r.target_id);
    if (r.session_id !== prevSession) {
      first.set(r.target_id, (first.get(r.target_id) || 0) + 1);
      prev = null; prevSession = r.session_id;
    }
    if (prev && prev !== r.target_id) {
      const key = prev + '\u0000' + r.target_id;
      trans.set(key, (trans.get(key) || 0) + 1);
    }
    prev = r.target_id;
  }
  return {
    transitions: [...trans.entries()].map(([k, n]) => { const [from, to] = k.split('\u0000'); return { from, to, from_name: names.get(from), to_name: names.get(to), count: n }; })
      .sort((a, b) => b.count - a.count).slice(0, 40),
    first_opened: [...first.entries()].map(([id, n]) => ({ target_id: id, target_name: names.get(id), sessions: n })).sort((a, b) => b.sessions - a.sessions),
  };
}

function eventList(q) {
  const ef = filters(q, 'e');
  const where = [ef.sql ? ef.sql.slice(6) : null];
  const params = { ...ef.params };
  if (q.type) { where.push('e.event_type = @type'); params.type = String(q.type); }
  if (q.session) { where.push('e.session_id = @session'); params.session = String(q.session); }
  if (!q.include_heartbeat) where.push(`e.event_type != 'heartbeat'`);
  const w = where.filter(Boolean);
  const whereSql = w.length ? 'WHERE ' + w.join(' AND ') : '';
  const limit = Math.min(Number(q.limit) || 100, 1000);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) n FROM events e ${whereSql}`).get(params).n;
  const rows = db.prepare(`
    SELECT e.id, e.event_id, e.seq, e.student_id, e.session_id, e.frame, e.event_type, e.target_id, e.target_type,
           e.target_name, e.duration_ms, e.ts, e.server_ts, e.meta
    FROM events e ${whereSql} ORDER BY e.ts DESC, e.id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  return { total, limit, offset, rows };
}

function frames() {
  return db.prepare(`SELECT frame, COUNT(*) AS sessions FROM sessions WHERE frame IS NOT NULL GROUP BY frame ORDER BY sessions DESC`).all();
}

// ---------- CSV 匯出 ----------
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const iso = (ms) => (ms ? new Date(ms + TZ_OFFSET_MS).toISOString().replace('Z', '+08:00').replace('T', ' ').slice(0, 19) : '');

function exportEventsCsv(q, write) {
  const ef = filters(q, 'e');
  const cols = ['id', 'event_id', 'seq', 'student_id', 'session_id', 'frame', 'event_type', 'target_id', 'target_type', 'target_name', 'duration_ms', 'ts', 'time_local', 'server_ts', 'meta'];
  write('﻿' + cols.join(',') + '\n'); // BOM 讓 Excel 正確顯示中文
  const stmt = db.prepare(`SELECT * FROM events e ${ef.sql} ORDER BY e.ts, e.seq`);
  for (const r of stmt.iterate(ef.params)) {
    r.time_local = iso(r.ts);
    write(cols.map((c) => csvCell(r[c])).join(',') + '\n');
  }
}

function exportSessionsCsv(q, write) {
  const sf = filters(q, 's', 'start_ts');
  const cols = ['session_id', 'student_id', 'frame', 'start_local', 'end_local', 'duration_sec', 'ended_normally', 'end_reason', 'event_count', 'start_ts', 'last_ts', 'end_ts'];
  write('﻿' + cols.join(',') + '\n');
  const stmt = db.prepare(`SELECT s.*, ${DUR} AS dur FROM sessions s ${sf.sql} ORDER BY s.start_ts`);
  for (const r of stmt.iterate(sf.params)) {
    Object.assign(r, {
      start_local: iso(r.start_ts),
      end_local: iso(r.end_ts || r.last_ts),
      duration_sec: Math.round(r.dur / 1000),
      ended_normally: r.end_ts ? 1 : 0,
    });
    write(cols.map((c) => csvCell(r[c])).join(',') + '\n');
  }
}

module.exports = { overview, students, studentDetail, materials, clicks, sequences, eventList, frames, exportEventsCsv, exportSessionsCsv };
