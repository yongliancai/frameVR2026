// Excel 匯出：檔案結構正確、內容可被讀取、研究者版本不含身分
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { startServer } = require('./helpers');
const xlsx = require('../src/xlsx');

// 讀回 zip（只支援我們自己產生的 deflate 檔），回傳 { 檔名: 內容字串 }
function unzip(buf) {
  const out = {};
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const comp = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28), crc = buf.readUInt32LE(i + 14);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const data = zlib.inflateRawSync(buf.slice(i + 30 + nameLen + extra, i + 30 + nameLen + extra + comp));
    assert.equal(xlsx.crc32(data), crc, name + ' CRC 不符');
    out[name] = data.toString('utf8');
    i += 30 + nameLen + extra + comp;
  }
  return out;
}

test('xlsx 產生器：欄名、特殊字元跳脫、數字與文字儲存格', () => {
  assert.equal(xlsx.colName(0), 'A');
  assert.equal(xlsx.colName(25), 'Z');
  assert.equal(xlsx.colName(26), 'AA');
  const files = unzip(xlsx.build([{ name: '測試/表[1]', columns: [{ header: '名稱' }, { header: '數值' }], rows: [['<a&b>', 3.5], [null, 0]] }]));
  assert.ok(files['xl/workbook.xml'].includes('name="測試 表 1 "'));
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.ok(sheet.includes('&lt;a&amp;b&gt;'));
  assert.ok(sheet.includes('<c r="B2"><v>3.5</v></c>'));
  assert.ok(sheet.includes('<c r="B3"><v>0</v></c>'));
});

const KEY = 'test_ingest_key_0123456789';
let srv;
test.before(async () => {
  srv = await startServer({ INGEST_KEY: KEY, ADMIN_USER: 'admin', ADMIN_PASS: 'admin-password-123', DEDUPE_MS: '0' });
  const send = (b) => fetch(srv.base + '/api/frame-action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY }, body: JSON.stringify(b) });
  for (const [u, n] of [['acct-1', 'Poster A'], ['acct-1', 'Poster B'], ['acct-2', 'Poster B'], ['acct-2', 'Poster A']]) {
    await send({ event: 'material', user: u, email: u + '@gmail.com', frame: 'f', asset_name: n, asset_type: 'images' });
  }
  await send({ event: 'click', user: 'acct-1', frame: 'f', asset_name: 'Car 1', asset_type: 'models' });
});
test.after(async () => { await srv.stop(); });

async function download(user, pass) {
  const l = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
  const cookie = l.headers.get('set-cookie').split(';')[0];
  const r = await fetch(srv.base + '/api/export/research.xlsx', { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /spreadsheetml/);
  return { files: unzip(Buffer.from(await r.arrayBuffer())), cookie };
}

test('管理者下載：8 張工作表，含代號對照', async () => {
  const { files, cookie } = await download('admin', 'admin-password-123');
  const wb = files['xl/workbook.xml'];
  for (const name of ['說明', '學生摘要', '學生×教材', '工作階段', '教材摘要', '瀏覽順序', '事件明細', '代號對照']) assert.ok(wb.includes(`name="${name}"`), name);
  assert.ok(files['xl/worksheets/sheet8.xml'].includes('acct-1@gmail.com'));
  // 學生摘要有兩位學生（S001、S002），學生×教材有兩份教材各兩欄
  assert.ok(files['xl/worksheets/sheet2.xml'].includes('>S001<') && files['xl/worksheets/sheet2.xml'].includes('>S002<'));
  assert.ok(files['xl/worksheets/sheet3.xml'].includes('Poster A｜互動秒數'));
  // 建立研究者帳號供下一個測試使用
  await fetch(srv.base + '/api/users', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'res', password: 'research-pass-456', role: 'researcher' }) });
});

test('研究者下載：沒有代號對照表，也沒有 email 或帳號 ID', async () => {
  const { files } = await download('res', 'research-pass-456');
  assert.ok(!files['xl/workbook.xml'].includes('代號對照'));
  const all = Object.values(files).join('');
  assert.doesNotMatch(all, /acct-|user:|@gmail/);
  // 瀏覽順序：A→B 與 B→A 各一次，轉移機率 1
  assert.ok(files['xl/worksheets/sheet6.xml'].includes('<v>1</v>'));
});
