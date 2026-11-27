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

-- 學生身分：代號（S001…）依第一次出現的順序編號；email 只有管理者看得到
CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id  TEXT UNIQUE NOT NULL,      -- 與 events.student_id 相同（例如 user:<FrameVR 帳號 ID>）
  email       TEXT,                      -- FrameVR %email%（學生同意分享時才有）
  excluded    INTEGER NOT NULL DEFAULT 0, -- 1 = 測試帳號，統計時排除
  note        TEXT,
  first_seen  INTEGER
);

-- 後台帳號：admin 可看設定與管理；researcher 只看統計（學生顯示為代號）
CREATE TABLE IF NOT EXISTS users (
  username    TEXT PRIMARY KEY,
  pass_hash   TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'researcher')),
  disabled    INTEGER NOT NULL DEFAULT 0,
  created_ts  INTEGER
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash  TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  expires_ts  INTEGER NOT NULL
);
`);

// 舊資料庫升級：把既有事件裡的學生補進 students（依第一次出現時間編號；已存在的不變）
db.exec(`
INSERT INTO students (student_id, first_seen)
SELECT student_id, MIN(ts) FROM events
WHERE student_id NOT IN (SELECT student_id FROM students)
GROUP BY student_id ORDER BY MIN(ts);
`);

module.exports = db;
