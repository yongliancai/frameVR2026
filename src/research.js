// 研究用 Excel：把行為紀錄整理成可以直接做統計的表格（寬格式＋長格式＋Codebook）
// lang = 'zh'（預設）或 'en'：只翻譯標題、說明與標籤；資料本身（教材名稱等）維持原樣
const stats = require('./stats');
const studentIds = require('./students');
const xlsx = require('./xlsx');
const analysis = require('./analysis');

const TYPE = {
  zh: { board: '展板', model: '3D 模型', video: '影片', button: '互動按鈕', material: '教材', other: '其他' },
  en: { board: 'Board', model: '3D model', video: 'Video', button: 'Button', material: 'Material', other: 'Other' },
};
const EVENT = {
  zh: { session_start: '進入', session_end: '離開', click: '點擊', material_open: '開啟教材', material_close: '關閉教材', like: '喜歡', unlike: '取消喜歡', favorite: '收藏', unfavorite: '取消收藏', heartbeat: '心跳' },
  en: { session_start: 'Enter', session_end: 'Leave', click: 'Click', material_open: 'Open material', material_close: 'Close material', like: 'Like', unlike: 'Unlike', favorite: 'Favorite', unfavorite: 'Unfavorite', heartbeat: 'Heartbeat' },
};
const END = {
  zh: { timeout: '閒置逾時', leave_trigger: '離開觸發', leave: '離開觸發' },
  en: { timeout: 'Idle timeout', leave_trigger: 'Leave trigger', leave: 'Leave trigger' },
};
const sec = (ms) => (ms == null ? null : Math.round(ms / 1000));
const min = (ms) => (ms == null ? null : Math.round(ms / 600) / 100);
const t = (ms) => (ms ? stats.iso(ms) : null);

// 工作表名稱（Excel 上限 31 字元）
const SHEET = {
  zh: { readme: '說明', obs: '研究觀察', eng: 'A參與度與C類型', eff: 'B教材效能', lsaF: 'D-LSA轉移次數', lsaZ: 'D-LSA調整後殘差Z', lsaL: 'D-LSA轉移清單',
    sum: '學生摘要', mat: '學生×教材', ses: '工作階段', msum: '教材摘要', seq: '瀏覽順序', ev: '事件明細', map: '代號對照' },
  en: { readme: 'README', obs: 'Observations', eng: 'A Engagement & C Types', eff: 'B Material effectiveness', lsaF: 'D-LSA frequencies', lsaZ: 'D-LSA adjusted residuals', lsaL: 'D-LSA transitions',
    sum: 'Student summary', mat: 'Student x Material', ses: 'Sessions', msum: 'Material summary', seq: 'Viewing sequences', ev: 'Event log', map: 'Code map' },
};

function codebook(q, role, cfg, lang) {
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const S = SHEET[lang];
  const any = L('（不限）', '(any)');
  const range = `${q.from || any}${L(' ～ ', ' to ')}${q.to || any}`;
  const cats = lang === 'en' ? analysis.CATEGORIES_EN : analysis.CATEGORIES;
  const codes = lang === 'en' ? analysis.CODES_EN : analysis.CODES;
  const C = { file: L('檔案資訊', 'File'), sheet: L('工作表', 'Sheet'), col: L('欄位', 'Field'), lim: L('資料限制', 'Limitation'),
    cat: L('分析分類', 'Analysis category'), def: L('指標定義', 'Indicator'), code: L('LSA 行為編碼', 'LSA code'), ref: L('參考文獻', 'Reference'), adv: L('分析建議', 'Suggestion') };
  const rows = [
    [C.file, L('匯出時間', 'Exported at'), stats.iso(Date.now()) + L('（台灣時間）', ' (Taiwan time, UTC+8)')],
    [C.file, L('資料範圍', 'Data range'), range + (q.frame ? L(`；Frame：${q.frame}`, `; Frame: ${q.frame}`) : L('；全部 Frame', '; all Frames'))],
    [C.file, L('匯出角色', 'Exported by'), role === 'admin' ? L('管理者（含代號對照表）', 'Admin (includes the code map)') : L('研究者（學生只以代號呈現）', 'Researcher (students shown as codes only)')],
    [C.file, L('已排除', 'Excluded'), L('管理者標記為「測試帳號」的學生不在本檔案中', 'Students marked as test accounts by an admin are not included')],

    [C.sheet, S.sum, L('一列＝一位學生。描述統計、相關分析、與前後測／問卷合併（以「學生代號」對應）', 'One row per student. Descriptive statistics, correlations, merging with pre/post-tests or questionnaires (by student code)')],
    [C.sheet, S.mat, L('一列＝一位學生；每份教材兩欄（開啟次數、互動秒數）。集群分析、學習型態分群、熱點分析', 'One row per student; two columns per material (opens, seconds). Clustering, learner-pattern grouping, hotspot analysis')],
    [C.sheet, S.ses, L('一列＝一次使用。使用頻率、每次時長、使用時段分析', 'One row per session. Frequency, session length, time-of-day analysis')],
    [C.sheet, S.msum, L('一列＝一份教材。比較教材吸引力（開啟人數）、停留時間、喜好', 'One row per material. Compare attraction (students who opened), view time, preferences')],
    [C.sheet, S.seq, L('一列＝「A 接著開啟 B」的轉移。序列分析、滯後序列分析（LSA）、繪製轉移圖', 'One row per "A then B" transition. Sequence analysis, lag sequential analysis (LSA), transition diagrams')],
    [C.sheet, S.ev, L('一列＝一個事件（長格式、依時間排序）。歷程探勘（process mining）、自訂分析', 'One row per event (long format, time-ordered). Process mining, custom analyses')],
    ...(role === 'admin' ? [[C.sheet, S.map, L('僅管理者版本：代號 ↔ email ↔ FrameVR 帳號 ID。請勿提供給研究者', 'Admin version only: code ↔ email ↔ FrameVR account ID. Do not share with researchers')]] : []),

    [C.col, L('學生代號', 'Student code'), L('S001 起依學生第一次出現的順序編號，固定不變', 'Assigned from S001 in order of first appearance; never changes')],
    [C.col, L('使用次數', 'Sessions'), L(`工作階段數。同一位學生超過 ${cfg.gap} 分鐘沒有動作，下一個動作算新的一次`, `Number of sessions. After ${cfg.gap} min without activity, the student’s next action starts a new session`)],
    [C.col, L('總使用時長(分)', 'Total time (min)'), L('各次使用「第一個動作 → 最後一個動作（或離開觸發）」的加總', 'Sum over sessions of "first action → last action (or leave trigger)"')],
    [C.col, L('教材互動秒數', 'Material seconds'), L(`開啟一份教材到「開啟下一份／離開／逾時」為止；單次上限 ${cfg.maxMat} 分鐘`, `From opening a material until the next material, leaving, or timeout; capped at ${cfg.maxMat} min per view`)],
    [C.col, L('點擊次數', 'Clicks'), L(`所有物件的點擊；同一人 ${cfg.dedupe} 秒內重複點同一物件只算一次`, `Clicks on all objects; repeated clicks on the same object within ${cfg.dedupe} s count once`)],
    [C.col, L('喜歡／收藏(目前)', 'Like / Favorite (current)'), L('以每位學生最後一次操作為準（喜歡後又取消＝0）', 'Each student’s latest state (liked then unliked = 0)')],
    [C.col, L('結束方式', 'End type'), L('離開觸發＝學生碰到離開物件；閒置逾時＝FrameVR 沒有離開訊號，以最後一次動作當作離開', 'Leave trigger = the student touched a leave object; Idle timeout = FrameVR sends no leave signal, so the last action is treated as leaving')],

    [C.lim, L('時長為推估值', 'Durations are estimates'), L('FrameVR 無法得知學生何時關閉視窗；最後一個動作之後停留的時間不會被計入，時長偏向低估', 'FrameVR cannot tell when a student closes the window; time after the last action is not counted, so durations tend to be underestimated')],
    [C.lim, L('教材時間的定義', 'Meaning of material time'), L('是「注意力停留在該教材的可能時間」，學生可能同時在做別的事；建議搭配開啟次數一起解讀', 'It is the time attention may have stayed on the material; students may be doing other things. Interpret together with open counts')],
    [C.lim, L('只有點擊才會被記錄', 'Only clicks are recorded'), L('學生走近、觀看但沒有點擊的教材不會被記錄', 'Materials a student approaches or looks at without clicking are not recorded')],
    [C.lim, L('進入時間', 'Entry time'), L('若出生點沒有設定靠近觸發，進入時間＝第一次點擊時間', 'Without a proximity trigger at the spawn point, entry time = time of the first click')],

    ...cats.map((c) => [C.cat, c.title, L(`研究問題：${c.question}\n建議方法：${c.methods}\n指標：${c.indicators}`, `Research question: ${c.question}\nSuggested methods: ${c.methods}\nIndicators: ${c.indicators}`)]),
    [C.def, L('教材廣度 %', 'Breadth %'), L('看過的不同教材數 ÷ 範圍內被開啟過的教材總數', 'Distinct materials viewed ÷ all materials opened by anyone in the range')],
    [C.def, L('教材深度（秒）', 'Depth (s)'), L('每次開啟教材的平均停留秒數', 'Mean seconds per material view')],
    [C.def, L('回訪次數', 'Revisits'), L('開啟次數 − 看過的不同教材數（同一份教材再回去看）', 'Opens − distinct materials viewed (going back to the same material)')],
    [C.def, L('瞥過比例 %', 'Glance rate %'), L(`停留少於 ${analysis.CONFIG.glanceSec} 秒的開啟所佔比例`, `Share of views shorter than ${analysis.CONFIG.glanceSec} s`)],
    [C.def, L('吸引力 %', 'Attraction %'), L('開啟過該教材的學生 ÷ 範圍內所有學生（attracting power）', 'Students who opened the material ÷ all students in the range (attracting power)')],
    [C.def, L('停留力', 'Holding'), L('該教材每次開啟的平均／中位停留秒數（holding power）', 'Mean / median seconds per view of the material (holding power)')],
    [C.def, '%DV', L('看過超過一半教材的學生比例（percentage of diligent visitors；Serrell 1998）', 'Share of students who viewed more than half of the materials (percentage of diligent visitors; Serrell 1998)')],
    [C.def, L('學習者類型', 'Learner type'), L(`開過教材的學生達 ${analysis.CONFIG.minProfileN} 人以上時，以「廣度 %」與「深度」的中位數切成四型；剛好等於中位數歸為「高」`, `When at least ${analysis.CONFIG.minProfileN} students opened materials, students are split into four types at the medians of breadth % and depth; values equal to the median count as "high"`)],
    [C.def, L('LSA 調整後殘差 Z', 'LSA adjusted residual Z'), L('Z = (實際次數 − 期望次數) ÷ √(期望次數 × (1 − 列總和/N) × (1 − 欄總和/N))；期望次數 = 列總和 × 欄總和 ÷ N；Z > 1.96 表示該轉移顯著多於隨機（p < .05）',
      'Z = (observed − expected) ÷ √(expected × (1 − row total/N) × (1 − column total/N)); expected = row total × column total ÷ N; Z > 1.96 means the transition occurs significantly more than chance (p < .05)')],
    ...Object.entries(codes).map(([k, v]) => [C.code, k, v + (k === 'OM' ? L('（展板／圖片教材）', ' (board / image material)') : '')]),
    [C.code, L('不編碼', 'Not coded'), L('「關閉教材」是系統推算的事件；點展板／影片與「開啟教材」重複，因此都不編碼', '"Close material" is inferred by the system, and clicks on boards/videos duplicate "open material", so neither is coded')],
    ...analysis.REFERENCES.map((r) => [C.ref, '', r]),
    [C.adv, L('描述統計', 'Descriptive statistics'), L('學生摘要：使用次數、總時長、看過教材數的平均數、標準差、分布（時長通常右偏，可取對數或用中位數）', 'Student summary: mean, SD and distribution of sessions, total time and materials viewed (time is usually right-skewed; log-transform or use medians)')],
    [C.adv, L('教材比較', 'Comparing materials'), L('教材摘要：開啟人數比例（觸及率）×平均互動秒數，找出「很多人開但很快離開」的教材', 'Material summary: reach (share who opened) × mean seconds, to find materials many open but leave quickly')],
    [C.adv, L('學習型態分群', 'Learner clustering'), L('學生×教材：以互動秒數做 K-means 或階層式集群（先標準化），比較各群的學習成效', 'Student x Material: K-means or hierarchical clustering on seconds (standardise first), then compare outcomes between clusters')],
    [C.adv, L('瀏覽序列', 'Viewing sequences'), L('瀏覽順序：計算轉移機率、滯後序列分析（Z 分數 > 1.96 的顯著轉移），或用事件明細做 process mining', 'Viewing sequences: transition probabilities, lag sequential analysis (significant transitions with Z > 1.96), or process mining on the event log')],
    [C.adv, L('與學習成效連結', 'Linking to outcomes'), L('把前後測／問卷以學生代號合併到學生摘要，做相關或迴歸（例：教材互動時間 → 後測分數，控制前測）', 'Merge pre/post-tests or questionnaires into the student summary by code, then run correlation or regression (e.g., material time → post-test, controlling for pre-test)')],
    [C.adv, L('樣本與排除', 'Sample and exclusions'), L('建議事先訂出排除標準（例如總時長 < 1 分鐘、只點 1 次），並在論文中報告排除人數', 'Set exclusion rules in advance (e.g., total time < 1 min, a single click) and report how many students were excluded')],
  ];
  return { name: S.readme, columns: [{ header: L('類別', 'Category'), width: 16 }, { header: L('項目', 'Item'), width: 26 }, { header: L('說明', 'Description'), width: 95, wrap: true }], rows };
}

function buildWorkbook(q, role, cfg, lang = 'zh') {
  if (lang !== 'en') lang = 'zh';
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const S = SHEET[lang];
  const TY = TYPE[lang]; const EV = EVENT[lang]; const EN_ = END[lang];
  const dir = studentIds.directory();
  const label = (id) => { const s = dir.get(id); return s ? s.code : L('未編號', 'unassigned'); };
  const sorter = (a, b) => String(a[0]).localeCompare(String(b[0]));
  const H = (list, width = 13, wide = {}) => list.map((h, i) => ({ header: h, width: wide[i] || width }));

  // 學生摘要
  const clicks = new Map();
  for (const r of stats.clicksByStudent(q)) {
    if (!clicks.has(r.student_id)) clicks.set(r.student_id, {});
    clicks.get(r.student_id)[r.target_type] = r.n;
  }
  const prefs = new Map();
  for (const p of stats.currentPrefs(q)) {
    const x = prefs.get(p.student_id) || { liked: 0, faved: 0 };
    x.liked += p.liked; x.faved += p.favorited;
    prefs.set(p.student_id, x);
  }
  const studentRows = stats.students(q).map((r) => {
    const c = clicks.get(r.student_id) || {};
    const p = prefs.get(r.student_id) || { liked: 0, faved: 0 };
    return [label(r.student_id), r.sessions, min(r.total_ms), min(r.avg_session_ms), t(r.first_seen), t(r.last_seen),
      r.clicks || 0, c.board || 0, c.model || 0, c.video || 0, c.button || 0,
      r.opens || 0, r.materials || 0, sec(r.material_ms || 0), p.liked, p.faved];
  }).sort(sorter);

  // 學生 × 教材（寬格式）
  const matrix = stats.studentMaterialMatrix(q);
  const mats = [...new Map(matrix.map((m) => [m.target_id, m.target_name || m.target_id])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const byStudent = new Map();
  for (const m of matrix) {
    if (!byStudent.has(m.student_id)) byStudent.set(m.student_id, new Map());
    byStudent.get(m.student_id).set(m.target_id, m);
  }
  const matrixRows = [...byStudent.entries()].map(([sid, m]) => [label(sid), ...mats.flatMap(([id]) => {
    const x = m.get(id);
    return [x ? x.opens : 0, x ? sec(x.ms) : 0];
  })]).sort(sorter);

  const sessions = stats.sessionList(q).map((s) => [label(s.student_id), s.session_id, s.frame, t(s.start_ts), t(s.end_ts || s.last_ts),
    min(s.duration_ms), s.end_ts ? (EN_[s.end_reason] || s.end_reason || EN_.leave) : L('進行中', 'In progress'), s.event_count]);

  const materials = stats.materials(q).map((r) => [r.target_name || r.target_id, TY[r.target_type] || r.target_type, r.opens, r.students,
    sec(r.total_ms), sec(r.avg_ms), r.clicks, r.liked_now, r.unlike_events, r.favorited_now, r.unfavorite_events]);

  const seq = stats.sequences(q);
  const outTotals = new Map();
  for (const x of seq.transitions) outTotals.set(x.from, (outTotals.get(x.from) || 0) + x.count);
  const transitions = seq.transitions.map((x) => [x.from_name, x.to_name, x.count, Math.round((x.count / outTotals.get(x.from)) * 1000) / 1000]);

  const events = stats.eventRows(q).map((e) => [t(e.ts), label(e.student_id), e.session_id, e.seq, EV[e.event_type] || e.event_type, e.event_type,
    e.target_name || e.target_id, TY[e.target_type] || e.target_type, sec(e.duration_ms), e.frame]);

  // 研究分析 A–E
  const A = analysis.analyze(q, lang);
  const cats = lang === 'en' ? analysis.CATEGORIES_EN : analysis.CATEGORIES;
  const codeNames = lang === 'en' ? analysis.CODES_EN : analysis.CODES;
  const engRows = A.engagement.map((r) => [label(r.student_id), r.sessions, r.active_days, r.total_min, r.opens, r.breadth_n, r.breadth_pct, r.depth_s, r.revisits, r.glance_pct,
    r.clicks_model, r.clicks_button, r.liked, r.favorited, r.profile || L('（樣本不足，未分型）', '(sample too small; not classified)')]).sort(sorter);
  const effRows = A.materials.map((m) => [m.name, TY[m.type] || m.type, m.students, m.opens, m.attraction_pct, m.holding_mean_s, m.holding_median_s, m.glance_pct, m.revisit_pct, m.first_picks, m.liked_pct, m.favorited_pct]);
  const codes = A.lsa.codes.map((c) => c.code);
  const cell = (a, b) => A.lsa.cells.find((c) => c.from === a && c.to === b);
  const cn = (c) => `${c} ${codeNames[c]}`;
  const lsaFreq = codes.map((a) => [cn(a), ...codes.map((b) => cell(a, b).freq)]);
  const lsaZ = codes.map((a) => [cn(a), ...codes.map((b) => { const c = cell(a, b); return c.z == null ? null : c.z; })]);
  const lsaSig = A.lsa.cells.filter((c) => c.freq > 0).sort((x, y) => (y.z ?? -99) - (x.z ?? -99))
    .map((c) => [cn(c.from), cn(c.to), c.freq, c.expected, c.z, c.significant ? L('顯著', 'significant') : '']);
  const codeCols = [{ header: L('前一個行為 ＼ 後一個行為', 'Antecedent \\ Consequent'), width: 26 }, ...codes.map((c) => ({ header: cn(c), width: 14 }))];

  const sheets = [
    codebook(q, role, cfg, lang),
    { name: S.obs, columns: [{ header: L('分類', 'Category'), width: 26 }, { header: L('觀察（自動產生，描述性）', 'Observation (automatic, descriptive)'), width: 110, wrap: true }],
      rows: A.observations.map((o) => [o.category ? cats.find((c) => c.key === o.category).title : (o.level === 'warn' ? L('樣本提醒', 'Sample note') : ''), o.text]) },
    { name: S.eng, columns: H(L(['學生代號', '使用次數', '活躍天數', '總使用時長(分)', '教材開啟次數', '看過教材數', '教材廣度%', '教材深度(秒)', '回訪次數', '瞥過比例%', '點擊-3D模型', '點擊-按鈕', '喜歡(目前)', '收藏(目前)', '學習者類型'],
      ['Student code', 'Sessions', 'Active days', 'Total time (min)', 'Material opens', 'Materials viewed', 'Breadth %', 'Depth (s)', 'Revisits', 'Glance rate %', 'Clicks - 3D model', 'Clicks - button', 'Likes (current)', 'Favorites (current)', 'Learner type']), 14, { 14: 22 }), rows: engRows },
    { name: S.eff, columns: H(L(['教材', '類型', '開啟人數', '開啟次數', '吸引力%', '平均停留(秒)', '中位停留(秒)', '瞥過率%', '回訪率%', '首選次數', '喜歡率%', '收藏率%'],
      ['Material', 'Type', 'Students', 'Opens', 'Attraction %', 'Mean view (s)', 'Median view (s)', 'Glance rate %', 'Revisit rate %', 'First picks', 'Like rate %', 'Favorite rate %']), 14, { 0: 30 }), rows: effRows },
    { name: S.lsaF, columns: codeCols, rows: lsaFreq },
    { name: S.lsaZ, columns: codeCols, rows: lsaZ },
    { name: S.lsaL, columns: H(L(['前一個行為', '後一個行為', '實際次數', '期望次數', 'Z 值', `Z > ${analysis.CONFIG.zCritical}`], ['Antecedent', 'Consequent', 'Observed', 'Expected', 'Z', `Z > ${analysis.CONFIG.zCritical}`]), 13, { 0: 22, 1: 22 }), rows: lsaSig },
    { name: S.sum, columns: H(L(['學生代號', '使用次數', '總使用時長(分)', '平均每次(分)', '第一次使用', '最後使用', '點擊次數', '點擊-展板', '點擊-3D模型', '點擊-影片', '點擊-按鈕', '教材開啟次數', '看過教材數', '教材互動秒數', '喜歡(目前)', '收藏(目前)'],
      ['Student code', 'Sessions', 'Total time (min)', 'Avg. per session (min)', 'First active', 'Last active', 'Clicks', 'Clicks - board', 'Clicks - 3D model', 'Clicks - video', 'Clicks - button', 'Material opens', 'Materials viewed', 'Material seconds', 'Likes (current)', 'Favorites (current)']), 14, { 4: 20, 5: 20 }), rows: studentRows },
    { name: S.mat, columns: [{ header: L('學生代號', 'Student code') }, ...mats.flatMap(([, n]) => [{ header: n + L('｜開啟次數', ' | opens'), width: 18 }, { header: n + L('｜互動秒數', ' | seconds'), width: 18 }])], rows: matrixRows },
    { name: S.ses, columns: H(L(['學生代號', '工作階段 ID', 'Frame', '開始', '結束', '時長(分)', '結束方式', '事件數'], ['Student code', 'Session ID', 'Frame', 'Start', 'End', 'Length (min)', 'End type', 'Events']), 13, { 1: 38, 3: 20, 4: 20, 6: 16 }), rows: sessions },
    { name: S.msum, columns: H(L(['教材', '類型', '開啟次數', '開啟人數', '累積互動秒數', '平均互動秒數', '點擊次數', '喜歡(目前人數)', '取消喜歡次數', '收藏(目前人數)', '取消收藏次數'],
      ['Material', 'Type', 'Opens', 'Students', 'Total seconds', 'Mean seconds', 'Clicks', 'Likes (current students)', 'Unlikes', 'Favorites (current students)', 'Unfavorites']), 15, { 0: 30 }), rows: materials },
    { name: S.seq, columns: H(L(['先開啟', '接著開啟', '次數', '轉移機率'], ['From', 'Then', 'Count', 'Transition probability']), 14, { 0: 30, 1: 30 }), rows: transitions },
    { name: S.ev, columns: H(L(['時間', '學生代號', '工作階段 ID', '順序', '事件', '事件代碼', '物件', '類型', '時長(秒)', 'Frame'], ['Time', 'Student code', 'Session ID', 'Seq.', 'Event', 'Event code', 'Object', 'Type', 'Duration (s)', 'Frame']), 13, { 0: 20, 2: 38, 5: 16, 6: 30 }), rows: events },
  ];
  if (role === 'admin') {
    sheets.push({ name: S.map, columns: H(L(['學生代號', 'Email', 'FrameVR 帳號 ID', '測試帳號(已排除)', '備註'], ['Student code', 'Email', 'FrameVR account ID', 'Test account (excluded)', 'Note']), 14, { 1: 30, 2: 50, 3: 18, 4: 24 }),
      rows: studentIds.list().map((r) => [r.code, r.email, r.student_id, r.excluded ? L('是', 'yes') : '', r.note]) });
  }
  return xlsx.build(sheets);
}

module.exports = { buildWorkbook, SHEET };
