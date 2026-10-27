// SQLite 資料層：事件表 + 工作階段表
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'framevr.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     TEXT UNIQUE,              -- 前端產生的 UUID，用來去重
  seq          INTEGER,                  -- 該工作階段內的操作順序
  student_id   TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  frame        TEXT,                     -- FrameVR 空間名稱
  event_type   TEXT NOT NULL,            -- session_start / heartbeat / session_end / click / material_open / material_close / like / unlike / favorite / unfavorite
  target_id    TEXT,
  target_type  TEXT,                     -- board / model / video / button / material
  target_name  TEXT,
  duration_ms  INTEGER,                  -- material_close 時的互動時間
  ts           INTEGER NOT NULL,         -- 事件時間（毫秒，採用前端時間；時鐘明顯錯誤時改用伺服器時間）
  client_ts    INTEGER,
  server_ts    INTEGER NOT NULL,
  meta         TEXT                      -- JSON
);
CREATE INDEX IF NOT EXISTS idx_events_student ON events(student_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type, ts);
CREATE INDEX IF NOT EXISTS idx_events_target  ON events(target_id);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL,
  frame        TEXT,
  start_ts     INTEGER NOT NULL,         -- 進入時間
  last_ts      INTEGER NOT NULL,         -- 最後一次收到事件（含心跳）
  end_ts       INTEGER,                  -- 離開時間（收到 session_end 才有）
  end_reason   TEXT,
  user_agent   TEXT,
  event_count  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_student ON sessions(student_id, start_ts);

CREATE TABLE IF NOT EXISTS probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_ts INTEGER NOT NULL,
  payload TEXT
);
`);

module.exports = db;
