// FrameVR Action Editor 請求 → 行為事件 的推算邏輯
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb, fakeClock } = require('./helpers');

useTempDb('fa');
const clock = fakeClock();
const db = require('../src/db');
const fa = require('../src/frameAction');

const MIN = 60 * 1000;
const call = (p) => fa.handleFrameAction({ frame: 'f', ...p }, 'test');
const mat = (user, name) => call({ event: 'material', user, asset_name: name, asset_type: 'images' });
const events = (user) => db.prepare('SELECT * FROM events WHERE student_id = ? ORDER BY ts, seq').all('user:' + user);
const sessionsOf = (user) => db.prepare('SELECT * FROM sessions WHERE student_id = ? ORDER BY start_ts').all('user:' + user);

test('物件名稱自動判斷事件', () => {
  assert.equal(fa.inferFromName('Air-Cleaning Tree').action, 'material');
  assert.deepEqual(fa.inferFromName('Smart Parking 喜歡'), { action: 'like', material: 'Smart Parking' });
  assert.deepEqual(fa.inferFromName('Future Cooling-收藏'), { action: 'favorite', material: 'Future Cooling' });
  assert.equal(fa.inferFromName('入口方塊').action, 'enter');
  assert.equal(fa.inferFromName('出口').action, 'leave');
  assert.equal(fa.inferFromName('測驗按鈕').action, 'click');
});

test('身分：未替換的 %變數% 與 Guest 不採用，改用帳號 ID', () => {
  assert.equal(fa.resolveStudent({ student: '%nametag%', user: 'u1' }).id, 'user:u1');
  assert.equal(fa.resolveStudent({ student: 'Guest', user: 'u1' }).id, 'user:u1');
  assert.equal(fa.resolveStudent({ user: '%uniqueUserId%' }).id, 'Guest');
});

test('切換教材時，上一份教材記錄互動時間', () => {
  mat('sw', 'A'); clock.advance(2 * MIN);
  mat('sw', 'B');
  const close = events('sw').find((e) => e.event_type === 'material_close');
  assert.equal(close.target_id, 'A');
  assert.equal(close.duration_ms, 2 * MIN);
});

test('喜歡按鈕在喜歡／取消喜歡之間切換，並對應目前開著的教材', () => {
  mat('lk', 'Poster'); clock.advance(5000);
  call({ event: 'auto', user: 'lk', asset_name: '喜歡' }); clock.advance(5000);
  call({ event: 'auto', user: 'lk', asset_name: '喜歡' });
  const prefs = events('lk').filter((e) => /like/.test(e.event_type));
  assert.deepEqual(prefs.map((e) => [e.event_type, e.target_id]), [['like', 'Poster'], ['unlike', 'Poster']]);
});

// R-01：學生看完最後一份教材就離開、不再回來 → 最後一份教材也要有互動時間，工作階段也要結束
test('R-01 閒置巡檢：最後一份教材記錄時間、工作階段標記結束', () => {
  mat('r01', 'A'); clock.advance(1 * MIN);
  mat('r01', 'B'); clock.advance(3 * MIN);
  call({ event: 'click', user: 'r01', asset_name: 'Car 1', asset_type: 'models' });
  const lastAction = clock.now;
  clock.advance(3 * 60 * MIN); // 3 小時都沒有回來

  assert.equal(typeof fa.closeIdleSessions, 'function', '需要伺服器端的閒置巡檢 closeIdleSessions()');
  fa.closeIdleSessions();

  const closes = events('r01').filter((e) => e.event_type === 'material_close');
  const b = closes.find((e) => e.target_id === 'B');
  assert.ok(b, '最後一份教材 B 應該被關閉');
  assert.equal(b.duration_ms, 3 * MIN, 'B 的互動時間算到最後一次動作');
  const [s] = sessionsOf('r01');
  assert.equal(s.end_ts, lastAction);
  assert.equal(s.end_reason, 'timeout');

  // 再巡檢一次不會重複關閉
  fa.closeIdleSessions();
  assert.equal(events('r01').filter((e) => e.event_type === 'material_close').length, closes.length);
});

// R-02：同一人同一物件在 1 秒內重複觸發只算一次
test('R-02 連點去重：1 秒內重複只記一次，間隔 2 秒則各記一次', () => {
  for (let i = 0; i < 3; i++) call({ event: 'click', user: 'r02', asset_name: 'Car 1', asset_type: 'models' });
  clock.advance(300);
  call({ event: 'click', user: 'r02', asset_name: 'Car 1', asset_type: 'models' });
  const clicks = () => events('r02').filter((e) => e.event_type === 'click').length;
  assert.equal(clicks(), 1, '同一秒內的重複觸發應只記 1 次');
  clock.advance(2000);
  call({ event: 'click', user: 'r02', asset_name: 'Car 1', asset_type: 'models' });
  assert.equal(clicks(), 2);
  // 不同物件不受影響
  call({ event: 'click', user: 'r02', asset_name: 'Car 2', asset_type: 'models' });
  assert.equal(clicks(), 3);
});

test('R-02 同一瞬間重複觸發喜歡按鈕只切換一次（不會立刻變回取消）', () => {
  mat('r02b', 'Poster'); clock.advance(2000);
  call({ event: 'like', user: 'r02b', asset_name: '喜歡' });
  call({ event: 'like', user: 'r02b', asset_name: '喜歡' }); // 同一瞬間重複觸發 → 視為一次
  const prefs = events('r02b').filter((e) => /like/.test(e.event_type)).map((e) => e.event_type);
  assert.deepEqual(prefs, ['like']);
});

test('學生代號連續不跳號（同一位學生重複出現不消耗編號）', () => {
  for (let i = 0; i < 5; i++) { clock.advance(5000); mat('seqA', 'P' + i); mat('seqB', 'P' + i); }
  const ids = db.prepare('SELECT id FROM students ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(ids, ids.map((_, i) => i + 1));
});
