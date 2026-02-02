#!/bin/sh
# =============================================================================
# start.sh - Cloud Run optimalisert oppstart (robust versjon)
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
# LOGGING (Cloud Run fanger stdout/stderr automatisk)
# =============================================================================

log() {
  echo "[start.sh] $(date '+%H:%M:%S') $1"
}

log_error() {
  echo "[start.sh] $(date '+%H:%M:%S') ERROR: $1" >&2
}

# =============================================================================
# CLEANUP
# =============================================================================

cleanup() {
  log "Shutdown signal mottatt..."

  for pid in $FRONTEND_PID $BACKEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "Stopper PID $pid..."
      kill "$pid" 2>/dev/null || true
    fi
  done

  sleep 1

  for pid in $FRONTEND_PID $BACKEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  log "Cleanup ferdig."
  exit 0
}

trap cleanup INT TERM

# =============================================================================
# MAIN
# =============================================================================

log "========================================"
log "StudyWise Cloud Run Startup"
log "Frontend: ${FRONTEND_HOST}:${FRONTEND_PORT}"
log "Backend:  ${BACKEND_HOST}:${BACKEND_PORT}"
log "========================================"

# -----------------------------------------------------------------------------
# 1. START FRONTEND (Cloud Run trenger port binding ASAP)
# -----------------------------------------------------------------------------

if [ ! -f /app/frontend/server.js ]; then
  log_error "FATAL: /app/frontend/server.js finnes ikke!"
  exit 1
fi

log "Starter frontend..."

# Start frontend UTEN pipe - direkte til stdout
HOSTNAME="${FRONTEND_HOST}" PORT="${FRONTEND_PORT}" node /app/frontend/server.js &
FRONTEND_PID=$!

log "Frontend PID: ${FRONTEND_PID}"

# Kort pause for port-binding
sleep 1

if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  log_error "Frontend krasjet ved oppstart!"
  exit 1
fi

# -----------------------------------------------------------------------------
# 2. START BACKEND
# -----------------------------------------------------------------------------

if [ ! -f /app/backend/dist/index.js ]; then
  log_error "FATAL: /app/backend/dist/index.js finnes ikke!"
  exit 1
fi

log "Starter backend..."

# Debug: Vis hvilke env vars som er satt (uten verdier for sikkerhet)
log "Env vars satt: $(env | grep -E '^(MONGO_URI|JWT_|ENCRYPTION|REDIS|HUGGING|NODE_ENV|WEB_ORIGIN|CANVAS)' | cut -d= -f1 | tr '\n' ' ')"

# Start backend med eksplisitt PORT
# Output til fil for å fange crash-meldinger
BACKEND_LOG="/tmp/backend.log"
PORT="${BACKEND_PORT}" node /app/backend/dist/index.js > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

log "Backend PID: ${BACKEND_PID}"

# Vent og sjekk om backend fortsatt kjører
sleep 3
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  log_error "Backend krasjet! Exit status og output:"
  wait "$BACKEND_PID" 2>/dev/null
  EXIT_CODE=$?
  log_error "Exit code: $EXIT_CODE"
  log_error "Backend log output:"
  cat "$BACKEND_LOG" 2>/dev/null || log_error "(ingen output)"
else
  # Backend kjører, vis eventuelle tidlige meldinger
  log "Backend kjører. Tidlig output:"
  head -20 "$BACKEND_LOG" 2>/dev/null || true
fi

# Fortsett å streame backend logs til stdout
tail -f "$BACKEND_LOG" 2>/dev/null &

# -----------------------------------------------------------------------------
# 3. VENT PÅ BACKEND HEALTH
# -----------------------------------------------------------------------------

log "Venter på backend health..."
i=0
while [ "$i" -lt 30 ]; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log_error "Backend krasjet under oppstart!"
    break
  fi

  if wget -q -O /dev/null --timeout=2 "http://${BACKEND_HOST}:${BACKEND_PORT}/health" 2>/dev/null; then
    log "Backend klar etter ${i}s"
    break
  fi

  i=$((i + 1))
  sleep 1
done

if [ "$i" -ge 30 ]; then
  log_error "Backend health timeout"
fi

# -----------------------------------------------------------------------------
# 4. KLAR - OVERVÅK
# -----------------------------------------------------------------------------

log "========================================"
log "OPPSTART FULLFØRT"
log "========================================"

# Hold containeren i live ved å vente på frontend
# Hvis frontend dør, exit med feil så Cloud Run restarter
wait "$FRONTEND_PID"
EXIT_CODE=$?

log_error "Frontend avsluttet med kode $EXIT_CODE"
exit $EXIT_CODE
