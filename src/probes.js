// 原始請求紀錄（給管理者檢查 FrameVR 設定用）：一律有筆數上限，避免被大量請求灌爆
const db = require('./db');

const KEEP = Number(process.env.PROBE_KEEP || 300);
const insert = db.prepare('INSERT INTO probes (server_ts, payload) VALUES (?, ?)');
const trim = db.prepare('DELETE FROM probes WHERE id <= (SELECT id FROM probes ORDER BY id DESC LIMIT 1 OFFSET ?)');

function logProbe(payload) {
  try {
    insert.run(Date.now(), JSON.stringify(payload).slice(0, 4000));
    trim.run(KEEP);
  } catch { /* 紀錄失敗不影響主流程 */ }
}

module.exports = { logProbe, KEEP };
