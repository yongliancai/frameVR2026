// 研究分析：把行為紀錄整理成五類常見的學習分析
//   A 參與度指標   — 每位學生的投入程度（次數、時長、廣度、深度、回訪、瞥過）
//   B 教材效能     — 每份教材的吸引力與停留力（博物館觀眾研究：attracting / holding power、%DV）
//   C 學習者類型   — 依「廣度 × 深度」中位數分成四型（可再用 Excel 原始指標做集群分析）
//   D 行為序列     — 滯後序列分析 LSA：行為編碼 → 轉移次數 → 調整後殘差 Z（Bakeman & Quera）
//   E 使用模式     — 使用時長分布、首先開啟的教材
// 所有門檻集中在 CONFIG，並寫進 Excel 的 Codebook。
const stats = require('./stats');

const CONFIG = {
  glanceSec: 10,        // 一次教材停留少於這個秒數 → 視為「瞥過」
  minProfileN: 4,       // 開過教材的學生少於這個人數 → 不分型
  minLsaN: 30,          // 轉移總數少於這個數 → LSA 標示「樣本太少」
  zCritical: 1.96,      // p < .05
};

// LSA 行為編碼（material_close 為推算事件、展板／影片的點擊與開啟重複 → 不編碼）
const CODES = {
  EN: '進入', OM: '開啟展板教材', OV: '開啟影片', CM: '點3D模型', CB: '點互動按鈕', CO: '點其他物件',
  LK: '喜歡', UL: '取消喜歡', FV: '收藏', UF: '取消收藏', EX: '離開',
};
const CODES_EN = {
  EN: 'Enter', OM: 'Open board', OV: 'Open video', CM: 'Click 3D model', CB: 'Click button', CO: 'Click other object',
  LK: 'Like', UL: 'Unlike', FV: 'Favorite', UF: 'Unfavorite', EX: 'Leave',
};
const PROFILE_EN = { 深度探索型: 'Deep explorer', 廣泛瀏覽型: 'Broad browser', 專注聚焦型: 'Focused viewer', 淺嘗即止型: 'Light sampler', 未開啟教材: 'No materials opened' };
const PROFILE_DESC_EN = {
  'Deep explorer': 'Views many materials and stays long on each (breadth and depth at or above the median)',
  'Broad browser': 'Views many materials but briefly',
  'Focused viewer': 'Views fewer materials but stays longer on each',
  'Light sampler': 'Views few materials, briefly',
  'No materials opened': 'Only clicked models or buttons; never opened a material',
};

function codeOf(e) {
  switch (e.event_type) {
    case 'session_start': return 'EN';
    case 'session_end': return 'EX';
    case 'material_open': return e.target_type === 'video' ? 'OV' : 'OM';
    case 'click':
      if (e.target_type === 'model') return 'CM';
      if (e.target_type === 'button') return 'CB';
      if (['board', 'video', 'material'].includes(e.target_type)) return null;
      return 'CO';
    case 'like': return 'LK';
    case 'unlike': return 'UL';
    case 'favorite': return 'FV';
    case 'unfavorite': return 'UF';
    default: return null;
  }
}

const median = (arr) => {
  const a = arr.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const pct = (a, b) => (b ? round((a / b) * 100, 1) : null);

// 滯後序列分析：sequences = [[code, code, ...], ...]（每個工作階段一條）
function lagSequential(sequences, zCrit = CONFIG.zCritical) {
  const freq = new Map();
  let N = 0;
  const used = new Set();
  for (const seq of sequences) {
    for (let i = 0; i + 1 < seq.length; i++) {
      const k = seq[i] + '>' + seq[i + 1];
      freq.set(k, (freq.get(k) || 0) + 1);
      used.add(seq[i]); used.add(seq[i + 1]);
      N++;
    }
  }
  const codes = Object.keys(CODES).filter((c) => used.has(c));
  const row = {}; const col = {};
  for (const c of codes) { row[c] = 0; col[c] = 0; }
  for (const [k, f] of freq) { const [a, b] = k.split('>'); row[a] += f; col[b] += f; }
  const cells = [];
  for (const a of codes) {
    for (const b of codes) {
      const f = freq.get(a + '>' + b) || 0;
      const e = N ? (row[a] * col[b]) / N : 0;
      const denom = Math.sqrt(e * (1 - row[a] / N) * (1 - col[b] / N));
      const z = denom > 0 ? (f - e) / denom : null;
      cells.push({ from: a, to: b, freq: f, expected: round(e, 2), z: round(z, 2), significant: z != null && z > zCrit && f > 0 });
    }
  }
  return {
    N, codes: codes.map((c) => ({ code: c, label: CODES[c], row: row[c], col: col[c] })), cells,
    significant: cells.filter((c) => c.significant).sort((x, y) => y.z - x.z),
    enough: N >= CONFIG.minLsaN,
  };
}

function classify(breadth, depth, medB, medD) {
  if (breadth == null || breadth === 0) return '未開啟教材';
  if (medB == null || medD == null) return null;
  const hiB = breadth >= medB; const hiD = (depth ?? 0) >= medD;
  if (hiB && hiD) return '深度探索型';
  if (hiB) return '廣泛瀏覽型';
  if (hiD) return '專注聚焦型';
  return '淺嘗即止型';
}
const PROFILE_DESC = {
  深度探索型: '看的教材多、每份也看得久（廣度、深度都在中位數以上）',
  廣泛瀏覽型: '看的教材多，但每份停留較短',
  專注聚焦型: '看的教材較少，但每份停留較久',
  淺嘗即止型: '看的教材少、停留也短',
  未開啟教材: '只點了模型或按鈕，沒有開啟任何教材',
};

function analyze(q, lang = 'zh') {
  const events = stats.eventRows(q);
  const sessions = stats.sessionList(q);
  const prefs = stats.currentPrefs(q);
  const dayOf = (ts) => stats.iso(ts).slice(0, 10);

  // ---------- 共同彙整 ----------
  const S = new Map(); // student → 指標
  const M = new Map(); // material → 指標
  const bySession = new Map();
  const get = (map, k, init) => { if (!map.has(k)) map.set(k, init()); return map.get(k); };
  const newStudent = () => ({ sessions: new Set(), days: new Set(), events: 0, opens: 0, mats: new Map(), views: [], clicksModel: 0, clicksButton: 0, total_ms: 0 });
  const newMat = () => ({ name: null, type: null, openers: new Map(), views: [], firstPicks: 0 });

  for (const e of events) {
    const s = get(S, e.student_id, newStudent);
    s.events++; s.sessions.add(e.session_id); s.days.add(dayOf(e.ts));
    if (e.event_type === 'material_open' && e.target_id) {
      s.opens++;
      s.mats.set(e.target_id, (s.mats.get(e.target_id) || 0) + 1);
      const m = get(M, e.target_id, newMat);
      m.name = e.target_name || e.target_id; m.type = e.target_type;
      m.openers.set(e.student_id, (m.openers.get(e.student_id) || 0) + 1);
    }
    if (e.event_type === 'material_close' && e.target_id && e.duration_ms != null) {
      s.views.push(e.duration_ms);
      get(M, e.target_id, newMat).views.push(e.duration_ms);
    }
    if (e.event_type === 'click' && e.target_type === 'model') s.clicksModel++;
    if (e.event_type === 'click' && e.target_type === 'button') s.clicksButton++;
    get(bySession, e.session_id, () => []).push(e);
  }
  for (const s of sessions) if (S.has(s.student_id)) S.get(s.student_id).total_ms += s.duration_ms || 0;

  const nMaterials = M.size;
  const glanceMs = CONFIG.glanceSec * 1000;

  // ---------- A 參與度 ----------
  const likeBy = new Map();
  for (const p of prefs) { const x = likeBy.get(p.student_id) || { liked: 0, faved: 0 }; x.liked += p.liked; x.faved += p.favorited; likeBy.set(p.student_id, x); }
  const engagement = [...S.entries()].map(([sid, s]) => {
    const breadthN = s.mats.size;
    const dwell = s.views.reduce((a, b) => a + b, 0);
    const lk = likeBy.get(sid) || { liked: 0, faved: 0 };
    return {
      student_id: sid,
      sessions: s.sessions.size,
      active_days: s.days.size,
      total_min: round(s.total_ms / 60000, 2),
      events: s.events,
      opens: s.opens,
      breadth_n: breadthN,
      breadth_pct: nMaterials ? pct(breadthN, nMaterials) : null,
      depth_s: s.views.length ? round(dwell / s.views.length / 1000, 1) : null,
      dwell_total_s: round(dwell / 1000, 0),
      revisits: s.opens - breadthN,
      glance_pct: s.views.length ? pct(s.views.filter((v) => v < glanceMs).length, s.views.length) : null,
      clicks_model: s.clicksModel,
      clicks_button: s.clicksButton,
      liked: lk.liked,
      favorited: lk.faved,
    };
  });

  // ---------- C 學習者類型 ----------
  const openers = engagement.filter((r) => r.breadth_n > 0);
  const canProfile = openers.length >= CONFIG.minProfileN;
  const medB = canProfile ? median(openers.map((r) => r.breadth_pct)) : null;
  const medD = canProfile ? median(openers.map((r) => r.depth_s ?? 0)) : null;
  for (const r of engagement) r.profile = canProfile || r.breadth_n === 0 ? classify(r.breadth_pct, r.depth_s, medB, medD) : null;
  const profileCounts = {};
  for (const k of Object.keys(PROFILE_DESC)) profileCounts[k] = engagement.filter((r) => r.profile === k).length;

  // ---------- E 使用模式（首選教材、時長分布） ----------
  for (const list of bySession.values()) {
    const first = list.find((e) => e.event_type === 'material_open' && e.target_id);
    if (first) M.get(first.target_id).firstPicks++;
  }
  const BINS = [[0, 1], [1, 3], [3, 5], [5, 10], [10, 20], [20, Infinity]];
  const lengthBins = BINS.map(([a, b]) => ({
    label: b === Infinity ? `${a} 分鐘以上` : `${a}–${b} 分鐘`,
    count: sessions.filter((s) => S.has(s.student_id) && (s.duration_ms || 0) >= a * 60000 && (s.duration_ms || 0) < b * 60000).length,
  }));

  // ---------- B 教材效能 ----------
  const nStudents = S.size;
  const likedNow = new Map(); const favNow = new Map();
  for (const p of prefs) {
    if (p.liked) likedNow.set(p.target_id, (likedNow.get(p.target_id) || 0) + 1);
    if (p.favorited) favNow.set(p.target_id, (favNow.get(p.target_id) || 0) + 1);
  }
  const materials = [...M.entries()].map(([id, m]) => {
    const nOpen = m.openers.size;
    const views = m.views;
    return {
      target_id: id, name: m.name, type: m.type,
      opens: [...m.openers.values()].reduce((a, b) => a + b, 0),
      students: nOpen,
      attraction_pct: pct(nOpen, nStudents),
      holding_mean_s: views.length ? round(mean(views) / 1000, 1) : null,
      holding_median_s: views.length ? round(median(views) / 1000, 1) : null,
      glance_pct: views.length ? pct(views.filter((v) => v < glanceMs).length, views.length) : null,
      revisit_pct: pct([...m.openers.values()].filter((n) => n >= 2).length, nOpen),
      first_picks: m.firstPicks,
      liked_pct: pct(likedNow.get(id) || 0, nOpen),
      favorited_pct: pct(favNow.get(id) || 0, nOpen),
    };
  }).sort((a, b) => (b.attraction_pct ?? 0) - (a.attraction_pct ?? 0) || (b.holding_mean_s ?? 0) - (a.holding_mean_s ?? 0));
  const diligent = engagement.filter((r) => nMaterials && r.breadth_n > nMaterials / 2).length;

  // ---------- D 行為序列 ----------
  const codeSeqs = [...bySession.values()].map((list) => list.map(codeOf).filter(Boolean)).filter((s) => s.length > 1);
  const lsa = lagSequential(codeSeqs);

  const summary = {
    students: nStudents,
    students_opened: openers.length,
    materials: nMaterials,
    sessions: sessions.filter((s) => S.has(s.student_id)).length,
    diligent_pct: pct(diligent, nStudents),
    median_total_min: round(median(engagement.map((r) => r.total_min)), 1),
    median_breadth_pct: medB,
    median_depth_s: medD,
  };

  const observations = observe({ summary, materials, profileCounts, canProfile, lsa, engagement }, lang);
  if (lang === 'en') return toEnglish({ summary, engagement, materials, canProfile, medB, medD, profileCounts, lsa, lengthBins, observations });
  return {
    config: CONFIG, summary,
    engagement: engagement.sort((a, b) => b.total_min - a.total_min),
    materials,
    profiles: { available: canProfile, min_n: CONFIG.minProfileN, median_breadth_pct: medB, median_depth_s: medD, counts: profileCounts, descriptions: PROFILE_DESC },
    lsa, codes: CODES,
    usage: { length_bins: lengthBins, first_picks: materials.filter((m) => m.first_picks).map((m) => ({ name: m.name, first_picks: m.first_picks })).sort((a, b) => b.first_picks - a.first_picks) },
    observations,
  };
}

// 英文版輸出：類型名稱、行為編碼、時長分組改成英文（數值不變）
function toEnglish({ summary, engagement, materials, canProfile, medB, medD, profileCounts, lsa, lengthBins, observations }) {
  const counts = {};
  for (const [k, v] of Object.entries(profileCounts)) counts[PROFILE_EN[k]] = v;
  return {
    config: CONFIG, summary,
    engagement: engagement.sort((a, b) => b.total_min - a.total_min).map((r) => ({ ...r, profile: r.profile ? PROFILE_EN[r.profile] : null })),
    materials,
    profiles: { available: canProfile, min_n: CONFIG.minProfileN, median_breadth_pct: medB, median_depth_s: medD, counts, descriptions: PROFILE_DESC_EN },
    lsa: { ...lsa, codes: lsa.codes.map((c) => ({ ...c, label: CODES_EN[c.code] })) },
    codes: CODES_EN,
    usage: {
      length_bins: lengthBins.map((b) => ({ ...b, label: b.label.replace(' 分鐘以上', '+ min').replace(' 分鐘', ' min') })),
      first_picks: materials.filter((m) => m.first_picks).map((m) => ({ name: m.name, first_picks: m.first_picks })).sort((a, b) => b.first_picks - a.first_picks),
    },
    observations,
  };
}

// 根據資料自動產生的觀察（描述性，不做因果推論）
function observe({ summary, materials, profileCounts, canProfile, lsa, engagement }, lang = 'zh') {
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const codeName = (c) => (lang === 'en' ? CODES_EN : CODES)[c];
  const profName = (k) => (lang === 'en' ? PROFILE_EN[k] : k);
  const out = [];
  const n = summary.students;
  if (!n) return [{ level: 'info', text: L('目前篩選範圍內還沒有學生資料。', 'No student data in the selected range yet.') }];
  if (n < 10) out.push({ level: 'warn', text: L(`目前只有 ${n} 位學生，以下觀察僅供參考；正式分析建議累積更多樣本。`, `Only ${n} student(s) so far; treat these observations as tentative and collect a larger sample before formal analysis.`) });

  const withViews = materials.filter((m) => m.holding_mean_s != null);
  if (materials.length >= 2 && materials[0].attraction_pct !== materials[materials.length - 1].attraction_pct) {
    const top = materials[0]; const low = materials[materials.length - 1];
    out.push({ level: 'info', category: 'B', text: L(`吸引力最高的教材是「${top.name}」（${top.attraction_pct}% 的學生開啟過），最低的是「${low.name}」（${low.attraction_pct}%）。`,
      `The most attractive material is "${top.name}" (opened by ${top.attraction_pct}% of students); the least is "${low.name}" (${low.attraction_pct}%).`) });
  }
  const byHold = [...withViews].sort((a, b) => b.holding_mean_s - a.holding_mean_s);
  if (withViews.length >= 2 && byHold[0].holding_mean_s !== byHold[byHold.length - 1].holding_mean_s) {
    const a = byHold[0]; const z = byHold[byHold.length - 1];
    out.push({ level: 'info', category: 'B', text: L(`平均停留最久的是「${a.name}」（${a.holding_mean_s} 秒），最短的是「${z.name}」（${z.holding_mean_s} 秒）。`,
      `Longest average view: "${a.name}" (${a.holding_mean_s} s); shortest: "${z.name}" (${z.holding_mean_s} s).`) });
  }
  for (const m of materials) {
    if (m.glance_pct != null && m.glance_pct >= 50 && m.opens >= 3) {
      out.push({ level: 'attention', category: 'B', text: L(`「${m.name}」有 ${m.glance_pct}% 的開啟在 ${CONFIG.glanceSec} 秒內就離開，可檢查內容是否過難、過長或與學習目標連結不清楚。`,
        `${m.glance_pct}% of views of "${m.name}" ended within ${CONFIG.glanceSec} s. Check whether it is too hard, too long, or unclear in how it links to the learning goal.`) });
    }
  }
  if (summary.diligent_pct != null) {
    out.push({ level: 'info', category: 'B', text: L(`${summary.diligent_pct}% 的學生看過超過一半的教材（%DV，Serrell 1998 以 51% 以上為「全面使用」的參考）。`,
      `${summary.diligent_pct}% of students viewed more than half of the materials (%DV; Serrell 1998 uses 51% or more as a benchmark for thorough use).`) });
  }
  if (canProfile) {
    const top = Object.entries(profileCounts).filter(([k]) => k !== '未開啟教材').sort((a, b) => b[1] - a[1])[0];
    if (top && top[1]) out.push({ level: 'info', category: 'C', text: L(`人數最多的學習者類型是「${top[0]}」（${top[1]} 人）。`, `The most common learner type is "${profName(top[0])}" (${top[1]} student${top[1] === 1 ? '' : 's'}).`) });
  } else {
    out.push({ level: 'info', category: 'C', text: L(`開過教材的學生少於 ${CONFIG.minProfileN} 人，暫不分型。`, `Fewer than ${CONFIG.minProfileN} students opened materials, so learner types are not assigned yet.`) });
  }
  const none = profileCounts['未開啟教材'];
  if (none) out.push({ level: 'attention', category: 'A', text: L(`有 ${none} 位學生只點了模型或按鈕，沒有開啟任何教材。`, `${none} student${none === 1 ? '' : 's'} only clicked models or buttons and never opened a material.`) });
  const oneShot = engagement.filter((r) => r.sessions === 1).length;
  if (n >= 5) out.push({ level: 'info', category: 'A', text: L(`${pct(oneShot, n)}% 的學生只使用過 1 次；使用時長中位數 ${summary.median_total_min} 分鐘。`, `${pct(oneShot, n)}% of students used it only once; median total time is ${summary.median_total_min} min.`) });
  if (lsa.N) {
    if (!lsa.enough) out.push({ level: 'warn', category: 'D', text: L(`行為轉移只有 ${lsa.N} 筆（建議至少 ${CONFIG.minLsaN} 筆），序列分析結果不穩定。`, `Only ${lsa.N} behaviour transitions (at least ${CONFIG.minLsaN} recommended); sequential analysis is unstable.`) });
    const top = lsa.significant.slice(0, 3).map((c) => `${codeName(c.from)} → ${codeName(c.to)}${L('（', ' (')}Z = ${c.z}${L('）', ')')}`);
    if (top.length) out.push({ level: 'info', category: 'D', text: L(`顯著的行為轉移（Z > ${CONFIG.zCritical}）：${top.join('、')}。`, `Significant transitions (Z > ${CONFIG.zCritical}): ${top.join('; ')}.`) });
  }
  return out;
}

// 分類說明：研究問題與建議方法（後台與 Excel Codebook 共用）
const CATEGORIES = [
  { key: 'A', title: 'A. 參與度指標', question: '學生投入程度如何？投入與學習成效是否相關？',
    methods: '描述統計（平均數、中位數、分布）；以學生代號合併前後測，做相關或迴歸（例：教材互動時間 → 後測，控制前測）。',
    indicators: '使用次數、活躍天數、總時長、教材廣度（看過幾 %）、深度（每次平均停留秒數）、回訪次數、瞥過比例' },
  { key: 'B', title: 'B. 教材效能', question: '哪些教材最吸引學生？哪些能讓學生停留？哪些需要修改？',
    methods: '博物館觀眾研究的吸引力（attracting power）與停留力（holding power）、%DV（Shettel 1973；Serrell 1998）；可用卡方或 Kruskal-Wallis 比較教材類型。',
    indicators: '吸引力 %、平均／中位停留秒數、瞥過率、回訪率、首選次數、喜歡率' },
  { key: 'C', title: 'C. 學習者類型', question: '學生有哪些不同的學習型態？不同型態的學習成效是否不同？',
    methods: '後台以「廣度 × 深度」中位數分成四型，方便快速檢視；正式研究建議用 Excel 的原始指標做 K-means 或階層式集群（先標準化），再以 ANOVA／卡方比較各群成效。',
    indicators: '深度探索型、廣泛瀏覽型、專注聚焦型、淺嘗即止型、未開啟教材' },
  { key: 'D', title: 'D. 行為序列（LSA）', question: '學生的操作有哪些顯著的先後順序？例如開教材後是否常接著按喜歡？',
    methods: '滯後序列分析（Lag Sequential Analysis；Bakeman & Quera 2011）：行為編碼 → 轉移次數表 → 調整後殘差 Z，Z > 1.96 為顯著（p < .05），可畫成行為轉移圖；也可用事件明細做 process mining。沉浸式學習行為研究中最常用的方法。',
    indicators: '行為編碼、轉移次數、期望次數、Z 值、顯著轉移' },
  { key: 'E', title: 'E. 使用模式', question: '學生通常使用多久？從哪份教材開始？什麼時段使用？',
    methods: '使用時長分布、首選教材次數、星期 × 時段熱度（總覽頁）；可比較不同班級或施測場次。',
    indicators: '使用時長分組、首選教材、時段' },
];

const CATEGORIES_EN = [
  { key: 'A', title: 'A. Engagement', question: 'How engaged are students? Is engagement related to learning outcomes?',
    methods: 'Descriptive statistics (mean, median, distribution); merge pre/post-tests by student code and run correlation or regression (e.g., material time → post-test, controlling for pre-test).',
    indicators: 'Sessions, active days, total time, material breadth (% viewed), depth (mean seconds per view), revisits, glance rate' },
  { key: 'B', title: 'B. Material effectiveness', question: 'Which materials attract students, which hold their attention, and which need revision?',
    methods: 'Attracting power and holding power from museum visitor studies, plus %DV (Shettel 1973; Serrell 1998); compare material types with chi-square or Kruskal–Wallis tests.',
    indicators: 'Attraction %, mean/median view seconds, glance rate, revisit rate, first picks, like rate' },
  { key: 'C', title: 'C. Learner types', question: 'What different learning patterns do students show, and do outcomes differ between them?',
    methods: 'The dashboard splits students into four types at the medians of breadth × depth for a quick view. For formal research, run K-means or hierarchical clustering on the raw indicators in the Excel file (standardise first), then compare groups with ANOVA or chi-square.',
    indicators: 'Deep explorer, Broad browser, Focused viewer, Light sampler, No materials opened' },
  { key: 'D', title: 'D. Behaviour sequences (LSA)', question: 'Which actions significantly tend to follow one another, e.g., do students often press Like after opening a material?',
    methods: 'Lag sequential analysis (Bakeman & Quera 2011): code behaviours → transition frequency table → adjusted residual Z; Z > 1.96 is significant (p < .05) and can be drawn as a transition diagram. Event-level data also supports process mining. LSA is the most common method in immersive-learning behaviour research.',
    indicators: 'Behaviour codes, transition counts, expected counts, Z values, significant transitions' },
  { key: 'E', title: 'E. Usage patterns', question: 'How long do students use it, which material do they start with, and when do they use it?',
    methods: 'Session-length distribution, first-pick counts, weekday × hour heatmap (Overview tab); compare classes or test sessions.',
    indicators: 'Session-length groups, first picks, time of day' },
];

const REFERENCES = [
  'Bakeman, R., & Quera, V. (2011). Sequential analysis and observational methods for the behavioral sciences. Cambridge University Press.',
  'Serrell, B. (1998). Paying attention: Visitors and museum exhibitions. American Association of Museums.',
  'Shettel, H. H. (1973). Exhibits: Art form or educational medium? Museum News, 52(1), 32–41.',
  'Behavioral analysis in immersive learning environments: A systematic literature review and research agenda (2024). arXiv:2405.03442.',
];

module.exports = { analyze, lagSequential, classify, codeOf, CONFIG, CODES, CODES_EN, CATEGORIES, CATEGORIES_EN, REFERENCES, PROFILE_DESC, PROFILE_EN, PROFILE_DESC_EN };
