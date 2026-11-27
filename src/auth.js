// 後台帳號與登入（取代 Basic Auth：可以登出、可以分角色）
// 密碼以 scrypt 雜湊；登入後發一個隨機 token 放在 HttpOnly Cookie，資料庫只存 token 的 SHA-256
const crypto = require('crypto');
const db = require('./db');

const COOKIE = 'fvr_sess';
const SESSION_DAYS = Number(process.env.LOGIN_SESSION_DAYS || 7);
const ROLES = ['admin', 'researcher'];

const q = {
  count: db.prepare('SELECT COUNT(*) n FROM users'),
  get: db.prepare('SELECT * FROM users WHERE username = ?'),
  list: db.prepare('SELECT username, role, disabled, created_ts FROM users ORDER BY role, username'),
  insert: db.prepare('INSERT INTO users (username, pass_hash, role, created_ts) VALUES (?, ?, ?, ?)'),
  setPass: db.prepare('UPDATE users SET pass_hash = ? WHERE username = ?'),
  setRole: db.prepare('UPDATE users SET role = ? WHERE username = ?'),
  setDisabled: db.prepare('UPDATE users SET disabled = ? WHERE username = ?'),
  activeAdmins: db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0"),
  newSession: db.prepare('INSERT INTO auth_sessions (token_hash, username, expires_ts) VALUES (?, ?, ?)'),
  session: db.prepare(`
    SELECT u.username, u.role FROM auth_sessions s JOIN users u ON u.username = s.username
    WHERE s.token_hash = ? AND s.expires_ts > ? AND u.disabled = 0`),
  dropSession: db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?'),
  dropUserSessions: db.prepare('DELETE FROM auth_sessions WHERE username = ?'),
  purge: db.prepare('DELETE FROM auth_sessions WHERE expires_ts <= ?'),
};

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const USER_RE = /^[A-Za-z0-9._@-]{3,64}$/;
function validate({ username, password, role }, { requirePassword = true } = {}) {
  if (username !== undefined && !USER_RE.test(username)) return '帳號需為 3–64 個英數字或 . _ @ -';
  if ((requirePassword || password !== undefined) && (typeof password !== 'string' || password.length < 10)) return '密碼至少 10 個字元';
  if (role !== undefined && !ROLES.includes(role)) return '角色只能是 admin 或 researcher';
  return null;
}

function createUser(username, password, role, { fromEnv = false } = {}) {
  // 從 .env 沿用舊的 DASHBOARD_PASS 時不檢查長度，避免升級後被鎖在門外（之後請在後台改密碼）
  const err = validate({ username, password: fromEnv && password ? 'x'.repeat(10) : password, role });
  if (err) return { error: err };
  if (q.get.get(username)) return { error: '帳號已存在' };
  q.insert.run(username, hashPassword(password), role, Date.now());
  return { ok: true };
}

// 第一次啟動：沒有任何帳號時，用 .env 的 ADMIN_USER/ADMIN_PASS（或舊的 DASHBOARD_USER/DASHBOARD_PASS）建立管理者
function bootstrap(env = process.env) {
  if (q.count.get().n > 0) return null;
  const user = env.ADMIN_USER || env.DASHBOARD_USER;
  const pass = env.ADMIN_PASS || env.DASHBOARD_PASS;
  if (!user || !pass) return 'no-users';
  const r = createUser(user, pass, 'admin', { fromEnv: true });
  return r.error ? 'bootstrap-failed: ' + r.error : 'created';
}

function updateUser(username, patch, actor) {
  const u = q.get.get(username);
  if (!u) return { status: 404, error: '找不到帳號' };
  const err = validate({ password: patch.password, role: patch.role }, { requirePassword: false });
  if (err) return { status: 400, error: err };
  const losesAdmin = u.role === 'admin' && !u.disabled && ((patch.role && patch.role !== 'admin') || patch.disabled);
  if (losesAdmin && q.activeAdmins.get().n <= 1) return { status: 400, error: '至少要保留一個可用的管理者帳號' };
  if (username === actor && patch.disabled) return { status: 400, error: '不能停用自己的帳號' };
  db.transaction(() => {
    if (patch.password) { q.setPass.run(hashPassword(patch.password), username); q.dropUserSessions.run(username); }
    if (patch.role) q.setRole.run(patch.role, username);
    if (patch.disabled !== undefined) { q.setDisabled.run(patch.disabled ? 1 : 0, username); if (patch.disabled) q.dropUserSessions.run(username); }
  })();
  return { status: 200, ok: true };
}

// 登入失敗限制：每個 IP 15 分鐘內最多 10 次
const fails = new Map();
function tooManyFails(ip) {
  const f = fails.get(ip);
  return f && Date.now() - f.start < 15 * 60000 && f.n >= 10;
}
function noteFail(ip) {
  const now = Date.now();
  let f = fails.get(ip);
  if (!f || now - f.start > 15 * 60000) { f = { start: now, n: 0 }; fails.set(ip, f); }
  f.n++;
}

function login(username, password, ip) {
  if (tooManyFails(ip)) return { status: 429, error: '登入失敗太多次，請 15 分鐘後再試' };
  const u = typeof username === 'string' ? q.get.get(username) : null;
  const ok = u && !u.disabled && verifyPassword(password, u.pass_hash);
  if (!ok) { noteFail(ip); return { status: 401, error: '帳號或密碼錯誤' }; }
  fails.delete(ip);
  const token = crypto.randomBytes(32).toString('base64url');
  q.purge.run(Date.now());
  q.newSession.run(sha(token), u.username, Date.now() + SESSION_DAYS * 86400000);
  return { status: 200, token, user: { username: u.username, role: u.role } };
}

function readCookie(req) {
  const raw = req.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieHeader(token, req, basePath, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=${basePath || '/'}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function attachUser(req, res, next) {
  const token = readCookie(req);
  req.user = token ? q.session.get(sha(token), Date.now()) || null : null;
  next();
}

function logout(req) {
  const token = readCookie(req);
  if (token) q.dropSession.run(sha(token));
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ ok: false, error: 'login required' });
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'login required' });
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '只有管理者可以使用' });
  next();
}

module.exports = {
  bootstrap, createUser, updateUser, login, logout, attachUser, requireLogin, requireAdmin,
  cookieHeader, listUsers: () => q.list.all(), SESSION_DAYS, ROLES, hashPassword, verifyPassword,
};
