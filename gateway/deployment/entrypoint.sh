#!/bin/sh
set -e

wait_tcp() {
  local host="$1" port="$2" label="$3"
  echo "[entrypoint] Waiting for $label ($host:$port)..."
  until nc -z "$host" "$port" 2>/dev/null; do
    sleep 2
  done
  echo "[entrypoint] $label is ready"
}

wait_http() {
  local url="$1" label="$2"
  echo "[entrypoint] Waiting for $label ($url)..."
  until wget -q --spider "$url" 2>/dev/null; do
    sleep 2
  done
  echo "[entrypoint] $label is ready"
}

# Parse KAFKA_BROKERS (first broker only, e.g. "kafka:29092")
BROKER="${KAFKA_BROKERS:-kafka:29092}"
KAFKA_HOST="${BROKER%%:*}"
KAFKA_PORT="${BROKER##*:}"

wait_tcp "$KAFKA_HOST" "$KAFKA_PORT" "kafka"
wait_http "${SCHEMA_REGISTRY_URL:-http://schema-registry:8081}/subjects" "schema-registry"

echo "[entrypoint] All dependencies ready — starting gateway"
exec node dist/index.js
