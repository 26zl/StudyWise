#!/bin/sh
# =============================================================================
# start.sh - Starter backend + frontend i samme container for Cloud Run
# =============================================================================
#
# Arkitektur:
#   - Backend (Express): Intern på localhost:4000
#   - Frontend (Next.js standalone): Ekstern på 0.0.0.0:$PORT (Cloud Run PORT=8080)
#   - Frontend proxy'er /api/* til backend via Next.js rewrites
#
# Logging:
#   - Backend output prefixes med [backend]
#   - Frontend output prefixes med [frontend]
#   - Script output prefixes med [start.sh]
#   - Alt går til stdout/stderr som Cloud Run fanger opp
#
# Kompatibilitet: POSIX sh (Alpine/BusyBox ash)
# =============================================================================

set -eu

# =============================================================================
# KONFIGURASJON
# =============================================================================

BACKEND_PORT="4000"
BACKEND_HOST="127.0.0.1"
BACKEND_HEALTH_URL="http://${BACKEND_HOST}:${BACKEND_PORT}/health"
BACKEND_START_TIMEOUT="${BACKEND_START_TIMEOUT:-60}"

FRONTEND_PORT="${PORT:-8080}"
FRONTEND_HOST="0.0.0.0"

HEALTH_CHECK_INTERVAL="1"

# Process IDs
BACKEND_PID=""
FRONTEND_PID=""
BACKEND_LOG_PID=""
FRONTEND_LOG_PID=""

# Named pipes for output prefixing
BACKEND_FIFO="/tmp/backend_output_$$"
FRONTEND_FIFO="/tmp/frontend_output_$$"

# =============================================================================
# LOGGING
# =============================================================================

log() {
  printf '[start.sh] %s %s\n' "$(date '+%H:%M:%S')" "$1"
}

log_error() {
  printf '[start.sh] %s ERROR: %s\n' "$(date '+%H:%M:%S')" "$1" >&2
}

# =============================================================================
# CLEANUP
# =============================================================================

cleanup() {
  log "Mottok shutdown signal, stopper prosesser..."

  # Stop hovedprosesser (SIGTERM først)
  for pid in $FRONTEND_PID $BACKEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "Stopper prosess $pid..."
      kill "$pid" 2>/dev/null || true
    fi
  done

  # Vent på graceful shutdown
  sleep 2

  # Force kill hvis nødvendig
  for pid in $FRONTEND_PID $BACKEND_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "Force kill prosess $pid..."
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  # Vent litt så output flushes gjennom FIFO
  sleep 1

  # Stop log-prefixere
  for pid in $FRONTEND_LOG_PID $BACKEND_LOG_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  # Rydd opp FIFOs
  rm -f "$BACKEND_FIFO" "$FRONTEND_FIFO"

  log "Cleanup fullført."
}

trap cleanup INT TERM EXIT

# =============================================================================
# HEALTH CHECK
# =============================================================================

check_backend_health() {
  if command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null --timeout=2 "$BACKEND_HEALTH_URL" 2>/dev/null
  elif command -v curl >/dev/null 2>&1; then
    curl -fsS --connect-timeout 2 "$BACKEND_HEALTH_URL" >/dev/null 2>&1
  else
    log_error "Verken wget eller curl tilgjengelig!"
    return 1
  fi
}

# =============================================================================
# OUTPUT PREFIXING VIA NAMED PIPE
# =============================================================================
# Bruker FIFO + sed for å prefixe hver linje med [prefix].
# sed -u = unbuffered (line-buffered), støttes av BusyBox sed.
# Dette lar oss beholde PID til hovedprosessen mens output prefixes.

setup_output_prefix() {
  _fifo="$1"
  _prefix="$2"

  # Fjern gammel FIFO hvis den finnes, opprett ny
  rm -f "$_fifo"
  mkfifo "$_fifo"

  # Start prefixer i bakgrunnen
  # sed leser fra FIFO og prefixer hver linje
  sed -u "s/^/[${_prefix}] /" < "$_fifo" &

  # Returner PID via echo (caller må fange med $())
  echo $!
}

# =============================================================================
# MAIN
# =============================================================================

log "========================================"
log "StudyWise Container Startup"
log "========================================"
log "Backend:  ${BACKEND_HOST}:${BACKEND_PORT} (intern)"
log "Frontend: ${FRONTEND_HOST}:${FRONTEND_PORT} (ekstern)"
log "========================================"

# -----------------------------------------------------------------------------
# START BACKEND MED OUTPUT PREFIXING
# -----------------------------------------------------------------------------

log "Setter opp backend logging..."
BACKEND_LOG_PID=$(setup_output_prefix "$BACKEND_FIFO" "backend")
log "Backend log-prefixer startet (pid=${BACKEND_LOG_PID})"

log "Starter backend på port ${BACKEND_PORT}..."

# VIKTIG: PORT=4000 overstyrer Cloud Run sin PORT=8080 kun for backend
# Output går til FIFO som prefixes med [backend]
PORT="${BACKEND_PORT}" node /app/backend/dist/index.js > "$BACKEND_FIFO" 2>&1 &
BACKEND_PID=$!

log "Backend startet (pid=${BACKEND_PID})"

# -----------------------------------------------------------------------------
# VENT PÅ BACKEND HEALTH CHECK
# -----------------------------------------------------------------------------

log "Venter på backend health: ${BACKEND_HEALTH_URL}"

elapsed=0
while [ "$elapsed" -lt "$BACKEND_START_TIMEOUT" ]; do
  # Sjekk om backend fortsatt kjører
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log_error "Backend krasjet under oppstart!"
    log_error "Se [backend] linjer over for faktisk feilmelding."
    # Vent på at buffret output flushes gjennom FIFO
    sleep 3
    exit 1
  fi

  # Sjekk health endpoint
  if check_backend_health; then
    log "Backend health OK etter ${elapsed}s"
    break
  fi

  elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
  sleep "$HEALTH_CHECK_INTERVAL"
done

if [ "$elapsed" -ge "$BACKEND_START_TIMEOUT" ]; then
  log_error "Backend timeout etter ${BACKEND_START_TIMEOUT}s!"
  log_error "Health URL svarte ikke: ${BACKEND_HEALTH_URL}"
  log_error "Se [backend] linjer for detaljer."
  sleep 2
  exit 1
fi

# -----------------------------------------------------------------------------
# START FRONTEND MED OUTPUT PREFIXING
# -----------------------------------------------------------------------------

log "Setter opp frontend logging..."
FRONTEND_LOG_PID=$(setup_output_prefix "$FRONTEND_FIFO" "frontend")
log "Frontend log-prefixer startet (pid=${FRONTEND_LOG_PID})"

log "Starter frontend på ${FRONTEND_HOST}:${FRONTEND_PORT}..."

# HOSTNAME=0.0.0.0 sikrer binding til alle interfaces (påkrevd for Cloud Run)
HOSTNAME="${FRONTEND_HOST}" PORT="${FRONTEND_PORT}" node /app/server.js > "$FRONTEND_FIFO" 2>&1 &
FRONTEND_PID=$!

log "Frontend startet (pid=${FRONTEND_PID})"

log "========================================"
log "Container klar! Lytter på port ${FRONTEND_PORT}"
log "========================================"

# -----------------------------------------------------------------------------
# OVERVÅK PROSESSER
# -----------------------------------------------------------------------------

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    log_error "Backend døde uventet!"
    log_error "Se [backend] linjer for feilmelding."
    sleep 2
    exit 1
  fi

  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    log_error "Frontend døde uventet!"
    log_error "Se [frontend] linjer for feilmelding."
    sleep 2
    exit 1
  fi

  sleep 5
done
