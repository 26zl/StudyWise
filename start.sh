#!/bin/sh
# =============================================================================
# start.sh - Starter backend + frontend i samme container for Cloud Run
# =============================================================================
#
# Arkitektur:
#   - Backend (Express): Intern på localhost:4000
#   - Frontend (Next.js standalone): Ekstern på 0.0.0.0:$PORT (Cloud Run setter PORT=8080)
#   - Frontend proxy'er /api/* til backend via Next.js rewrites
#
# Cloud Run krav:
#   - Container MÅ lytte på $PORT (vanligvis 8080) innen timeout
#   - Kun frontend eksponeres eksternt, backend er intern
#
# Kompatibilitet: POSIX sh (Alpine/BusyBox ash) - ingen bash-ismer
# =============================================================================

set -eu

# =============================================================================
# KONFIGURASJON
# =============================================================================

# Backend kjører ALLTID på port 4000 internt (ignorerer Cloud Run PORT)
BACKEND_PORT="4000"
BACKEND_HOST="127.0.0.1"
BACKEND_HEALTH_URL="http://${BACKEND_HOST}:${BACKEND_PORT}/health"
BACKEND_START_TIMEOUT="${BACKEND_START_TIMEOUT:-60}"

# Frontend bruker Cloud Run sin PORT (default 8080) og binder til alle interfaces
FRONTEND_PORT="${PORT:-8080}"
FRONTEND_HOST="0.0.0.0"

# Timing
HEALTH_CHECK_INTERVAL="1"

# Process IDs
BACKEND_PID=""
FRONTEND_PID=""

# =============================================================================
# LOGGING
# =============================================================================

log() {
  echo "[start.sh] $(date '+%H:%M:%S') $1"
}

log_error() {
  echo "[start.sh] $(date '+%H:%M:%S') ERROR: $1" >&2
}

# =============================================================================
# CLEANUP / GRACEFUL SHUTDOWN
# =============================================================================

cleanup() {
  log "Mottok shutdown signal, stopper prosesser..."

  # Stop frontend først (den er eksponert)
  if [ -n "${FRONTEND_PID}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    log "Stopper frontend (pid=${FRONTEND_PID})..."
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi

  # Stop backend
  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    log "Stopper backend (pid=${BACKEND_PID})..."
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi

  # Gi prosessene tid til graceful shutdown
  sleep 2

  # Force kill hvis de fortsatt lever
  if [ -n "${FRONTEND_PID}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    log "Frontend svarer ikke, sender SIGKILL..."
    kill -9 "${FRONTEND_PID}" 2>/dev/null || true
  fi

  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    log "Backend svarer ikke, sender SIGKILL..."
    kill -9 "${BACKEND_PID}" 2>/dev/null || true
  fi

  log "Cleanup fullfort."
}

# Cloud Run sender SIGTERM ved shutdown
trap cleanup INT TERM EXIT

# =============================================================================
# HEALTH CHECK
# =============================================================================

check_backend_health() {
  if command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --timeout=2 "${BACKEND_HEALTH_URL}" 2>/dev/null
  elif command -v curl >/dev/null 2>&1; then
    curl -fsS --connect-timeout 2 "${BACKEND_HEALTH_URL}" >/dev/null 2>&1
  else
    log_error "Verken wget eller curl er tilgjengelig!"
    return 1
  fi
}

# =============================================================================
# START BACKEND
# =============================================================================

log "========================================"
log "StudyWise Container Startup"
log "========================================"
log "Backend:  ${BACKEND_HOST}:${BACKEND_PORT} (intern)"
log "Frontend: ${FRONTEND_HOST}:${FRONTEND_PORT} (ekstern/Cloud Run)"
log "========================================"

log "Starter backend..."

# VIKTIG: Vi overstyrer PORT til 4000 KUN for backend-prosessen
# Dette hindrer at backend arver Cloud Run sin PORT=8080
PORT="${BACKEND_PORT}" node /app/backend/dist/index.js &
BACKEND_PID="$!"

log "Backend startet med pid=${BACKEND_PID}, venter på health check..."

# =============================================================================
# VENT PÅ BACKEND HEALTH
# =============================================================================

elapsed=0
while [ "${elapsed}" -lt "${BACKEND_START_TIMEOUT}" ]; do
  # Sjekk om backend fortsatt kjører
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    log_error "Backend krasjet under oppstart!"
    log_error "Sjekk at alle env-variabler er satt (MONGO_URI, JWT_*, etc.)"
    exit 1
  fi

  # Sjekk health endpoint
  if check_backend_health; then
    log "Backend health check OK etter ${elapsed}s"
    break
  fi

  elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
  sleep "${HEALTH_CHECK_INTERVAL}"
done

if [ "${elapsed}" -ge "${BACKEND_START_TIMEOUT}" ]; then
  log_error "Backend ble ikke klar innen ${BACKEND_START_TIMEOUT}s!"
  log_error "Health URL: ${BACKEND_HEALTH_URL}"
  log_error "Mulige årsaker:"
  log_error "  - Database connection timeout (sjekk MONGO_URI)"
  log_error "  - Manglende env-variabler"
  log_error "  - Backend lytter på feil port"
  exit 1
fi

# =============================================================================
# START FRONTEND
# =============================================================================

log "Starter frontend på ${FRONTEND_HOST}:${FRONTEND_PORT}..."

# Next.js standalone trenger HOSTNAME og PORT
# HOSTNAME=0.0.0.0 sikrer at den binder til alle interfaces (påkrevd for Cloud Run)
HOSTNAME="${FRONTEND_HOST}" PORT="${FRONTEND_PORT}" node /app/server.js &
FRONTEND_PID="$!"

log "Frontend startet med pid=${FRONTEND_PID}"
log "========================================"
log "Container er klar! Lytter på port ${FRONTEND_PORT}"
log "========================================"

# =============================================================================
# OVERVÅK PROSESSER
# =============================================================================

# Hvis én prosess dør, avslutt containeren (Cloud Run vil restarte)
while true; do
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    log_error "Backend prosessen døde uventet!"
    exit 1
  fi

  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    log_error "Frontend prosessen døde uventet!"
    exit 1
  fi

  sleep 5
done
