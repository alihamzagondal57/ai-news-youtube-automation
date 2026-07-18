#!/usr/bin/env bash
# GCE startup script — runs as root on every boot (the VM stops and restarts
# per render job, so setup must be idempotent, not a one-time step).
set -euo pipefail

REPO_URL="${repo_url}"
REPO_REF="${repo_ref}"
RENDER_SERVER_PORT="${render_server_port}"
APP_DIR="/opt/ai-news-youtube-automation"

log() { echo "[provision-vm] $*"; }

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  log "Installing ffmpeg and headless Chromium dependencies..."
  apt-get update
  apt-get install -y \
    ffmpeg \
    libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 fonts-liberation \
    libu2f-udev libvulkan1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  log "Cloning $REPO_URL@$REPO_REF into $APP_DIR..."
  git clone --branch "$REPO_REF" --depth 1 "$REPO_URL" "$APP_DIR"
else
  log "Repo already present, pulling latest $REPO_REF..."
  cd "$APP_DIR" && git fetch origin "$REPO_REF" --depth 1 && git checkout "$REPO_REF" && git reset --hard "origin/$REPO_REF"
fi

cd "$APP_DIR"
log "Installing workspace dependencies..."
npm ci

cat > /etc/systemd/system/render-server.service <<UNIT
[Unit]
Description=Remotion render-server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/infra/render-server
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$RENDER_SERVER_PORT
Environment=ENABLE_SELF_SHUTDOWN=true
EnvironmentFile=-$APP_DIR/infra/render-server/.env

[Install]
WantedBy=multi-user.target
UNIT

log "Enabling and starting render-server..."
systemctl daemon-reload
systemctl enable render-server
systemctl restart render-server

log "Provisioning complete."
