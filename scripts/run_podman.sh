#!/usr/bin/env bash
set -eo pipefail

MODE="${1:-client}"
WORKSPACE_DIR="${2:-$(pwd)}"
MODELS_DIR="${MODELS_DIR:-${HOME}/.cache/qwen_models}"
POD_NAME="qwen_code_pod"
SERVER_CONTAINER_NAME="qwen_server"
CLIENT_CONTAINER_NAME="qwen_code_client"

mkdir -p "${MODELS_DIR}"
WORKSPACE_DIR=$(realpath "${WORKSPACE_DIR}")

echo "Mode: ${MODE}"
echo "Workspace: ${WORKSPACE_DIR}"
echo "Models Cache: ${MODELS_DIR}"

case "${MODE}" in
    server)
        echo "Starting Qwen Model Server Container..."
        podman run -d \
            --name "${SERVER_CONTAINER_NAME}" \
            --replace \
            --device /dev/dri \
            -p 8080:8080 \
            -v "${MODELS_DIR}:/models:Z" \
            qwen-server:latest
        echo "Model server container started!"
        ;;

    client)
        echo "Launching Qwen Code Workspace Client Container..."
        # Link to server if running on host network or podman network
        podman run -it --rm \
            --name "${CLIENT_CONTAINER_NAME}_$$" \
            --network host \
            -e QWEN_SERVER_HOST="127.0.0.1" \
            -e QWEN_SERVER_PORT="8080" \
            -v "${WORKSPACE_DIR}:/workspace:Z" \
            -w /workspace \
            --userns=keep-id \
            qwen-client:latest
        ;;

    pod)
        echo "Creating and running Qwen Code Pod..."
        podman pod create --name "${POD_NAME}" -p 8080:8080 --replace
        
        echo "Launching Model Server in Pod..."
        podman run -d \
            --pod "${POD_NAME}" \
            --name "${SERVER_CONTAINER_NAME}" \
            --replace \
            --device /dev/dri \
            -v "${MODELS_DIR}:/models:Z" \
            qwen-server:latest

        echo "Launching Workspace Client in Pod..."
        podman run -it --rm \
            --pod "${POD_NAME}" \
            --name "${CLIENT_CONTAINER_NAME}" \
            -e QWEN_SERVER_HOST="127.0.0.1" \
            -e QWEN_SERVER_PORT="8080" \
            -v "${WORKSPACE_DIR}:/workspace:Z" \
            -w /workspace \
            --userns=keep-id \
            qwen-client:latest
        ;;

    status)
        echo "=== Qwen Podman Status ==="
        podman ps --filter "name=qwen"
        ;;

    stop)
        echo "Stopping Qwen Podman containers..."
        podman stop "${SERVER_CONTAINER_NAME}" || true
        podman pod stop "${POD_NAME}" || true
        podman pod rm "${POD_NAME}" || true
        echo "Stopped."
        ;;

    *)
        echo "Usage: $0 {server|client [workspace_dir]|pod|status|stop}"
        exit 1
        ;;
esac

