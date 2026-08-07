#!/usr/bin/env bash
set -eo pipefail

CONFIG_FILE="${LITELLM_CONFIG:-/app/config.yaml}"
PORT="${LITELLM_PORT:-4000}"
HOST="${LITELLM_HOST:-0.0.0.0}"

echo "=== LiteLLM Proxy Server Starting ==="
echo "Config: ${CONFIG_FILE}"
echo "Listening on: ${HOST}:${PORT}"

# Wait for at least one backend model server to be reachable
CHAT_HOST="${CHAT_SERVER_HOST:-podllama_chat}"
CHAT_PORT="${CHAT_SERVER_PORT:-8080}"
AUTOCOMPLETE_HOST="${AUTOCOMPLETE_SERVER_HOST:-podllama_autocomplete}"
AUTOCOMPLETE_PORT="${AUTOCOMPLETE_SERVER_PORT:-8080}"

echo "Waiting for backend model servers..."
MAX_RETRIES=60
RETRY_COUNT=0

# Use python for health checks since curl may not be available in the
# official litellm image.  Falls back to curl if python is missing.
health_check() {
    local host="$1" port="$2"
    if command -v python3 &>/dev/null; then
        python3 -c "
import urllib.request, sys
try:
    urllib.request.urlopen('http://${host}:${port}/health', timeout=2)
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null
    elif command -v python &>/dev/null; then
        python -c "
import urllib.request, sys
try:
    urllib.request.urlopen('http://${host}:${port}/health', timeout=2)
    sys.exit(0)
except Exception:
    sys.exit(1)
" 2>/dev/null
    elif command -v curl &>/dev/null; then
        curl -s -m 2 "http://${host}:${port}/health" > /dev/null 2>&1
    else
        # No tool available; skip health check and start immediately
        echo "WARNING: Neither python nor curl found; skipping backend health check."
        return 0
    fi
}

while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
    if health_check "${CHAT_HOST}" "${CHAT_PORT}" || \
       health_check "${AUTOCOMPLETE_HOST}" "${AUTOCOMPLETE_PORT}"; then
        echo "Backend model server is reachable!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Waiting for backend servers (${RETRY_COUNT}/${MAX_RETRIES})..."
    sleep 2
done

if [ ${RETRY_COUNT} -eq ${MAX_RETRIES} ]; then
    echo "WARNING: Could not reach backend model servers after ${MAX_RETRIES} attempts. Starting proxy anyway..."
fi

echo "Launching LiteLLM Proxy..."
exec litellm --config "${CONFIG_FILE}" --port "${PORT}" --host "${HOST}" "$@"
