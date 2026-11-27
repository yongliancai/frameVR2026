# FrameVR 學習行為紀錄系統

FrameVR 物件的 **Action Editor →「API Call」** 把學生的行為送到你的伺服器 → SQLite 儲存 → 網頁後台視覺化與 CSV 匯出。不需要在 FrameVR 寫程式。

```
FrameVR（學生）                                   nckuchat.online/framevr（PM2 → Node/Express）
┌──────────────────────────────┐   API Call      ┌──────────────────────────────────────────┐
│ 進場 Nametag 輸入固定編號      │  ─────────────▶ │ /api/frame-action  金鑰驗證               │
│ 物件的 Action Editor：         │  X-API-Key      │   ↳ 切分工作階段、推算教材互動時間、喜好切換 │
│  出生點 Proximity → enter      │                 │ SQLite: events / sessions                 │
│  教材 Click → material         │                 │ /             後台網頁（帳密登入）          │
│  按鈕 Click → click/like/...   │                 │ /api/export   CSV 匯出                     │
└──────────────────────────────┘                 └──────────────────────────────────────────┘
```

> 2023 年曾有的 Frame Script（Script Editor）已不在目前版本的 FrameVR（v0.66）中，所以改用官方的 Action Editor「API Call」動作。

## 六項功能對應

| 需求 | 怎麼記錄 | 後台呈現 |
|---|---|---|
| 1. 使用時間（進入、離開、累積時長） | 出生點 Proximity → `enter`；出口 → `leave`（選用）；超過 15 分鐘沒動作自動視為離開 | 總覽 KPI、每日時長、學生表、每次使用時長條 |
| 2. 物件點擊（展板、3D 模型、影片、按鈕） | 每個物件 Click → `material` 或 `click`，`category` 標記類型 | 「點擊」分頁：前 15 名、依類型統計 |
| 3. 教材互動歷程（開啟次數、互動時間、先後順序） | 點教材＝開啟；開啟下一份、離開或逾時＝關閉並計算時長；每筆有 `seq` | 「教材」分頁：開啟次數、平均互動、A→B 瀏覽順序、第一個開啟的教材；學生的逐筆歷程 |
| 4. 喜好（喜歡、取消喜歡、收藏） | 教材旁的喜歡／收藏按鈕 Click → `like` / `favorite`，每按一次切換 | 教材明細「目前喜歡／收藏人數」與取消次數；學生的目前喜好 |
| 5. 身分與工作階段 | `%uniqueUserId%`（FrameVR 帳號，不跳同意視窗）；選用 `%email%`。研究者只看到代號 S001…；工作階段由伺服器切分，閒置 15 分鐘自動結算 | 學生分頁、事件紀錄、管理者「帳號與學生」 |
| 6. 透過 API 存到外部資料庫 | Action Editor「API Call」→ `POST /api/frame-action` | `data/framevr.db`，可匯出 events / sessions CSV |

**估算說明**（研究報告請註明）：FrameVR 沒有提供「離開」與「持續停留」的訊號，所以
- 離開時間＝點了出口／離開物件的時間；沒點的話＝最後一次動作的時間。
- 教材互動時間＝開啟到下一個教材／離開的時間（上限 10 分鐘）；開啟後就沒有任何動作的，時長記為未知、不列入平均。

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
sudo nano /home/nckuchat/framevr2026/.env        # 填 INGEST_KEY、ADMIN_USER、ADMIN_PASS；BASE_PATH=/framevr、PORT=3060 保持不變
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

## 在 FrameVR 設定（Action Editor）

後台的「**FrameVR 設定**」分頁有完整的 URL 與可一鍵複製的 Body 範本，以下是流程。

### 1. 在 FrameVR 新增 API 金鑰（只做一次）
FrameVR 右側選單 → **PROFILE** → 捲到最下面「**API Keys for Interactivity**」→ Add New API Key，值填伺服器 `.env` 的 `INGEST_KEY`（`sudo grep INGEST_KEY /home/nckuchat/framevr2026/.env`）。

### 2. 把物件取好名字
教材的名稱會直接成為後台的教材名稱（`%assetName%`），例如「水循環展板」「心臟模型」。可互動的物件類型：Model、Shape、Image、Text Label、Shader（影片可用封面圖片或旁邊的按鈕代替）。

### 3. 替每個物件加上 API Call
右側選單 → **FRAME SETTINGS → ACTION EDITOR** → 選物件 → **Add Trigger** → **Add Action → API Call**：

| 欄位 | 值 |
|---|---|
| URL | `https://nckuchat.online/framevr/api/frame-action` |
| HTTP Method | `POST` |
| HTTP Header Name | `X-API-Key` |
| API Key | 步驟 1 新增的金鑰 |
| POST/PUT Body | 依用途複製下表範本 |

| 物件 | 觸發 | Body 的 `event` |
|---|---|---|
| 出生點的透明方塊 | Proximity | `enter` |
| 展板／3D 模型／影片封面 | Click/Tap | `material`（`category` 填 `board` / `model` / `video`） |
| 一般互動按鈕 | Click/Tap | `click`（`category`: `button`） |
| 喜歡按鈕 | Click/Tap | `like`（`material` 填對應教材的物件名稱） |
| 收藏按鈕 | Click/Tap | `favorite`（同上） |
| 出口／結束按鈕（選用） | Click/Tap 或 Proximity | `leave` |

教材的 Body 範例（其他範本在後台複製）：
```json
{
  "event": "material",
  "category": "board",
  "user": "%uniqueUserId%",
  "frame": "%frameName%",
  "asset_id": "%assetId%",
  "asset_name": "%assetName%",
  "asset_type": "%assetType%"
}
```

設定完按 Action Editor 的 **Test**，到後台「FrameVR 設定」分頁最下方「最近收到的請求」確認有收到。

### 4. 學生進場
學生在 Connect 畫面的 **Nametag** 輸入固定編號（例如 `S01`）。第一次觸發時 FrameVR 會詢問是否同意分享名牌，請學生按同意；若沒填名牌或拒絕，會改用 FrameVR 帳號 ID（顯示為 `user:...`）。

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| POST / GET | `/api/frame-action` | FrameVR Action Editor 呼叫用。需 `X-API-Key` header（或 `?key=`）。欄位見下方 |
| POST | `/api/events` | 一般事件批次寫入 `{ "events": [ ... ] }`（自訂工具用） |
| GET | `/api/overview` `/api/students` `/api/students/:id` `/api/materials` `/api/clicks` `/api/sequences` `/api/event-list` | 後台資料，可帶 `from`、`to`（YYYY-MM-DD）、`frame`、`student` |
| GET | `/api/export/events.csv`、`/api/export/sessions.csv` | CSV（含 BOM，Excel 直接開中文不會亂碼） |

`/api/frame-action` 欄位：

| 欄位 | 說明 |
|---|---|
| `event` | `enter` `material` `click` `like` `favorite` `unlike` `unfavorite` `leave` |
| `user` | `%uniqueUserId%`，學生識別（請學生登入 FrameVR；未登入者記為 Guest） |
| `email` | （選用）`%email%`；FrameVR 會先詢問學生是否同意，只有管理者看得到 |
| `user` | `%uniqueUserId%` |
| `frame` `asset_id` `asset_name` `asset_type` | `%frameName%` `%assetId%` `%assetName%` `%assetType%` |
| `category` | 選填：`board` `model` `video` `button`；未填依 `asset_type` 推測 |
| `material` | 喜歡／收藏按鈕對應的教材物件名稱；未填就用學生目前開著的教材 |

回應範例：`{"ok":true,"student":"user:abc123","session_id":"…","recorded":["click","material_close","material_open"]}`

## 後台帳號與權限

| 角色 | 可以看 | 不能看 |
|---|---|---|
| 管理者 admin | 全部統計、FrameVR 設定、原始請求（摘要＋CSV）、帳號管理、學生 email 與帳號 ID、測試帳號標記 | — |
| 研究者 researcher | 統計分頁、Excel／CSV 下載（學生只有代號） | 設定、原始請求、email、帳號 ID（伺服器端回 403） |

第一個管理者由 `.env` 的 `ADMIN_USER` / `ADMIN_PASS` 在第一次啟動時建立；之後在「帳號與學生」新增研究者。

## 研究分析（後台「研究分析」分頁）

依沉浸式學習行為研究與博物館觀眾研究常用的方法，分成五類，每類附研究問題與建議方法：

| 分類 | 研究問題 | 指標／方法 |
|---|---|---|
| A 參與度 | 投入程度？與學習成效相關嗎？ | 次數、時長、廣度、深度、回訪、瞥過；合併前後測做相關／迴歸 |
| B 教材效能 | 哪些教材吸引人、留得住？ | 吸引力 %、停留力、瞥過率、%DV（Shettel 1973；Serrell 1998） |
| C 學習者類型 | 有哪些學習型態？ | 廣度 × 深度四型；Excel 原始指標可做 K-means |
| D 行為序列 | 哪些操作順序顯著？ | 滯後序列分析 LSA，調整後殘差 Z > 1.96（Bakeman & Quera 2011） |
| E 使用模式 | 用多久、從哪裡開始？ | 時長分布、首選教材 |

頁面最上方的「自動觀察」依資料自動產生描述性結果；樣本少時會提醒。

## 中英雙語

後台與登入頁右上角可切換「English／中文」（記在瀏覽器）。英文模式下，研究分析的自動觀察、分類說明與「下載 Excel」也都是英文；教材、物件與 Frame 名稱維持原本的名稱。

## 研究用 Excel

後台右上「下載 Excel（研究用）」依目前的日期與 Frame 篩選匯出：說明（Codebook、指標定義、LSA 編碼、參考文獻）、研究觀察、A 參與度與 C 類型、B 教材效能、D LSA 次數／Z 值／轉移清單、學生摘要、學生×教材、工作階段、教材摘要、瀏覽順序、事件明細；管理者版本另有「代號對照」。

## 研究使用注意

- 學生以 FrameVR 帳號識別，研究者只看到代號（S001…）；代號與 email／帳號 ID 的對照只有管理者看得到。
- 自己測試用的帳號請在「帳號與學生」勾選「測試帳號」，統計與匯出就會排除。
- 正式施測前，先用自己的帳號走一遍，到「事件紀錄」確認每種事件都有進來。
- 備份：`data/framevr.db` 就是全部資料，可用 `sqlite3 data/framevr.db ".backup backup.db"` 線上備份。
