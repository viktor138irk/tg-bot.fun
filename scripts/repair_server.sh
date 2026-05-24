#!/usr/bin/env bash
# BotFactory v2.2.0 — repair/update script for real API + frontend + bots
set -euo pipefail

APP_DIR="/opt/botfactory"
SRC_DIR="/opt/botfactory-src"
APP_USER="botfactory"
FRONT_DIR="${APP_DIR}/frontend"
BACK_DIR="${APP_DIR}/backend"
VENV="${APP_DIR}/venv"
API_PORT="8000"

ok(){ echo -e "\033[0;32m[✓]\033[0m $*"; }
warn(){ echo -e "\033[1;33m[!]\033[0m $*"; }
err(){ echo -e "\033[0;31m[✗]\033[0m $*"; }

[[ $EUID -eq 0 ]] || { err "Запустите от root: sudo bash scripts/repair_server.sh"; exit 1; }
[[ -d "$APP_DIR" ]] || { err "Нет ${APP_DIR}. Сначала установите BotFactory."; exit 1; }

mkdir -p "${APP_DIR}/logs" "${APP_DIR}/uploads" "${APP_DIR}/backups" "$BACK_DIR" "$FRONT_DIR"

if [[ -d "$SRC_DIR" ]]; then
  if [[ -d "$SRC_DIR/backend" ]]; then
    rsync -a --delete "${SRC_DIR}/backend/" "${BACK_DIR}/"
    ok "Backend синхронизирован из ${SRC_DIR}"
  fi
  if [[ -d "$SRC_DIR/frontend" ]]; then
    rsync -a --delete "${SRC_DIR}/frontend/" "${FRONT_DIR}/"
    ok "Frontend синхронизирован из ${SRC_DIR}"
  fi
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
chmod 755 /opt || true
chmod 755 "$APP_DIR" "$BACK_DIR" "$FRONT_DIR" 2>/dev/null || true
find "$BACK_DIR" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "$BACK_DIR" -type f -name '*.py' -exec chmod 644 {} \; 2>/dev/null || true
chmod 770 "${APP_DIR}/logs" "${APP_DIR}/uploads" "${APP_DIR}/backups" 2>/dev/null || true
[[ -f "${APP_DIR}/.env" ]] && { chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"; chmod 600 "${APP_DIR}/.env"; }
ok "Права исправлены"

if [[ -f "${BACK_DIR}/requirements.txt" && -x "${VENV}/bin/pip" ]]; then
  sudo -u "$APP_USER" "${VENV}/bin/pip" install -q -r "${BACK_DIR}/requirements.txt"
  ok "Python-зависимости проверены"
fi

if [[ -f "${FRONT_DIR}/package.json" ]]; then
  npm install --prefix "${FRONT_DIR}" --silent --no-fund --no-audit
  npm run build --prefix "${FRONT_DIR}" --silent
  [[ -f "${FRONT_DIR}/dist/index.html" ]] || { err "Frontend build failed: нет dist/index.html"; exit 1; }
  chown -R "${APP_USER}:${APP_USER}" "${FRONT_DIR}"
  chmod 755 "${FRONT_DIR}" "${FRONT_DIR}/dist"
  find "${FRONT_DIR}/dist" -type d -exec chmod 755 {} \;
  find "${FRONT_DIR}/dist" -type f -exec chmod 644 {} \;
  ok "Frontend пересобран"
fi

cat > /etc/systemd/system/botfactory-api.service <<SERVICE
[Unit]
Description=BotFactory API (FastAPI)
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=exec
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${BACK_DIR}
Environment=PYTHONPATH=${BACK_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${VENV}/bin/uvicorn main:app --host 127.0.0.1 --port ${API_PORT} --workers 1 --loop uvloop --log-level info
Restart=always
RestartSec=5
TimeoutStopSec=20
KillMode=mixed
StandardOutput=append:${APP_DIR}/logs/api.log
StandardError=append:${APP_DIR}/logs/api-error.log

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/systemd/system/botfactory-bots.service <<SERVICE
[Unit]
Description=BotFactory Bots Runner (platform + shops)
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target postgresql.service redis-server.service
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=exec
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${BACK_DIR}
Environment=PYTHONPATH=${BACK_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${VENV}/bin/python shop_bots_runner.py
Restart=always
RestartSec=10
TimeoutStopSec=20
KillMode=mixed
StandardOutput=append:${APP_DIR}/logs/bots.log
StandardError=append:${APP_DIR}/logs/bots-error.log

[Install]
WantedBy=multi-user.target
SERVICE
ok "systemd service-файлы обновлены"

if [[ -f /etc/nginx/sites-available/botfactory ]]; then
  nginx -t
  systemctl reload nginx || systemctl restart nginx
  ok "Nginx проверен и перезагружен"
else
  warn "Конфиг /etc/nginx/sites-available/botfactory не найден"
fi

systemctl daemon-reload
systemctl enable botfactory-api botfactory-bots >/dev/null 2>&1 || true
systemctl restart botfactory-api || true
sleep 2
systemctl restart botfactory-bots || true
sleep 2

ok "Статусы сервисов:"
systemctl --no-pager --full status botfactory-api || true
systemctl --no-pager --full status botfactory-bots || true

echo
ok "Проверка HTTP:"
curl -sS -i "http://127.0.0.1:${API_PORT}/api/health" || true
echo
curl -sS -I "http://127.0.0.1/" || true

echo
warn "Если бот молчит, пришлите вывод:"
echo "journalctl -u botfactory-bots -n 160 --no-pager"
echo "tail -n 160 ${APP_DIR}/logs/bots-error.log"
