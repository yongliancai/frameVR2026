// =====================================================================
// FrameVR 環境探測腳本（部署前先跑一次）
// 用法：Frame 側欄 <> Script Editor → 新增 Script → 貼上本檔 → 改 API_BASE / INGEST_KEY → 執行
// 進入 Frame 後，到後台「系統」分頁就能看到回報結果；也可以在瀏覽器 Console 看。
// 目的：確認 Frame Script 裡有哪些物件可用（scene、BABYLON.GUI、fetch、localStorage…），
//      並記錄你點到的 3D 物件名稱，方便填寫 tracker.js 的 TARGETS 對照表。
// =====================================================================
const API_BASE = 'https://nckuchat.online/framevr';   // ← 你的後台網址（結尾不要加 /）
const INGEST_KEY = '請填入 .env 的 INGEST_KEY';

(function () {
  const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : {});
  const has = (fn) => { try { return !!fn(); } catch (e) { return false; } };

  function findScene() {
    try { if (typeof scene !== 'undefined' && scene) return scene; } catch (e) {}
    try { if (g.BABYLON && g.BABYLON.EngineStore && g.BABYLON.EngineStore.LastCreatedScene) return g.BABYLON.EngineStore.LastCreatedScene; } catch (e) {}
    try { if (g.BABYLON && g.BABYLON.Engine && g.BABYLON.Engine.LastCreatedScene) return g.BABYLON.Engine.LastCreatedScene; } catch (e) {}
    return null;
  }

  const sc = findScene();
  const report = {
    key: INGEST_KEY,
    time: new Date().toISOString(),
    href: has(() => g.location) ? String(g.location.href) : null,
    userAgent: has(() => g.navigator) ? g.navigator.userAgent : null,
    globals: {
      window: typeof window !== 'undefined',
      document: typeof document !== 'undefined',
      fetch: typeof fetch !== 'undefined',
      sendBeacon: has(() => g.navigator && g.navigator.sendBeacon),
      localStorage: has(() => { g.localStorage.setItem('__fvt', '1'); g.localStorage.removeItem('__fvt'); return true; }),
      prompt: has(() => typeof g.prompt === 'function'),
      BABYLON: has(() => g.BABYLON),
      BABYLON_GUI: has(() => g.BABYLON && g.BABYLON.GUI && g.BABYLON.GUI.AdvancedDynamicTexture),
      sceneVariable: has(() => typeof scene !== 'undefined' && scene),
      sceneFound: !!sc,
      onPointerObservable: has(() => sc && sc.onPointerObservable),
      crypto_randomUUID: has(() => g.crypto && g.crypto.randomUUID),
    },
    meshCount: sc && sc.meshes ? sc.meshes.length : null,
    sampleMeshNames: sc && sc.meshes ? sc.meshes.slice(0, 80).map((m) => m.name) : [],
  };

  console.log('[FrameVR probe]', report);
  send('/api/probe', report);

  // 點擊任何物件，就把名稱與父層鏈回報（最多 30 次）
  let n = 0;
  if (sc && sc.onPointerObservable && g.BABYLON) {
    sc.onPointerObservable.add(function (pi) {
      if (pi.type !== g.BABYLON.PointerEventTypes.POINTERPICK || n >= 30) return;
      const m = pi.pickInfo && pi.pickInfo.pickedMesh;
      if (!m) return;
      n++;
      const chain = [];
      let cur = m;
      while (cur && chain.length < 8) { chain.push({ name: cur.name, id: cur.id, uniqueId: cur.uniqueId, metadata: safe(cur.metadata) }); cur = cur.parent; }
      console.log('[FrameVR probe] clicked', chain);
      send('/api/probe', { key: INGEST_KEY, clicked: chain, time: new Date().toISOString() });
    });
  }

  function safe(v) { try { return v ? JSON.parse(JSON.stringify(v)) : null; } catch (e) { return '[unserializable]'; } }
  function send(path, body) {
    try {
      fetch(API_BASE + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
        .then(function (r) { console.log('[FrameVR probe] sent', r.status); })
        .catch(function (e) { console.warn('[FrameVR probe] fetch failed', e); });
    } catch (e) { console.warn('[FrameVR probe] fetch not available', e); }
  }
})();
