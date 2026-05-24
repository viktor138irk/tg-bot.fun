#!/usr/bin/env bash
# BotFactory v2.1.1 — emergency repair for nginx 500 + service diagnostics
set -euo pipefail

APP_DIR="/opt/botfactory"
SRC_DIR="/opt/botfactory-src"
APP_USER="botfactory"
FRONT_DIR="${APP_DIR}/frontend"
API_PORT="8000"

ok(){ echo -e "\033[0;32m[✓]\033[0m $*"; }
warn(){ echo -e "\033[1;33m[!]\033[0m $*"; }
err(){ echo -e "\033[0;31m[✗]\033[0m $*"; }

[[ $EUID -eq 0 ]] || { err "Запустите от root: sudo bash scripts/repair_server.sh"; exit 1; }
[[ -d "$APP_DIR" ]] || { err "Нет ${APP_DIR}. Сначала установите BotFactory."; exit 1; }

mkdir -p "${APP_DIR}/logs" "${APP_DIR}/uploads" "${APP_DIR}/backups"

if id "$APP_USER" >/dev/null 2>&1; then
  chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
else
  warn "Пользователь ${APP_USER} не найден"
fi

# Важно: nginx должен пройти по /opt/botfactory и читать frontend/dist.
chmod 755 /opt || true
chmod 755 "$APP_DIR"
chmod 755 "${APP_DIR}/frontend" 2>/dev/null || true
chmod 755 "${APP_DIR}/frontend/dist" 2>/dev/null || true
find "${APP_DIR}/frontend/dist" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "${APP_DIR}/frontend/dist" -type f -exec chmod 644 {} \; 2>/dev/null || true
chmod 755 "${APP_DIR}/backend" 2>/dev/null || true
find "${APP_DIR}/backend" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "${APP_DIR}/backend" -type f -name '*.py' -exec chmod 644 {} \; 2>/dev/null || true
chmod 770 "${APP_DIR}/logs" "${APP_DIR}/uploads" "${APP_DIR}/backups" 2>/dev/null || true
[[ -f "${APP_DIR}/.env" ]] && chmod 600 "${APP_DIR}/.env"
ok "Права исправлены"

if [[ -d "$SRC_DIR" ]]; then
  if [[ -d "$SRC_DIR/backend" ]]; then
    rsync -a --delete "${SRC_DIR}/backend/" "${APP_DIR}/backend/"
    ok "Backend синхронизирован из ${SRC_DIR}"
  fi
  if [[ -d "$SRC_DIR/frontend" ]]; then
    rsync -a --delete "${SRC_DIR}/frontend/" "${APP_DIR}/frontend/"
    ok "Frontend синхронизирован из ${SRC_DIR}"
  fi
fi

if [[ -f "${APP_DIR}/backend/requirements.txt" && -x "${APP_DIR}/venv/bin/pip" ]]; then
  "${APP_DIR}/venv/bin/pip" install -q -r "${APP_DIR}/backend/requirements.txt"
  ok "Python-зависимости проверены"
fi

if [[ -f "${APP_DIR}/frontend/package.json" ]]; then
  npm install --prefix "${APP_DIR}/frontend" --silent --no-fund --no-audit
  npm run build --prefix "${APP_DIR}/frontend" --silent
  [[ -f "${APP_DIR}/frontend/dist/index.html" ]] || { err "Frontend build failed: нет dist/index.html"; exit 1; }
  find "${APP_DIR}/frontend/dist" -type d -exec chmod 755 {} \;
  find "${APP_DIR}/frontend/dist" -type f -exec chmod 644 {} \;
  ok "Frontend пересобран"
fi

if [[ -f /etc/nginx/sites-available/botfactory ]]; then
  nginx -t
  systemctl reload nginx || systemctl restart nginx
  ok "Nginx проверен и перезагружен"
else
  warn "Конфиг /etc/nginx/sites-available/botfactory не найден"
fi

systemctl daemon-reload
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
warn "Если бот не стартует, сразу пришлите вывод команд:"
echo "journalctl -u botfactory-bots -n 120 --no-pager"
echo "journalctl -u botfactory-api -n 120 --no-pager"
echo "tail -n 120 ${APP_DIR}/logs/bots-error.log"
echo "tail -n 120 ${APP_DIR}/logs/api-error.log"
