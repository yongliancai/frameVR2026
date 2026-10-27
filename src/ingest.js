// 接收 FrameVR 傳來的行為事件，寫入 events，並同步更新 sessions
const db = require('./db');

const EVENT_TYPES = new Set([
  'session_start', 'heartbeat', 'session_end',
  'click',
  'material_open', 'material_close',
  'like', 'unlike', 'favorite', 'unfavorite',
]);
const TARGET_TYPES = new Set(['board', 'model', 'video', 'button', 'material', 'other']);
// 採用前端時間（離線補送的事件保有原本時間）；超前伺服器 10 分鐘以上或早於 30 天前，視為電腦時鐘錯誤，改用伺服器時間
const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000;

const str = (v, max = 128) => (v === undefined || v === null || v === '' ? null : String(v).slice(0, max));
const int = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

function normalize(raw, serverTs) {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const event_type = str(raw.type || raw.event_type, 32);
  if (!EVENT_TYPES.has(event_type)) return { error: `unknown event type: ${event_type}` };
  const student_id = str(raw.student_id, 64);
  const session_id = str(raw.session_id, 64);
  if (!student_id || !session_id) return { error: 'student_id and session_id are required' };

  let client_ts = null;
  if (raw.ts !== undefined) {
    client_ts = typeof raw.ts === 'string' ? Date.parse(raw.ts) : int(raw.ts);
    if (!Number.isFinite(client_ts)) client_ts = null;
  }
  const ts = client_ts && client_ts - serverTs < MAX_FUTURE_MS && serverTs - client_ts < MAX_PAST_MS ? client_ts : serverTs;

  let target_type = str(raw.target_type, 16);
  if (target_type && !TARGET_TYPES.has(target_type)) target_type = 'other';

  let meta = raw.meta;
  if (meta !== undefined && meta !== null) {
    try { meta = JSON.stringify(meta).slice(0, 4000); } catch { meta = null; }
  } else meta = null;

  return {
    row: {
      event_id: str(raw.event_id, 64),
      seq: int(raw.seq),
      student_id,
      session_id,
      frame: str(raw.frame, 128),
      event_type,
      target_id: str(raw.target_id, 128),
      target_type,
      target_name: str(raw.target_name, 200),
      duration_ms: int(raw.duration_ms),
      ts,
      client_ts,
      server_ts: serverTs,
      meta,
    },
    // 喜好小工具送來的事件不算一次「使用工作階段」，不寫入 sessions
    skipSession: raw.source === 'widget',
  };
}

const insertEvent = db.prepare(`
  INSERT OR IGNORE INTO events
    (event_id, seq, student_id, session_id, frame, event_type, target_id, target_type, target_name, duration_ms, ts, client_ts, server_ts, meta)
  VALUES
    (@event_id, @seq, @student_id, @session_id, @frame, @event_type, @target_id, @target_type, @target_name, @duration_ms, @ts, @client_ts, @server_ts, @meta)
`);

const upsertSession = db.prepare(`
  INSERT INTO sessions (session_id, student_id, frame, start_ts, last_ts, end_ts, end_reason, user_agent, event_count)
  VALUES (@session_id, @student_id, @frame, @ts, @ts, @end_ts, @end_reason, @user_agent, 1)
  ON CONFLICT(session_id) DO UPDATE SET
    start_ts    = MIN(start_ts, excluded.start_ts),
    last_ts     = MAX(last_ts, excluded.last_ts),
    end_ts      = COALESCE(excluded.end_ts, end_ts),
    end_reason  = COALESCE(excluded.end_reason, end_reason),
    frame       = COALESCE(frame, excluded.frame),
    user_agent  = COALESCE(user_agent, excluded.user_agent),
    event_count = event_count + 1
`);

const ingestBatch = db.transaction((rows, userAgent) => {
  let inserted = 0;
  for (const r of rows) {
    const skip = r._skipSession; delete r._skipSession;
    const info = insertEvent.run(r);
    if (info.changes === 0) continue; // 重複事件（重送）
    inserted++;
    if (skip) continue;
    const isEnd = r.event_type === 'session_end';
    upsertSession.run({
      session_id: r.session_id,
      student_id: r.student_id,
      frame: r.frame,
      ts: r.ts,
      end_ts: isEnd ? r.ts : null,
      end_reason: isEnd ? (safeReason(r.meta) || 'leave') : null,
      user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    });
  }
  return inserted;
});

function safeReason(meta) {
  try { return meta ? String(JSON.parse(meta).reason || '').slice(0, 32) || null : null; } catch { return null; }
}

function ingest(body, userAgent) {
  const serverTs = Date.now();
  const list = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
  if (list.length > 500) return { status: 413, json: { ok: false, error: 'too many events in one batch (max 500)' } };
  const rows = [];
  const rejected = [];
  list.forEach((raw, i) => {
    const n = normalize(raw, serverTs);
    if (n.error) rejected.push({ index: i, error: n.error });
    else rows.push(Object.assign(n.row, n.skipSession ? { _skipSession: true } : {}));
  });
  const inserted = rows.length ? ingestBatch(rows, userAgent) : 0;
  return { status: 200, json: { ok: true, received: list.length, inserted, duplicates: rows.length - inserted, rejected } };
}

module.exports = { ingest, EVENT_TYPES };
