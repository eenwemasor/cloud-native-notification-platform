#!/bin/sh
set -e

wait_tcp() {
  local host="$1" port="$2" label="$3"
  printf "[entrypoint] Waiting for %s (%s:%s)..." "$label" "$host" "$port"
  until nc -z "$host" "$port" 2>/dev/null; do
    printf "."
    sleep 2
  done
  echo " ready"
}

wait_http() {
  local url="$1" label="$2"
  printf "[entrypoint] Waiting for %s (%s)..." "$label" "$url"
  until wget -q --spider "$url" 2>/dev/null; do
    printf "."
    sleep 2
  done
  echo " ready"
}

# Parse KAFKA_BROKERS (first broker only, e.g. "kafka:29092")
BROKER="${KAFKA_BROKERS:-kafka:29092}"
KAFKA_HOST="${BROKER%%:*}"
KAFKA_PORT="${BROKER##*:}"

SMTP_HOST="${SMTP_HOST:-mailhog}"
SMTP_PORT="${SMTP_PORT:-1025}"

wait_tcp "$KAFKA_HOST" "$KAFKA_PORT" "kafka"
wait_http "${SCHEMA_REGISTRY_URL:-http://schema-registry:8081}/subjects" "schema-registry"
wait_tcp "$SMTP_HOST" "$SMTP_PORT" "smtp"

echo "[entrypoint] All dependencies ready — starting email-service"
exec node dist/index.js
