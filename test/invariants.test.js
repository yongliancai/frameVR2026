// 不變量測試：隨機產生大量操作序列，檢查推算結果永遠合理
// 用固定種子，失敗時可以重現（訊息會印出種子）
const test = require('node:test');
const assert = require('node:assert/strict');
const { useTempDb, fakeClock } = require('./helpers');

useTempDb('inv');
const clock = fakeClock();
const db = require('../src/db');
const fa = require('../src/frameAction');

const MAX_MATERIAL_MS = Number(process.env.MAX_MATERIAL_MIN || 10) * 60 * 1000;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

const NAMES = ['展板A', '展板B', '展板C', 'Car 1', 'Woman 2', 'Poster 喜歡', 'Poster 收藏', '入口', '出口', '測驗按鈕'];
const GAPS = [0, 200, 1500, 20e3, 3 * 60e3, 12 * 60e3, 20 * 60e3, 2 * 3600e3];

test('隨機 300 組操作序列，推算結果符合不變量', () => {
  const seeds = 300;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = rng(seed);
    const users = ['u' + seed + 'a', 'u' + seed + 'b'];
    const steps = 5 + Math.floor(r() * 30);
    for (let i = 0; i < steps; i++) {
      clock.advance(pick(r, GAPS));
      const name = pick(r, NAMES);
      const type = /Car|Woman/.test(name) ? 'models' : 'images';
      fa.handleFrameAction({ event: 'auto', user: pick(r, users), frame: 'f', asset_name: name, asset_type: type }, 't');
      if (fa.closeIdleSessions && r() < 0.2) fa.closeIdleSessions();
    }
    clock.advance(24 * 3600e3);
    if (fa.closeIdleSessions) fa.closeIdleSessions();

    for (const u of users) {
      const id = 'user:' + u;
      const msg = `seed=${seed} student=${id}`;
      const evs = db.prepare('SELECT * FROM events WHERE student_id = ? ORDER BY session_id, seq').all(id);
      const bySession = new Map();
      for (const e of evs) { if (!bySession.has(e.session_id)) bySession.set(e.session_id, []); bySession.get(e.session_id).push(e); }

      for (const [sid, list] of bySession) {
        // 1. 每個工作階段內 seq 唯一且遞增
        const seqs = list.map((e) => e.seq);
        assert.deepEqual(seqs, [...new Set(seqs)].sort((a, b) => a - b), msg + ' seq 重複或亂序');
        // 2. 第一個事件是 session_start
        assert.equal(list[0].event_type, 'session_start', msg + ' 工作階段沒有以 session_start 開始');
        // 3. 教材開關成對：同時最多一份開著，關閉的是目前開著的那份
        let open = null;
        for (const e of list) {
          if (e.event_type === 'material_open') { assert.equal(open, null, msg + ' 同時開著兩份教材'); open = e.target_id; }
          if (e.event_type === 'material_close') { assert.equal(e.target_id, open, msg + ' 關閉了沒開著的教材'); open = null; }
          // 4. 互動時間在 0 ～ 上限之間（或未知 null）
          if (e.event_type === 'material_close' && e.duration_ms !== null) {
            assert.ok(e.duration_ms >= 0 && e.duration_ms <= MAX_MATERIAL_MS, msg + ' 互動時間超出範圍 ' + e.duration_ms);
          }
        }
        // 5. 一天後巡檢完：沒有還開著的教材，工作階段都已結束
        if (fa.closeIdleSessions) {
          assert.equal(open, null, msg + ` 工作階段 ${sid} 結束後仍有開著的教材`);
          const s = db.prepare('SELECT end_ts FROM sessions WHERE session_id = ?').get(sid);
          assert.ok(s && s.end_ts, msg + ` 工作階段 ${sid} 沒有結束時間`);
        }
      }
      // 6. 喜歡／取消喜歡交替出現（每份教材）
      const prefs = db.prepare("SELECT target_id, event_type FROM events WHERE student_id = ? AND event_type IN ('like','unlike') ORDER BY ts, id").all(id);
      const last = new Map();
      for (const p of prefs) {
        assert.notEqual(last.get(p.target_id), p.event_type, msg + ' 喜歡狀態沒有交替');
        last.set(p.target_id, p.event_type);
      }
    }
  }
});
