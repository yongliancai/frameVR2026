// 研究用 Excel：把行為紀錄整理成可以直接做統計的表格（寬格式＋長格式＋Codebook）
const stats = require('./stats');
const studentIds = require('./students');
const xlsx = require('./xlsx');

const TYPE = { board: '展板', model: '3D 模型', video: '影片', button: '互動按鈕', material: '教材', other: '其他' };
const EVENT = {
  session_start: '進入', session_end: '離開', click: '點擊', material_open: '開啟教材', material_close: '關閉教材',
  like: '喜歡', unlike: '取消喜歡', favorite: '收藏', unfavorite: '取消收藏', heartbeat: '心跳',
};
const END = { timeout: '閒置逾時', leave_trigger: '離開觸發', leave: '離開觸發' };
const sec = (ms) => (ms == null ? null : Math.round(ms / 1000));
const min = (ms) => (ms == null ? null : Math.round(ms / 600) / 100);
const t = (ms) => (ms ? stats.iso(ms) : null);

function codebook(q, role, cfg) {
  const range = `${q.from || '（不限）'} ～ ${q.to || '（不限）'}`;
  const rows = [
    ['檔案資訊', '匯出時間', stats.iso(Date.now()) + '（台灣時間）'],
    ['檔案資訊', '資料範圍', range + (q.frame ? `；Frame：${q.frame}` : '；全部 Frame')],
    ['檔案資訊', '匯出角色', role === 'admin' ? '管理者（含代號對照表）' : '研究者（學生只以代號呈現）'],
    ['檔案資訊', '已排除', '管理者標記為「測試帳號」的學生不在本檔案中'],

    ['工作表', '學生摘要', '一列＝一位學生。描述統計、相關分析、與前後測／問卷合併（以「學生代號」對應）'],
    ['工作表', '學生×教材', '一列＝一位學生；每份教材兩欄（開啟次數、互動秒數）。集群分析、學習型態分群、熱點分析'],
    ['工作表', '工作階段', '一列＝一次使用。使用頻率、每次時長、使用時段分析'],
    ['工作表', '教材摘要', '一列＝一份教材。比較教材吸引力（開啟人數）、停留時間、喜好'],
    ['工作表', '瀏覽順序', '一列＝「A 接著開啟 B」的轉移。序列分析、滯後序列分析（LSA）、繪製轉移圖'],
    ['工作表', '事件明細', '一列＝一個事件（長格式、依時間排序）。歷程探勘（process mining）、自訂分析'],
    ...(role === 'admin' ? [['工作表', '代號對照', '僅管理者版本：代號 ↔ email ↔ FrameVR 帳號 ID。請勿提供給研究者']] : []),

    ['欄位', '學生代號', 'S001 起依學生第一次出現的順序編號，固定不變'],
    ['欄位', '使用次數', '工作階段數。同一位學生超過 ' + cfg.gap + ' 分鐘沒有動作，下一個動作算新的一次'],
    ['欄位', '總使用時長(分)', '各次使用「第一個動作 → 最後一個動作（或離開觸發）」的加總'],
    ['欄位', '教材互動秒數', '開啟一份教材到「開啟下一份／離開／逾時」為止；單次上限 ' + cfg.maxMat + ' 分鐘'],
    ['欄位', '點擊次數', '所有物件的點擊；同一人 ' + cfg.dedupe + ' 秒內重複點同一物件只算一次'],
    ['欄位', '喜歡／收藏(目前)', '以每位學生最後一次操作為準（喜歡後又取消＝0）'],
    ['欄位', '結束方式', '離開觸發＝學生碰到離開物件；閒置逾時＝FrameVR 沒有離開訊號，以最後一次動作當作離開'],

    ['資料限制', '時長為推估值', 'FrameVR 無法得知學生何時關閉視窗；最後一個動作之後停留的時間不會被計入，時長偏向低估'],
    ['資料限制', '教材時間的定義', '是「注意力停留在該教材的可能時間」，學生可能同時在做別的事；建議搭配開啟次數一起解讀'],
    ['資料限制', '只有點擊才會被記錄', '學生走近、觀看但沒有點擊的教材不會被記錄'],
    ['資料限制', '進入時間', '若出生點沒有設定靠近觸發，進入時間＝第一次點擊時間'],

    ['分析建議', '描述統計', '學生摘要：使用次數、總時長、看過教材數的平均數、標準差、分布（時長通常右偏，可取對數或用中位數）'],
    ['分析建議', '教材比較', '教材摘要：開啟人數比例（觸及率）×平均互動秒數，找出「很多人開但很快離開」的教材'],
    ['分析建議', '學習型態分群', '學生×教材：以互動秒數做 K-means 或階層式集群（先標準化），比較各群的學習成效'],
    ['分析建議', '瀏覽序列', '瀏覽順序：計算轉移機率、滯後序列分析（Z 分數 > 1.96 的顯著轉移），或用事件明細做 process mining'],
    ['分析建議', '與學習成效連結', '把前後測／問卷以學生代號合併到學生摘要，做相關或迴歸（例：教材互動時間 → 後測分數，控制前測）'],
    ['分析建議', '樣本與排除', '建議事先訂出排除標準（例如總時長 < 1 分鐘、只點 1 次），並在論文中報告排除人數'],
  ];
  return { name: '說明', columns: [{ header: '類別', width: 12 }, { header: '項目', width: 22 }, { header: '說明', width: 90, wrap: true }], rows };
}

function buildWorkbook(q, role, cfg) {
  const dir = studentIds.directory();
  const label = (id) => { const s = dir.get(id); return s ? s.code : '未編號'; };
  const sorter = (a, b) => String(a[0]).localeCompare(String(b[0]));

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
    min(s.duration_ms), s.end_ts ? (END[s.end_reason] || s.end_reason || '離開觸發') : '進行中', s.event_count]);

  const materials = stats.materials(q).map((r) => [r.target_name || r.target_id, TYPE[r.target_type] || r.target_type, r.opens, r.students,
    sec(r.total_ms), sec(r.avg_ms), r.clicks, r.liked_now, r.unlike_events, r.favorited_now, r.unfavorite_events]);

  const seq = stats.sequences(q);
  const outTotals = new Map();
  for (const x of seq.transitions) outTotals.set(x.from, (outTotals.get(x.from) || 0) + x.count);
  const transitions = seq.transitions.map((x) => [x.from_name, x.to_name, x.count, Math.round((x.count / outTotals.get(x.from)) * 1000) / 1000]);

  const events = stats.eventRows(q).map((e) => [t(e.ts), label(e.student_id), e.session_id, e.seq, EVENT[e.event_type] || e.event_type, e.event_type,
    e.target_name || e.target_id, TYPE[e.target_type] || e.target_type, sec(e.duration_ms), e.frame]);

  const sheets = [
    codebook(q, role, cfg),
    { name: '學生摘要', columns: ['學生代號', '使用次數', '總使用時長(分)', '平均每次(分)', '第一次使用', '最後使用', '點擊次數', '點擊-展板', '點擊-3D模型', '點擊-影片', '點擊-按鈕',
      '教材開啟次數', '看過教材數', '教材互動秒數', '喜歡(目前)', '收藏(目前)'].map((h) => ({ header: h, width: /使用$/.test(h) ? 20 : 13 })), rows: studentRows },
    { name: '學生×教材', columns: [{ header: '學生代號' }, ...mats.flatMap(([, n]) => [{ header: n + '｜開啟次數', width: 18 }, { header: n + '｜互動秒數', width: 18 }])], rows: matrixRows },
    { name: '工作階段', columns: [{ header: '學生代號' }, { header: '工作階段 ID', width: 38 }, { header: 'Frame' }, { header: '開始', width: 20 }, { header: '結束', width: 20 }, { header: '時長(分)' }, { header: '結束方式' }, { header: '事件數' }], rows: sessions },
    { name: '教材摘要', columns: ['教材', '類型', '開啟次數', '開啟人數', '累積互動秒數', '平均互動秒數', '點擊次數', '喜歡(目前人數)', '取消喜歡次數', '收藏(目前人數)', '取消收藏次數'].map((h, i) => ({ header: h, width: i === 0 ? 30 : 14 })), rows: materials },
    { name: '瀏覽順序', columns: [{ header: '先開啟', width: 30 }, { header: '接著開啟', width: 30 }, { header: '次數' }, { header: '轉移機率', width: 12 }], rows: transitions },
    { name: '事件明細', columns: [{ header: '時間', width: 20 }, { header: '學生代號' }, { header: '工作階段 ID', width: 38 }, { header: '順序' }, { header: '事件' }, { header: '事件代碼', width: 16 }, { header: '物件', width: 30 }, { header: '類型' }, { header: '時長(秒)' }, { header: 'Frame' }], rows: events },
  ];
  if (role === 'admin') {
    sheets.push({ name: '代號對照', columns: [{ header: '學生代號' }, { header: 'Email', width: 30 }, { header: 'FrameVR 帳號 ID', width: 50 }, { header: '測試帳號(已排除)', width: 16 }, { header: '備註', width: 24 }],
      rows: studentIds.list().map((r) => [r.code, r.email, r.student_id, r.excluded ? '是' : '', r.note]) });
  }
  return xlsx.build(sheets);
}

module.exports = { buildWorkbook };
