#!/usr/bin/env bash
set -Eeuo pipefail

# FrameVR 行為紀錄系統部署腳本（與 nckuchat 的 deploy.sh 同一套流程）
# 伺服器上的 PM2 由 root 執行，Git checkout 由 nckuchat 帳號擁有。
# 在 checkout 目錄裡執行：sudo ./deploy.sh
DEPLOY_USER="nckuchat"
REPO_DIR="/home/nckuchat/framevr2026-deploy"
APP_DIR="/home/nckuchat/framevr2026"
PM2_APP="framevr-tracker"
HEALTH_URL="http://127.0.0.1:3060/framevr/api/health"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo ./deploy.sh" >&2
  exit 1
fi

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "Git checkout not found: ${REPO_DIR}" >&2
  exit 1
fi
if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "Production .env not found: ${APP_DIR}/.env" >&2
  echo "Refusing to deploy without the existing server configuration." >&2
  exit 1
fi
if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required but was not found." >&2
  exit 1
fi

printf '\n== Updating repository as %s ==\n' "${DEPLOY_USER}"
su - "${DEPLOY_USER}" -c "git -C '${REPO_DIR}' pull --ff-only origin main"

printf '\n== Backing up database ==\n'
if [[ -f "${APP_DIR}/data/framevr.db" ]]; then
  mkdir -p "${APP_DIR}/data/backups"
  BACKUP="${APP_DIR}/data/backups/framevr-$(date +%Y%m%d-%H%M%S).db"
  (cd "${APP_DIR}" && node -e "require('better-sqlite3')('data/framevr.db').backup(process.argv[1]).then(() => console.log('Backup: ' + process.argv[1]))" "${BACKUP}")
  ls -1t "${APP_DIR}"/data/backups/*.db 2>/dev/null | tail -n +15 | xargs -r rm --   # keep the latest 14
else
  echo "No database yet, skipping."
fi

printf '\n== Syncing files to production ==\n'
rsync -a \
  --exclude='/.git/' \
  --exclude='/.github/' \
  --exclude='/.env' \
  --exclude='/node_modules/' \
  --exclude='/data/' \
  --exclude='/logs/' \
  "${REPO_DIR}/" "${APP_DIR}/"

cd "${APP_DIR}"
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ ! -d node_modules || ! -f .deploy-lock-hash || "$(cat .deploy-lock-hash)" != "${LOCK_HASH}" ]]; then
  printf '\n== Installing dependencies ==\n'
  npm ci --omit=dev
  echo "${LOCK_HASH}" > .deploy-lock-hash
fi

printf '\n== Reloading PM2 application as root ==\n'
mkdir -p logs data
if pm2 describe "${PM2_APP}" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save >/dev/null

printf '\n== Checking application health ==\n'
for attempt in {1..10}; do
  if curl --fail --silent --show-error "${HEALTH_URL}"; then
    printf '\nDeployment completed successfully.\n'
    exit 0
  fi
  if [[ "${attempt}" -lt 10 ]]; then sleep 2; fi
done

echo "Deployment ran, but the health check did not pass. Check: pm2 logs ${PM2_APP} --lines 80" >&2
exit 1
