#!/usr/bin/env bash
set -eo pipefail

SERVER_HOST="${PODLLAMA_SERVER_HOST:-${PODLLAMA_HOST:-${QWEN_SERVER_HOST:-127.0.0.1}}}"
SERVER_PORT="${PODLLAMA_SERVER_PORT:-${PODLLAMA_PORT:-${QWEN_SERVER_PORT:-4000}}}"
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}/v1"

echo "=== Official QwenLM/qwen-code Agent Starting ==="
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
        echo "Connected to Qwen model server endpoint!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "Waiting for server (${RETRY_COUNT}/${MAX_RETRIES})..."
    sleep 2
done

if [ ${RETRY_COUNT} -eq ${MAX_RETRIES} ]; then
    echo "WARNING: Could not verify model server endpoint. Proceeding anyway..."
fi

# Environment variables for official QwenLM/qwen-code CLI
export OPENAI_BASE_URL="${SERVER_URL}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-local}"
export OPENAI_MODEL="${OPENAI_MODEL:-podllama-chat}"

QWEN_BIN=""
for candidate in "/usr/local/bin/qwen-code" "/usr/local/bin/qwen" "/opt/qwen-code/bin/qwen"; do
    if [ -x "${candidate}" ] && [ ! -d "${candidate}" ]; then
        QWEN_BIN="${candidate}"
        break
    fi
done

if [ -z "${QWEN_BIN}" ]; then
    QWEN_BIN=$(command -v qwen-code || command -v qwen || echo "/opt/qwen-code/bin/qwen")
fi

echo "Launching official QwenLM/qwen-code CLI..."
exec "${QWEN_BIN}" "$@"
