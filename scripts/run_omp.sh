#!/usr/bin/env bash
set -eo pipefail

# Parse workspace directory or CLI arguments cleanly
if [ -n "$1" ] && [ -d "$1" ]; then
    WORKSPACE_DIR=$(realpath "$1")
    shift
else
    WORKSPACE_DIR=$(realpath "${WORKSPACE_DIR:-$(pwd)}")
fi

OMP_IMAGE="${OMP_IMAGE:-podllama-omp:latest}"
PODLLAMA_SERVER_HOST="${PODLLAMA_SERVER_HOST:-${PODLLAMA_HOST:-${OMP_SERVER_HOST:-127.0.0.1}}}"
PODLLAMA_SERVER_PORT="${PODLLAMA_SERVER_PORT:-${PODLLAMA_PORT:-${OMP_SERVER_PORT:-4000}}}"

echo "Launching PodLlama Workspace OMP CLI Container (omp.sh)..."
echo "Workspace: ${WORKSPACE_DIR}"
echo "Server Endpoint: http://${PODLLAMA_SERVER_HOST}:${PODLLAMA_SERVER_PORT}"

exec podman run -it --rm \
    --name "podllama_omp_$$" \
    --network host \
    -e PODLLAMA_SERVER_HOST="${PODLLAMA_SERVER_HOST}" \
    -e PODLLAMA_SERVER_PORT="${PODLLAMA_SERVER_PORT}" \
    -v "${WORKSPACE_DIR}:/workspace:z" \
    -w /workspace \
    --userns=keep-id \
    "${OMP_IMAGE}" "$@"
