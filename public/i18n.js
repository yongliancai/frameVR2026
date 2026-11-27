/* 介面雙語（繁體中文 / English）
 * 做法：畫面先以中文產生，切到英文時把「整段完全符合」的介面文字換成英文；
 * 資料（教材名稱、email、Frame 名稱）不會被換掉，因為它們不會剛好等於字典裡的整段文字。
 * 動態組合的文字（數字＋單位、圖表）在 app.js 用 I18N.L(中文, English) 直接寫兩種版本。
 */
(function () {
  'use strict';
  const KEY = 'fvr_lang';
  let lang = 'zh';
  try { const v = localStorage.getItem(KEY); if (v === 'en' || v === 'zh') lang = v; } catch (e) { /* 無痕模式等 */ }

  const EN = {
    // ---------- 共用／導覽 ----------
    'FrameVR 學習行為後台': 'FrameVR Learning Analytics', '登入｜FrameVR 學習行為後台': 'Sign in | FrameVR Learning Analytics',
    '總覽': 'Overview', '學生': 'Students', '教材': 'Materials', '點擊': 'Clicks', '事件紀錄': 'Event log',
    '研究分析': 'Analysis', 'FrameVR 設定': 'Settings', '帳號與學生': 'Accounts',
    '登出': 'Log out', '分頁': 'Tabs', '篩選': 'Filters', '關閉': 'Close',
    '今天': 'Today', '近 7 天': 'Last 7 days', '近 30 天': 'Last 30 days', '全部': 'All',
    '從': 'From', '到': 'To', '空間': 'Space', '全部 Frame': 'All Frames', '每 30 秒自動更新': 'Auto-refresh every 30 s',
    '下載 Excel（研究用）': 'Download Excel', '載入中…': 'Loading…',
    '無法載入圖表程式庫（Chart.js）': 'Could not load the chart library (Chart.js)',
    '此範圍沒有資料': 'No data in this range', '尚無資料': 'No data yet', '沒有資料': 'No data',
    '人': 'students', '次': 'times', '分鐘': 'min', '份': 'items', '筆': 'records',
    // ---------- 登入 ----------
    '請用管理者給你的帳號登入': 'Sign in with the account your administrator gave you',
    '帳號': 'Username', '密碼': 'Password', '登入': 'Sign in', '登入失敗': 'Sign-in failed',
    '帳號或密碼錯誤': 'Incorrect username or password',
    '登入失敗太多次，請 15 分鐘後再試': 'Too many failed attempts. Please try again in 15 minutes.',
    // ---------- 總覽 ----------
    '近 5 分鐘有動作': 'Active in the last 5 min', '學生數': 'Students', '使用次數': 'Sessions',
    '累積使用時長': 'Total time', '平均每次使用': 'Avg. per session', '物件點擊': 'Object clicks', '教材開啟': 'Material opens',
    '喜歡（扣除取消）': 'Likes (net)', '收藏（扣除取消）': 'Favorites (net)',
    '每日使用人數': 'Daily active students', '當天至少進入一次的學生數': 'Students who entered at least once that day',
    '每日累積使用時長': 'Daily total time',
    '分鐘；FrameVR 沒有離開訊號，閒置超過設定時間即以最後一次動作當作離開': 'Minutes. FrameVR sends no leave signal, so after the idle limit the last action is treated as leaving.',
    '互動熱度': 'Activity heatmap', '星期 × 時段的事件數（台灣時間）': 'Events by weekday × hour (Taiwan time)',
    '星期與時段的互動熱度': 'Activity by weekday and hour', '少': 'Fewer', '多': 'More',
    '事件類型': 'Event types', '篩選範圍內的事件數': 'Events in the selected range',
    // ---------- 學生 ----------
    '學生使用紀錄': 'Student activity', '匯出工作階段 CSV': 'Export sessions CSV', '學生識別碼': 'Student',
    '平均每次': 'Avg. per session', '開啟教材': 'Material opens', '看過教材數': 'Materials viewed',
    '教材互動時間': 'Material time', '喜歡': 'Likes', '收藏': 'Favorites', '最後使用': 'Last active',
    '此範圍沒有學生資料': 'No students in this range',
    '喜歡的教材': 'Liked materials', '收藏的教材': 'Favorited materials', '目前的喜好': 'Current preferences',
    '以最後一次操作為準': 'Based on each student’s latest action',
    '每次使用時長': 'Session lengths', '最近 30 次；斜紋代表沒有點「離開」，時長以最後一次動作估算': 'Last 30 sessions. Striped bars: the student never triggered "leave", so length is estimated from the last action.',
    '操作歷程': 'Activity history', '每次工作階段內依先後順序（#）列出': 'Listed in order (#) within each session',
    '匯出此學生事件 CSV': 'Export this student’s events (CSV)', '沒有互動事件': 'No interaction events', '進行中': 'In progress',
    // ---------- 教材 ----------
    '教材開啟次數': 'Material opens', '前 15 名；顏色代表物件類型': 'Top 15; colour shows object type',
    '展板': 'Board', '3D 模型': '3D model', '影片': 'Video', '互動按鈕': 'Button', '其他': 'Other',
    '平均互動時間': 'Avg. interaction time', '每次開啟到關閉（或切換到下一份）的平均時間，秒': 'Average seconds from opening to closing (or switching to the next material)',
    '教材互動明細': 'Material interaction details', '喜歡／收藏「目前」為每位學生最後一次操作後的人數': '"Current" likes/favorites count each student’s latest state',
    '類型': 'Type', '開啟次數': 'Opens', '開啟人數': 'Students', '累積互動': 'Total time', '平均互動': 'Avg. time',
    '喜歡（目前）': 'Likes (current)', '取消喜歡次數': 'Unlikes', '收藏（目前）': 'Favorites (current)', '取消收藏次數': 'Unfavorites',
    '最常見的瀏覽順序': 'Most common viewing sequences', '同一次使用中，從 A 教材接著開啟 B 教材的次數': 'Times material B was opened right after material A in the same session',
    '先開啟': 'From', '接著開啟': 'Then', '次數': 'Count', '第一個開啟的教材': 'First material opened',
    '每次使用時最先開啟的教材，次數': 'Material opened first in each session (count)', '此範圍沒有教材互動': 'No material interactions in this range',
    // ---------- 點擊 ----------
    '點擊最多的物件': 'Most-clicked objects', '前 15 名': 'Top 15', '依物件類型': 'By object type',
    '點擊次數': 'Clicks', '人數': 'Students', '物件點擊明細': 'Object click details',
    '類型依 Action Editor Body 的 category 或物件名稱判斷；「其他」代表兩者都無法判斷': 'Type comes from the Action Editor body’s category or the object name; "Other" means neither identifies it.',
    '物件': 'Object', '識別碼': 'ID', '尚無點擊': 'No clicks yet',
    // ---------- 事件紀錄 ----------
    '全部事件': 'All events', '進入（session_start）': 'Enter (session_start)', '心跳（heartbeat）': 'Heartbeat (heartbeat)',
    '離開（session_end）': 'Leave (session_end)', '點擊（click）': 'Click (click)', '開啟教材（material_open）': 'Open material (material_open)',
    '關閉教材（material_close）': 'Close material (material_close)', '喜歡（like）': 'Like (like)', '取消喜歡（unlike）': 'Unlike (unlike)',
    '收藏（favorite）': 'Favorite (favorite)', '取消收藏（unfavorite）': 'Unfavorite (unfavorite)',
    '匯出事件 CSV': 'Export events CSV', '時間': 'Time', '事件': 'Event', '時長': 'Duration', '順序': 'Seq.', '工作階段': 'Session',
    '進入': 'Enter', '離開': 'Leave', '心跳': 'Heartbeat', '關閉教材': 'Close material', '取消喜歡': 'Unlike', '取消收藏': 'Unfavorite',
    '上一頁': 'Previous', '下一頁': 'Next', '學生代號，例如 S001': 'Student code, e.g. S001', '沒有符合的事件': 'No matching events',
    // ---------- 研究分析 ----------
    '自動觀察': 'Automatic observations',
    '依目前篩選範圍的資料自動產生（描述性，不代表因果）。研究用的完整數據請按右上「下載 Excel（研究用）」。': 'Generated from the data in the selected range (descriptive, not causal). For the full research dataset, use "Download Excel" at the top.',
    '被開啟過的教材': 'Materials opened', '使用時長中位數': 'Median total time', '%DV（看過一半以上教材）': '%DV (viewed over half the materials)',
    '行為轉移數（LSA）': 'Behaviour transitions (LSA)', '研究問題：': 'Research question: ', '建議分析方法與指標': 'Suggested methods and indicators',
    '活躍天數': 'Active days', '總時長(分)': 'Total (min)', '看過教材': 'Viewed', '廣度': 'Breadth', '深度(秒)': 'Depth (s)',
    '回訪': 'Revisits', '瞥過比例': 'Glance rate', '未分型': 'Not classified',
    '橫軸：吸引力（開啟過的學生 %）；縱軸：平均停留秒數。右上 = 吸引人也留得住；右下 = 很多人開但很快離開。': 'X: attracting power (% of students who opened it). Y: average seconds per view. Top right = attracts and holds; bottom right = many open it but leave quickly.',
    'B. 教材效能明細': 'B. Material effectiveness details', '教材效能明細': 'Material effectiveness details',
    '吸引力': 'Attraction', '平均停留(秒)': 'Mean view (s)', '中位停留(秒)': 'Median view (s)', '瞥過率': 'Glance rate',
    '回訪率': 'Revisit rate', '首選次數': 'First picks', '喜歡率': 'Like rate', '收藏率': 'Favorite rate',
    '顯著的行為轉移': 'Significant transitions', '前一個行為': 'Antecedent', '後一個行為': 'Consequent',
    '調整後殘差 Z 矩陣': 'Adjusted residual (Z) matrix', '（列 = 前一個行為，欄 = 後一個行為；藍色越深越顯著）': '(rows = antecedent, columns = consequent; darker blue = more significant)',
    '目前沒有顯著的轉移': 'No significant transitions yet', '此範圍還沒有行為轉移': 'No behaviour transitions in this range',
    '每次使用的時長分組（次數）': 'Sessions by length (count)', 'E. 首選教材': 'E. First picks', '每次使用時第一個開啟的教材': 'First material opened in each session',
    '參考文獻': 'References', '尚無教材停留資料': 'No view-time data yet',
    // ---------- FrameVR 設定 ----------
    'FrameVR Action Editor 設定': 'FrameVR Action Editor setup',
    '右側選單 → FRAME SETTINGS → ACTION EDITOR → 選物件 → Add Trigger → Add Action →': 'Right-hand menu → FRAME SETTINGS → ACTION EDITOR → choose object → Add Trigger → Add Action →',
    '，填入下面的值': ', then fill in these values', '複製': 'Copy', '複製 Body': 'Copy body', '已複製': 'Copied', '請手動選取': 'Please select and copy manually',
    '選你在 FrameVR「PROFILE → API Keys for Interactivity」新增的金鑰（值＝伺服器 .env 的 INGEST_KEY）': 'Choose the key you added under FrameVR "PROFILE → API Keys for Interactivity" (its value = INGEST_KEY in the server .env)',
    '依物件用途，複製下方對應的內容': 'Copy the matching body below for each object’s purpose',
    '通用設定（建議：所有物件都用這一段）': 'General setup (recommended for every object)',
    '進階：個別範本': 'Advanced: individual templates', '（不想用名稱判斷時才需要）': '(only if you don’t want name-based detection)',
    '進入（出生點的靠近觸發）': 'Enter (proximity trigger at the spawn point)', '開啟教材（展板／影片）': 'Open material (board / video)',
    '只記點擊（3D 模型、互動按鈕）': 'Click only (3D models, buttons)', '喜歡按鈕': 'Like button', '收藏按鈕': 'Favorite button', '離開（選用）': 'Leave (optional)',
    'Frame API 測試（唯讀）': 'Frame API test (read-only)', '⚠ 目前尚未設定': '⚠ not set yet',
    '。物件 ID 在 FrameVR 右側選單 →「ASSETS IN THIS FRAME」。': '. Object IDs are in the FrameVR right-hand menu → "ASSETS IN THIS FRAME".',
    '讀取 Frame 資料': 'Read Frame data', '物件 ID': 'Object ID', '讀取物件': 'Read object', '尚未查詢': 'Not queried yet',
    '查詢中…': 'Querying…', '請輸入物件 ID': 'Please enter an object ID', '★ 找到觸發設定': '★ Trigger settings found',
    '⚠ 伺服器尚未設定 INGEST_KEY': '⚠ INGEST_KEY is not set on the server', '例如 AbC123xyz': 'e.g. AbC123xyz',
    '收到的請求': 'Received requests', '匯出原始請求 CSV': 'Export raw requests CSV', '今天收到': 'Received today',
    '今天被拒絕': 'Rejected today', '最後一筆': 'Latest', '結果': 'Result', '拒絕': 'Rejected', '接受': 'Accepted',
    '帶到帳號': 'Account sent', '帶到 email': 'Email sent',
    '還沒有收到任何請求。設定好後，在 Action Editor 按 Test，或進入 Frame 點一下物件。': 'No requests yet. After setup, press Test in the Action Editor or click an object in the Frame.',
    // ---------- 帳號與學生 ----------
    '後台帳號': 'Dashboard accounts',
    '研究者只能看統計，學生顯示為代號；管理者另可看 FrameVR 設定、原始請求與 email。': 'Researchers see statistics only, with students shown as codes. Admins can also see FrameVR settings, raw requests and emails.',
    '密碼（至少 10 字元）': 'Password (at least 10 characters)', '角色': 'Role', '研究者': 'Researcher', '管理者': 'Admin',
    '新增帳號': 'Add account', '狀態': 'Status', '建立時間': 'Created', '你': 'you', '可使用': 'Active', '已停用': 'Disabled',
    '重設密碼': 'Reset password', '停用': 'Disable', '啟用': 'Enable', '已更新': 'Updated',
    '學生身分': 'Student identities',
    '代號依第一次出現的順序自動編號，研究者只看得到代號。勾選「測試帳號」的資料不會出現在統計與匯出中（資料仍保留，可隨時取消）。': 'Codes are assigned in order of first appearance; researchers only see codes. Students ticked as "Test account" are left out of statistics and exports (data is kept and can be restored any time).',
    '代號': 'Code', 'FrameVR 帳號 ID': 'FrameVR account ID', '事件數': 'Events', '最後出現': 'Last seen',
    '測試帳號': 'Test account', '備註': 'Note', '例如：管理者測試': 'e.g. admin testing', '還沒有學生資料': 'No students yet',
    // ---------- 伺服器錯誤訊息 ----------
    '帳號已存在': 'That username already exists', '密碼至少 10 個字元': 'Password must be at least 10 characters',
    '帳號需為 3–64 個英數字或 . _ @ -': 'Username must be 3–64 letters, digits or . _ @ -',
    '角色只能是 admin 或 researcher': 'Role must be admin or researcher', '找不到帳號': 'Account not found',
    '至少要保留一個可用的管理者帳號': 'At least one active admin account is required', '不能停用自己的帳號': 'You cannot disable your own account',
    '只有管理者可以使用': 'Admins only', '請重新登入': 'Please sign in again',
  };

  // 結尾帶排序箭頭的表頭，例如「累積使用時長 ↓」
  const PATTERNS = [
    [/^(.+?) ([↑↓])$/, (m) => (EN[m[1]] ? EN[m[1]] + ' ' + m[2] : null)],
  ];

  function translateText(s) {
    if (lang !== 'en' || !s) return s;
    const t = s.trim();
    if (!t) return s;
    let out = EN[t];
    if (out === undefined) for (const [re, fn] of PATTERNS) { const m = re.exec(t); if (m) { out = fn(m); if (out != null) break; } }
    if (out == null) return s;
    return s.replace(t, out);
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function translateDom(root) {
    if (lang !== 'en' || !root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) {
      const p = n.parentElement;
      if (!p || p.closest('script,style,pre,code,[data-raw]')) continue;
      const v = translateText(n.nodeValue);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
    const els = root.querySelectorAll ? root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(',')) : [];
    for (const el of els) for (const a of ATTRS) if (el.hasAttribute(a)) el.setAttribute(a, translateText(el.getAttribute(a)));
  }

  function setLang(l) {
    try { localStorage.setItem(KEY, l); } catch (e) { /* 不能存就只套用本頁 */ }
    location.reload();
  }

  function apply() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
    document.title = translateText(document.title);
    translateDom(document.body);
    const btn = document.getElementById('lang');
    if (btn) {
      btn.textContent = lang === 'en' ? '中文' : 'English';
      btn.setAttribute('aria-label', lang === 'en' ? '切換成中文' : 'Switch to English');
      btn.addEventListener('click', () => setLang(lang === 'en' ? 'zh' : 'en'));
    }
  }

  window.I18N = {
    get lang() { return lang; },
    L: (zh, en) => (lang === 'en' ? en : zh),
    t: translateText,
    translateDom, apply, setLang, EN,
  };
})();
