#!/usr/bin/env bash
# =============================================================================
# PEDILA — backup diario de MySQL/MariaDB y de las imágenes subidas.
# Retención: KEEP_DAYS días (por defecto 7). Lo programa setup-servidor.sh en el
# cron del usuario de la app (03:30). Se puede correr a mano: bash backup.sh
#
# Restaurar: ver README › Operación diaria › Restaurar un backup.
# =============================================================================
set -euo pipefail

APP_HOME="${APP_HOME:-$HOME/pedila}"
ENV_FILE="${ENV_FILE:-${APP_HOME}/shared/.env}"
DEST="${BACKUP_DIR:-${APP_HOME}/shared/backups}"
UPLOADS="${UPLOADS_DIR:-${APP_HOME}/shared/uploads}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"

[[ -f "${ENV_FILE}" ]] || { echo "No existe ${ENV_FILE}" >&2; exit 1; }
mkdir -p "${DEST}"
chmod 700 "${DEST}"

# DATABASE_URL="mysql://usuario:clave@host:puerto/base"
DB_URL="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
[[ "${DB_URL}" =~ ^mysql://([^:]+):([^@]*)@([^:/]+)(:([0-9]+))?/([^?]+) ]] || { echo "DATABASE_URL con formato inesperado" >&2; exit 1; }
urldecode() { local s="${1//+/ }"; printf '%b' "${s//%/\\x}"; }
DB_USER="$(urldecode "${BASH_REMATCH[1]}")"
DB_PASS="$(urldecode "${BASH_REMATCH[2]}")"
DB_HOST="${BASH_REMATCH[3]}"
DB_PORT="${BASH_REMATCH[5]:-3306}"
DB_NAME="${BASH_REMATCH[6]}"

# Las credenciales van en un archivo temporal (no quedan visibles en `ps`).
CNF="$(mktemp)"
chmod 600 "${CNF}"
trap 'rm -f "${CNF}"' EXIT
printf '[client]\nuser=%s\npassword=%s\nhost=%s\nport=%s\n' "${DB_USER}" "${DB_PASS}" "${DB_HOST}" "${DB_PORT}" > "${CNF}"

DB_FILE="${DEST}/db-${DB_NAME}-${STAMP}.sql.gz"
echo "[$(date -Is)] Dump de ${DB_NAME} -> ${DB_FILE}"
mysqldump --defaults-extra-file="${CNF}" --single-transaction --quick --routines --triggers \
  --no-tablespaces --default-character-set=utf8mb4 "${DB_NAME}" | gzip -6 > "${DB_FILE}"
gzip -t "${DB_FILE}"

UP_FILE="${DEST}/uploads-${STAMP}.tar.gz"
if [[ -d "${UPLOADS}" ]]; then
  echo "[$(date -Is)] Imágenes -> ${UP_FILE}"
  tar -czf "${UP_FILE}" -C "$(dirname "${UPLOADS}")" "$(basename "${UPLOADS}")"
fi

echo "[$(date -Is)] Borrando backups de más de ${KEEP_DAYS} días"
find "${DEST}" -maxdepth 1 -type f \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -mtime "+$((KEEP_DAYS - 1))" -print -delete

echo "[$(date -Is)] Backup OK ($(du -h "${DB_FILE}" | cut -f1) base)"
