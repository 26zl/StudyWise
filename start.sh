#!/bin/sh
# start.sh - Starter backend + frontend i samme container
# - Backend: Node/Express på port 4000
# - Frontend: Next.js standalone på $PORT (Cloud Run setter PORT)
#
# Denne fila er skrevet for å være kompatibel med Alpine/BusyBox (ash),
# derfor brukes IKKE "wait -n" (som kan mangle).

set -eu

# -----------------------------
# Konfig (kan endres ved behov)
# -----------------------------
BACKEND_PORT="${BACKEND_PORT:-4000}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:${BACKEND_PORT}/health}"
BACKEND_START_TIMEOUT="${BACKEND_START_TIMEOUT:-60}"  # sekunder
SLEEP_BETWEEN_CHECKS="${SLEEP_BETWEEN_CHECKS:-1}"

# Cloud Run setter PORT automatisk. Vi fallbacker til 8080 lokalt.
PORT="${PORT:-8080}"

# PIDs for prosessene
BACKEND_PID=""
FRONTEND_PID=""

# -----------------------------
# Cleanup ved exit / signal
# -----------------------------
cleanup() {
  echo "[start.sh] Stopper prosesser..."

  # Stop frontend først
  if [ -n "${FRONTEND_PID}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "[start.sh] Stopper frontend (pid=${FRONTEND_PID})"
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi

  # Stop backend
  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[start.sh] Stopper backend (pid=${BACKEND_PID})"
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi

  # Vent litt på at de faktisk dør (best effort)
  sleep 1

  # Hard kill hvis de fortsatt lever
  if [ -n "${FRONTEND_PID}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "[start.sh] Frontend lever fortsatt, SIGKILL..."
    kill -9 "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[start.sh] Backend lever fortsatt, SIGKILL..."
    kill -9 "${BACKEND_PID}" 2>/dev/null || true
  fi

  echo "[start.sh] Cleanup ferdig."
}

# Kjør cleanup ved ctrl+c / SIGTERM (Cloud Run sender SIGTERM ved shutdown)
trap cleanup INT TERM EXIT

# -----------------------------
# Hjelpefunksjon: sjekk URL
# -----------------------------
check_health() {
  # Bruk wget hvis tilgjengelig (alpine har ofte wget). Fallback til curl hvis du har det.
  if command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "${BACKEND_HEALTH_URL}"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsS "${BACKEND_HEALTH_URL}" >/dev/null
  else
    echo "[start.sh] FEIL: Verken wget eller curl finnes i image."
    return 1
  fi
}

# -----------------------------
# Start backend
# -----------------------------
echo "[start.sh] Starter backend på port ${BACKEND_PORT}..."
# Antakelse: backend entry ligger i /app/backend/dist/index.js
# (tilpass om du har annet entrypoint)
node /app/backend/dist/index.js &
BACKEND_PID="$!"
echo "[start.sh] Backend pid=${BACKEND_PID}"

# -----------------------------
# Vent på at backend blir klar
# -----------------------------
echo "[start.sh] Venter på backend health: ${BACKEND_HEALTH_URL}"
i=0
while [ "${i}" -lt "${BACKEND_START_TIMEOUT}" ]; do
  if check_health >/dev/null 2>&1; then
    echo "[start.sh] Backend er klar ✅"
    break
  fi

  # Hvis backend døde under oppstart, feiler vi tidlig
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[start.sh] FEIL: Backend avsluttet under oppstart."
    exit 1
  fi

  i=$((i + 1))
  sleep "${SLEEP_BETWEEN_CHECKS}"
done

if [ "${i}" -ge "${BACKEND_START_TIMEOUT}" ]; then
  echo "[start.sh] FEIL: Backend ble ikke klar innen ${BACKEND_START_TIMEOUT}s."
  echo "[start.sh] Tips: Sørg for at backend har GET /health som svarer 200."
  exit 1
fi

# -----------------------------
# Start frontend (Next standalone)
# -----------------------------
echo "[start.sh] Starter frontend på PORT=${PORT}..."
# Antakelse: Next standalone server ligger i /app/server.js
# (det er standard for Next standalone output)
PORT="${PORT}" node /app/server.js &
FRONTEND_PID="$!"
echo "[start.sh] Frontend pid=${FRONTEND_PID}"

# -----------------------------
# Overvåk prosessene (portable)
# - Hvis én dør, stopper vi den andre og exit'er
# -----------------------------
echo "[start.sh] Begge prosesser kjører. Overvåker..."
while true; do
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "[start.sh] Backend døde. Avslutter..."
    exit 1
  fi

  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    echo "[start.sh] Frontend døde. Avslutter..."
    exit 1
  fi

  sleep 1
done