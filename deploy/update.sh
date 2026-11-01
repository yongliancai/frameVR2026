#!/usr/bin/env bash
# 在 VPS 上更新到 GitHub 最新版本：bash /opt/framevr2026/deploy/update.sh
# GitHub Actions 自動部署也是呼叫這支腳本。資料庫（data/）與 .env 不會被動到。
set -euo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$APP_DIR"

echo "==> 拉取最新程式"
git fetch --all --prune
git reset --hard origin/main

echo "==> 備份資料庫"
mkdir -p data/backups
if [[ -f data/framevr.db ]] && command -v sqlite3 >/dev/null; then
  sqlite3 data/framevr.db ".backup 'data/backups/framevr-$(date +%Y%m%d-%H%M%S).db'"
  ls -1t data/backups/*.db | tail -n +15 | xargs -r rm --   # 只保留最近 14 份
fi

echo "==> 安裝套件"
npm ci --omit=dev

echo "==> 重新啟動"
mkdir -p logs
pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
pm2 save >/dev/null

sleep 1
PORT=$(grep -E '^PORT=' .env | cut -d= -f2 || echo 3060)
BASE_PATH=$(grep -E '^BASE_PATH=' .env | cut -d= -f2 || true)
curl -fsS "http://127.0.0.1:${PORT:-3060}${BASE_PATH}/api/health" >/dev/null && echo "==> 更新完成，服務正常（$(git log -1 --format='%h %s')）"
