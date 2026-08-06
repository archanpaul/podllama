#!/usr/bin/env bash
set -eo pipefail

SERVER_HOST="${QWEN_SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${QWEN_SERVER_PORT:-4000}"
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}/v1"

echo "=== Official QwenLM/qwen-code Agent Starting ==="
echo "Workspace Directory: /workspace"
echo "Connecting to Model Endpoint: ${SERVER_URL}"

# Wait for model server endpoint to be healthy
echo "Waiting for model server readiness..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ ${RETRY_COUNT} -lt ${MAX_RETRIES} ]; do
    if curl -s "http://${SERVER_HOST}:${SERVER_PORT}/health" > /dev/null 2>&1 || \
       curl -s "${SERVER_URL}/models" > /dev/null 2>&1; then
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
export OPENAI_MODEL="${OPENAI_MODEL:-qwen-chat}"

QWEN_BIN=$(command -v qwen-code || command -v qwen || echo "/usr/local/bin/qwen-code")

echo "Launching official QwenLM/qwen-code CLI..."
exec "${QWEN_BIN}" "$@"
