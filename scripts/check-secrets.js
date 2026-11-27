// 秘密掃描：攔截被 commit 的金鑰與 .env（曾發生 INGEST_KEY 外流到公開 GitHub）
// 用法：node scripts/check-secrets.js [檔案…]；不帶參數時掃描 git 追蹤的所有檔案
const fs = require('fs');
const { execSync } = require('child_process');

const RULES = [
  { name: 'FrameVR 互動金鑰（frk_ 開頭）', re: /\bfrk_[A-Za-z0-9_-]{16,}/ },
  { name: '私鑰', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: '在程式中寫死 INGEST_KEY / DASHBOARD_PASS / FRAME_API_KEY 的值', re: /\b(INGEST_KEY|DASHBOARD_PASS|ADMIN_PASS|FRAME_API_KEY|SESSION_SECRET)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{12,}/ },
  { name: 'X-API-Key 標頭寫死金鑰', re: /x-api-key['"]?\s*[:,]\s*['"][A-Za-z0-9_\-]{20,}['"]/i },
];
// 合法的例外：範例檔與測試用的假金鑰
const ALLOW_FILES = [/^\.env\.example$/, /^test\//, /^scripts\/check-secrets\.js$/];

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];
for (const f of files) {
  const base = f.split('/').pop();
  if (base === '.env' || /^\.env\.(?!example$)/.test(base)) { problems.push(`${f}: 不可 commit .env 檔`); continue; }
  if (ALLOW_FILES.some((r) => r.test(f))) continue;
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\u0000')) continue; // 二進位檔
  text.split('\n').forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) problems.push(`${f}:${i + 1}: ${r.name}`);
  });
}
if (problems.length) {
  console.error('秘密掃描失敗：\n  ' + problems.join('\n  ') + '\n金鑰請放在伺服器的 .env，不要放進 repo。');
  process.exit(1);
}
console.log(`秘密掃描通過（${files.length} 個檔案）`);
