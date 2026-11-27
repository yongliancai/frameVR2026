# AI Agent 入口

本專案的工程規範在 **[ENGINEERING.md](ENGINEERING.md)**（唯一主要規範，本檔只是入口）。

- 驗證：`npm run check && npm test`（全部通過才可 commit）
- 禁止：未經負責人批准部署；commit 金鑰或 `.env`；刪除或放寬測試；把學生帳號 ID 或 email 給研究者角色
- 部署與回滾：只由負責人執行 `sudo ./deploy.sh`、`sudo ./deploy.sh --rollback`
