// 接收 FrameVR「Action Editor → API Call」送來的請求，轉成標準行為事件
//
// 每個物件的 API Call 只回報「誰、點了什麼」，其餘由伺服器推算：
//   - 工作階段：同一位學生超過 SESSION_GAP_MIN 分鐘沒有動作，下一個動作就算新的一次使用
//   - 教材互動時間：從開啟教材到「開啟下一份教材／離開／逾時」為止（上限 MAX_MATERIAL_MIN 分鐘）
//   - 喜歡／收藏：每按一次就切換（喜歡 ⇄ 取消喜歡）
//
// 請求內容（JSON body 或網址參數皆可），FrameVR 會自動把 %變數% 換成實際值：
// {
//   "event":      "enter | material | click | like | favorite | leave",
//   "student":    "%nametag%",        學生在進場名牌輸入的固定編號
//   "user":       "%uniqueUserId%",   FrameVR 帳號 ID（核對用）
//   "frame":      "%frameName%",
//   "asset_id":   "%assetId%",
//   "asset_name": "%assetName%",
//   "asset_type": "%assetType%",
//   "category":   "board | model | video | button"   （選填）
//   "material":   "教材識別碼"                         （選填；喜歡／收藏按鈕要對應哪份教材）
// }
const crypto = require('crypto');
const db = require('./db');
const { ingest } = require('./ingest');

const SESSION_GAP_MS = Number(process.env.SESSION_GAP_MIN || 15) * 60 * 1000;
const MAX_MATERIAL_MS = Number(process.env.MAX_MATERIAL_MIN || 10) * 60 * 1000;

const EVENT_ALIASES = {
  enter: 'enter', start: 'enter', join: 'enter',
  leave: 'leave', exit: 'leave', end: 'leave',
  material: 'material', open: 'material', material_open: 'material',
  click: 'click', button: 'click',
  like: 'like', favorite: 'favorite', favourite: 'favorite', fav: 'favorite',
  unlike: 'unlike', unfavorite: 'unfavorite',
};
const CATEGORY_ALIASES = {
  board: 'board', 展板: 'board', image: 'board', poster: 'board',
  model: 'model', 模型: 'model', '3d': 'model',
  video: 'video', 影片: 'video',
  button: 'button', 按鈕: 'button',
  material: 'material', 教材: 'material',
};

// 沒有被替換的 %變數%、空字串都視為沒有值
function clean(v, max = 128) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || /^%[A-Za-z]+%$/.test(s) || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null;
  return s.slice(0, max);
}

function resolveStudent(p) {
  const tag = clean(p.student || p.nametag, 64);
  const user = clean(p.user || p.uniqueUserId, 128);
  const userOk = user && user.toLowerCase() !== 'anonymous' ? user : null;
  if (tag && tag.toLowerCase() !== 'guest') return { id: tag.replace(/\s+/g, ''), source: 'nametag', user: userOk };
  if (userOk) return { id: 'user:' + userOk.slice(0, 40), source: 'uniqueUserId', user: userOk };
  return { id: 'Guest', source: 'none', user: null };
}

function guessCategory(p) {
  const c = clean(p.category || p.type_label, 32);
  if (c && CATEGORY_ALIASES[c.toLowerCase()]) return CATEGORY_ALIASES[c.toLowerCase()];
  const t = (clean(p.asset_type || p.assetType, 32) || '').toLowerCase();
  if (t.includes('model')) return 'model';
  if (t.includes('video')) return 'video';
  if (t.includes('image') || t.includes('text') || t.includes('label')) return 'board';
  if (t.includes('shape') || t.includes('button')) return 'button';
  return 'other';
}

const q = {
  activeSession: db.prepare(`
    SELECT * FROM sessions
    WHERE student_id = ? AND end_ts IS NULL AND last_ts >= ?
    ORDER BY last_ts DESC LIMIT 1`),
  staleSession: db.prepare(`
    SELECT * FROM sessions
    WHERE student_id = ? AND end_ts IS NULL AND last_ts < ?
    ORDER BY last_ts DESC LIMIT 1`),
  maxSeq: db.prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM events WHERE session_id = ?`),
  lastMaterialEvent: db.prepare(`
    SELECT event_type, target_id, target_type, target_name, ts FROM events
    WHERE session_id = ? AND event_type IN ('material_open', 'material_close')
    ORDER BY ts DESC, seq DESC, id DESC LIMIT 1`),
  knownType: db.prepare(`
    SELECT target_type FROM events
    WHERE target_id = ? AND event_type = 'material_open' AND target_type IS NOT NULL
    ORDER BY id DESC LIMIT 1`),
  lastPref: db.prepare(`
    SELECT event_type FROM events
    WHERE student_id = ? AND target_id = ? AND event_type IN (?, ?)
    ORDER BY ts DESC, id DESC LIMIT 1`),
  endStale: db.prepare(`UPDATE sessions SET end_ts = last_ts, end_reason = 'timeout' WHERE session_id = ?`),
  logRaw: db.prepare('INSERT INTO probes (server_ts, payload) VALUES (?, ?)'),
  trimRaw: db.prepare('DELETE FROM probes WHERE id <= (SELECT id FROM probes ORDER BY id DESC LIMIT 1 OFFSET 300)'),
};

function openMaterial(sessionId) {
  const last = q.lastMaterialEvent.get(sessionId);
  return last && last.event_type === 'material_open' ? last : null;
}

function closeEvent(base, open, ts, reason) {
  const dur = Math.max(0, Math.min(ts - open.ts, MAX_MATERIAL_MS));
  return {
    ...base,
    type: 'material_close',
    target_id: open.target_id,
    target_type: open.target_type,
    target_name: open.target_name,
    // 逾時關閉且之後完全沒有動作：不知道看了多久，記為未知（不列入平均）
    duration_ms: reason === 'timeout' && dur === 0 ? null : dur,
    ts,
    meta: { reason, inferred: true },
  };
}

const handle = db.transaction((p, userAgent) => {
  const now = Date.now();
  const action = EVENT_ALIASES[(clean(p.event || p.action, 32) || 'click').toLowerCase()];
  if (!action) return { status: 400, json: { ok: false, error: `unknown event: ${p.event}` } };

  const who = resolveStudent(p);
  const frame = clean(p.frame || p.frameName, 128);
  const assetId = clean(p.asset_id || p.assetId, 128);
  const assetName = clean(p.asset_name || p.assetName, 200);
  const category = guessCategory(p);
  const meta = { via: 'action-editor', id_source: who.source, user: who.user, asset_id: assetId, asset_type: clean(p.asset_type || p.assetType, 32) };
  const target = {
    id: clean(p.target || p.material_id, 128) || assetName || assetId,
    name: clean(p.name, 200) || assetName || assetId,
    type: category,
  };

  const events = [];
  let seq = 0;
  const push = (ev) => events.push({ event_id: crypto.randomUUID(), seq: ++seq, student_id: who.id, frame, ts: now, ...ev, meta: { ...meta, ...(ev.meta || {}) } });

  // 1. 上一次使用已逾時：把當時還開著的教材補上關閉（時間算到最後一次動作）
  const stale = q.staleSession.get(who.id, now - SESSION_GAP_MS);
  if (stale) {
    const open = openMaterial(stale.session_id);
    if (open) {
      const n = q.maxSeq.get(stale.session_id).n;
      events.push({ event_id: crypto.randomUUID(), seq: n + 1, student_id: who.id, frame: stale.frame, session_id: stale.session_id,
        ...closeEvent({}, open, Math.max(stale.last_ts, open.ts), 'timeout'), meta: { reason: 'timeout', inferred: true } });
    }
  }
  const staleId = stale ? stale.session_id : null;

  // 2. 找出或建立這次的工作階段
  let session = q.activeSession.get(who.id, now - SESSION_GAP_MS);
  let sessionId;
  if (session) {
    sessionId = session.session_id;
    seq = q.maxSeq.get(sessionId).n;
  } else {
    sessionId = crypto.randomUUID();
    push({ session_id: sessionId, type: 'session_start', meta: { trigger: action, inferred: action !== 'enter' } });
  }
  const base = { session_id: sessionId };
  const open = session ? openMaterial(sessionId) : null;
  const recorded = [];

  switch (action) {
    case 'enter':
      if (session) recorded.push('already_in_session');
      break;

    case 'material': {
      push({ ...base, type: 'click', target_id: target.id, target_type: target.type, target_name: target.name });
      if (open && open.target_id !== target.id) push(closeEvent(base, open, now, 'switch'));
      if (!open || open.target_id !== target.id) push({ ...base, type: 'material_open', target_id: target.id, target_type: target.type, target_name: target.name });
      break;
    }

    case 'click':
      push({ ...base, type: 'click', target_id: target.id, target_type: target.type === 'other' ? 'button' : target.type, target_name: target.name });
      break;

    case 'like':
    case 'favorite':
    case 'unlike':
    case 'unfavorite': {
      // 對應哪份教材：body 指定的 material → 目前開著的教材 → 按鈕本身
      let mid = clean(p.material || p.target, 128);
      if (mid === '教材物件名稱') mid = null; // 範本的預設文字沒改：改用目前開著的教材
      const tid = mid || (open && open.target_id) || target.id;
      const tname = clean(p.material_name, 200) || mid || (open ? open.target_name : target.name);
      let type = action;
      if (action === 'like' || action === 'favorite') {
        const [on, off] = action === 'like' ? ['like', 'unlike'] : ['favorite', 'unfavorite'];
        const last = q.lastPref.get(who.id, tid, on, off);
        type = last && last.event_type === on ? off : on; // 切換
      }
      const known = q.knownType.get(tid);
      push({ ...base, type, target_id: tid, target_type: known ? known.target_type : null, target_name: tname, meta: { button: assetName } });
      break;
    }

    case 'leave':
      if (open) push(closeEvent(base, open, now, 'leave'));
      push({ ...base, type: 'session_end', meta: { reason: 'leave_trigger' } });
      break;
  }

  const out = events.length ? ingest({ events }, userAgent) : { json: { inserted: 0 } };
  if (staleId) q.endStale.run(staleId); // 上一次使用標記為「閒置逾時」結束
  for (const e of events) recorded.push(e.type);
  return {
    status: 200,
    json: { ok: true, student: who.id, id_source: who.source, session_id: sessionId, recorded, inserted: out.json.inserted },
  };
});

function handleFrameAction(params, userAgent) {
  const p = { ...params };
  delete p.key;
  try {
    q.logRaw.run(Date.now(), JSON.stringify(p).slice(0, 4000));
    q.trimRaw.run();
  } catch { /* 紀錄失敗不影響主流程 */ }
  return handle(p, userAgent);
}

module.exports = { handleFrameAction, resolveStudent, clean };
