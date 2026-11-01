# FrameVR 學習行為紀錄系統

FrameVR 空間內的 Frame Script 追蹤學生行為 → 批次 POST 到你的伺服器 → SQLite 儲存 → 網頁後台視覺化與 CSV 匯出。

```
FrameVR（學生瀏覽器）                     你的伺服器（Nginx → PM2 → Node/Express）
┌─────────────────────────┐   POST     ┌──────────────────────────────────────┐
│ tracker.js（Frame Script）│ ────────▶ │ /api/events   事件收集（金鑰驗證、去重）│
│  進場輸入學號             │  每 5 秒   │ SQLite: events / sessions             │
│  心跳、點擊、教材、喜好     │  批次送出   │ /            後台網頁（帳密登入）       │
└─────────────────────────┘            │ /api/export  CSV 匯出                  │
 widget/like.html（選用）  ────────▶    └──────────────────────────────────────┘
```

## 六項功能對應

| 需求 | 前端事件 | 後台呈現 |
|---|---|---|
| 1. 使用時間（進入、離開、累積時長） | `session_start`、每 30 秒 `heartbeat`、`session_end` | 總覽 KPI、每日時長、學生表、每次使用時長條 |
| 2. 物件點擊（展板、3D 模型、影片、按鈕） | `click` + `target_type`（board / model / video / button） | 「點擊」分頁：前 15 名、依類型統計 |
| 3. 教材互動歷程（開啟次數、互動時間、先後順序） | `material_open` / `material_close`（`duration_ms`）、每筆 `seq` | 「教材」分頁：開啟次數、平均互動、A→B 瀏覽順序、第一個開啟的教材；學生抽屜的逐筆歷程 |
| 4. 喜好（喜歡、取消喜歡、收藏） | `like` / `unlike` / `favorite` / `unfavorite` | 教材明細「目前喜歡／收藏人數」與取消次數；學生的目前喜好 |
| 5. 身分與工作階段 | 每筆事件都帶 `student_id`、`session_id`、毫秒 `ts` | 事件紀錄分頁、學生抽屜依工作階段分組 |
| 6. 透過 API 存到外部資料庫 | `POST /api/events`（批次、失敗時暫存 localStorage 重送、`event_id` 去重） | `data/framevr.db`，可匯出 events / sessions CSV |

**離開時間的判定**：收到 `session_end`（關分頁、離開頁面）就用那個時間；沒收到（當機、斷網、直接關機）就用最後一次心跳時間估算，誤差最多 30 秒。後台會標示哪些是估算的。

## 部署到 nckuchat.online（CloudPanel + PM2，與 nckuchat 相同流程）

後台網址：`https://nckuchat.online/framevr/`。跟 nckuchat 的 `app`（8080）共用同一台主機、同一個 root PM2，本系統用 3060。

| 項目 | 位置 |
|---|---|
| Git checkout（nckuchat 帳號擁有） | `/home/nckuchat/framevr2026-deploy` |
| 正式目錄（PM2 從這裡執行） | `/home/nckuchat/framevr2026` |
| 設定檔 | `/home/nckuchat/framevr2026/.env` |
| 資料庫 | `/home/nckuchat/framevr2026/data/framevr.db` |
| PM2 名稱 | `framevr-tracker` |

### 首次安裝（只做一次）

```bash
# 1. 用 nckuchat 帳號建立 checkout
sudo su - nckuchat -c "git clone https://github.com/yongliancai/frameVR2026.git /home/nckuchat/framevr2026-deploy"

# 2. 建立正式目錄與 .env
sudo mkdir -p /home/nckuchat/framevr2026
sudo cp /home/nckuchat/framevr2026-deploy/.env.example /home/nckuchat/framevr2026/.env
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"   # 產生 INGEST_KEY，貼進 .env
sudo nano /home/nckuchat/framevr2026/.env        # 填 INGEST_KEY、DASHBOARD_PASS；BASE_PATH=/framevr、PORT=3060 保持不變
sudo chmod 600 /home/nckuchat/framevr2026/.env

# 3. 第一次部署（之後每次更新也是這行）
cd /home/nckuchat/framevr2026-deploy
sudo ./deploy.sh
```

4. **Nginx**：CloudPanel → Sites → nckuchat.online → **Vhost**，把 `deploy/nginx-location.conf` 裡的兩個 `location` 區塊貼進有 `listen 443` 的 `server {` 區塊（例如 `location / {` 的上一行），按 Save。
5. 打開 `https://nckuchat.online/framevr/`，用 `.env` 的帳密登入。

> `/framevr` 路徑會交給本系統處理，nckuchat 的 `public/` 裡不要放同名資料夾。
>
> 第一次部署若卡在安裝 `better-sqlite3`（`node-gyp` 錯誤），先執行 `sudo apt install -y build-essential python3`，再跑一次 `sudo ./deploy.sh`。

### 之後的版本更新

```bash
# 本機改完 → git push 到 main，然後 SSH 進主機：
cd /home/nckuchat/framevr2026-deploy
sudo ./deploy.sh
```

`deploy.sh` 會依序：拉最新程式 → 備份資料庫（保留最近 14 份，在 `data/backups/`）→ 同步到正式目錄（不動 `.env`、`data/`、`logs/`）→ `package-lock.json` 有變才重裝套件 → PM2 reload → 健康檢查。

### 常用指令

```bash
sudo pm2 list                          # 同時看到 app（nckuchat）與 framevr-tracker
sudo pm2 logs framevr-tracker --lines 80
curl http://127.0.0.1:3060/framevr/api/health
```

> 想先看後台長什麼樣：在本機 `npm install` 後執行 `DB_PATH=./data/demo.db npm run seed`，再 `DB_PATH=./data/demo.db npm start`，開 `http://127.0.0.1:3060/`。

## 放進 FrameVR

### 第一步：探測環境（只做一次）

FrameVR 沒有公開 Frame Script 的完整 API 文件，所以先確認你的 Frame 裡能用哪些東西：

1. Frame 側欄綠色圖示列的 `<>`（Script Editor）→ 新增 Script → 貼上 `frame-script/probe.js`
2. 改上面的 `API_BASE`（`https://nckuchat.online/framevr`）、`INGEST_KEY`，儲存並重新進入 Frame
3. 隨意點幾個展板、模型、影片
4. 到後台「系統」分頁看探測結果：
   - `sceneFound`、`onPointerObservable` 要是 `true`，點擊紀錄才能運作
   - `BABYLON_GUI` 是 `true` 才會出現進場學號框與喜歡／收藏按鈕（`false` 時學號改用瀏覽器輸入框，喜好改用下方的小工具）
   - `fetch` 要是 `true`
   - `clicked` 裡的 `name` 就是物件名稱，下一步要用

確認完把 probe 刪掉。

### 第二步：安裝追蹤器

1. 新增 Script → 貼上 `frame-script/tracker.js`
2. 修改 `CONFIG`：
   - `API_BASE`：`https://nckuchat.online/framevr`（安裝腳本最後會印出）
   - `INGEST_KEY`：與 `.env` 相同
   - `FRAME_NAME`：這個空間的名稱（多個 Frame 共用同一個後台時用來區分）
   - `TARGETS`：把探測到的物件名稱對應成教材

```js
TARGETS: [
  { match: /^board_water/i, id: 'board-water-cycle', name: '展板：水循環', type: 'board', material: true },
  { match: 'Heart_Model',   id: 'model-heart',       name: '3D 模型：心臟', type: 'model', material: true },
  { match: 'btn_quiz',      id: 'btn-quiz',          name: '按鈕：小測驗', type: 'button' },
]
```

`match` 可以是完整名稱或正規表達式，會一路往父層物件找。`material: true` 的物件點擊後算「開啟教材」並開始計時；點另一份教材、按「✕ 關閉」或離開 Frame 時結束計時。單次互動上限 10 分鐘（`MAX_MATERIAL_MS`）。

`LOG_UNKNOWN_CLICKS: true` 時，沒在對照表裡的物件也會記成「其他」，可以在後台「點擊」分頁看名稱再補進來。

### 喜歡／收藏的兩種做法

- **內建按鈕（預設）**：學生開啟教材時，畫面下方出現「♡ 喜歡　☆ 收藏　✕ 關閉」。需要 `BABYLON_GUI` 可用。
- **網頁小工具（備案）**：在展板旁放一個 FrameVR「網頁瀏覽器」物件，網址填：
  ```
  https://nckuchat.online/framevr/widget/like.html?k=INGEST_KEY&id=board-water-cycle&name=水循環&frame=my-frame
  ```
  `id` 要和 TARGETS 的 `id` 一致，後台才會算在同一份教材上。小工具的事件不會被算成一次「使用」。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/events` | `{ "key": "...", "events": [ ... ] }`，一次最多 500 筆；也接受 `X-Api-Key` header |
| GET | `/api/overview` `/api/students` `/api/students/:id` `/api/materials` `/api/clicks` `/api/sequences` `/api/event-list` | 後台資料，可帶 `from`、`to`（YYYY-MM-DD）、`frame`、`student` |
| GET | `/api/export/events.csv`、`/api/export/sessions.csv` | CSV（含 BOM，Excel 直接開中文不會亂碼） |

事件欄位：

```json
{
  "event_id": "uuid（去重用）",
  "seq": 12,
  "type": "material_close",
  "student_id": "S0312",
  "session_id": "uuid（每次進入產生）",
  "frame": "science-museum",
  "target_id": "model-heart",
  "target_type": "model",
  "target_name": "3D 模型：心臟",
  "duration_ms": 48210,
  "ts": 1793102160094,
  "meta": { "reason": "switch", "clicks_inside": 2 }
}
```

## 研究使用注意

- 學生識別碼建議用座號或研究編號，不要用真實姓名；資料庫只存你在學號框輸入的字串。
- 正式施測前，先用自己的帳號走一遍，到「事件紀錄」確認每種事件都有進來。
- 備份：`data/framevr.db` 就是全部資料，可用 `sqlite3 data/framevr.db ".backup backup.db"` 線上備份。
