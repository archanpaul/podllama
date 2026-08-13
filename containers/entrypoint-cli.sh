#!/usr/bin/env bash
set -eo pipefail

SERVER_HOST="${PODLLAMA_SERVER_HOST:-${PODLLAMA_HOST:-${CRUSH_SERVER_HOST:-127.0.0.1}}}"
SERVER_PORT="${PODLLAMA_SERVER_PORT:-${PODLLAMA_PORT:-${CRUSH_SERVER_PORT:-4000}}}"
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}/v1"

echo "=== Official charmbracelet/crush Agent Starting ==="
echo "Workspace Directory: /workspace"
echo "Connecting to Model Endpoint: ${SERVER_URL}"

# Wait for model server endpoint to be healthy
echo "Waiting for model server readiness..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
    if curl -s "http://${SERVER_HOST}:${SERVER_PORT}/health/liveliness" > /dev/null 2>&1 || \
       curl -s -H "Authorization: Bearer ${OPENAI_API_KEY:-sk-local}" "${SERVER_URL}/models" > /dev/null 2>&1 || \
       curl -s "http://${SERVER_HOST}:${SERVER_PORT}/health" > /dev/null 2>&1; then
        echo "Connected to model server endpoint!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Waiting for server (${RETRY_COUNT}/${MAX_RETRIES})...."
    sleep 2
done

if [ ${RETRY_COUNT} -eq ${MAX_RETRIES} ]; then
    echo "WARNING: Could not verify model server endpoint. Proceeding anyway..."
fi

# Environment variables for charmbracelet/crush CLI
export OPENAI_BASE_URL="${SERVER_URL}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-local}"
export OPENAI_MODEL="${OPENAI_MODEL:-podllama-chat}"

# Configure ~/.config/crush/crush.json from template in /app/config/crush.json
mkdir -p ~/.config/crush
if [ -f /app/config/crush.json ]; then
    cp /app/config/crush.json ~/.config/crush/crush.json
else
    echo "WARNING: /app/config/crush.json not found, using default configuration."
fi

# Substitute runtime environment variables into crush.json
sed -i "s|\${SERVER_URL}|${SERVER_URL}|g" ~/.config/crush/crush.json
sed -i "s|\${OPENAI_API_KEY}|${OPENAI_API_KEY:-sk-local}|g" ~/.config/crush/crush.json

CRUSH_BIN=""
for candidate in "/usr/local/bin/crush" "/opt/crush/crush" "/opt/crush/bin/crush"; do
    if [ -x "${candidate}" ] && [ ! -d "${candidate}" ]; then
        CRUSH_BIN="${candidate}"
        break
    fi
done

if [ -z "${CRUSH_BIN}" ]; then
    CRUSH_BIN=$(command -v crush || echo "/usr/local/bin/crush")
fi

echo "Launching official charmbracelet/crush CLI..."
# Auto-inject --yolo flag if not explicitly passed by user
HAS_YOLO=0
for arg in "$@"; do
    if [ "${arg}" = "--yolo" ]; then
        HAS_YOLO=1
        break
    fi
done

if [ ${HAS_YOLO} -eq 1 ]; then
    exec "${CRUSH_BIN}" "$@"
else
    exec "${CRUSH_BIN}" --yolo "$@"
fi
