#!/usr/bin/env bash
# =============================================================================
# PEDILA — despliegue sin cortar el servicio (correr como el usuario de la app).
#
#   bash deploy.sh                          git clone de REPO_URL (rama BRANCH) y build en el servidor
#   bash deploy.sh --source /ruta/subida    código subido por SFTP (se copia y se compila)
#   bash deploy.sh --artifact build.tar.gz  build ya compilado (GitHub Actions o tu PC): no compila
#   bash deploy.sh rollback                 vuelve a la release anterior
#   bash deploy.sh status                   muestra releases y estado de PM2
#
# Cada deploy crea ~/pedila/releases/AAAAMMDD-HHMMSS, aplica migraciones, cambia el
# enlace ~/pedila/current y hace `pm2 reload` (las instancias web se reinician de a una).
# Si /api/health no responde, vuelve solo a la release anterior.
#
# Variables: REPO_URL, BRANCH=main, KEEP_RELEASES=5, BUILD_MEMORY_MB=1536,
#            HEALTH_URL=http://127.0.0.1:3000/api/health, APP_HOME=~/pedila
# =============================================================================
set -euo pipefail

APP_HOME="${APP_HOME:-$HOME/pedila}"
BRANCH="${BRANCH:-main}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
BUILD_MEMORY_MB="${BUILD_MEMORY_MB:-1536}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
RELEASES="${APP_HOME}/releases"
SHARED="${APP_HOME}/shared"
CURRENT="${APP_HOME}/current"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -ne 0 ]] || die "No corras el deploy como root: usá el usuario de la app (ej. sudo -iu pedila)."
[[ -s "${SHARED}/.env" ]] || die "Falta ${SHARED}/.env (copiá .env.example y completalo)."
command -v pm2 >/dev/null || die "PM2 no está instalado (corré setup-servidor.sh)."

health_check() {
  local tries=30
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS --max-time 5 "${HEALTH_URL}" >/dev/null 2>&1; then
      echo "Salud OK (${HEALTH_URL})"
      return 0
    fi
    sleep 2
  done
  return 1
}

switch_to() {
  local target="$1"
  ln -sfn "${target}" "${APP_HOME}/current.tmp"
  mv -Tf "${APP_HOME}/current.tmp" "${CURRENT}"
  pm2 startOrReload "${CURRENT}/deploy/ecosystem.config.js" --update-env
  pm2 save --force >/dev/null
}

previous_release() {
  local active
  active="$(readlink -f "${CURRENT}" 2>/dev/null || true)"
  ls -1d "${RELEASES}"/*/ 2>/dev/null | sed 's#/$##' | sort | grep -v "^${active}$" | tail -1
}

case "${1:-}" in
  status)
    echo "Release activa: $(readlink -f "${CURRENT}" 2>/dev/null || echo ninguna)"
    ls -1 "${RELEASES}"
    pm2 status
    exit 0
    ;;
  rollback)
    PREV="$(previous_release)"
    [[ -n "${PREV}" ]] || die "No hay una release anterior a la cual volver."
    log "Volviendo a ${PREV}"
    switch_to "${PREV}"
    health_check || die "La release anterior tampoco responde: revisá pm2 logs."
    echo "Rollback listo. Ojo: las migraciones de base NO se revierten (ver README › Actualizaciones)."
    exit 0
    ;;
esac

RELEASE="$(date +%Y%m%d-%H%M%S)"
REL="${RELEASES}/${RELEASE}"
MODE="git"
SRC=""
if [[ "${1:-}" == "--artifact" ]]; then MODE="artifact"; SRC="${2:-}"; fi
if [[ "${1:-}" == "--source" ]]; then MODE="source"; SRC="${2:-}"; fi

log "Nueva release ${RELEASE} (modo ${MODE})"
mkdir -p "${REL}"
trap 'echo "El deploy falló: la release activa no cambió. Podés borrar ${REL}." >&2' ERR

case "${MODE}" in
  git)
    [[ -n "${REPO_URL:-}" ]] || die "Definí REPO_URL (o usá --source / --artifact)."
    git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${REL}"
    ;;
  source)
    [[ -d "${SRC}" ]] || die "No existe la carpeta ${SRC}"
    rsync -a --delete \
      --exclude /node_modules --exclude /.next --exclude /dist --exclude /uploads --exclude /.env \
      --exclude /test-results --exclude /playwright-report --exclude /.git \
      "${SRC}/" "${REL}/"
    ;;
  artifact)
    [[ -f "${SRC}" ]] || die "No existe el archivo ${SRC}"
    tar -xzf "${SRC}" -C "${REL}"
    ;;
esac

cd "${REL}"
ln -sfn "${SHARED}/.env" .env
echo "${RELEASE}" > RELEASE

if [[ "${MODE}" == "artifact" ]]; then
  log "Dependencias de producción (worker y CLI de Prisma)"
  npm ci --omit=dev --no-audit --no-fund
  [[ -f .next/standalone/server.js ]] || die "El artefacto no trae .next/standalone/server.js"
else
  log "Dependencias"
  npm ci --no-audit --no-fund
  log "Build (memoria máxima ${BUILD_MEMORY_MB} MB; si se queda sin memoria, ver README › compilar afuera)"
  NEXT_DEPLOYMENT_ID="${RELEASE}" NODE_OPTIONS="--max-old-space-size=${BUILD_MEMORY_MB}" npm run build
  npm prune --omit=dev --no-audit --no-fund
fi

log "Verificando sharp"
node -e "require('${REL}/.next/standalone/node_modules/sharp')" 2>/dev/null || node -e "require('sharp')" || die "sharp no carga en este servidor (ver README › Solución de problemas)."

log "Migraciones de base de datos (prisma migrate deploy)"
npx prisma migrate deploy

PREV_ACTIVE="$(readlink -f "${CURRENT}" 2>/dev/null || true)"
log "Activando la release y recargando PM2 sin downtime"
switch_to "${REL}"

if ! health_check; then
  echo "La nueva versión no responde." >&2
  if [[ -n "${PREV_ACTIVE}" && -d "${PREV_ACTIVE}" ]]; then
    log "Rollback automático a ${PREV_ACTIVE}"
    switch_to "${PREV_ACTIVE}"
    health_check || true
  fi
  die "Deploy fallido. Revisá: pm2 logs pedila-web --lines 100"
fi

log "Limpieza de releases viejas (se conservan ${KEEP_RELEASES})"
ls -1d "${RELEASES}"/*/ | sed 's#/$##' | sort | head -n "-${KEEP_RELEASES}" | while read -r old; do
  [[ "${old}" == "$(readlink -f "${CURRENT}")" ]] || rm -rf "${old}"
done

trap - ERR
log "Deploy ${RELEASE} listo"
pm2 status
