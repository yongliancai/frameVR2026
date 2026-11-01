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

## 部署到 VPS（Hostinger 等 Ubuntu 主機）

### 1. 選擇網址

| 掛法 | 網址範例 | 需要先做 |
|---|---|---|
| **子路徑（建議）** | `https://nckuchat.online/framevr/` | 不用改 DNS，沿用網站現有的 HTTPS 憑證 |
| 獨立子網域 | `https://framevr.nckuchat.online/` | DNS 新增 A 紀錄 `framevr` → VPS 的 IP |

### 2. 首次安裝（SSH 進 VPS 執行一次）

```bash
ssh root@VPS的IP
curl -fsSL https://raw.githubusercontent.com/yongliancai/frameVR2026/main/deploy/setup-vps.sh -o setup-vps.sh

# 子路徑：
sudo bash setup-vps.sh nckuchat.online 你的email /framevr
# 或子網域：
# sudo bash setup-vps.sh framevr.nckuchat.online 你的email
```

腳本會安裝 Node.js 22 與 PM2，產生 `.env`，最後印出**後台密碼**與 **INGEST_KEY**，請記下來（也存在 `/opt/framevr2026/.env`）。

**子路徑模式不會動到網站原本的內容**：轉送規則存成 `/etc/nginx/snippets/framevr2026.conf`，網站設定裡只需要多一行 `include`。

- **CloudPanel 主機（nckuchat.online 就是）**：腳本不會直接改 Nginx 檔案，因為 CloudPanel 會在介面存檔時覆蓋它們。跑完後腳本會提示最後一步：到 CloudPanel → Sites → nckuchat.online → **Vhost**，在 `listen 443` 那個 `server {` 區塊內（例如 `location / {` 上一行）貼上 `include /etc/nginx/snippets/framevr2026.conf;`，再按 Save。
  - PM2 會用 root 執行，跟 nckuchat 的 `app` 在同一個 PM2 裡，`sudo pm2 list` 可以同時看到 `app`（8080）和 `framevr-tracker`（3060）。
  - 不會另外安裝 Nginx 或 Certbot，沿用 CloudPanel 的 Nginx 和 HTTPS 憑證。
- **一般 Ubuntu 主機**：腳本會自動在網域的 `server { }` 區塊加 `include`，修改前先備份，`nginx -t` 檢查失敗就自動還原。
- 預設使用連接埠 3060。如果已經被其他服務佔用，腳本會停下來，改用 `PORT=3070 sudo -E bash setup-vps.sh ...`。
- 原本網站的 `/framevr` 路徑會交給本系統處理，請確認原網站沒有用到它。

> repo 若設為 Private，VPS 無法直接 clone：先在 VPS 執行 `ssh-keygen -t ed25519`，把 `~/.ssh/id_ed25519.pub` 加到 GitHub repo → Settings → Deploy keys，再用
> `REPO_URL=git@github.com:yongliancai/frameVR2026.git sudo -E bash setup-vps.sh ...`

### 3. 之後的版本更新

改完程式 `git push` 到 main 後，二選一：

- **手動**：SSH 進 VPS 執行 `bash /opt/framevr2026/deploy/update.sh`（會先備份資料庫，保留最近 14 份）
- **自動**：設定 GitHub Actions（`.github/workflows/deploy.yml`），每次 push 自動檢查並部署
  1. 在 VPS 產生部署用金鑰：`ssh-keygen -t ed25519 -f ~/.ssh/gh_deploy -N ""`，再 `cat ~/.ssh/gh_deploy.pub >> ~/.ssh/authorized_keys`
  2. GitHub repo → Settings → Secrets and variables → Actions：
     - Secrets：`VPS_HOST`＝VPS IP、`VPS_USER`＝root（或你的帳號）、`VPS_SSH_KEY`＝`cat ~/.ssh/gh_deploy` 的完整內容
     - Variables：`DEPLOY_ENABLED`＝`true`

資料庫 `data/` 與 `.env` 不在 git 裡，更新不會覆蓋。

### 常用指令

```bash
sudo pm2 status                 # 服務狀態
sudo pm2 logs framevr-tracker   # 即時日誌
nano /opt/framevr2026/.env      # 改設定後執行 sudo pm2 reload framevr-tracker --update-env
```

> 想先看後台長什麼樣：`DB_PATH=./data/demo.db npm run seed` 產生示範資料，再 `DB_PATH=./data/demo.db npm start`。

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
