# Claude 專案入口

本專案的工程規範在 **[ENGINEERING.md](ENGINEERING.md)**，開始任何修改前先讀它。

最重要的四條：
1. 正式部署（`sudo ./deploy.sh`）每次都要負責人明確批准，並由負責人在主機上執行；你只能 push。
2. 不得把金鑰、密碼或 `.env` 放進 repo；不得自己填寫金鑰。
3. 改完執行 `npm run check && npm test`，全部通過才能 commit；不可刪除或放寬測試來讓它通過。
4. 給研究者的資料只能出現學生代號（S001…），權限要在伺服器端檢查。
