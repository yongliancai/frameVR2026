// HTTP 黑箱測試：啟動真正的 server.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const KEY = 'test_ingest_key_0123456789';
let srv;
test.before(async () => { srv = await startServer({ INGEST_KEY: KEY }); });
test.after(async () => { await srv.stop(); });

const post = (path, body, headers = {}) => fetch(srv.base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('正確金鑰：Action Editor 請求被記錄', async () => {
  const r = await post('/api/frame-action', { event: 'material', user: 'h1', asset_name: 'Air-Cleaning Tree', asset_type: 'images' }, { 'X-API-Key': KEY });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.student, 'user:h1');
  assert.ok(j.recorded.includes('material_open'));
});

test('錯誤金鑰回 401', async () => {
  const r = await post('/api/frame-action', { event: 'click', user: 'x' }, { 'X-API-Key': 'wrong' });
  assert.equal(r.status, 401);
});

// R-09：金鑰不能放在網址（會被記進 Nginx log）
test('R-09 網址參數 ?key= 不被接受', async () => {
  const r = await fetch(srv.base + '/api/frame-action?key=' + KEY + '&event=click&user=q');
  assert.equal(r.status, 401);
});

// R-03：沒有正確金鑰的請求不能無限寫入資料庫
test('R-03 大量錯誤金鑰請求，原始請求紀錄有上限', async () => {
  const pad = 'x'.repeat(200);
  for (let i = 0; i < 400; i++) {
    await post('/api/frame-action', { pad, i }, { 'X-API-Key': 'wrong' });
  }
  const db = require('better-sqlite3')(srv.dbPath, { readonly: true });
  const n = db.prepare('SELECT COUNT(*) n FROM probes').get().n;
  db.close();
  assert.ok(n <= 300, `probes 有 ${n} 筆，應不超過 300`);
});

test('被拒絕的請求很多之後，正確金鑰仍然可以寫入', async () => {
  const r = await post('/api/frame-action', { event: 'click', user: 'h2', asset_name: 'Car 1', asset_type: 'models' }, { 'X-API-Key': KEY });
  assert.equal(r.status, 200);
});
