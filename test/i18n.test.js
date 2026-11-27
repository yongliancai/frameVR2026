// 英文版：伺服器產生的說明、觀察、Excel 標題都不能殘留中文（資料本身除外）
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers');

const CJK = /[㐀-鿿＀-￯　-〿]/;
const KEY = 'test_ingest_key_0123456789';
let srv; let cookie;

test.before(async () => {
  srv = await startServer({ INGEST_KEY: KEY, ADMIN_USER: 'admin', ADMIN_PASS: 'admin-password-123', DEDUPE_MS: '0' });
  const send = (b) => fetch(srv.base + '/api/frame-action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY }, body: JSON.stringify(b) });
  // 英文命名的教材，讓「資料」本身沒有中文，方便檢查介面文字
  for (const u of ['a', 'b', 'c', 'd', 'e']) {
    for (const n of ['Poster A', 'Poster B', 'Poster C']) await send({ event: 'material', user: u, frame: 'f', asset_name: n, asset_type: 'images' });
    await send({ event: 'click', user: u, frame: 'f', asset_name: 'Car 1', asset_type: 'models' });
    await send({ event: 'like', user: u, frame: 'f', asset_name: 'Like', material: 'Poster A' });
  }
  const l = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin-password-123' }) });
  cookie = l.headers.get('set-cookie').split(';')[0];
});
test.after(async () => { await srv.stop(); });

const get = (p) => fetch(srv.base + p, { headers: { Cookie: cookie } });

test('研究分析 API：lang=en 時說明、觀察、類型、編碼全為英文', async () => {
  const d = await (await get('/api/analysis?lang=en')).json();
  const leak = [];
  const walk = (v, p) => {
    if (typeof v === 'string') { if (CJK.test(v)) leak.push(p + ' = ' + v); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (CJK.test(k)) leak.push(p + ' key ' + k); walk(x, p + '.' + k); }
  };
  walk(d, '$');
  assert.deepEqual(leak, []);
  assert.ok(d.observations.length > 0);
  assert.ok(d.categories[0].title.startsWith('A.'));
});

test('研究分析 API：預設仍是中文', async () => {
  const d = await (await get('/api/analysis')).json();
  assert.match(d.categories[0].title, /參與度/);
});

function unzip(buf) {
  const out = {}; let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const comp = buf.readUInt32LE(i + 18), nl = buf.readUInt16LE(i + 26), ex = buf.readUInt16LE(i + 28);
    out[buf.slice(i + 30, i + 30 + nl).toString()] = zlib.inflateRawSync(buf.slice(i + 30 + nl + ex, i + 30 + nl + ex + comp)).toString();
    i += 30 + nl + ex + comp;
  }
  return out;
}

test('Excel：lang=en 時工作表名稱、標題與說明全為英文', async () => {
  const r = await get('/api/export/research.xlsx?lang=en');
  assert.match(r.headers.get('content-disposition'), /-en\.xlsx/);
  const files = unzip(Buffer.from(await r.arrayBuffer()));
  for (const [name, xml] of Object.entries(files)) {
    const m = xml.match(/[^<>]*[㐀-鿿＀-￯　-〿][^<>]*/);
    assert.equal(m, null, `${name} 有中文：${m && m[0]}`);
  }
  assert.ok(files['xl/workbook.xml'].includes('name="README"'));
});

test('前端字典：中文鍵不重複、英文值不含中文', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8');
  const body = src.slice(src.indexOf('const EN = {'), src.indexOf('};', src.indexOf('const EN = {')));
  const keys = [...body.matchAll(/'((?:[^'\\]|\\.)+)':\s*'((?:[^'\\]|\\.)*)'/g)];
  assert.ok(keys.length > 200);
  const seen = new Set();
  for (const [, k, v] of keys) {
    assert.ok(!seen.has(k), '重複的鍵：' + k);
    seen.add(k);
    assert.doesNotMatch(v, CJK, `「${k}」的英文還有中文：${v}`);
  }
});
