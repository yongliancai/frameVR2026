// =====================================================================
// FrameVR 學習行為追蹤器（Frame Script）
// 貼到 Frame 側欄 <> Script Editor。學生一進入 Frame 就會執行。
//
// 記錄內容
//   1. 使用時間：session_start（進入）、heartbeat（每 30 秒）、session_end（離開）
//   2. 物件點擊：click（展板 board / 3D 模型 model / 影片 video / 互動按鈕 button）
//   3. 教材互動歷程：material_open / material_close（含互動時間 duration_ms、seq 操作順序）
//   4. 喜好：like / unlike / favorite / unfavorite（教材開啟時畫面下方出現按鈕）
//   5. 身分與工作階段：student_id（進場輸入）、session_id（每次進入產生）、毫秒時間戳記
//   6. 儲存：批次 POST 到你的伺服器 /api/events，斷線時暫存在 localStorage 稍後補送
// =====================================================================

const CONFIG = {
  API_BASE: 'https://nckuchat.online/framevr',      // ← 你的後台網址（結尾不要加 /）
  INGEST_KEY: '請填入 .env 的 INGEST_KEY',
  FRAME_NAME: 'my-frame',                     // ← 這個 Frame 的名稱，後台可用來篩選
  ASK_ID_EVERY_TIME: true,                    // 教室共用電腦建議 true；個人裝置可改 false（記住上次學號）
  HEARTBEAT_MS: 30000,
  FLUSH_MS: 5000,
  MAX_MATERIAL_MS: 10 * 60 * 1000,            // 單次教材互動時間上限（避免開著不看灌高時間）
  LOG_UNKNOWN_CLICKS: true,                   // 點到沒在 TARGETS 裡的物件也記成 type=other，方便你找出物件名稱
  DEBUG: true,                                // 在 Console 印出事件

  // 物件對照表：用 3D 物件名稱（或其父層名稱）對應到展板／模型／影片／按鈕
  //   match: 完整名稱字串、或正規表達式（/.../）
  //   type:  board | model | video | button
  //   material: true 代表「教材」，點擊會開啟教材並開始計算互動時間
  // 物件名稱怎麼找：先跑 probe.js，或把 LOG_UNKNOWN_CLICKS 打開後到後台「事件紀錄」看 target_name
  TARGETS: [
    { match: /^board_water/i,  id: 'board-water-cycle', name: '展板：水循環',       type: 'board', material: true },
    { match: /^model_heart/i,  id: 'model-heart',       name: '3D 模型：心臟',      type: 'model', material: true },
    { match: /^video_intro/i,  id: 'video-intro',       name: '影片：單元導覽',     type: 'video', material: true },
    { match: 'btn_quiz',       id: 'btn-quiz',          name: '按鈕：小測驗',       type: 'button' },
  ],
};

(function () {
  const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : {});
  const B = g.BABYLON;
  const LS = storage();
  const QUEUE_KEY = 'fvt_queue';
  const log = (...a) => { if (CONFIG.DEBUG) console.log('[FrameVR tracker]', ...a); };

  let studentId = null;
  let sessionId = null;
  let seq = 0;
  let queue = loadQueue();
  let current = null;          // 目前開啟的教材 { target, openedAt, clicks }
  let ended = false;
  let ui = null;
  let sending = false;         // 是否有一批事件正在傳送中

  // ---------------- 啟動 ----------------
  askStudentId(function (id) {
    studentId = id;
    sessionId = uuid();
    track('session_start', null, { meta: { url: safe(() => g.location.href), ua: safe(() => g.navigator.userAgent), screen: safe(() => g.screen.width + 'x' + g.screen.height) } });
    flush();
    setInterval(function () { track('heartbeat', null, { meta: { visible: isVisible() } }); }, CONFIG.HEARTBEAT_MS);
    setInterval(flush, CONFIG.FLUSH_MS);
    hookClicks();
    hookLeave();
    log('started', { studentId, sessionId });
  });

  // ---------------- 學生身分 ----------------
  function askStudentId(done) {
    const saved = LS.get('fvt_student_id');
    if (!CONFIG.ASK_ID_EVERY_TIME && saved) return done(saved);

    const GUI = B && B.GUI;
    if (GUI && GUI.AdvancedDynamicTexture) {
      try {
        const adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI('fvt_login', true, getScene());
        const panel = new GUI.Rectangle('fvt_login_panel');
        Object.assign(panel, { width: '420px', height: '230px', cornerRadius: 16, thickness: 0, background: '#1f2533ee', isPointerBlocker: true });
        adt.addControl(panel);
        const stack = new GUI.StackPanel(); stack.paddingTop = '18px'; panel.addControl(stack);

        const title = new GUI.TextBlock(); Object.assign(title, { text: '請輸入你的學號或座號', color: 'white', fontSize: 22, height: '44px' });
        const input = new GUI.InputText(); Object.assign(input, { width: '320px', height: '48px', text: saved || '', color: 'white', background: '#2c3446', focusedBackground: '#384259', fontSize: 22, thickness: 1, placeholderText: '例如 S0312' });
        const hint = new GUI.TextBlock(); Object.assign(hint, { text: '', color: '#ffb4a8', fontSize: 16, height: '30px' });
        const btn = GUI.Button.CreateSimpleButton('fvt_ok', '開始'); Object.assign(btn, { width: '160px', height: '48px', color: 'white', background: '#3b7ddd', cornerRadius: 10, fontSize: 20 });
        [title, input, hint, btn].forEach((c) => stack.addControl(c));

        const submit = function () {
          const v = cleanId(input.text);
          if (!v) { hint.text = '學號不能空白'; return; }
          LS.set('fvt_student_id', v);
          adt.dispose();
          done(v);
        };
        btn.onPointerUpObservable.add(submit);
        input.onKeyboardEventProcessedObservable && input.onKeyboardEventProcessedObservable.add(function (e) { if (e.key === 'Enter') submit(); });
        return;
      } catch (e) { console.warn('[FrameVR tracker] GUI login failed, fallback to prompt', e); }
    }
    // 備案：瀏覽器內建輸入框
    let v = null;
    try { v = cleanId(g.prompt('請輸入你的學號或座號', saved || '')); } catch (e) {}
    v = v || saved || ('anon-' + uuid().slice(0, 8));
    LS.set('fvt_student_id', v);
    done(v);
  }

  function cleanId(v) { return String(v || '').trim().replace(/\s+/g, '').slice(0, 64); }

  // ---------------- 點擊 ----------------
  function hookClicks() {
    const sc = getScene();
    if (!sc || !sc.onPointerObservable || !B) { console.warn('[FrameVR tracker] 找不到 scene.onPointerObservable，無法記錄點擊'); return; }
    sc.onPointerObservable.add(function (pi) {
      if (pi.type !== B.PointerEventTypes.POINTERPICK) return;
      const mesh = pi.pickInfo && pi.pickInfo.pickedMesh;
      if (!mesh || String(mesh.name).indexOf('fvt_') === 0) return;
      const hit = resolveTarget(mesh);
      if (hit) onTargetClick(hit, mesh);
      else if (CONFIG.LOG_UNKNOWN_CLICKS) {
        track('click', { id: 'mesh:' + mesh.name, name: mesh.name, type: 'other' }, { meta: { chain: nameChain(mesh) } });
      }
    });
  }

  function resolveTarget(mesh) {
    let cur = mesh; let depth = 0;
    while (cur && depth < 10) {
      const nm = String(cur.name || '');
      for (const t of CONFIG.TARGETS) {
        if (t.match instanceof RegExp ? t.match.test(nm) : t.match === nm) return t;
      }
      cur = cur.parent; depth++;
    }
    return null;
  }

  function onTargetClick(t, mesh) {
    track('click', t, { meta: { mesh: mesh.name } });
    if (current) current.clicks++;
    if (t.material) openMaterial(t);
  }

  // ---------------- 教材互動 ----------------
  function openMaterial(t) {
    if (current && current.target.id === t.id) return; // 同一份教材重複點擊只算一次開啟
    closeMaterial('switch');
    current = { target: t, openedAt: Date.now(), clicks: 0 };
    track('material_open', t);
    showPrefBar(t);
  }

  function closeMaterial(reason) {
    if (!current) return;
    const dur = Math.min(Date.now() - current.openedAt, CONFIG.MAX_MATERIAL_MS);
    track('material_close', current.target, { duration_ms: dur, meta: { reason: reason, clicks_inside: current.clicks } });
    current = null;
    hidePrefBar();
  }

  // ---------------- 喜歡 / 收藏 ----------------
  function prefKey(kind, id) { return 'fvt_' + kind + '_' + studentId + '_' + id; }
  function togglePref(kind) {
    if (!current) return;
    const t = current.target;
    const on = LS.get(prefKey(kind, t.id)) === '1';
    LS.set(prefKey(kind, t.id), on ? '0' : '1');
    track(kind === 'like' ? (on ? 'unlike' : 'like') : (on ? 'unfavorite' : 'favorite'), t);
    refreshPrefBar();
    flush();
  }

  function showPrefBar(t) {
    const GUI = B && B.GUI;
    if (!GUI || !GUI.AdvancedDynamicTexture) return;
    if (!ui) {
      try {
        const adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI('fvt_prefs', true, getScene());
        const bar = new GUI.Rectangle('fvt_bar');
        Object.assign(bar, { width: '560px', height: '64px', cornerRadius: 14, thickness: 0, background: '#1f2533dd', verticalAlignment: GUI.Control.VERTICAL_ALIGNMENT_BOTTOM, top: '-24px', isPointerBlocker: true });
        adt.addControl(bar);
        const row = new GUI.StackPanel(); row.isVertical = false; row.height = '64px'; bar.addControl(row);
        const label = new GUI.TextBlock(); Object.assign(label, { width: '250px', color: 'white', fontSize: 17, textWrapping: true });
        const mk = (name, txt, bg, fn) => { const b = GUI.Button.CreateSimpleButton(name, txt); Object.assign(b, { width: '96px', height: '44px', color: 'white', background: bg, cornerRadius: 10, fontSize: 17, paddingLeft: '6px' }); b.onPointerUpObservable.add(fn); row.addControl(b); return b; };
        row.addControl(label);
        const like = mk('fvt_like', '♡ 喜歡', '#5a3a4a', function () { togglePref('like'); });
        const fav = mk('fvt_fav', '☆ 收藏', '#4a4630', function () { togglePref('fav'); });
        mk('fvt_close', '✕ 關閉', '#3a4052', function () { closeMaterial('close_button'); });
        ui = { adt, bar, label, like, fav };
      } catch (e) { console.warn('[FrameVR tracker] 無法建立喜好按鈕', e); return; }
    }
    ui.label.text = t.name || t.id;
    ui.bar.isVisible = true;
    refreshPrefBar();
  }

  function refreshPrefBar() {
    if (!ui || !current) return;
    const id = current.target.id;
    const liked = LS.get(prefKey('like', id)) === '1';
    const faved = LS.get(prefKey('fav', id)) === '1';
    ui.like.textBlock.text = liked ? '♥ 已喜歡' : '♡ 喜歡';
    ui.like.background = liked ? '#c2456b' : '#5a3a4a';
    ui.fav.textBlock.text = faved ? '★ 已收藏' : '☆ 收藏';
    ui.fav.background = faved ? '#b38a1d' : '#4a4630';
  }
  function hidePrefBar() { if (ui) ui.bar.isVisible = false; }

  // ---------------- 離開 ----------------
  function hookLeave() {
    if (typeof g.addEventListener !== 'function') return;
    const end = function (reason) {
      if (ended) return;
      ended = true;
      closeMaterial('leave');
      track('session_end', null, { meta: { reason: reason } });
      flush(true);
    };
    g.addEventListener('pagehide', function () { end('pagehide'); });
    g.addEventListener('beforeunload', function () { end('beforeunload'); });
    // 切到別的分頁時先把資料送出（不結束工作階段；心跳停止後後台會以最後心跳時間估算離開時間）
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (!isVisible()) flush(true); });
  }

  // ---------------- 事件與傳送 ----------------
  function track(type, t, extra) {
    if (!studentId || !sessionId) return;
    if (ended && type !== 'session_end' && type !== 'material_close') return;
    extra = extra || {};
    const ev = {
      event_id: uuid(),
      seq: ++seq,
      type: type,
      student_id: studentId,
      session_id: sessionId,
      frame: CONFIG.FRAME_NAME,
      target_id: t ? t.id : null,
      target_type: t ? t.type : null,
      target_name: t ? (t.name || t.id) : null,
      duration_ms: extra.duration_ms != null ? extra.duration_ms : null,
      ts: Date.now(),
      meta: extra.meta || null,
    };
    queue.push(ev);
    if (queue.length > 2000) queue = queue.slice(-2000); // 離線太久時保留最新 2000 筆
    saveQueue();
    if (type !== 'heartbeat') log(type, ev.target_name || '', ev);
    if (queue.length >= 20) flush();
  }

  function flush(useBeacon) {
    if (!queue.length) return;
    const batch = queue.slice(0, 200);
    const body = JSON.stringify({ key: CONFIG.INGEST_KEY, events: batch });
    const url = CONFIG.API_BASE + '/api/events';

    if (useBeacon && g.navigator && g.navigator.sendBeacon) {
      try {
        const ok = g.navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
        if (ok) { queue = queue.slice(batch.length); saveQueue(); return; }
      } catch (e) {}
    }
    if (sending && !useBeacon) return;
    sending = true;
    try {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: !!useBeacon })
        .then(function (r) {
          sending = false;
          if (r.ok || r.status === 400) { // 400 代表資料格式錯，丟掉避免卡住佇列
            const ids = new Set(batch.map((e) => e.event_id));
            queue = queue.filter((e) => !ids.has(e.event_id));
            saveQueue();
          } else console.warn('[FrameVR tracker] 伺服器回應', r.status);
        })
        .catch(function (e) { sending = false; console.warn('[FrameVR tracker] 傳送失敗，稍後重試', e); });
    } catch (e) { sending = false; console.warn('[FrameVR tracker] fetch 不可用', e); }
  }

  // ---------------- 工具 ----------------
  function getScene() {
    try { if (typeof scene !== 'undefined' && scene) return scene; } catch (e) {}
    try { if (B && B.EngineStore && B.EngineStore.LastCreatedScene) return B.EngineStore.LastCreatedScene; } catch (e) {}
    try { if (B && B.Engine && B.Engine.LastCreatedScene) return B.Engine.LastCreatedScene; } catch (e) {}
    return null;
  }
  function nameChain(m) { const a = []; let c = m; while (c && a.length < 6) { a.push(c.name); c = c.parent; } return a; }
  function isVisible() { try { return document.visibilityState !== 'hidden'; } catch (e) { return true; } }
  function safe(fn) { try { return fn(); } catch (e) { return null; } }
  function uuid() {
    try { if (g.crypto && g.crypto.randomUUID) return g.crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
  }
  function storage() {
    const mem = {};
    let ok = false;
    try { g.localStorage.setItem('__fvt', '1'); g.localStorage.removeItem('__fvt'); ok = true; } catch (e) {}
    return {
      get: (k) => { try { return ok ? g.localStorage.getItem(k) : (k in mem ? mem[k] : null); } catch (e) { return k in mem ? mem[k] : null; } },
      set: (k, v) => { try { if (ok) g.localStorage.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } },
    };
  }
  function loadQueue() { try { return JSON.parse(LS.get(QUEUE_KEY) || '[]'); } catch (e) { return []; } }
  function saveQueue() { LS.set(QUEUE_KEY, JSON.stringify(queue)); }
})();
