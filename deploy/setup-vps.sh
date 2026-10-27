#!/usr/bin/env bash
# =====================================================================
# FrameVR 行為紀錄系統：VPS 首次安裝（Ubuntu 22.04 / 24.04，例如 Hostinger VPS）
#
# 用法（以 root 或有 sudo 的使用者執行）：
#   curl -fsSL https://raw.githubusercontent.com/yongliancai/frameVR2026/main/deploy/setup-vps.sh -o setup-vps.sh
#   sudo bash setup-vps.sh framevr.你的網域.com 你的email@example.com
#
# 會做的事：安裝 Node.js 22、PM2、Nginx、Certbot → 下載程式 → 產生 .env（隨機金鑰與後台密碼）
#           → 啟動服務並設定開機自動啟動 → 設定 Nginx 與 HTTPS 憑證
# 可以重複執行，已存在的 .env 不會被覆蓋。
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
REPO_URL="${REPO_URL:-https://github.com/yongliancai/frameVR2026.git}"
APP_DIR="${APP_DIR:-/opt/framevr2026}"
APP_USER="${APP_USER:-${SUDO_USER:-root}}"
PORT="${PORT:-3060}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "用法：sudo bash setup-vps.sh <網域> <email>"
  echo "例如：sudo bash setup-vps.sh framevr.example.com me@example.com"
  exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "請用 sudo 執行"; exit 1; fi

step() { echo; echo "==== $* ===="; }

step "1/7 安裝系統套件"
apt-get update -y
apt-get install -y curl git nginx build-essential python3 certbot python3-certbot-nginx sqlite3

step "2/7 安裝 Node.js 22 與 PM2"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
command -v pm2 >/dev/null || npm install -g pm2

step "3/7 下載程式到 $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

step "4/7 安裝相依套件"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev && mkdir -p data logs"

step "5/7 建立 .env"
if [[ ! -f "$APP_DIR/.env" ]]; then
  INGEST_KEY=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
  DASH_PASS=$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")
  cat > "$APP_DIR/.env" <<EOF
PORT=$PORT
HOST=127.0.0.1
BASE_PATH=
INGEST_KEY=$INGEST_KEY
DASHBOARD_USER=admin
DASHBOARD_PASS=$DASH_PASS
ALLOWED_ORIGINS=*
TZ_OFFSET_MIN=480
EOF
  chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  NEW_ENV=1
else
  echo ".env 已存在，保留原設定"
  NEW_ENV=0
fi

step "6/7 用 PM2 啟動並設定開機自動啟動"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && (pm2 describe framevr-tracker >/dev/null 2>&1 && pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js) && pm2 save"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "$(eval echo ~"$APP_USER")" >/dev/null
systemctl enable "pm2-$APP_USER" >/dev/null 2>&1 || true

step "7/7 設定 Nginx 與 HTTPS"
sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$APP_DIR/deploy/nginx-subdomain.conf" > "/etc/nginx/sites-available/framevr2026"
ln -sf /etc/nginx/sites-available/framevr2026 /etc/nginx/sites-enabled/framevr2026
nginx -t
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full' || true; fi
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || {
  echo "!! HTTPS 憑證申請失敗：請確認 $DOMAIN 的 DNS A 紀錄已指向這台 VPS 的 IP，生效後重跑本腳本"
}

sleep 1
echo
echo "======================================================"
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null && echo "服務狀態：正常" || echo "服務狀態：異常，請看 pm2 logs framevr-tracker"
echo "後台網址：https://$DOMAIN/"
if [[ "$NEW_ENV" == "1" ]]; then
  echo "後台帳號：admin"
  echo "後台密碼：$DASH_PASS"
  echo "INGEST_KEY（貼到 tracker.js）：$INGEST_KEY"
  echo "以上資訊存在 $APP_DIR/.env，請另外記下來"
fi
echo "tracker.js 的 API_BASE：https://$DOMAIN"
echo "======================================================"
