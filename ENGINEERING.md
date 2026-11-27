# 工程規範（FrameVR 學習行為紀錄系統）

> 本檔是本專案**唯一的主要工程規範**。`CLAUDE.md`、`AGENTS.md` 只是指向這裡的入口，內容以本檔為準。
> 方法論依據：《AI Code Factory Guide v2.0》。修改本檔請在 commit 說明原因。

## 1. 先讀這三件事

1. **正式部署每次都要專案負責人明確批准**，由負責人在主機上執行 `sudo ./deploy.sh`。AI 或協作者只能 push 到 GitHub，不能部署，也不能說「已部署」。
2. **不得把金鑰或密碼放進 repo**（INGEST_KEY、ADMIN_PASS、FRAME_API_KEY、`.env`）。CI 的 `npm run check` 會攔截。曾發生過金鑰外流到公開 GitHub（commit 7d36957）。
3. **改完一定要跑 `npm run check && npm test`**，全部通過才可以 commit 到 main。測試失敗時不可刪測試、跳過測試或放寬斷言來讓它通過；要修程式，或說明為什麼需求變了。

## 2. 架構地圖

```
FrameVR 物件 ─Click/Tap→ Action Editor「API Call」
   POST /framevr/api/frame-action  (X-API-Key = INGEST_KEY)
        │
server.js ── checkIngestKey ──> src/frameAction.js  推算工作階段、教材開關、喜好、去重
        │                            └─> src/ingest.js   寫入 events / sessions / students
        │                            └─> src/probes.js   原始請求紀錄（有上限）
        ├── 每分鐘 closeIdleSessions()                     結算閒置逾時的工作階段
        └── 後台 /framevr/  (src/auth.js 登入，admin / researcher)
               ├─ src/stats.js     統計查詢（自動排除測試帳號）
               ├─ src/students.js  身分轉換：研究者只看到代號 S001…
               ├─ src/analysis.js  研究分析 A–E（參與度、教材效能、學習者類型、LSA、使用模式）
               ├─ src/research.js  研究用 Excel（src/xlsx.js 產生 .xlsx）
               └─ public/          原生 JS 後台（app.js、login.html、i18n.js 中英切換）
SQLite：data/framevr.db（WAL，單一程序寫入；PM2 instances 必須維持 1）
```

| 邊界 | 規則 |
|---|---|
| 收集 API ↔ 後台 | 收集 API 只認 INGEST_KEY；後台只認登入 Cookie。兩者不可互通 |
| admin ↔ researcher | **權限一律在伺服器端檢查**（`auth.requireAdmin`），前端隱藏分頁只是方便，不算防護 |
| 學生身分 | 任何給研究者的回應或匯出都必須經過 `students.relabel()` 或只輸出代號；不得出現 `user:`、email。新增 API 時要把路徑加進 `test/auth.test.js` 的不外洩清單 |
| 資料庫結構 | 只做新增式變更（`CREATE TABLE IF NOT EXISTS`、新增欄位），不刪、不改既有欄位；升級邏輯寫在 `src/db.js` 並有 `test/migration.test.js` |
| 套件 | 優先用 Node 內建功能。新增套件前要說明理由（目前刻意不用 Jest、ESLint、exceljs） |

## 3. 資料推算規則（改這些要同步改 Codebook 與測試）

| 項目 | 規則 | 設定 | 測試 |
|---|---|---|---|
| 工作階段 | 同一學生超過 N 分鐘沒動作，下一個動作算新的一次；伺服器每分鐘巡檢結算 | `SESSION_GAP_MIN=15` | R-01、不變量 |
| 教材互動時間 | 開啟 → 開啟下一份／離開／逾時；單次上限 | `MAX_MATERIAL_MIN=10` | 切換測試、不變量 |
| 連點去重 | 同一學生、同一物件、同一動作在 N 毫秒內只算一次 | `DEDUPE_MS=1000` | R-02 |
| 喜歡／收藏 | 每按一次切換 | — | 喜歡切換、不變量 |
| 學生代號 | 依第一次出現順序 S001…，不跳號、不重編 | — | 代號連續、migration |
| 測試帳號 | admin 勾選後所有統計與匯出排除，資料保留 | — | 排除測試 |
| 學生 email | Body 帶 `%email%`（FrameVR 會先詢問學生）；只存在 students 表，只有 admin 看得到 | `COLLECT_EMAIL`（預設 1，只影響後台範本） | email 測試 |
| 研究分析 | 瞥過 < 10 秒；開過教材 ≥ 4 人才分型（廣度 × 深度中位數）；LSA 調整後殘差 Z > 1.96，轉移 < 30 筆標示樣本太少 | `src/analysis.js` 的 CONFIG | `test/analysis.test.js`（含手算 Z = 2.45） |

**不變量**（`test/invariants.test.js` 以 300 組隨機序列檢查）：
- seq 在工作階段內唯一遞增。
- 每個工作階段以 session_start 開始。
- 同時最多一份教材開著。
- 互動時間介於 0 和上限之間。
- 巡檢後沒有未關閉的教材，也沒有未結束的工作階段。
- 喜歡與取消喜歡交替出現。

## 3.5 雙語（中文／English）

- 介面預設中文，右上「English」切換，記在瀏覽器（localStorage）。
- 靜態文字：在 `public/i18n.js` 的 `EN` 字典加「整段中文 → 英文」，畫面產生後自動替換；資料（教材、物件、Frame 名稱、email）不翻譯。
- 動態組合的文字（數字＋單位、圖表、提示）：在 `app.js` 用 `L(中文, English)` 寫兩種版本。
- 伺服器產生的文字（研究分析的觀察與分類、Excel）：API 帶 `lang=en`，在 `src/analysis.js`、`src/research.js` 用 `L()`。
- **新增任何介面文字都要同時給英文**；`test/i18n.test.js` 會檢查伺服器英文輸出與字典，`scripts/check-i18n-ui.js` 檢查畫面。

## 4. 驗證指令

| 指令 | 內容 | 何時跑 |
|---|---|---|
| `npm run check` | 語法檢查（全部 JS＋deploy.sh）＋秘密掃描 | 每次 commit 前；CI |
| `npm test` | 39 項：推算邏輯、回歸（R-01～R-12）、不變量、HTTP 黑箱、權限、Excel、DB 升級、研究分析、英文版 | 每次 commit 前；CI；deploy.sh 部署前 |
| CI（`.github/workflows/check.yml`） | Node 20（正式）與 22 各跑一次以上兩項，並實際啟動伺服器打 `/api/frame-action` | 每次 push |
| UI 檢查 | 用 Playwright 以 admin 與 researcher 各登入一次，確認分頁可見性、沒有 console error | 改 `public/` 時 |
| 英文介面檢查 | `node scripts/check-i18n-ui.js <網址> <帳號> <密碼>`：切英文走過所有分頁，列出未翻譯的文字（需 Playwright，用法見檔頭） | 改 `public/` 的文字時 |

秘密掃描的例外：只有明確的假值可以在同一行加 `secret-scan: allow` 註記，並寫出原因。

## 5. 修 bug 的流程

依手冊 08 的循環：**重現 → 寫一個會失敗的測試（red）→ 修 → 測試通過（green）→ 記錄在下表**。
不是每個 bug 都要新增規則；一次性、低風險的問題修好即可。

| ID | 問題 | 防護 | 位置 |
|---|---|---|---|
| R-01 | 最後一份教材沒有互動時間、工作階段不結束 | 每分鐘巡檢＋回歸測試＋不變量 | `frameAction.closeIdleSessions`、`test/frameAction.test.js` |
| R-02 | 連點重複計數 | 去重＋回歸測試 | `frameAction.isDuplicate` |
| R-03 | 錯誤金鑰可無限寫入 | 記錄上限＋每 IP 速率限制＋HTTP 測試 | `server.checkIngestKey`、`src/probes.js` |
| R-04 | 研究者看得到設定 | 伺服器端 403＋權限測試 | `src/auth.js`、`test/auth.test.js` |
| R-08 | CI 與正式 Node 版本不同 | CI 矩陣 Node 20／22 | `.github/workflows/check.yml` |
| R-09 | 金鑰可放網址 | 不接受 `?key=`＋測試 | `server.checkIngestKey` |
| R-11 | 學生代號跳號（INSERT OR IGNORE 消耗 AUTOINCREMENT） | NOT EXISTS 寫法＋回歸測試 | `src/ingest.js`、`src/db.js` |
| R-12 | 原始 ID 長得像代號（例如 S0314）時被誤判，學生抽屜空白 | 依角色解讀學生參數（admin 先找原始 ID，researcher 只認代號）＋回歸測試 | `students.resolveParam`、`server.js` 的 `Q(req)` |
| 部署 Node 版本 | root 直接執行 deploy.sh 用到另一個 Node，原生模組不符 | deploy.sh 固定系統 PATH 並印出 Node 版本 | `deploy.sh` |
| 金鑰外流 | 金鑰被 commit | `scripts/check-secrets.js`（CI＋deploy 前） | — |

## 6. 部署與回滾（只由負責人執行）

```bash
cd /home/nckuchat/framevr2026-deploy
sudo ./deploy.sh              # 更新到 main 最新版
sudo ./deploy.sh --rollback   # 回到上一次成功部署的版本
```

deploy.sh 的流程：
1. git pull
2. **在 checkout 目錄跑 `npm run check` 與 `npm test`，失敗就停止，正式環境不動**
3. 備份 DB（檔名含版本號，保留 14 份）
4. rsync
5. pm2 reload
6. health check
7. 記錄 `.deployed-commit` 和 `.previous-commit`

資料庫還原：停止 PM2，把 `data/backups/` 裡對應的備份複製回 `data/framevr.db`，再啟動。這會丟失備份之後的資料，必須由負責人決定。

## 7. AI 協作者的權限

| 行為 | 處置 |
|---|---|
| 讀程式、跑測試、在本機或暫存環境啟動伺服器 | 可自行進行 |
| 修改程式、新增測試、push 到 GitHub（包含 main） | 在負責人已批准的任務範圍內可自行進行；範圍外先問 |
| 正式部署、操作正式資料庫、改主機設定 | **每次都要負責人明確批准，並由負責人執行** |
| 填寫或讀取金鑰、密碼 | 不可以；由負責人自己處理 |
| 刪除資料、刪除測試、降低檢查門檻 | 需要專項批准並說明理由 |
