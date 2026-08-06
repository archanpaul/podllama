#!/usr/bin/env bash
set -eo pipefail

WORKSPACE_DIR="${1:-${WORKSPACE_DIR:-$(pwd)}}"
WORKSPACE_DIR=$(realpath "${WORKSPACE_DIR}")
CLIENT_IMAGE="${CLIENT_IMAGE:-qwen-client:latest}"
QWEN_SERVER_HOST="${QWEN_SERVER_HOST:-127.0.0.1}"
QWEN_SERVER_PORT="${QWEN_SERVER_PORT:-4000}"

echo "Launching Qwen Code Workspace Client Container..."
echo "Workspace: ${WORKSPACE_DIR}"
echo "Server Endpoint: http://${QWEN_SERVER_HOST}:${QWEN_SERVER_PORT}"

exec podman run -it --rm \
    --name "qwen_code_client_$$" \
    --network host \
    -e QWEN_SERVER_HOST="${QWEN_SERVER_HOST}" \
    -e QWEN_SERVER_PORT="${QWEN_SERVER_PORT}" \
    -v "${WORKSPACE_DIR}:/workspace:Z" \
    -w /workspace \
    --userns=keep-id \
    "${CLIENT_IMAGE}"
