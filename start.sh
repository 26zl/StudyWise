#!/bin/sh
# Oppstartsskript for StudyWise
# Starter backend på port 4000, frontend på PORT (Cloud Run sin port)
set -e

BACKEND_PID=""
FRONTEND_PID=""

# Graceful shutdown - fanger SIGTERM fra Cloud Run
cleanup() {
  echo "Mottok shutdown-signal, avslutter gracefully..."

  if [ -n "$FRONTEND_PID" ]; then
    kill $FRONTEND_PID 2>/dev/null || true
  fi

  if [ -n "$BACKEND_PID" ]; then
    kill $BACKEND_PID 2>/dev/null || true
  fi

  # Vent på at prosessene avsluttes
  wait $FRONTEND_PID 2>/dev/null || true
  wait $BACKEND_PID 2>/dev/null || true

  echo "Shutdown fullfort"
  exit 0
}

trap cleanup SIGTERM SIGINT

# Start backend i bakgrunnen
echo "Starter backend på port 4000..."
node backend/dist/index.js &
BACKEND_PID=$!

# Vent på at backend er klar (maks 30 sekunder)
echo "Venter på at backend skal bli klar..."
RETRIES=0
MAX_RETRIES=30

while [ $RETRIES -lt $MAX_RETRIES ]; do
  if wget -q --spider http://localhost:4000/health 2>/dev/null; then
    echo "Backend er klar!"
    break
  fi

  # Sjekk om backend-prosessen fortsatt kjorer
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "FEIL: Backend-prosessen krasjet under oppstart"
    exit 1
  fi

  RETRIES=$((RETRIES + 1))
  echo "Forsok $RETRIES/$MAX_RETRIES - venter 1 sekund..."
  sleep 1
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
  echo "FEIL: Backend ble ikke klar innen $MAX_RETRIES sekunder"
  kill $BACKEND_PID 2>/dev/null || true
  exit 1
fi

# Start frontend på Cloud Run sin PORT (default 8080)
echo "Starter frontend på port ${PORT:-8080}..."
export HOSTNAME="0.0.0.0"
export INTERNAL_API_URL="http://localhost:4000"
node server.js &
FRONTEND_PID=$!

echo "StudyWise kjorer - backend PID: $BACKEND_PID, frontend PID: $FRONTEND_PID"

# Vent på at en av prosessene avsluttes
wait -n $BACKEND_PID $FRONTEND_PID 2>/dev/null || wait $BACKEND_PID $FRONTEND_PID

# Hvis vi kommer hit uten signal, har en prosess krasjet
echo "En prosess avsluttet uventet, avslutter..."
cleanup
