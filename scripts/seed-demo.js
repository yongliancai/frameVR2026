// 產生示範資料（只在測試資料庫使用！）
// 用法：DB_PATH=./data/demo.db node scripts/seed-demo.js
require('../src/env').load();
if (!process.env.DB_PATH) { console.error('請指定 DB_PATH，避免寫進正式資料庫，例如 DB_PATH=./data/demo.db'); process.exit(1); }
const { ingest } = require('../src/ingest');

const MATERIALS = [
  { id: 'board-water-cycle', name: '展板：水循環', type: 'board', w: 9 },
  { id: 'board-rock', name: '展板：岩石的形成', type: 'board', w: 6 },
  { id: 'board-weather', name: '展板：天氣與氣候', type: 'board', w: 5 },
  { id: 'model-heart', name: '3D 模型：心臟', type: 'model', w: 8 },
  { id: 'model-volcano', name: '3D 模型：火山剖面', type: 'model', w: 7 },
  { id: 'model-plant-cell', name: '3D 模型：植物細胞', type: 'model', w: 4 },
  { id: 'video-intro', name: '影片：單元導覽', type: 'video', w: 6 },
  { id: 'video-experiment', name: '影片：蒸發實驗', type: 'video', w: 4 },
];
const BUTTONS = [
  { id: 'btn-quiz', name: '按鈕：小測驗', type: 'button' },
  { id: 'btn-portal', name: '按鈕：傳送門', type: 'button' },
  { id: 'btn-hint', name: '按鈕：提示', type: 'button' },
];
let rnd = 42;
const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const wpick = (arr) => { const t = arr.reduce((s, x) => s + x.w, 0); let r = rand() * t; for (const x of arr) { if ((r -= x.w) <= 0) return x; } return arr[0]; };
const id = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (rand() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });

const students = Array.from({ length: 26 }, (_, i) => 'S' + String(301 + i).padStart(4, '0'));
const DAY = 86400000;
const now = Date.now();
let total = 0;

for (let d = 13; d >= 0; d--) {
  const base = new Date(now - d * DAY);
  const dow = new Date(base.getTime() + 8 * 3600000).getUTCDay();
  if (dow === 0 || dow === 6) continue; // 週末不上課
  // 每天兩堂課：台灣時間 09:10、13:30，部分學生課後自己進來
  const slots = [[1, 10], [5, 30], [11, 0]];
  for (const [hUtc, m] of slots) {
    const start0 = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hUtc, m);
    if (start0 > now) continue;
    const share = hUtc === 11 ? 0.18 : 0.72;
    for (const s of students) {
      if (rand() > share) continue;
      const events = [];
      const sid = id();
      let t = start0 + Math.floor(rand() * 6 * 60000);
      let seq = 0;
      const push = (type, tgt, extra = {}) => events.push({ event_id: id(), seq: ++seq, type, student_id: s, session_id: sid, frame: rand() > 0.15 ? 'science-museum' : 'grade5-review', target_id: tgt?.id, target_type: tgt?.type, target_name: tgt?.name, ts: t, ...extra });
      push('session_start');
      const minutes = 6 + rand() * (hUtc === 11 ? 14 : 30);
      const end = t + minutes * 60000;
      let lastBeat = t;
      while (t < end) {
        const step = 15000 + rand() * 90000;
        t += step;
        while (lastBeat + 30000 < t) { lastBeat += 30000; events.push({ event_id: id(), seq: ++seq, type: 'heartbeat', student_id: s, session_id: sid, ts: lastBeat }); }
        if (rand() < 0.55) {
          const mat = wpick(MATERIALS);
          push('click', mat);
          push('material_open', mat);
          const openAt = t;
          const dwell = 20000 + rand() * (mat.type === 'video' ? 180000 : 110000);
          if (rand() < 0.22) { t = openAt + dwell * 0.5 * rand(); push('like', mat); if (rand() < 0.12) { t += 4000; push('unlike', mat); } }
          if (rand() < 0.12) { t += 3000; push('favorite', mat); if (rand() < 0.15) { t += 4000; push('unfavorite', mat); } }
          t = openAt + dwell;
          push('material_close', mat, { duration_ms: Math.round(dwell), meta: { reason: rand() < 0.6 ? 'switch' : 'close_button' } });
        } else if (rand() < 0.5) {
          push('click', pick(BUTTONS));
        } else {
          push('click', { id: 'mesh:Floor_' + Math.floor(rand() * 3), name: 'Floor_' + Math.floor(rand() * 3), type: 'other' });
        }
      }
      if (t <= now) {
        if (rand() < 0.85) push('session_end', null, { meta: { reason: 'pagehide' } });
        for (let i = 0; i < events.length; i += 400) total += ingest({ events: events.slice(i, i + 400) }, 'seed-demo').json.inserted;
      }
    }
  }
}

// 兩位現在在線的學生
for (const s of ['S0302', 'S0317']) {
  const sid = id(); let t = now - 7 * 60000; let seq = 0;
  const ev = [{ event_id: id(), seq: ++seq, type: 'session_start', student_id: s, session_id: sid, frame: 'science-museum', ts: t }];
  const mat = MATERIALS[3];
  ev.push({ event_id: id(), seq: ++seq, type: 'material_open', student_id: s, session_id: sid, frame: 'science-museum', target_id: mat.id, target_type: mat.type, target_name: mat.name, ts: t + 60000 });
  for (let b = t + 30000; b < now; b += 30000) ev.push({ event_id: id(), seq: ++seq, type: 'heartbeat', student_id: s, session_id: sid, ts: b });
  total += ingest({ events: ev }, 'seed-demo').json.inserted;
}
console.log('inserted events:', total);
