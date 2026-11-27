// 語法檢查：所有 JS 檔與 deploy.sh
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dirs = ['.', 'src', 'public', 'scripts', 'test'];
let n = 0;
for (const d of dirs) {
  for (const f of fs.readdirSync(path.join(root, d))) {
    if (!f.endsWith('.js')) continue;
    execFileSync(process.execPath, ['--check', path.join(root, d, f)], { stdio: 'inherit' });
    n++;
  }
}
execFileSync('bash', ['-n', path.join(root, 'deploy.sh')], { stdio: 'inherit' });
console.log(`語法檢查通過（${n} 個 JS 檔 + deploy.sh）`);
