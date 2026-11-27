#!/usr/bin/env bash
set -Eeuo pipefail

# FrameVR 行為紀錄系統部署腳本（與 nckuchat 的 deploy.sh 同一套流程）
# 伺服器上的 PM2 由 root 執行，Git checkout 由 nckuchat 帳號擁有。
#
#   sudo ./deploy.sh                 更新到 GitHub main 最新版
#   sudo ./deploy.sh --rollback      回到上一次部署成功的版本
#   sudo ./deploy.sh --rollback <commit>  回到指定版本
#
# 部署前一定會先在 checkout 目錄跑 npm test；測試失敗就停止，正式環境完全不動。
# 整個腳本包在 main() 裡：bash 會先讀完整個函式才執行，所以 git pull 更新本檔時不會讀到一半的新內容
main() {
# 固定使用系統路徑（與 sudo 的 secure_path 相同），避免 root 的 nvm 等設定換成另一個 Node 版本，
# 造成 better-sqlite3 原生模組版本不符（2026-11-28 發生過：root 直接執行時用到 Node 22，正式環境是 Node 20）
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
DEPLOY_USER="${DEPLOY_USER:-nckuchat}"
REPO_DIR="${REPO_DIR:-/home/nckuchat/framevr2026-deploy}"
APP_DIR="${APP_DIR:-/home/nckuchat/framevr2026}"
PM2_APP="framevr-tracker"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3060/framevr/api/health}"

MODE="deploy"
TARGET=""
if [[ "${1:-}" == "--rollback" ]]; then MODE="rollback"; TARGET="${2:-}"; fi

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
echo "Using Node $(node -v) at $(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "Node.js 20 or newer is required (found $(node -v))." >&2
  exit 1
fi

as_user() { su - "${DEPLOY_USER}" -c "$1"; }

# 依 lockfile 與 Node 版本決定要不要重裝套件（原生模組 better-sqlite3 需要配合 Node 版本）
install_deps() {
  local dir="$1" run="$2"
  local hash
  hash="$(sha256sum "${dir}/package-lock.json" | cut -d' ' -f1)-node$(node -v)"
  if [[ ! -d "${dir}/node_modules" || ! -f "${dir}/.deploy-lock-hash" || "$(cat "${dir}/.deploy-lock-hash")" != "${hash}" ]]; then
    printf '\n== Installing dependencies in %s ==\n' "${dir}"
    echo "If no prebuilt SQLite binary matches this Node version, it is compiled from source."
    echo "That can take 2-5 minutes with no output. Please wait; do not press Ctrl+C."
    ${run} "cd '${dir}' && npm ci --omit=dev && echo '${hash}' > .deploy-lock-hash"
  fi
}

PREV_COMMIT="$(cat "${APP_DIR}/.deployed-commit" 2>/dev/null || true)"

if [[ "${MODE}" == "deploy" ]]; then
  printf '\n== Updating repository as %s ==\n' "${DEPLOY_USER}"
  as_user "git -C '${REPO_DIR}' checkout -q main && git -C '${REPO_DIR}' pull --ff-only origin main"
else
  if [[ -z "${TARGET}" ]]; then
    TARGET="$(cat "${APP_DIR}/.previous-commit" 2>/dev/null || true)"
    if [[ -z "${TARGET}" ]]; then echo "No previous deployment recorded; use: sudo ./deploy.sh --rollback <commit>" >&2; exit 1; fi
  fi
  printf '\n== Rolling back to %s ==\n' "${TARGET}"
  as_user "git -C '${REPO_DIR}' fetch -q origin && git -C '${REPO_DIR}' checkout -q --detach '${TARGET}'"
fi
NEW_COMMIT="$(git -C "${REPO_DIR}" rev-parse --short HEAD)"
echo "Version to deploy: ${NEW_COMMIT}（目前正式環境：${PREV_COMMIT:-未知}）"

printf '\n== Running tests before touching production ==\n'
install_deps "${REPO_DIR}" as_user
if [[ -f "${REPO_DIR}/scripts/check-secrets.js" ]]; then
  if ! as_user "cd '${REPO_DIR}' && npm run -s check && npm test >/tmp/framevr-deploy-test.log 2>&1"; then
    echo "Tests FAILED. Production was NOT changed. Log: /tmp/framevr-deploy-test.log" >&2
    tail -n 40 /tmp/framevr-deploy-test.log >&2 || true
    exit 1
  fi
  echo "All checks passed."
else
  echo "This version has no test suite (older than the engineering setup); skipping tests."
fi

printf '\n== Backing up database ==\n'
if [[ -f "${APP_DIR}/data/framevr.db" ]]; then
  mkdir -p "${APP_DIR}/data/backups"
  BACKUP="${APP_DIR}/data/backups/framevr-$(date +%Y%m%d-%H%M%S)-before-${NEW_COMMIT}.db"
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
  --exclude='/test/' \
  --exclude='/.deploy-lock-hash' \
  --exclude='/.deployed-commit' \
  --exclude='/.previous-commit' \
  "${REPO_DIR}/" "${APP_DIR}/"

cd "${APP_DIR}"
install_deps "${APP_DIR}" "bash -c"

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
  if curl --fail --silent "${HEALTH_URL}"; then
    if [[ -n "${PREV_COMMIT}" && "${PREV_COMMIT}" != "${NEW_COMMIT}" ]]; then echo "${PREV_COMMIT}" > "${APP_DIR}/.previous-commit"; fi
    echo "${NEW_COMMIT}" > "${APP_DIR}/.deployed-commit"
    printf '\nDeployment completed successfully: %s\n' "${NEW_COMMIT}"
    [[ -n "${PREV_COMMIT}" ]] && echo "To undo: sudo ./deploy.sh --rollback   (back to ${PREV_COMMIT})"
    exit 0
  fi
  if [[ "${attempt}" -lt 10 ]]; then sleep 2; fi
done

echo "Deployment ran, but the health check did not pass. Recent error log:" >&2
pm2 logs "${PM2_APP}" --err --lines 30 --nostream >&2 || true
echo "Full log: pm2 logs ${PM2_APP} --lines 80" >&2
[[ -n "${PREV_COMMIT}" ]] && echo "To return to the last working version: sudo ./deploy.sh --rollback" >&2
exit 1
}

main "$@"
