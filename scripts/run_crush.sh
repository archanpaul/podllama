#!/usr/bin/env bash
set -eo pipefail

WORKSPACE_DIR="${1:-${WORKSPACE_DIR:-$(pwd)}}"
WORKSPACE_DIR=$(realpath "${WORKSPACE_DIR}")
CLI_IMAGE="${CLI_IMAGE:-podllama-cli:latest}"
PODLLAMA_SERVER_HOST="${PODLLAMA_SERVER_HOST:-${PODLLAMA_HOST:-${CRUSH_SERVER_HOST:-127.0.0.1}}}"
PODLLAMA_SERVER_PORT="${PODLLAMA_SERVER_PORT:-${PODLLAMA_PORT:-${CRUSH_SERVER_PORT:-4000}}}"

echo "Launching PodLlama Workspace Client Container (Crush)..."
echo "Workspace: ${WORKSPACE_DIR}"
echo "Server Endpoint: http://${PODLLAMA_SERVER_HOST}:${PODLLAMA_SERVER_PORT}"

exec podman run -it --rm \
    --name "podllama_client_$$" \
    --network host \
    -e PODLLAMA_SERVER_HOST="${PODLLAMA_SERVER_HOST}" \
    -e PODLLAMA_SERVER_PORT="${PODLLAMA_SERVER_PORT}" \
    -v "${WORKSPACE_DIR}:/workspace:z" \
    -w /workspace \
    --userns=keep-id \
    "${CLI_IMAGE}"
