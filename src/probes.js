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

// 管理者用的摘要：只顯示數量與最近幾筆的重點欄位，完整內容用 CSV 匯出
const TZ_OFFSET_MS = Number(process.env.TZ_OFFSET_MIN ?? 480) * 60 * 1000;
function summary(recentN = 5) {
  const now = Date.now();
  const dayStart = Math.floor((now + TZ_OFFSET_MS) / 86400000) * 86400000 - TZ_OFFSET_MS;
  const rows = db.prepare('SELECT server_ts, payload FROM probes WHERE server_ts >= ?').all(dayStart);
  let rejected = 0;
  for (const r of rows) if (r.payload && r.payload.includes('"_rejected"')) rejected++;
  const recent = db.prepare('SELECT server_ts, payload FROM probes ORDER BY id DESC LIMIT ?').all(recentN).map(compact);
  const lastRej = db.prepare(`SELECT server_ts, payload FROM probes WHERE payload LIKE '%"_rejected"%' ORDER BY id DESC LIMIT 1`).get();
  return {
    kept: db.prepare('SELECT COUNT(*) n FROM probes').get().n,
    keep_limit: KEEP,
    today_total: rows.length,
    today_rejected: rejected,
    last_ts: recent[0] ? recent[0].time : null,
    last_rejected: lastRej ? compact(lastRej) : null,
    recent,
  };
}

function compact(r) {
  let p = {};
  try { p = JSON.parse(r.payload); } catch { /* ignore */ }
  return {
    time: r.server_ts,
    rejected: p._rejected || null,
    event: p.event || null,
    asset_name: p.asset_name || null,
    asset_type: p.asset_type || null,
    user_set: !!(p.user && !/^%.*%$/.test(p.user)),
    email_set: !!(p.email && !/^%.*%$/.test(p.email)),
  };
}

function exportCsv(write, cell, iso) {
  write('﻿id,server_ts,time_local,payload\n');
  for (const r of db.prepare('SELECT * FROM probes ORDER BY id').iterate()) {
    write([r.id, r.server_ts, iso(r.server_ts), r.payload].map(cell).join(',') + '\n');
  }
}

module.exports.summary = summary;
module.exports.exportCsv = exportCsv;
