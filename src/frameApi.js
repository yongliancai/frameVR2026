// FrameVR 官方 Automate API（https://api.framevr.io/doc/automate/）的唯讀查詢
// 用途：確認物件資料裡的 triggers（Action Editor 設定）能不能被程式讀到，作為之後自動套用的依據。
// 需要 .env：FRAME_API_KEY（FrameVR → PROFILE →「Your API Key」）、FRAME_REF（Frame 名稱，例如 ncku2026）
const BASE = 'https://api.framevr.io/automate/v1';
const ASSET_TYPES = ['images', 'models', 'shapes', 'texts', 'text-areas', 'videos', 'pdfs', 'audios', 'spheres',
  'spawn-spots', 'particles', 'voice-zones', 'streaming-screens', 'polls', 'news', 'shaders', 'NPCs', 'agents',
  'whiteboards', 'basemodel-chairs', 'remotebrowsers'];

function config() {
  return { key: process.env.FRAME_API_KEY || '', frame: process.env.FRAME_REF || '' };
}

async function call(path) {
  const { key } = config();
  if (!key) return { ok: false, status: 0, error: '伺服器 .env 尚未設定 FRAME_API_KEY' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, signal: ctrl.signal });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 5000); }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? '連線逾時' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// 在任意 JSON 裡找出 triggers 欄位（不知道確切結構，所以整棵樹搜尋）
function findTriggers(obj, path = '$', out = []) {
  if (!obj || typeof obj !== 'object' || out.length > 50) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path + '.' + k;
    if (/trigger|interact|action/i.test(k) && v && (Array.isArray(v) ? v.length : typeof v === 'object')) out.push({ path: p, value: v });
    if (v && typeof v === 'object') findTriggers(v, p, out);
  }
  return out;
}

async function readFrame(frameRef) {
  const ref = frameRef || config().frame;
  if (!ref) return { ok: false, error: '請提供 Frame 名稱（或在 .env 設定 FRAME_REF）' };
  const res = await call('/frame/' + encodeURIComponent(ref));
  if (res.data && typeof res.data === 'object') {
    res.top_level_keys = Object.keys(res.data);
    res.triggers_found = findTriggers(res.data).slice(0, 20);
  }
  return res;
}

async function readAsset(assetType, assetId, frameRef) {
  const ref = frameRef || config().frame;
  if (!ref) return { ok: false, error: '請提供 Frame 名稱（或在 .env 設定 FRAME_REF）' };
  if (!ASSET_TYPES.includes(assetType)) return { ok: false, error: '不支援的物件類型：' + assetType };
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(assetId || '')) return { ok: false, error: '物件 ID 格式不正確' };
  const res = await call(`/asset/${encodeURIComponent(ref)}/${assetType}/${encodeURIComponent(assetId)}`);
  if (res.data && typeof res.data === 'object') res.triggers_found = findTriggers(res.data);
  return res;
}

module.exports = { readFrame, readAsset, ASSET_TYPES, config };
