#!/bin/sh
# =============================================================================
# start.sh - Cloud Run optimalisert oppstart
# =============================================================================
#
# KRITISK FOR CLOUD RUN:
#   - Frontend MÅ starte FØRST og binde til 0.0.0.0:$PORT raskt
#   - Backend starter i bakgrunnen (frontend proxy'er /api/* til den)
#   - Startup probe (TCP på 8080) må passere innen timeout
#
# Arkitektur:
#   - Frontend (Next.js standalone): 0.0.0.0:$PORT (8080) - EKSTERN
#   - Backend (Express): 127.0.0.1:4000 - INTERN
#
# =============================================================================

set -eu

# =============================================================================
# KONFIGURASJON
# =============================================================================

FRONTEND_PORT="${PORT:-8080}"
FRONTEND_HOST="0.0.0.0"
BACKEND_PORT="4000"
BACKEND_HOST="127.0.0.1"

# PIDs
FRONTEND_PID=""
BACKEND_PID=""

# =============================================================================
# LOGGING
# =============================================================================

log() {
  echo "[start.sh] $(date '+%Y-%m-%d %H:%M:%S') $1"
}

log_error() {
  echo "[start.sh] $(date '+%Y-%m-%d %H:%M:%S') ERROR: $1" >&2
}

# =============================================================================
# DEBUG INFO (fjern etter deploy fungerer)
# =============================================================================

debug_info() {
  log "=== DEBUG INFO ==="
  log "PORT env: ${PORT:-not set}"
  log "FRONTEND_PORT: ${FRONTEND_PORT}"
  log "FRONTEND_HOST: ${FRONTEND_HOST}"
  log "NODE_ENV: ${NODE_ENV:-not set}"
  log "PWD: $(pwd)"
  log "--- Fil-struktur ---"
  ls -la /app/ 2>/dev/null || log "Kunne ikke liste /app/"
  log "--- server.js sjekk ---"
  if [ -f /app/server.js ]; then
    log "server.js FINNES på /app/server.js"
  else
    log_error "server.js MANGLER på /app/server.js!"
    log "Søker etter server.js..."
    find /app -name "server.js" 2>/dev/null | head -5 || true
  fi
  log "--- backend dist sjekk ---"
  if [ -f /app/backend/dist/index.js ]; then
    log "backend/dist/index.js FINNES"
  else
    log_error "backend/dist/index.js MANGLER!"
  fi
  log "=== END DEBUG ==="
}

# =============================================================================
# CLEANUP
# =============================================================================

cleanup() {
  log "Shutdown signal mottatt..."

  # Stop prosesser
  for pid in $FRONTEND_PID $BACKEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "Stopper PID $pid..."
      kill "$pid" 2>/dev/null || true
    fi
  done

  sleep 2

  # Force kill
  for pid in $FRONTEND_PID $BACKEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  log "Cleanup ferdig."
}

trap cleanup INT TERM EXIT

# =============================================================================
# MAIN - FRONTEND FØRST FOR RASK PORT BINDING
# =============================================================================

log "========================================"
log "StudyWise Cloud Run Startup"
log "========================================"

# Kjør debug info
debug_info

# -----------------------------------------------------------------------------
# 1. START FRONTEND FØRST (Cloud Run startup probe trenger 8080 ASAP)
# -----------------------------------------------------------------------------

log "STEG 1: Starter frontend på ${FRONTEND_HOST}:${FRONTEND_PORT}..."

if [ ! -f /app/server.js ]; then
  log_error "FATAL: /app/server.js finnes ikke!"
  log_error "Next.js standalone build mangler. Sjekk Dockerfile COPY steg."
  exit 1
fi

# Start frontend - HOSTNAME og PORT er påkrevd for Next.js standalone
HOSTNAME="${FRONTEND_HOST}" PORT="${FRONTEND_PORT}" node /app/server.js 2>&1 | sed -u 's/^/[frontend] /' &
FRONTEND_PID=$!

log "Frontend startet (PID=${FRONTEND_PID})"

# Gi frontend litt tid til å binde porten
sleep 2

# Verifiser at frontend kjører
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  log_error "Frontend krasjet umiddelbart!"
  exit 1
fi

log "Frontend kjører, port ${FRONTEND_PORT} skal nå være tilgjengelig"

# -----------------------------------------------------------------------------
# 2. START BACKEND I BAKGRUNNEN
# -----------------------------------------------------------------------------

log "STEG 2: Starter backend på ${BACKEND_HOST}:${BACKEND_PORT}..."

if [ ! -f /app/backend/dist/index.js ]; then
  log_error "FATAL: /app/backend/dist/index.js finnes ikke!"
  exit 1
fi

# Start backend med PORT=4000 (overstyrer Cloud Run sin PORT=8080)
PORT="${BACKEND_PORT}" node /app/backend/dist/index.js 2>&1 | sed -u 's/^/[backend] /' &
BACKEND_PID=$!

log "Backend startet (PID=${BACKEND_PID})"

# -----------------------------------------------------------------------------
# 3. VENT PÅ BACKEND HEALTH (ikke-blokkerende for Cloud Run probe)
# -----------------------------------------------------------------------------

log "STEG 3: Venter på backend health check (i bakgrunnen)..."

# Vent maks 30 sekunder på backend (ikke-kritisk for startup probe)
i=0
while [ "$i" -lt 30 ]; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log_error "Backend krasjet under oppstart!"
    # Ikke exit - la frontend fortsette å kjøre slik at Cloud Run probe passerer
    break
  fi

  if wget -q -O /dev/null --timeout=2 "http://${BACKEND_HOST}:${BACKEND_PORT}/health" 2>/dev/null; then
    log "Backend health OK etter ${i}s"
    break
  fi

  i=$((i + 1))
  sleep 1
done

if [ "$i" -ge 30 ]; then
  log_error "Backend health timeout (30s) - men frontend kjører fortsatt"
fi

# -----------------------------------------------------------------------------
# 4. BEKREFT STATUS
# -----------------------------------------------------------------------------

log "========================================"
log "STARTUP FULLFØRT"
log "========================================"
log "Frontend: ${FRONTEND_HOST}:${FRONTEND_PORT} (PID=${FRONTEND_PID})"
log "Backend:  ${BACKEND_HOST}:${BACKEND_PORT} (PID=${BACKEND_PID})"
log "========================================"

# Vis lyttende porter (debug)
if command -v netstat >/dev/null 2>&1; then
  log "Lyttende porter:"
  netstat -tlnp 2>/dev/null | grep -E ":(${FRONTEND_PORT}|${BACKEND_PORT})" || log "(netstat fant ingen)"
elif command -v ss >/dev/null 2>&1; then
  log "Lyttende porter:"
  ss -tlnp 2>/dev/null | grep -E ":(${FRONTEND_PORT}|${BACKEND_PORT})" || log "(ss fant ingen)"
fi

# -----------------------------------------------------------------------------
# 5. OVERVÅK PROSESSER
# -----------------------------------------------------------------------------

log "Overvåker prosesser..."

while true; do
  # Sjekk frontend (kritisk)
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    log_error "Frontend døde! Container må restarte."
    exit 1
  fi

  # Sjekk backend (viktig men ikke kritisk for Cloud Run probe)
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log_error "Backend døde! API-kall vil feile."
    # Ikke exit - la Cloud Run håndtere restart hvis nødvendig
  fi

  sleep 10
done
