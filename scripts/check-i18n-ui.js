// 英文介面檢查（本機手動執行，需要 Playwright；不在 CI 中）
// 用法：
//   DB_PATH=/tmp/demo.db node scripts/seed-demo.js
//   DB_PATH=/tmp/demo.db PORT=3997 BASE_PATH=/framevr ADMIN_USER=<帳號> ADMIN_PASS=<測試密碼> node server.js &
//   node scripts/check-i18n-ui.js http://localhost:3997/framevr/ <帳號> <測試密碼>
// 會切到英文、走過每個分頁與學生抽屜，列出仍是中文、且不是資料（教材／物件／Frame 名稱）的文字。
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('需要 Playwright：npm i -D playwright（或在已安裝的環境執行）'); process.exit(2); }

const [base = 'http://localhost:3997/framevr/', user, pass] = process.argv.slice(2);
if (!user || !pass) { console.error('用法：node scripts/check-i18n-ui.js <網址> <帳號> <密碼>'); process.exit(2); }
// 刻意保留的中文：語言切換按鈕本身、FrameVR 範本中伺服器辨識用的中文關鍵字
const ALLOWED = [/^中文$/, /^@aria-label:切換成中文$/, /Chinese keywords/];

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fvr_lang', 'en'); } catch (e) { /* ignore */ } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const left = new Map(); const data = new Set();
  const scan = async (tag) => {
    const found = await p.evaluate(() => {
      const CJK = /[㐀-鿿＀-￯　-〿]/; const res = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode; const t = n.nodeValue.trim(); if (t && CJK.test(t) && !n.parentElement.closest('script,style')) res.push(t); }
      for (const el of document.querySelectorAll('[placeholder],[title],[aria-label]')) for (const a of ['placeholder', 'title', 'aria-label']) { const v = el.getAttribute(a); if (v && CJK.test(v)) res.push('@' + a + ':' + v); }
      if (CJK.test(document.title)) res.push('@title:' + document.title);
      return res;
    });
    for (const t of found) if (![...data].some((d) => t.includes(d)) && !ALLOWED.some((r) => r.test(t)) && !left.has(t)) left.set(t, tag);
  };
  await p.goto(base + 'login.html'); await scan('login');
  await p.fill('#u', user); await p.fill('#p', pass); await p.click('button[type=submit]'); await p.waitForSelector('#who:not(:empty)');
  const names = await p.evaluate(async () => {
    const j = async (u) => (await fetch(u)).json();
    const [m, f, e] = await Promise.all([j('api/materials'), j('api/frames'), j('api/event-list?limit=1000')]);
    return [...m.map((x) => x.target_name), ...f.map((x) => x.frame), ...e.rows.map((x) => x.target_name)].filter(Boolean);
  });
  names.forEach((n) => data.add(n));
  for (const h of ['overview', 'students', 'materials', 'clicks', 'events', 'analysis', 'system', 'admin']) {
    await p.goto(base + '#' + h); await p.waitForTimeout(1300); await scan(h);
    if (h === 'students' && await p.$('#view tbody tr')) { await p.click('#view tbody tr'); await p.waitForTimeout(1200); await scan('drawer'); await p.keyboard.press('Escape'); }
  }
  await b.close();
  for (const [t, tag] of left) console.log(tag.padEnd(9), '|', t.slice(0, 140));
  console.log(`\n未翻譯：${left.size}；頁面錯誤：${errs.length}`);
  process.exit(left.size || errs.length ? 1 : 0);
})();
