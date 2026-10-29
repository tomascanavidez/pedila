#!/usr/bin/env bash
# =============================================================================
# PEDILA — preparación de un VPS nuevo (Ubuntu 22.04/24.04 o Debian 12).
# Idempotente: se puede correr varias veces sin romper nada.
#
#   sudo bash setup-servidor.sh
#
# Opciones (variables de entorno):
#   APP_USER=pedila            usuario sin privilegios que corre la app
#   NODE_MAJOR=24              versión LTS de Node.js
#   SWAP_SIZE=2G               swap a crear si la RAM es menor a 3 GB y no hay swap
#   CONFIGURE_FIREWALL=1       0 = no tocar el firewall
#   EXTRA_PORTS="25 465 587"   puertos extra a abrir (ej. si el VPS también corre el
#                              correo o el panel Ferozo: ¡consultá sus puertos a DonWeb!)
#   INSTALL_NGINX=0            1 = instalar nginx (variante B del README)
#   INSTALL_CERTBOT=0          1 = instalar certbot para Let's Encrypt
#   INSTALL_MARIADB=0          1 = instalar MariaDB local (si Ferozo no gestiona la base)
# =============================================================================
set -euo pipefail

APP_USER="${APP_USER:-pedila}"
NODE_MAJOR="${NODE_MAJOR:-24}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
CONFIGURE_FIREWALL="${CONFIGURE_FIREWALL:-1}"
EXTRA_PORTS="${EXTRA_PORTS:-}"
INSTALL_NGINX="${INSTALL_NGINX:-0}"
INSTALL_CERTBOT="${INSTALL_CERTBOT:-0}"
INSTALL_MARIADB="${INSTALL_MARIADB:-0}"
APP_HOME="/home/${APP_USER}/pedila"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;31m[!] %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Este script necesita root: sudo bash $0" >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID}" != "ubuntu" && "${ID}" != "debian" && "${ID_LIKE:-}" != *"debian"* ]]; then
  warn "Sistema ${PRETTY_NAME}: el script está probado en Ubuntu/Debian. Seguí bajo tu responsabilidad."
fi

log "Paquetes base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git rsync unzip tar gzip cron ufw build-essential python3 mariadb-client

log "Node.js ${NODE_MAJOR} LTS"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

# sharp (procesamiento de imágenes) usa binarios precompilados con libvips incluida
# para Linux x64/arm64 con glibc: no hace falta instalar libvips. Se verifica glibc.
log "Dependencias de sharp"
GLIBC="$(ldd --version | head -1 | grep -oE '[0-9]+\.[0-9]+$' || echo 0)"
echo "glibc ${GLIBC} (sharp necesita >= 2.26)"

log "PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2@latest
fi

log "Usuario de la app: ${APP_USER}"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "PEDILA" "${APP_USER}"
fi
install -d -o "${APP_USER}" -g "${APP_USER}" -m 750 "${APP_HOME}" "${APP_HOME}/releases" "${APP_HOME}/shared"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 750 "${APP_HOME}/shared/backups" "${APP_HOME}/shared/logs"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 755 "${APP_HOME}/shared/uploads"
# El proxy (nginx/Apache) necesita poder atravesar el home para leer /uploads.
chmod o+x "/home/${APP_USER}" "${APP_HOME}" "${APP_HOME}/shared"
if [[ ! -f "${APP_HOME}/shared/.env" ]]; then
  touch "${APP_HOME}/shared/.env"
  chown "${APP_USER}:${APP_USER}" "${APP_HOME}/shared/.env"
  chmod 600 "${APP_HOME}/shared/.env"
  warn "Creé ${APP_HOME}/shared/.env vacío: completalo a partir de .env.example antes del primer deploy."
fi

log "Swap"
MEM_MB="$(free -m | awk '/^Mem:/{print $2}')"
if [[ "${MEM_MB}" -lt 3000 ]] && ! swapon --show | grep -q .; then
  fallocate -l "${SWAP_SIZE}" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "Swap de ${SWAP_SIZE} creado (RAM: ${MEM_MB} MB)."
else
  echo "RAM ${MEM_MB} MB; swap actual: $(swapon --show --noheadings | wc -l) dispositivo(s). Sin cambios."
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/99-pedila.conf
sysctl -p /etc/sysctl.d/99-pedila.conf >/dev/null

if [[ "${CONFIGURE_FIREWALL}" == "1" ]]; then
  log "Firewall (22, 80, 443 ${EXTRA_PORTS})"
  if systemctl is-active --quiet firewalld 2>/dev/null; then
    warn "firewalld está activo (posiblemente lo gestiona el panel). No toco el firewall: abrí 22, 80 y 443 desde ahí."
  else
    warn "Si este VPS también corre el panel Ferozo o el correo, sus puertos quedan BLOQUEADOS salvo que los pases en EXTRA_PORTS."
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    for p in ${EXTRA_PORTS}; do ufw allow "${p}/tcp"; done
    ufw --force enable
    ufw status verbose
  fi
fi

if [[ "${INSTALL_NGINX}" == "1" ]]; then
  log "nginx"
  apt-get install -y nginx
  install -d /var/www/letsencrypt /etc/nginx/snippets
  cat > /etc/nginx/snippets/pedila-proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_read_timeout 60s;
proxy_send_timeout 60s;
EOF
  systemctl enable --now nginx
  echo "Copiá deploy/nginx.conf a /etc/nginx/sites-available/pedila.conf (ver README)."
fi

if [[ "${INSTALL_CERTBOT}" == "1" ]]; then
  log "Certbot (Let's Encrypt)"
  apt-get install -y certbot python3-certbot-nginx
fi

if [[ "${INSTALL_MARIADB}" == "1" ]]; then
  log "MariaDB local"
  apt-get install -y mariadb-server
  systemctl enable --now mariadb
  echo "Creá la base y el usuario (ver README › Base de datos)."
fi

log "PM2 al iniciar el servidor + rotación de logs"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" >/dev/null
sudo -u "${APP_USER}" -H bash -lc '
  pm2 ping >/dev/null
  pm2 describe pm2-logrotate >/dev/null 2>&1 || pm2 install pm2-logrotate
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 14
  pm2 set pm2-logrotate:compress true
  pm2 save --force >/dev/null
'

log "Backup diario (cron del usuario ${APP_USER})"
CRON_LINE="30 3 * * * ${APP_HOME}/current/deploy/backup.sh >> ${APP_HOME}/shared/logs/backup.log 2>&1"
( crontab -u "${APP_USER}" -l 2>/dev/null | grep -v 'deploy/backup.sh' ; echo "${CRON_LINE}" ) | crontab -u "${APP_USER}" -

log "Listo"
cat <<EOF
Próximos pasos (ver README › Despliegue):
  1. Completar ${APP_HOME}/shared/.env (DATABASE_URL, AUTH_SECRET, APP_URL, MP_*, SMTP_*).
  2. Como ${APP_USER}:  REPO_URL=<tu repo> bash deploy.sh   (o --artifact build.tar.gz)
  3. Configurar el proxy inverso (variante A Ferozo o B nginx) y el SSL.
EOF
