#!/usr/bin/env bash
set -eo pipefail

CONFIG_FILE="/app/config/model_conf.yaml"
MODELS_DIR="/models"

if [ -f "/models/model_conf.yaml" ]; then
    CONFIG_FILE="/models/model_conf.yaml"
fi

echo "=== Qwen Code Model Server Starting ==="
echo "Reading configuration from ${CONFIG_FILE}..."

MODEL_ROLE="${MODEL_ROLE:-chat}"
echo "Role: ${MODEL_ROLE}"

# Helper function to read YAML config via python
parse_yaml_val() {
    python3 -c "import yaml; c=yaml.safe_load(open('${CONFIG_FILE}')); $1" 2>/dev/null || echo "$2"
}

if [ "${MODEL_ROLE}" = "autocomplete" ]; then
    DEFAULT_MODEL=$(parse_yaml_val "print(c.get('active_autocomplete_model', c.get('active_chat_model', '')))" "")
    DEFAULT_PORT=$(parse_yaml_val "print(c.get('autocomplete_server_port', 8081))" "8081")
else
    DEFAULT_MODEL=$(parse_yaml_val "print(c.get('active_chat_model', c.get('active_model', '')))" "")
    DEFAULT_PORT=$(parse_yaml_val "print(c.get('chat_server_port', 8080))" "8080")
fi

ACTIVE_MODEL="${ACTIVE_MODEL:-${DEFAULT_MODEL}}"
SERVER_PORT="${SERVER_PORT:-${DEFAULT_PORT}}"

MODEL_URL=$(parse_yaml_val "print(c['models']['${ACTIVE_MODEL}']['url'])" "")
EXPECTED_SHA256=$(parse_yaml_val "print(c['models']['${ACTIVE_MODEL}']['sha256'])" "")
GPU_LAYERS=$(parse_yaml_val "print(c.get('vulkan_gpu_layers', 99))" "99")
CTX_SIZE=$(parse_yaml_val "print(c.get('context_size', 16384))" "16384")

TARGET_MODEL_PATH="${MODELS_DIR}/${ACTIVE_MODEL}"

echo "Active Model (${MODEL_ROLE}): ${ACTIVE_MODEL}"
echo "Server Port: ${SERVER_PORT}"
echo "Model Path: ${TARGET_MODEL_PATH}"
echo "Expected SHA256: ${EXPECTED_SHA256}"

# Function to verify checksum
verify_checksum() {
    local file_path="$1"
    local expected_hash="$2"
    
    if [ ! -f "${file_path}" ]; then
        return 1
    fi
    
    if [ "${expected_hash}" = "auto-verify-on-download" ] || [ -z "${expected_hash}" ]; then
        echo "File ${file_path} exists. Skipping strict SHA256 assertion."
        return 0
    fi
    
    echo "Calculating SHA256 checksum for ${file_path}..."
    local actual_hash
    actual_hash=$(sha256sum "${file_path}" | awk '{print $1}')
    
    if [ "${actual_hash}" = "${expected_hash}" ]; then
        echo "Checksum match confirmed: ${actual_hash}"
        return 0
    else
        echo "Checksum mismatch! Expected ${expected_hash}, got ${actual_hash}"
        return 1
    fi
}

# Check if model exists and matches checksum
if verify_checksum "${TARGET_MODEL_PATH}" "${EXPECTED_SHA256}"; then
    echo "Model ${ACTIVE_MODEL} is valid and verified. Skipping download."
else
    echo "Model file missing or checksum invalid. Initiating download..."
    mkdir -p "${MODELS_DIR}"
    
    TEMP_FILE="${TARGET_MODEL_PATH}.tmp"
    rm -f "${TEMP_FILE}"
    
    echo "Downloading ${MODEL_URL}..."
    curl -L --progress-bar -o "${TEMP_FILE}" "${MODEL_URL}"
    
    if verify_checksum "${TEMP_FILE}" "${EXPECTED_SHA256}"; then
        mv "${TEMP_FILE}" "${TARGET_MODEL_PATH}"
        echo "Download completed and verified successfully!"
    else
        echo "ERROR: Downloaded file failed SHA256 verification!" >&2
        rm -f "${TEMP_FILE}"
        exit 1
    fi
fi

echo "=== Checking Vulkan GPU Availability ==="
VULKAN_GPU_FOUND=false
if command -v vulkaninfo >/dev/null 2>&1; then
    VULKAN_DEVICES=$(vulkaninfo --summary 2>/dev/null | grep -i "deviceName" || true)
    if [ -n "${VULKAN_DEVICES}" ]; then
        echo "Vulkan GPU device(s) detected:"
        echo "${VULKAN_DEVICES}"
        VULKAN_GPU_FOUND=true
    fi
fi

if [ "${VULKAN_GPU_FOUND}" = "false" ] && [ -e "/dev/dri" ]; then
    echo "Notice: /dev/dri DRM device node detected."
    VULKAN_GPU_FOUND=true
fi

if [ "${VULKAN_GPU_FOUND}" = "false" ]; then
    echo "WARNING: No Vulkan GPU hardware detected inside container. Falling back to CPU layers (gpu_layers=0)."
    GPU_LAYERS=0
else
    echo "Vulkan GPU acceleration enabled (${GPU_LAYERS} layers offloaded to GPU)."
fi

LLAMA_SERVER_BIN=$(command -v llama-server || command -v llama.cpp-server || echo "/usr/bin/llama-server")

echo "Launching ${LLAMA_SERVER_BIN}..."
exec "${LLAMA_SERVER_BIN}" \
    -m "${TARGET_MODEL_PATH}" \
    --host 0.0.0.0 \
    --port "${SERVER_PORT}" \
    -ngl "${GPU_LAYERS}" \
    -c "${CTX_SIZE}" \
    --alias "qwen2.5-coder"


