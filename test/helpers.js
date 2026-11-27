// 測試共用工具：每個測試檔用自己的暫存 SQLite，並提供可控制的時鐘
// 注意：必須在 require 任何 src/ 模組之前呼叫 useTempDb()
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function useTempDb(name = 'test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'framevr-' + name + '-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  return { dir, dbPath: process.env.DB_PATH };
}

// 讓 Date.now() 回傳可手動推進的時間
function fakeClock(start = Date.UTC(2026, 10, 27, 5, 0, 0)) {
  let now = start;
  const real = Date.now;
  Date.now = () => now;
  return {
    get now() { return now; },
    advance(ms) { now += ms; return now; },
    set(ms) { now = ms; },
    restore() { Date.now = real; },
  };
}

// 以子程序啟動真正的 server.js（黑箱測試 HTTP 行為）
async function startServer(env = {}) {
  const { dbPath, dir } = useTempDb('srv');
  const port = 4100 + Math.floor(Math.random() * 800);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), HOST: '127.0.0.1', BASE_PATH: '/framevr', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}/framevr`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* 還沒啟動 */ }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 49) throw new Error('server did not start:\n' + log);
  }
  return {
    base, dbPath, dir,
    log: () => log,
    stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }),
  };
}

module.exports = { useTempDb, fakeClock, startServer };
