// FrameVR 學習行為紀錄系統：事件收集 API + 視覺化後台
require('./src/env').load();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { ingest } = require('./src/ingest');
const { handleFrameAction, closeIdleSessions } = require('./src/frameAction');
const { logProbe } = require('./src/probes');
const frameApi = require('./src/frameApi');
const stats = require('./src/stats');
const db = require('./src/db');
const auth = require('./src/auth');
const students = require('./src/students');
const probes = require('./src/probes');
const research = require('./src/research');

const PORT = Number(process.env.PORT || 3060);
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, ''); // 例如 /framevr（掛在既有網域的子路徑時）
const INGEST_KEY = process.env.INGEST_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

const router = express.Router();

// ---------- 事件收集（給 FrameVR 呼叫） ----------
const ingestCors = cors({
  origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Api-Key'],
  maxAge: 86400,
});

// 同時接受 application/json 與 text/plain（sendBeacon、避免 CORS 預檢）
const parseAny = [
  express.json({ limit: '256kb' }),
  express.text({ type: ['text/plain', 'text/*'], limit: '256kb' }),
  (req, res, next) => {
    if (typeof req.body === 'string') {
      try { req.body = JSON.parse(req.body || '{}'); } catch { return res.status(400).json({ ok: false, error: 'invalid JSON' }); }
    }
    next();
  },
];

// 被拒絕的請求：每個 IP 每分鐘最多記錄 REJECT_LOG_PER_MIN 筆；超過 REJECT_LIMIT_PER_MIN 直接回 429
const REJECT_LOG_PER_MIN = 10;
const REJECT_LIMIT_PER_MIN = 60;
const rejects = new Map();
function countReject(ip) {
  const now = Date.now();
  let r = rejects.get(ip);
  if (!r || now - r.start > 60000) { r = { start: now, n: 0 }; rejects.set(ip, r); }
  r.n++;
  if (rejects.size > 10000) for (const [k, v] of rejects) if (now - v.start > 60000) rejects.delete(k);
  return r.n;
}

function checkIngestKey(req, res, next) {
  if (!INGEST_KEY) return next();
  // 接受 X-API-Key、Authorization: Bearer、body.key；不接受網址參數（會被記進伺服器 log）
  const auth = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const key = String(req.get('x-api-key') || auth || req.body?.key || '').trim();
  if (key && safeEqual(key, INGEST_KEY)) return next();
  const n = countReject(req.ip);
  if (n > REJECT_LIMIT_PER_MIN) return res.status(429).json({ ok: false, error: 'too many invalid requests' });
  // 被拒絕的請求也記錄（不存金鑰本身），方便看出是金鑰不符；有數量上限
  if (req.path.endsWith('/frame-action') && n <= REJECT_LOG_PER_MIN) {
    const body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    delete body.key;
    logProbe({
      _rejected: key ? '金鑰不符（FrameVR 選的 API Key 和伺服器 .env 的 INGEST_KEY 不一樣）' : '沒有帶金鑰（請確認 HTTP Header Name 填 X-API-Key 並選了 API Key）',
      _headers_seen: Object.keys(req.headers).filter((h) => !/cookie|authorization|x-api-key/i.test(h)),
      _key_length: key.length,
      ...body,
    });
  }
  return res.status(401).json({ ok: false, error: 'invalid api key' });
}

router.options('/api/events', ingestCors);
router.post('/api/events', ingestCors, parseAny, checkIngestKey, (req, res) => {
  const out = ingest(req.body, req.get('user-agent'));
  res.status(out.status).json(out.json);
});

// FrameVR Action Editor「API Call」動作呼叫的入口（POST JSON 或 GET 網址參數皆可）
const actionCors = cors({
  origin: ALLOWED_ORIGINS.includes('*') ? true : ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'OPTIONS'],
  maxAge: 86400, // allowedHeaders 不指定：照瀏覽器要求的標頭放行（例如 X-API-Key）
});
const frameAction = (req, res) => {
  const params = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  delete params.key;
  try {
    const out = handleFrameAction(params, req.get('user-agent'));
    res.status(out.status).json(out.json);
  } catch (e) {
    console.error('[frame-action]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
router.options('/api/frame-action', actionCors);
router.get('/api/frame-action', actionCors, checkIngestKey, frameAction);
router.post('/api/frame-action', actionCors, parseAny, checkIngestKey, frameAction);

router.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// 喜歡／收藏小工具：放進 FrameVR 的「網頁瀏覽器」物件裡使用（不需後台登入）
router.use('/widget', express.static(path.join(__dirname, 'widget'), { maxAge: '5m' }));

// ---------- 後台（需登入；admin / researcher 兩種角色） ----------
const bootstrapped = auth.bootstrap();
const COOKIE_PATH = (BASE_PATH || '') + '/';

const dash = express.Router();
dash.use(auth.attachUser);
// 會改資料的請求一律要求 JSON：跨站表單送不出 application/json，可擋 CSRF
const jsonOnly = (req, res, next) => (req.is('application/json') ? next() : res.status(415).json({ ok: false, error: 'Content-Type must be application/json' }));
const jsonBody = express.json({ limit: '64kb' });

dash.post('/api/login', jsonOnly, jsonBody, (req, res) => {
  const r = auth.login(req.body?.username, req.body?.password, req.ip);
  if (!r.token) return res.status(r.status).json({ ok: false, error: r.error });
  res.set('Set-Cookie', auth.cookieHeader(r.token, req, COOKIE_PATH, auth.SESSION_DAYS * 86400));
  res.json({ ok: true, user: r.user });
});
dash.post('/api/logout', (req, res) => {
  auth.logout(req);
  res.set('Set-Cookie', auth.cookieHeader('', req, COOKIE_PATH, 0));
  res.json({ ok: true });
});
dash.get('/api/me', auth.requireLogin, (req, res) => res.json(req.user));

// 回應依角色轉換學生身分（研究者只看到代號）
const wrap = (fn) => (req, res) => {
  try { res.json(students.relabel(fn(req), req.user.role)); } catch (e) { console.error(e); res.status(500).json({ ok: false, error: e.message }); }
};
const awrap = (fn) => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { console.error(e); res.status(500).json({ ok: false, error: e.message }); }
};
const L = auth.requireLogin;
const A = auth.requireAdmin;

// 統計（所有登入者）
dash.get('/api/overview', L, wrap((req) => stats.overview(req.query)));
dash.get('/api/students', L, wrap((req) => stats.students(req.query)));
dash.get('/api/students/:id', L, wrap((req) => stats.studentDetail(req.params.id, req.query)));
dash.get('/api/materials', L, wrap((req) => stats.materials(req.query)));
dash.get('/api/clicks', L, wrap((req) => stats.clicks(req.query)));
dash.get('/api/sequences', L, wrap((req) => stats.sequences(req.query)));
dash.get('/api/event-list', L, wrap((req) => stats.eventList(req.query)));
dash.get('/api/frames', L, wrap(() => stats.frames()));

const sendCsv = (res, name) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="framevr-${name}-${stamp}.csv"`);
};
dash.get('/api/export/:kind.csv', L, (req, res, next) => {
  const kind = req.params.kind;
  if (kind === 'probes') return next();
  if (!['events', 'sessions'].includes(kind)) return res.status(404).end();
  sendCsv(res, kind);
  (kind === 'events' ? stats.exportEventsCsv : stats.exportSessionsCsv)(req.query, (chunk) => res.write(chunk), req.user.role);
  res.end();
});

// 研究用 Excel（依目前篩選條件；研究者版本只有代號）
dash.get('/api/export/research.xlsx', L, (req, res) => {
  try {
    const buf = research.buildWorkbook(req.query, req.user.role, {
      gap: Number(process.env.SESSION_GAP_MIN || 15), maxMat: Number(process.env.MAX_MATERIAL_MIN || 10), dedupe: Number(process.env.DEDUPE_MS ?? 1000) / 1000,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="framevr-research-${stamp}.xlsx"`);
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ ok: false, error: e.message }); }
});

// 以下只有管理者：FrameVR 設定、原始請求、帳號、學生身分
dash.get('/api/export/probes.csv', A, (req, res) => {
  sendCsv(res, 'requests');
  probes.exportCsv((chunk) => res.write(chunk), stats.csvCell, stats.iso);
  res.end();
});
dash.get('/api/probes/summary', A, (req, res) => res.json(probes.summary(5)));
dash.get('/api/frameapi/frame', A, awrap((req) => frameApi.readFrame(req.query.frame)));
dash.get('/api/frameapi/asset/:type/:id', A, awrap((req) => frameApi.readAsset(req.params.type, req.params.id, req.query.frame)));
dash.get('/api/config', A, (req, res) => res.json({
  frame_api_key_set: !!frameApi.config().key,
  frame_ref: frameApi.config().frame,
  asset_types: frameApi.ASSET_TYPES,
  session_gap_min: Number(process.env.SESSION_GAP_MIN || 15),
  max_material_min: Number(process.env.MAX_MATERIAL_MIN || 10),
  dedupe_ms: Number(process.env.DEDUPE_MS ?? 1000),
  collect_email: process.env.COLLECT_EMAIL === '1',
  key_set: !!INGEST_KEY,
}));
dash.get('/api/users', A, (req, res) => res.json(auth.listUsers()));
dash.post('/api/users', A, jsonOnly, jsonBody, (req, res) => {
  const r = auth.createUser(String(req.body?.username || '').trim(), req.body?.password, req.body?.role || 'researcher');
  res.status(r.error ? 400 : 200).json(r.error ? { ok: false, error: r.error } : { ok: true });
});
dash.patch('/api/users/:username', A, jsonOnly, jsonBody, (req, res) => {
  const b = req.body || {};
  const r = auth.updateUser(req.params.username, { password: b.password || undefined, role: b.role, disabled: b.disabled }, req.user.username);
  res.status(r.status).json(r.error ? { ok: false, error: r.error } : { ok: true });
});
dash.get('/api/student-ids', A, (req, res) => res.json(students.list()));
dash.patch('/api/student-ids/:code', A, jsonOnly, jsonBody, (req, res) => {
  const ok = students.update(req.params.code, req.body || {});
  res.status(ok ? 200 : 404).json({ ok });
});

// 頁面：未登入一律導向登入頁；登入頁、樣式與前端程式本身不含資料
const sendIndex = (req, res) => (req.user ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : res.redirect(302, 'login.html'));
dash.get('/', sendIndex);
dash.get('/index.html', sendIndex);
dash.get('/vendor/chart.umd.min.js', L, (req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'), { maxAge: '7d' }));
dash.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '5m' }));

router.use(dash);
// 後台用相對路徑呼叫 API，所以 /framevr 要補成 /framevr/
if (BASE_PATH) app.use((req, res, next) => (req.path === BASE_PATH ? res.redirect(301, BASE_PATH + '/') : next()));
app.use(BASE_PATH || '/', router);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const HOST = process.env.HOST || '127.0.0.1'; // 走 Nginx 反向代理時只聽本機
// 每分鐘結算閒置逾時的工作階段（學生關掉 FrameVR 後不會再送請求）
setInterval(() => {
  try { closeIdleSessions(); } catch (e) { console.error('[idle-sweep]', e); }
}, 60 * 1000).unref();

app.listen(PORT, HOST, () => {
  console.log(`[framevr-tracker] listening on http://${HOST}:${PORT}${BASE_PATH || ''}/`);
  if (!INGEST_KEY) console.warn('[framevr-tracker] 警告：未設定 INGEST_KEY，任何人都能寫入事件');
  if (bootstrapped === 'created') console.log('[framevr-tracker] 已用 .env 建立第一個管理者帳號');
  if (bootstrapped === 'no-users') console.warn('[framevr-tracker] 警告：還沒有任何後台帳號。請在 .env 設定 ADMIN_USER / ADMIN_PASS 後重啟');
  if (bootstrapped && bootstrapped.startsWith('bootstrap-failed')) console.warn('[framevr-tracker] 建立管理者失敗：' + bootstrapped);
});
