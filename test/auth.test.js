// 帳號與角色：研究者看不到設定，學生只顯示代號
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const KEY = 'test_ingest_key_0123456789';
const ADMIN = { username: 'admin', password: 'admin-password-123' };
const RES = { username: 'researcher1', password: 'research-pass-456' };
let srv;

test.before(async () => {
  srv = await startServer({ INGEST_KEY: KEY, ADMIN_USER: ADMIN.username, ADMIN_PASS: ADMIN.password, DEDUPE_MS: '0' });
  const send = (b) => fetch(srv.base + '/api/frame-action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY }, body: JSON.stringify(b) });
  await send({ event: 'material', user: 'acct-aaa', email: 'stu.a@gmail.com', frame: 'f', asset_name: 'Poster A', asset_type: 'images' });
  await send({ event: 'material', user: 'acct-bbb', email: '%email%', frame: 'f', asset_name: 'Poster B', asset_type: 'images' });
  await send({ event: 'click', user: 'acct-owner', frame: 'f', asset_name: 'Car 1', asset_type: 'models' });
});
test.after(async () => { await srv.stop(); });

async function login(cred) {
  const r = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cred) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { status: r.status, cookie };
}
const get = (path, cookie) => fetch(srv.base + path, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
const send = (method, path, cookie, body) => fetch(srv.base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('未登入：資料 API 回 401，首頁導向登入頁', async () => {
  assert.equal((await get('/api/overview')).status, 401);
  const r = await get('/');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /login\.html$/);
  assert.equal((await get('/login.html')).status, 200);
});

test('錯誤密碼不能登入', async () => {
  assert.equal((await login({ username: 'admin', password: 'wrong-password' })).status, 401);
});

test('管理者用 .env 帳號登入，可以建立研究者帳號', async () => {
  const a = await login(ADMIN);
  assert.equal(a.status, 200);
  assert.match(a.cookie, /^fvr_sess=/);
  const me = await (await get('/api/me', a.cookie)).json();
  assert.equal(me.role, 'admin');
  const r = await send('POST', '/api/users', a.cookie, { ...RES, role: 'researcher' });
  assert.equal(r.status, 200);
  const short = await send('POST', '/api/users', a.cookie, { username: 'r2', password: 'short', role: 'researcher' });
  assert.equal(short.status, 400);
});

const ADMIN_ONLY = ['/api/probes/summary', '/api/config', '/api/frameapi/frame', '/api/users', '/api/student-ids', '/api/export/probes.csv'];

test('研究者呼叫管理功能一律 403（伺服器端檢查，不只是隱藏分頁）', async () => {
  const r = await login(RES);
  assert.equal(r.status, 200);
  for (const p of ADMIN_ONLY) assert.equal((await get(p, r.cookie)).status, 403, p);
  assert.equal((await send('POST', '/api/users', r.cookie, { username: 'hacker', password: 'xxxxxxxxxxxx', role: 'admin' })).status, 403);
});

test('管理者可以使用管理功能', async () => {
  const a = await login(ADMIN);
  for (const p of ADMIN_ONLY) {
    if (p.includes('frameapi')) continue; // 需要外部網路，略過
    assert.equal((await get(p, a.cookie)).status, 200, p);
  }
  const sum = await (await get('/api/probes/summary', a.cookie)).json();
  assert.ok(sum.recent.length <= 5);
  assert.ok(sum.today_total >= 3);
});

test('研究者只看到代號：回應與 CSV 都沒有帳號 ID 或 email', async () => {
  const { cookie } = await login(RES);
  for (const p of ['/api/students', '/api/event-list', '/api/overview', '/api/analysis', '/api/export/events.csv', '/api/export/sessions.csv']) {
    const text = await (await get(p, cookie)).text();
    assert.doesNotMatch(text, /acct-|user:|@gmail/, p + ' 洩漏了身分');
  }
  const rows = await (await get('/api/students', cookie)).json();
  assert.ok(rows.length >= 3);
  for (const r of rows) assert.match(r.student_id, /^S\d{3}$/);
  // 研究者用代號查詢單一學生
  const d = await (await get('/api/students/' + rows[0].student_id, cookie)).json();
  assert.ok(d.sessions.length >= 1);
  assert.equal(d.student_id, rows[0].student_id);
});

test('管理者看得到 email（學生同意時才有），未替換的 %email% 不會被存', async () => {
  const { cookie } = await login(ADMIN);
  const list = await (await get('/api/student-ids', cookie)).json();
  const a = list.find((s) => s.student_id === 'user:acct-aaa');
  const b = list.find((s) => s.student_id === 'user:acct-bbb');
  assert.equal(a.email, 'stu.a@gmail.com');
  assert.equal(b.email, null);
  const rows = await (await get('/api/students', cookie)).json();
  assert.equal(rows.find((r) => r.student_id === 'user:acct-aaa').student_label, 'stu.a@gmail.com');
});

test('標記為測試帳號後，統計排除該學生', async () => {
  const { cookie } = await login(ADMIN);
  const before = (await (await get('/api/overview', cookie)).json()).kpi.students;
  const owner = (await (await get('/api/student-ids', cookie)).json()).find((s) => s.student_id === 'user:acct-owner');
  assert.equal((await send('PATCH', '/api/student-ids/' + owner.code, cookie, { excluded: true })).status, 200);
  const after = (await (await get('/api/overview', cookie)).json()).kpi.students;
  assert.equal(after, before - 1);
});

test('不能移除最後一個管理者；停用帳號後立即登出', async () => {
  const a = await login(ADMIN);
  assert.equal((await send('PATCH', '/api/users/admin', a.cookie, { role: 'researcher' })).status, 400);
  const r = await login(RES);
  assert.equal((await send('PATCH', '/api/users/' + RES.username, a.cookie, { disabled: true })).status, 200);
  assert.equal((await get('/api/overview', r.cookie)).status, 401);
});

test('登出後 cookie 失效；改資料的請求必須是 JSON', async () => {
  const a = await login(ADMIN);
  const form = await fetch(srv.base + '/api/users', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'username=x&password=yyyyyyyyyyyy' });
  assert.equal(form.status, 415);
  await fetch(srv.base + '/api/logout', { method: 'POST', headers: { Cookie: a.cookie } });
  assert.equal((await get('/api/me', a.cookie)).status, 401);
});

test('連續猜密碼會被暫停', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await login({ username: 'admin', password: 'guess-' + i });
  assert.equal(last.status, 429);
});
