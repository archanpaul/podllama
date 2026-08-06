#!/usr/bin/env bash
set -eo pipefail

CONFIG_FILE="${LITELLM_CONFIG:-/app/config.yaml}"
PORT="${LITELLM_PORT:-4000}"
HOST="${LITELLM_HOST:-0.0.0.0}"

echo "=== LiteLLM Proxy Server Starting ==="
echo "Config: ${CONFIG_FILE}"
echo "Listening on: ${HOST}:${PORT}"

# Wait for at least one backend model server to be reachable
CHAT_HOST="${CHAT_SERVER_HOST:-qwen_server_chat}"
CHAT_PORT="${CHAT_SERVER_PORT:-8080}"
AUTOCOMPLETE_HOST="${AUTOCOMPLETE_SERVER_HOST:-qwen_server_autocomplete}"
AUTOCOMPLETE_PORT="${AUTOCOMPLETE_SERVER_PORT:-8081}"

echo "Waiting for backend model servers..."
MAX_RETRIES=60
RETRY_COUNT=0

while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
    if curl -s -m 2 "http://${CHAT_HOST}:${CHAT_PORT}/health" > /dev/null 2>&1 || \
       curl -s -m 2 "http://${AUTOCOMPLETE_HOST}:${AUTOCOMPLETE_PORT}/health" > /dev/null 2>&1; then
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
