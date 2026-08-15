#!/usr/bin/env bash
set -eo pipefail

SERVER_HOST="${PODLLAMA_SERVER_HOST:-${PODLLAMA_HOST:-${OMP_SERVER_HOST:-${PI_SERVER_HOST:-${CRUSH_SERVER_HOST:-127.0.0.1}}}}}"
SERVER_PORT="${PODLLAMA_SERVER_PORT:-${PODLLAMA_PORT:-${OMP_SERVER_PORT:-${PI_SERVER_PORT:-${CRUSH_SERVER_PORT:-4000}}}}}"
SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}/v1"

echo "=== Oh My Pi (omp.sh) Agent Starting ==="
echo "Workspace Directory: /workspace"
echo "Connecting to Model Endpoint: ${SERVER_URL}"

# Ensure current user UID is registered in /etc/passwd for Node/Bun compatibility under --userns=keep-id
USER_ID=$(id -u 2>/dev/null || echo "1000")
if ! grep -q "^[^:]*:[^:]*:${USER_ID}:" /etc/passwd 2>/dev/null; then
    USER_NAME=$(id -un 2>/dev/null || echo "appuser")
    GROUP_ID=$(id -g 2>/dev/null || echo "${USER_ID}")
    echo "${USER_NAME}:x:${USER_ID}:${GROUP_ID}:${USER_NAME}:/workspace:/bin/bash" >> /etc/passwd 2>/dev/null || true
fi

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

# Environment variables
export OPENAI_BASE_URL="${SERVER_URL}"
export OPENAI_API_BASE="${SERVER_URL}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-local}"
export OMP_DISABLE_TELEMETRY=1
export PI_DISABLE_TELEMETRY=1

TARGET_MODEL="${OPENAI_MODEL:-podllama-chat}"
# Normalize model string if user passed without provider prefix
if [ "${TARGET_MODEL}" = "podllama-chat" ] || [ "${TARGET_MODEL}" = "podllama-thinking" ]; then
    OMP_MODEL="podllama/${TARGET_MODEL}"
elif [ "${TARGET_MODEL}" = "chat" ]; then
    OMP_MODEL="podllama/podllama-chat"
elif [ "${TARGET_MODEL}" = "thinking" ]; then
    OMP_MODEL="podllama/podllama-thinking"
else
    OMP_MODEL="${TARGET_MODEL}"
fi

# Populate ~/.omp/agent/models.yml and config.json
CONFIG_DIR="${HOME:-/tmp}/.omp/agent"
mkdir -p "${CONFIG_DIR}" 2>/dev/null || { CONFIG_DIR="/tmp/.omp/agent"; mkdir -p "${CONFIG_DIR}"; }

cat << EOF_MODELS > "${CONFIG_DIR}/models.yml"
providers:
  podllama:
    baseUrl: "${SERVER_URL}"
    apiKey: "${OPENAI_API_KEY:-sk-local}"
    api: "openai-completions"
    models:
      - id: "podllama-chat"
        name: "PodLlama Chat"
        contextWindow: 16384
      - id: "podllama-thinking"
        name: "PodLlama Thinking"
        contextWindow: 16384
EOF_MODELS

cat << EOF_JSON > "${CONFIG_DIR}/config.json"
{
  "model": "${OMP_MODEL}",
  "theme": "dark",
  "approvalMode": "always-ask"
}
EOF_JSON

cat << EOF_OMP > "${CONFIG_DIR}/OMP.md"
# Agent Instructions

You are an Oh My Pi (omp.sh) coding agent operating inside a workspace at /workspace.

## Critical Rules
- ALWAYS use tools to create or overwrite files. Never just describe code in text.
- ALWAYS use relative file paths for tools (e.g. \`hello.py\` or \`src/main.py\`). NEVER use absolute paths starting with \`/\` or \`/workspace/\`.
- ALWAYS execute tool calls to create or modify files when asked.
EOF_OMP

# Also mirror to project .omp directory if writable
if [ -d "/workspace" ] && [ -w "/workspace" ]; then
    mkdir -p /workspace/.omp 2>/dev/null || true
    cp "${CONFIG_DIR}/models.yml" /workspace/.omp/models.yml 2>/dev/null || true
    cp "${CONFIG_DIR}/config.json" /workspace/.omp/config.json 2>/dev/null || true
fi

OMP_BIN=""
for candidate in "/usr/local/bin/omp" "/usr/bin/omp" "/opt/omp/bin/omp" "$(which omp 2>/dev/null)"; do
    if [ -n "${candidate}" ] && [ -x "${candidate}" ] && [ ! -d "${candidate}" ]; then
        OMP_BIN="${candidate}"
        break
    fi
done

if [ -z "${OMP_BIN}" ]; then
    OMP_BIN=$(command -v omp || echo "/usr/local/bin/omp")
fi

echo "Launching Oh My Pi (omp.sh) CLI (Model: ${OMP_MODEL})..."

# Check if model flag already provided in args
HAS_MODEL_FLAG=false
for arg in "$@"; do
    if [ "${arg}" = "-m" ] || [ "${arg}" = "--model" ] || [[ "${arg}" == --model=* ]]; then
        HAS_MODEL_FLAG=true
        break
    fi
done

if [ "${HAS_MODEL_FLAG}" = true ]; then
    exec "${OMP_BIN}" "$@"
else
    exec "${OMP_BIN}" --model "${OMP_MODEL}" "$@"
fi
