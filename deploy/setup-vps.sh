#!/usr/bin/env bash
# =====================================================================
# FrameVR 行為紀錄系統：VPS 首次安裝（Ubuntu 22.04 / 24.04，例如 Hostinger VPS）
#
# 兩種掛法（以 root 或有 sudo 的使用者執行）：
#
#   A. 掛在既有網站的子路徑（例如 https://nckuchat.online/framevr/）
#      sudo bash setup-vps.sh nckuchat.online 你的email /framevr
#      → 不新建站台、不動既有網站的其他設定，只在該網站的 Nginx server 區塊加一行 include
#
#   B. 獨立子網域（例如 https://framevr.nckuchat.online/）
#      sudo bash setup-vps.sh framevr.nckuchat.online 你的email
#      → 新建 Nginx 站台並申請 HTTPS 憑證（需先把子網域 DNS 指到 VPS）
#
# 下載：curl -fsSL https://raw.githubusercontent.com/yongliancai/frameVR2026/main/deploy/setup-vps.sh -o setup-vps.sh
# 可以重複執行，已存在的 .env 不會被覆蓋（只會更新 BASE_PATH）。
# =====================================================================
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
BASE_PATH="${3:-}"
REPO_URL="${REPO_URL:-https://github.com/yongliancai/frameVR2026.git}"
APP_DIR="${APP_DIR:-/opt/framevr2026}"
APP_USER="${APP_USER:-${SUDO_USER:-root}}"
PORT="${PORT:-3060}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "用法：sudo bash setup-vps.sh <網域> <email> [子路徑]"
  echo "  子路徑：sudo bash setup-vps.sh nckuchat.online me@example.com /framevr"
  echo "  子網域：sudo bash setup-vps.sh framevr.nckuchat.online me@example.com"
  exit 1
fi
if [[ $EUID -ne 0 ]]; then echo "請用 sudo 執行"; exit 1; fi
if [[ -n "$BASE_PATH" ]]; then
  BASE_PATH="/${BASE_PATH#/}"; BASE_PATH="${BASE_PATH%/}"
  [[ "$BASE_PATH" =~ ^/[A-Za-z0-9._-]+$ ]] || { echo "子路徑只能是一層英數字，例如 /framevr"; exit 1; }
fi
PUBLIC_URL="https://$DOMAIN$BASE_PATH"

step() { echo; echo "==== $* ===="; }

step "1/7 安裝系統套件"
apt-get update -y
apt-get install -y curl git nginx build-essential python3 sqlite3 iproute2
[[ -z "$BASE_PATH" ]] && apt-get install -y certbot python3-certbot-nginx

step "2/7 安裝 Node.js 22 與 PM2"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v
command -v pm2 >/dev/null || npm install -g pm2

# 連接埠被其他程式（例如 AI 伴侶）占用就停下
if ss -ltnp 2>/dev/null | grep -q ":$PORT " && ! ss -ltnp 2>/dev/null | grep ":$PORT " | grep -q node; then
  echo "!! 連接埠 $PORT 已被其他程式使用，請改用：PORT=3070 sudo -E bash setup-vps.sh ..."; exit 1
fi

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
NEW_ENV=0
if [[ ! -f "$APP_DIR/.env" ]]; then
  INGEST_KEY=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
  DASH_PASS=$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")
  cat > "$APP_DIR/.env" <<EOF
PORT=$PORT
HOST=127.0.0.1
BASE_PATH=$BASE_PATH
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
  echo ".env 已存在，保留原設定，只更新 BASE_PATH=$BASE_PATH"
  sed -i "s#^BASE_PATH=.*#BASE_PATH=$BASE_PATH#" "$APP_DIR/.env"
  PORT=$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2)
fi

step "6/7 用 PM2 啟動並設定開機自動啟動"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && (pm2 describe framevr-tracker >/dev/null 2>&1 && pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js) && pm2 save"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "$(eval echo ~"$APP_USER")" >/dev/null
systemctl enable "pm2-$APP_USER" >/dev/null 2>&1 || true

step "7/7 設定 Nginx"
NGINX_NOTE=""
if [[ -n "$BASE_PATH" ]]; then
  # ---- 子路徑：在既有網站的 server 區塊加 include ----
  mkdir -p /etc/nginx/snippets
  SNIPPET=/etc/nginx/snippets/framevr2026.conf
  sed -e "s#__BASE_PATH__#$BASE_PATH#g" -e "s#__PORT__#$PORT#g" "$APP_DIR/deploy/nginx-location.conf" > "$SNIPPET"
  INCLUDE_LINE="include $SNIPPET;"

  # 找出 server_name 含這個網域的設定檔（優先找有 443 的）
  mapfile -t FILES < <(grep -rlsE "server_name[^;]*[[:space:]]$DOMAIN([[:space:]]|;)" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | xargs -r readlink -f | sort -u)
  if [[ ${#FILES[@]} -eq 0 ]]; then
    NGINX_NOTE="找不到 $DOMAIN 的 Nginx 設定檔，請手動在該網站的 server { } 區塊（HTTPS 那個）裡加一行：$INCLUDE_LINE"
  else
    for F in "${FILES[@]}"; do
      if grep -qF "$INCLUDE_LINE" "$F"; then echo "已設定：$F"; continue; fi
      BACKUP="$F.bak-framevr-$(date +%Y%m%d%H%M%S)"
      cp "$F" "$BACKUP"
      # 在每個符合網域的 server_name 那行後面插入 include
      sed -i -E "/server_name[^;]*[[:space:]]$DOMAIN([[:space:]]|;)/a\\    $INCLUDE_LINE" "$F"
      if nginx -t 2>/dev/null; then
        echo "已加入：$F（備份在 $BACKUP）"
      else
        cp "$BACKUP" "$F"
        NGINX_NOTE="自動修改 $F 失敗，已還原。請手動在 server { } 區塊裡加一行：$INCLUDE_LINE"
      fi
    done
  fi
  nginx -t && systemctl reload nginx
  if [[ -d /home/clp ]] || command -v clpctl >/dev/null 2>&1; then
    NGINX_NOTE="${NGINX_NOTE}
偵測到 CloudPanel：之後若在 CloudPanel 介面儲存 Vhost，手動加的行可能被覆蓋。
請到 CloudPanel → Sites → $DOMAIN → Vhost，確認裡面有：$INCLUDE_LINE"
  fi
else
  # ---- 子網域：新建站台 + HTTPS ----
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$APP_DIR/deploy/nginx-subdomain.conf" > "/etc/nginx/sites-available/framevr2026"
  ln -sf /etc/nginx/sites-available/framevr2026 /etc/nginx/sites-enabled/framevr2026
  nginx -t
  systemctl reload nginx
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 'Nginx Full' || true; fi
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect || {
    NGINX_NOTE="HTTPS 憑證申請失敗：請確認 $DOMAIN 的 DNS A 紀錄已指向這台 VPS 的 IP，生效後重跑本腳本"
  }
fi

sleep 1
echo
echo "======================================================"
curl -fsS "http://127.0.0.1:$PORT$BASE_PATH/api/health" >/dev/null && echo "服務狀態：正常" || echo "服務狀態：異常，請看 pm2 logs framevr-tracker"
curl -fsS -o /dev/null "$PUBLIC_URL/api/health" 2>/dev/null && echo "對外網址：可連線" || echo "對外網址：目前連不到 $PUBLIC_URL/api/health，請看下方提示"
echo "後台網址：$PUBLIC_URL/"
if [[ "$NEW_ENV" == "1" ]]; then
  echo "後台帳號：admin"
  echo "後台密碼：$DASH_PASS"
  echo "INGEST_KEY（貼到 tracker.js）：$INGEST_KEY"
  echo "以上資訊存在 $APP_DIR/.env，請另外記下來"
fi
echo "tracker.js 的 API_BASE：$PUBLIC_URL"
[[ -n "$NGINX_NOTE" ]] && { echo; echo "!! $NGINX_NOTE"; }
echo "======================================================"
