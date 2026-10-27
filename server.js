// FrameVR 學習行為紀錄系統：事件收集 API + 視覺化後台
require('./src/env').load();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { ingest } = require('./src/ingest');
const stats = require('./src/stats');
const db = require('./src/db');

const PORT = Number(process.env.PORT || 3060);
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, ''); // 例如 /framevr（掛在既有網域的子路徑時）
const INGEST_KEY = process.env.INGEST_KEY || '';
const DASH_USER = process.env.DASHBOARD_USER || '';
const DASH_PASS = process.env.DASHBOARD_PASS || '';
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

function checkIngestKey(req, res, next) {
  if (!INGEST_KEY) return next();
  const key = req.get('x-api-key') || req.query.key || req.body?.key;
  if (key && safeEqual(String(key), INGEST_KEY)) return next();
  return res.status(401).json({ ok: false, error: 'invalid api key' });
}

router.options('/api/events', ingestCors);
router.post('/api/events', ingestCors, parseAny, checkIngestKey, (req, res) => {
  const out = ingest(req.body, req.get('user-agent'));
  res.status(out.status).json(out.json);
});

// 探測腳本回報 Frame Script 可用的環境（第一次部署時用）
router.options('/api/probe', ingestCors);
router.post('/api/probe', ingestCors, parseAny, checkIngestKey, (req, res) => {
  const body = { ...req.body }; delete body.key;
  db.prepare('INSERT INTO probes (server_ts, payload) VALUES (?, ?)').run(Date.now(), JSON.stringify(body).slice(0, 20000));
  res.json({ ok: true });
});

router.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// 喜歡／收藏小工具：放進 FrameVR 的「網頁瀏覽器」物件裡使用（不需後台登入）
router.use('/widget', express.static(path.join(__dirname, 'widget'), { maxAge: '5m' }));

// ---------- 後台（需登入） ----------
function dashboardAuth(req, res, next) {
  if (!DASH_USER || !DASH_PASS) return next();
  const h = req.get('authorization') || '';
  const [scheme, encoded] = h.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (safeEqual(u, DASH_USER) && safeEqual(rest.join(':'), DASH_PASS)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="FrameVR Dashboard", charset="UTF-8"');
  return res.status(401).send('需要登入');
}

const dash = express.Router();
dash.use(dashboardAuth);
const wrap = (fn) => (req, res) => {
  try { res.json(fn(req)); } catch (e) { console.error(e); res.status(500).json({ ok: false, error: e.message }); }
};
dash.get('/api/overview', wrap((req) => stats.overview(req.query)));
dash.get('/api/students', wrap((req) => stats.students(req.query)));
dash.get('/api/students/:id', wrap((req) => stats.studentDetail(req.params.id, req.query)));
dash.get('/api/materials', wrap((req) => stats.materials(req.query)));
dash.get('/api/clicks', wrap((req) => stats.clicks(req.query)));
dash.get('/api/sequences', wrap((req) => stats.sequences(req.query)));
dash.get('/api/event-list', wrap((req) => stats.eventList(req.query)));
dash.get('/api/frames', wrap(() => stats.frames()));
dash.get('/api/probes', wrap(() => db.prepare('SELECT * FROM probes ORDER BY id DESC LIMIT 20').all()));

dash.get('/api/export/:kind.csv', (req, res) => {
  const kind = req.params.kind;
  if (!['events', 'sessions'].includes(kind)) return res.status(404).end();
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="framevr-${kind}-${stamp}.csv"`);
  (kind === 'events' ? stats.exportEventsCsv : stats.exportSessionsCsv)(req.query, (chunk) => res.write(chunk));
  res.end();
});

dash.get('/vendor/chart.umd.min.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.min.js'), { maxAge: '7d' }));
dash.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '5m' }));

router.use(dash);
// 後台用相對路徑呼叫 API，所以 /framevr 要補成 /framevr/
if (BASE_PATH) app.use((req, res, next) => (req.path === BASE_PATH ? res.redirect(301, BASE_PATH + '/') : next()));
app.use(BASE_PATH || '/', router);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const HOST = process.env.HOST || '127.0.0.1'; // 走 Nginx 反向代理時只聽本機
app.listen(PORT, HOST, () => {
  console.log(`[framevr-tracker] listening on http://${HOST}:${PORT}${BASE_PATH || ''}/`);
  if (!INGEST_KEY) console.warn('[framevr-tracker] 警告：未設定 INGEST_KEY，任何人都能寫入事件');
  if (!DASH_USER || !DASH_PASS) console.warn('[framevr-tracker] 警告：未設定 DASHBOARD_USER / DASHBOARD_PASS，後台沒有密碼保護');
});
