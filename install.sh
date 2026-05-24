#!/usr/bin/env bash
# =============================================================================
#   BotFactory — SaaS Platform Interactive Installer v2.1
#   Ubuntu 22.04 / 24.04 clean server installer
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; B='\033[1m'; DIM='\033[2m'; NC='\033[0m'
OK="${G}[✓]${NC}"; ERR="${R}[✗]${NC}"; WARN="${Y}[!]${NC}"; INFO="${C}[→]${NC}"
hdr() { echo -e "\n${B}${C}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n  $1\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }
log()  { echo -e "${OK} $1"; }
info() { echo -e "${INFO} $1"; }
warn() { echo -e "${WARN} $1"; }
die()  { echo -e "${ERR} $1"; exit 1; }

[[ $EUID -ne 0 ]] && die "Запустите от root: sudo bash install.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ ! -d "${SCRIPT_DIR}/backend" ]] && die "Запустите из папки проекта: cd botfactory && sudo bash install.sh"

. /etc/os-release 2>/dev/null || true
if [[ "${ID:-}" != "ubuntu" ]]; then
  warn "Скрипт рассчитан на Ubuntu 22.04/24.04. Текущая ОС: ${PRETTY_NAME:-неизвестна}"
  read -rp "Продолжить? [y/N]: " _c; [[ "$_c" =~ ^[Yy]$ ]] || exit 0
elif [[ "${VERSION_ID:-}" != "22.04" && "${VERSION_ID:-}" != "24.04" ]]; then
  warn "Проверены Ubuntu 22.04 и 24.04. Текущая версия: ${VERSION_ID:-неизвестна}"
  read -rp "Продолжить? [y/N]: " _c; [[ "$_c" =~ ^[Yy]$ ]] || exit 0
fi

clear
echo -e "${B}${C}"
cat << 'BANNER'
  ____       _   _____         _
 | __ )  ___| |_|  ___|_ _  ___| |_ ___  _ __ _   _
 |  _ \ / _ \ __| |_ / _` |/ __| __/ _ \| '__| | | |
 | |_) |  __/ |_|  _| (_| | (__| || (_) | |  | |_| |
 |____/ \___|\__|_|  \__,_|\___|\__\___/|_|   \__, |
                                                |___/
BANNER
echo -e "${NC}${B}           SaaS Platform — Interactive Installer v2.1${NC}\n"

ask() {
  local var="$1" prompt="$2" default="${3:-}" secret="${4:-}"
  local val=""
  while [[ -z "$val" ]]; do
    if [[ -n "$default" ]]; then
      echo -ne "${C}?${NC} ${B}${prompt}${NC} ${DIM}[${default}]${NC}: "
    else
      echo -ne "${C}?${NC} ${B}${prompt}${NC}: "
    fi
    if [[ "$secret" == "secret" ]]; then
      read -rs val; echo ""
    else
      read -r val
    fi
    val="${val:-$default}"
    [[ -z "$val" ]] && echo -e "  ${WARN} Поле обязательно для заполнения"
  done
  printf -v "$var" '%s' "$val"
}

ask_optional() {
  local var="$1" prompt="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    echo -ne "${C}?${NC} ${B}${prompt}${NC} ${DIM}[${default}]${NC}: "
  else
    echo -ne "${C}?${NC} ${B}${prompt}${NC}: "
  fi
  local val=""; read -r val
  printf -v "$var" '%s' "${val:-$default}"
}

ask_opt() {
  local var="$1" prompt="$2" opts="${3:-Y/n}"
  echo -ne "${C}?${NC} ${B}${prompt}${NC} ${DIM}[${opts}]${NC}: "
  local ans=""; read -r ans
  if [[ "$opts" == "Y/n" ]]; then
    [[ "$ans" =~ ^[Nn] ]] && printf -v "$var" 'no' || printf -v "$var" 'yes'
  else
    [[ "$ans" =~ ^[Yy] ]] && printf -v "$var" 'yes' || printf -v "$var" 'no'
  fi
}

valid_number() { [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]; }

hdr "Шаг 1 из 3 — Конфигурация"

echo -e "\n${B}▸ Домен и SSL${NC}"
echo -e "${DIM}  Если домена нет — оставьте пустым, будет HTTP на IP-адресе${NC}\n"
ask_optional DOMAIN "Доменное имя" ""
DOMAIN="$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##;s#/$##')"

if [[ -n "$DOMAIN" ]]; then
  ask CERTBOT_EMAIL "Email для SSL-сертификата" "admin@${DOMAIN}"
  ask_opt WITH_WWW "Включить www.${DOMAIN} в сертификат?" "Y/n"
  ask_opt SETUP_SSL "Получить SSL-сертификат сейчас?" "Y/n"
else
  CERTBOT_EMAIL=""; WITH_WWW="no"; SETUP_SSL="no"
  warn "Домен не задан — установка на HTTP (SSL можно добавить позже)"
fi

echo -e "\n${B}▸ Telegram — платформенный бот${NC}"
echo -e "${DIM}  Создайте бота через @BotFather → /newbot → скопируйте токен${NC}\n"
ask PLATFORM_BOT_TOKEN "Токен платформенного бота" ""
echo -e "${DIM}  Несколько ID через запятую. Свой ID узнайте у @userinfobot${NC}\n"
ask PLATFORM_ADMIN_IDS "Telegram ID администраторов" ""

echo -e "\n${B}▸ База данных PostgreSQL${NC}\n"
ask_opt CUSTOM_DB_PASS "Задать пароль БД вручную?" "y/N"
if [[ "$CUSTOM_DB_PASS" == "yes" ]]; then
  ask DB_PASS "Пароль PostgreSQL" "" secret
else
  DB_PASS="$(openssl rand -hex 16)"
  log "Пароль БД сгенерирован автоматически"
fi

echo -e "\n${B}▸ Комиссии платформы${NC}\n"
ask_opt CUSTOM_COMMISSIONS "Изменить комиссии? (Тест 7д 10% / Trial 10% / Basic 7% / Pro 5% / Ent 3% / Постоплата default 5%)" "y/N"
if [[ "$CUSTOM_COMMISSIONS" == "yes" ]]; then
  ask COMM_TRIAL_WEEK "Тест 7 дней (%)" "10"
  ask COMM_TRIAL "Trial (%)" "10"
  ask COMM_BASIC "Basic (%)" "7"
  ask COMM_PRO "Pro (%)" "5"
  ask COMM_ENTERPRISE "Enterprise (%)" "3"
  ask COMM_POSTPAID_DEFAULT "Постоплата default (%)" "5"
  ask POSTPAID_DUE_DAY "День оплаты постоплаты по умолчанию (1-28)" "5"
else
  COMM_TRIAL_WEEK=10; COMM_TRIAL=10; COMM_BASIC=7; COMM_PRO=5; COMM_ENTERPRISE=3
  COMM_POSTPAID_DEFAULT=5; POSTPAID_DUE_DAY=5
fi

for n in "$COMM_TRIAL_WEEK" "$COMM_TRIAL" "$COMM_BASIC" "$COMM_PRO" "$COMM_ENTERPRISE" "$COMM_POSTPAID_DEFAULT"; do
  valid_number "$n" || die "Комиссии должны быть числами"
done
[[ "$POSTPAID_DUE_DAY" =~ ^[0-9]+$ ]] && (( POSTPAID_DUE_DAY >= 1 && POSTPAID_DUE_DAY <= 28 )) || die "День оплаты постоплаты должен быть от 1 до 28"

APP_DIR="/opt/botfactory"
APP_USER="botfactory"
DB_NAME="botfactory"
DB_USER="botfactory"
API_PORT=8000
SECRET_KEY="$(openssl rand -hex 32)"
VENV="${APP_DIR}/venv"
FRONT_DIR="${APP_DIR}/frontend"
PYTHON_BIN="$(command -v python3 || true)"

hdr "Шаг 2 из 3 — Подтверждение"

SERVER_IP="$(curl -4 -s --max-time 4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
[[ -z "$SERVER_IP" ]] && SERVER_IP="$(hostname -I | awk '{print $1}')"

echo -e "${B}Параметры установки:${NC}\n"
printf "  %-25s %s\n" "Директория:" "${APP_DIR}"
printf "  %-25s %s\n" "IP сервера:" "${SERVER_IP}"
printf "  %-25s %s\n" "Домен:" "${DOMAIN:-"(нет — HTTP)"}"
printf "  %-25s %s\n" "SSL:" "${SETUP_SSL}"
[[ -n "$DOMAIN" ]] && printf "  %-25s %s\n" "www в сертификат:" "${WITH_WWW}"
[[ -n "$DOMAIN" ]] && printf "  %-25s %s\n" "Email SSL:" "${CERTBOT_EMAIL}"
printf "  %-25s %s\n" "Platform Bot Token:" "${PLATFORM_BOT_TOKEN:0:24}…"
printf "  %-25s %s\n" "Admin Telegram IDs:" "${PLATFORM_ADMIN_IDS}"
printf "  %-25s %s\n" "DB пароль:" "${DB_PASS:0:8}… (скрыт)"
printf "  %-25s %s\n" "Комиссии:" "Тест7д ${COMM_TRIAL_WEEK}% | Trial ${COMM_TRIAL}% | Basic ${COMM_BASIC}% | Pro ${COMM_PRO}% | Ent ${COMM_ENTERPRISE}% | Postpay ${COMM_POSTPAID_DEFAULT}%"
printf "  %-25s %s\n" "Постоплата default:" "до ${POSTPAID_DUE_DAY} числа"
echo ""
read -rp "$(echo -e "${B}Начать установку?${NC} [y/N]: ")" START
[[ "$START" =~ ^[Yy]$ ]] || { echo "Отменено."; exit 0; }

hdr "Шаг 3 из 3 — Установка"
START_TIME=$(date +%s)
step() { echo -e "\n${B}${C}  ▸ $1${NC}"; }

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

wait_for_apt() {
  local locks=(/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock)
  for i in {1..60}; do
    local busy=0
    for lock in "${locks[@]}"; do
      fuser "$lock" >/dev/null 2>&1 && busy=1 || true
    done
    [[ "$busy" == "0" ]] && return 0
    sleep 2
  done
  die "APT занят другим процессом. Остановите apt/dpkg и повторите установку."
}

apt_install() {
  wait_for_apt
  apt-get install -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" "$@"
}

step "Системные пакеты"
wait_for_apt
apt-get update -qq
apt_install \
  ca-certificates curl wget git nano htop unzip gnupg lsb-release \
  build-essential libssl-dev libffi-dev libpq-dev \
  python3 python3-venv python3-dev python3-pip \
  postgresql postgresql-client \
  redis-server nginx \
  certbot python3-certbot-nginx \
  ufw fail2ban
PYTHON_BIN="$(command -v python3)"
log "Системные пакеты установлены без apt upgrade"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | cut -d. -f1)" != "v20" ]]; then
  info "Устанавливаем Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt_install nodejs
fi
log "Node.js $(node -v) готов"

step "Системный пользователь"
id "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
log "Пользователь ${APP_USER} готов"

step "PostgreSQL"
systemctl enable --now postgresql
su - postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'\"" | grep -q 1 || su - postgres -c "createdb ${DB_NAME}"
su - postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'\"" | grep -q 1 || su - postgres -c "psql -c \"CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}'\""
su - postgres -c "psql -c \"ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}'\""
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER}\""
su - postgres -c "psql -c \"ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER}\""
log "PostgreSQL: база ${DB_NAME} готова"

step "Redis"
systemctl enable --now redis-server
redis-cli ping | grep -q PONG && log "Redis работает"

step "Структура директорий"
mkdir -p "${APP_DIR}"/{backend,frontend,logs,uploads,backups}
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
log "Директории созданы"

step "Конфигурация (.env)"
cat > "${APP_DIR}/.env" << ENV
APP_DIR=${APP_DIR}
DEBUG=false
SECRET_KEY=${SECRET_KEY}

DATABASE_URL=postgresql+asyncpg://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
DB_POOL_SIZE=20

REDIS_URL=redis://127.0.0.1:6379/0

PLATFORM_BOT_TOKEN=${PLATFORM_BOT_TOKEN}
PLATFORM_ADMIN_IDS=${PLATFORM_ADMIN_IDS}

API_HOST=127.0.0.1
API_PORT=${API_PORT}
DOMAIN=${DOMAIN}
ALLOWED_ORIGINS=http://localhost:3000${DOMAIN:+,https://$DOMAIN,http://$DOMAIN}

UPLOAD_DIR=${APP_DIR}/uploads
MAX_UPLOAD_MB=10

COMMISSION_TRIAL_WEEK=${COMM_TRIAL_WEEK}
COMMISSION_TRIAL=${COMM_TRIAL}
COMMISSION_BASIC=${COMM_BASIC}
COMMISSION_PRO=${COMM_PRO}
COMMISSION_ENTERPRISE=${COMM_ENTERPRISE}
COMMISSION_POSTPAID_DEFAULT=${COMM_POSTPAID_DEFAULT}
POSTPAID_DEFAULT_DUE_DAY=${POSTPAID_DUE_DAY}
ENV
chmod 600 "${APP_DIR}/.env"
log ".env создан"

step "Копирование backend"
rsync -a --delete "${SCRIPT_DIR}/backend/" "${APP_DIR}/backend/"
PY_COUNT=$(find "${APP_DIR}/backend" -name "*.py" | wc -l)
log "Backend скопирован (${PY_COUNT} Python-файлов)"

step "Python виртуальное окружение"
rm -rf "$VENV"
"$PYTHON_BIN" -m venv "$VENV"
# shellcheck disable=SC1091
source "${VENV}/bin/activate"
pip install -q --upgrade pip wheel setuptools
pip install -q -r "${APP_DIR}/backend/requirements.txt"
deactivate
log "Python venv готов: $(${VENV}/bin/python --version)"

step "Frontend (React + Vite)"
rsync -a --delete "${SCRIPT_DIR}/frontend/" "${FRONT_DIR}/"
cat > "${FRONT_DIR}/.env.production" << FENV
VITE_API_URL=/api
FENV
npm install --prefix "$FRONT_DIR" --silent --no-fund --no-audit
npm run build --prefix "$FRONT_DIR" --silent
[[ -f "${FRONT_DIR}/dist/index.html" ]] || die "Frontend не собрался: нет ${FRONT_DIR}/dist/index.html"
log "Frontend собран"

step "Nginx"
mkdir -p /var/www/certbot
NGINX_CONF="/etc/nginx/sites-available/botfactory"
SERVER_NAMES="_"
[[ -n "$DOMAIN" ]] && SERVER_NAMES="$DOMAIN"
[[ -n "$DOMAIN" && "$WITH_WWW" == "yes" ]] && SERVER_NAMES="$SERVER_NAMES www.$DOMAIN"

cat > "$NGINX_CONF" << NGINX
server {
    listen 80;
    server_name ${SERVER_NAMES};

    client_max_body_size 20M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        root ${FRONT_DIR}/dist;
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache";
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        root ${FRONT_DIR}/dist;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    location /uploads/ {
        alias ${APP_DIR}/uploads/;
        expires 7d;
        add_header Cache-Control "public";
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/botfactory
nginx -t || die "Ошибка конфигурации Nginx"
systemctl enable nginx
systemctl restart nginx
log "Nginx запущен"

check_dns() {
  local host="$1" expected="$2"
  local ip
  ip="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | head -1 || true)"
  [[ -z "$ip" ]] && { warn "$host не резолвится. Настройте A-запись → $expected"; return 1; }
  [[ "$ip" != "$expected" ]] && { warn "$host указывает на $ip, а сервер: $expected"; return 1; }
  log "DNS OK: $host → $ip"
  return 0
}

step "SSL — Let's Encrypt"
run_certbot() {
  local d_args=(-d "$DOMAIN")
  check_dns "$DOMAIN" "$SERVER_IP" || return 1
  if [[ "$WITH_WWW" == "yes" ]]; then
    check_dns "www.$DOMAIN" "$SERVER_IP" || return 1
    d_args+=(-d "www.$DOMAIN")
  fi
  certbot --nginx "${d_args[@]}" \
    --email "$CERTBOT_EMAIL" \
    --agree-tos --no-eff-email \
    --redirect --non-interactive
}

if [[ -n "$DOMAIN" && "$SETUP_SSL" == "yes" ]]; then
  if run_certbot; then
    systemctl reload nginx
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log "SSL сертификат получен"
  else
    warn "SSL не получен. Исправьте DNS и запустите: certbot --nginx -d ${DOMAIN} --email ${CERTBOT_EMAIL} --agree-tos --redirect"
  fi
elif [[ -n "$DOMAIN" ]]; then
  warn "SSL пропущен. После DNS: certbot --nginx -d ${DOMAIN} --email ${CERTBOT_EMAIL} --agree-tos --redirect"
else
  warn "SSL недоступен без домена"
fi

step "Systemd сервисы"
cat > /etc/systemd/system/botfactory-api.service << SERVICE
[Unit]
Description=BotFactory API (FastAPI)
After=network.target postgresql.service redis-server.service
Requires=postgresql.service redis-server.service

[Service]
Type=exec
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
Environment=PYTHONPATH=${APP_DIR}/backend
EnvironmentFile=${APP_DIR}/.env
ExecStart=${VENV}/bin/uvicorn main:app --host 127.0.0.1 --port ${API_PORT} --workers 1 --loop uvloop --log-level info
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5
StandardOutput=append:${APP_DIR}/logs/api.log
StandardError=append:${APP_DIR}/logs/api-error.log

[Install]
WantedBy=multi-user.target
SERVICE

cat > /etc/systemd/system/botfactory-bots.service << SERVICE
[Unit]
Description=BotFactory Bots Runner (platform + shops)
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target postgresql.service redis-server.service

[Service]
Type=exec
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/backend
Environment=PYTHONPATH=${APP_DIR}/backend
EnvironmentFile=${APP_DIR}/.env
ExecStart=${VENV}/bin/python shop_bots_runner.py
Restart=always
RestartSec=10
StartLimitIntervalSec=60
StartLimitBurst=5
StandardOutput=append:${APP_DIR}/logs/bots.log
StandardError=append:${APP_DIR}/logs/bots-error.log

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable botfactory-api botfactory-bots
systemctl restart botfactory-api && log "API запущен" || warn "API не стартовал — см. journalctl -u botfactory-api"
systemctl restart botfactory-bots && log "Боты запущены" || warn "Боты не стартовали — см. journalctl -u botfactory-bots"

step "Firewall (UFW)"
ufw allow 22/tcp comment "SSH" >/dev/null || true
ufw allow 80/tcp comment "HTTP" >/dev/null || true
ufw allow 443/tcp comment "HTTPS" >/dev/null || true
ufw --force enable >/dev/null || warn "UFW не удалось включить автоматически"
log "UFW: правила SSH + HTTP + HTTPS добавлены без reset"

step "Fail2ban"
cat > /etc/fail2ban/jail.local << F2B
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
ignoreip = 127.0.0.1/8

[sshd]
enabled = true

[nginx-http-auth]
enabled = true
F2B
systemctl enable --now fail2ban || warn "Fail2ban не стартовал"
log "Fail2ban настроен"

step "Права доступа"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 755 "$APP_DIR"
chmod 600 "$APP_DIR/.env"
chmod -R 755 "${APP_DIR}/backend" "${APP_DIR}/frontend"
find "${FRONT_DIR}/dist" -type d -exec chmod 755 {} \; 2>/dev/null || true
find "${FRONT_DIR}/dist" -type f -exec chmod 644 {} \; 2>/dev/null || true
chmod -R 770 "${APP_DIR}/logs" "${APP_DIR}/uploads" "${APP_DIR}/backups"
log "Права выставлены: nginx может читать frontend, .env закрыт"

step "Logrotate"
cat > /etc/logrotate.d/botfactory << LR
${APP_DIR}/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ${APP_USER} ${APP_USER}
}
LR
log "Logrotate настроен"

step "Автоматическое резервное копирование"
cat > "${APP_DIR}/backups/backup.sh" << BACKUP
#!/usr/bin/env bash
set -euo pipefail
DIR="${APP_DIR}/backups"
DATE=\$(date +%Y%m%d_%H%M%S)
PGPASSWORD="${DB_PASS}" pg_dump -U ${DB_USER} -h 127.0.0.1 ${DB_NAME} | gzip > "\${DIR}/db_\${DATE}.sql.gz"
tar -czf "\${DIR}/uploads_\${DATE}.tar.gz" -C ${APP_DIR} uploads/ 2>/dev/null || true
find "\${DIR}" -name "*.gz" -mtime +30 -delete 2>/dev/null || true
echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Backup OK: \${DATE}"
BACKUP
chmod +x "${APP_DIR}/backups/backup.sh"
chown "$APP_USER:$APP_USER" "${APP_DIR}/backups/backup.sh"
( crontab -l 2>/dev/null | grep -v "botfactory/backups"; echo "0 2 * * * ${APP_DIR}/backups/backup.sh >> ${APP_DIR}/logs/backup.log 2>&1" ) | crontab -
log "Бекап: ежедневно в 02:00"

cat > "${APP_DIR}/install-info.txt" << INFO
BotFactory — параметры установки
Дата: $(date '+%Y-%m-%d %H:%M:%S')
Директория: ${APP_DIR}
Server IP: ${SERVER_IP}
Домен: ${DOMAIN:-нет}
SSL requested: ${SETUP_SSL}
DB User: ${DB_USER}
DB Name: ${DB_NAME}
DB Pass: ${DB_PASS}
Secret Key: ${SECRET_KEY}
API Port: ${API_PORT}
Комиссии: trial_week=${COMM_TRIAL_WEEK}% trial=${COMM_TRIAL}% basic=${COMM_BASIC}% pro=${COMM_PRO}% enterprise=${COMM_ENTERPRISE}% postpaid_default=${COMM_POSTPAID_DEFAULT}%
Постоплата default due day: ${POSTPAID_DUE_DAY}
INFO
chmod 600 "${APP_DIR}/install-info.txt"
chown "$APP_USER:$APP_USER" "${APP_DIR}/install-info.txt"

ELAPSED=$(( $(date +%s) - START_TIME ))
clear
echo -e "${B}${G}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   BotFactory успешно установлен! ✓        ║"
printf "  ║   Время установки: %-4s сек.              ║\n" "${ELAPSED}"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

echo -e "${B}▸ Доступ:${NC}"
if [[ -n "$DOMAIN" && -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
  echo -e "  ${G}●${NC} Панель: ${C}https://${DOMAIN}${NC}"
  echo -e "  ${G}●${NC} API:    ${C}https://${DOMAIN}/api${NC}"
else
  echo -e "  ${G}●${NC} Панель: ${C}http://${DOMAIN:-$SERVER_IP}${NC}"
  echo -e "  ${G}●${NC} API:    ${C}http://${DOMAIN:-$SERVER_IP}/api${NC}"
fi

echo -e "\n${B}▸ Управление:${NC}"
echo -e "  ${DIM}systemctl status botfactory-api${NC}"
echo -e "  ${DIM}systemctl status botfactory-bots${NC}"
echo -e "  ${DIM}journalctl -u botfactory-api -f${NC}"
echo -e "  ${DIM}journalctl -u botfactory-bots -f${NC}"
echo -e "\n${G}${B}⚠ Сохраните ${APP_DIR}/install-info.txt в надёжное место.${NC}\n"
