// 學生身分顯示：依角色決定研究者看到什麼
//   admin      ：email（有的話）或代號，並可看到原始帳號 ID
//   researcher ：只看到代號 S001…，回應中不含帳號 ID 與 email
const db = require('./db');

const q = {
  all: db.prepare('SELECT id, student_id, email, excluded, note, first_seen FROM students'),
  byId: db.prepare('SELECT * FROM students WHERE id = ?'),
  setEmail: db.prepare('UPDATE students SET email = ? WHERE student_id = ? AND (email IS NULL OR email != ?)'),
  update: db.prepare('UPDATE students SET excluded = COALESCE(@excluded, excluded), note = COALESCE(@note, note) WHERE id = @id'),
  list: db.prepare(`
    SELECT s.id, s.student_id, s.email, s.excluded, s.note, s.first_seen,
           (SELECT MAX(e.ts) FROM events e WHERE e.student_id = s.student_id) AS last_seen,
           (SELECT COUNT(*) FROM events e WHERE e.student_id = s.student_id) AS events
    FROM students s ORDER BY s.id`),
};

const code = (id) => 'S' + String(id).padStart(3, '0');
const CODE_RE = /^S(\d{1,9})$/;

function directory() {
  const map = new Map();
  for (const r of q.all.all()) map.set(r.student_id, { ...r, code: code(r.id) });
  return map;
}

// 後台網址裡的學生參數：研究者只會拿到代號（mode='code'）；
// 管理者拿到的是原始 ID（mode='auto'：先找原始 ID，找不到才當成代號）。
// 原始 ID 可能剛好長得像代號（例如名牌 S0314），所以不能只看格式判斷（R-12）。
const existsId = db.prepare('SELECT 1 FROM students WHERE student_id = ?');
function resolveParam(v, mode = 'code') {
  if (v == null || v === '') return v;
  const raw = String(v);
  if (mode === 'auto' && existsId.get(raw)) return raw;
  const m = CODE_RE.exec(raw.trim());
  if (!m) return mode === 'auto' ? raw : '\u0000no-such-student';
  const r = q.byId.get(Number(m[1]));
  return r ? r.student_id : '\u0000no-such-student';
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
function setEmail(studentId, email) {
  if (!email || !EMAIL_RE.test(email)) return;
  q.setEmail.run(email.toLowerCase(), studentId, email.toLowerCase());
}

function stripMeta(meta) {
  if (!meta) return meta;
  try {
    const m = JSON.parse(meta);
    delete m.user; delete m.email;
    return JSON.stringify(m);
  } catch { return null; }
}

// 對任何 API 回應做身分轉換：遇到含 student_id 的物件就加上顯示名稱
function relabel(data, role, dir = directory()) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = walk(val);
    if (typeof out.student_id === 'string') {
      const s = dir.get(out.student_id);
      const c = s ? s.code : '未編號';
      if (role === 'admin') {
        out.student_code = c;
        out.student_email = s ? s.email : null;
        out.student_label = (s && s.email) || c;
      } else {
        out.student_id = c;
        out.student_label = c;
        if (typeof out.meta === 'string') out.meta = stripMeta(out.meta);
      }
    }
    return out;
  };
  return walk(data);
}

function list() {
  return q.list.all().map((r) => ({ ...r, code: code(r.id) }));
}

function update(codeStr, patch) {
  const m = CODE_RE.exec(String(codeStr));
  if (!m) return false;
  const excluded = patch.excluded === undefined ? null : (patch.excluded ? 1 : 0);
  const note = patch.note === undefined ? null : String(patch.note).slice(0, 200);
  return q.update.run({ id: Number(m[1]), excluded, note }).changes > 0;
}

module.exports = { relabel, resolveParam, setEmail, list, update, directory, code };
