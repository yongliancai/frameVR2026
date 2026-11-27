// 升級相容性：用舊版（d493438）的資料庫結構啟動新程式，資料完整、學生依第一次出現順序編號
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { useTempDb } = require('./helpers');

const { dbPath } = useTempDb('mig');
const old = new Database(dbPath);
old.exec(`
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, seq INTEGER, student_id TEXT NOT NULL, session_id TEXT NOT NULL,
  frame TEXT, event_type TEXT NOT NULL, target_id TEXT, target_type TEXT, target_name TEXT, duration_ms INTEGER, ts INTEGER NOT NULL,
  client_ts INTEGER, server_ts INTEGER NOT NULL, meta TEXT);
CREATE TABLE sessions (session_id TEXT PRIMARY KEY, student_id TEXT NOT NULL, frame TEXT, start_ts INTEGER NOT NULL, last_ts INTEGER NOT NULL,
  end_ts INTEGER, end_reason TEXT, user_agent TEXT, event_count INTEGER DEFAULT 0);
CREATE TABLE probes (id INTEGER PRIMARY KEY AUTOINCREMENT, server_ts INTEGER NOT NULL, payload TEXT);`);
const ins = old.prepare('INSERT INTO events (event_id, seq, student_id, session_id, event_type, ts, server_ts) VALUES (?, 1, ?, ?, ?, ?, ?)');
ins.run('e1', 'user:later', 's2', 'click', 2000, 2000);
ins.run('e2', 'user:first', 's1', 'click', 1000, 1000);
ins.run('e3', 'user:first', 's1', 'material_open', 1500, 1500);
old.prepare("INSERT INTO sessions (session_id, student_id, start_ts, last_ts) VALUES ('s1', 'user:first', 1000, 1500)").run();
old.close();

test('舊資料庫升級：事件不變、學生補進身分表並依第一次出現排序', () => {
  const db = require('../src/db');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM events').get().n, 3);
  const rows = db.prepare('SELECT id, student_id FROM students ORDER BY id').all();
  assert.deepEqual(rows, [{ id: 1, student_id: 'user:first' }, { id: 2, student_id: 'user:later' }]);
  for (const t of ['users', 'auth_sessions']) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(t), t);
});

test('重新啟動（重跑升級）不會重複或跳號', () => {
  delete require.cache[require.resolve('../src/db')];
  const db = require('../src/db');
  assert.deepEqual(db.prepare('SELECT id FROM students ORDER BY id').all().map((r) => r.id), [1, 2]);
});
