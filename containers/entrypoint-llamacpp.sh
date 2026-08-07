#!/usr/bin/env bash
set -eo pipefail

CONFIG_FILE="/app/config/model_conf.yaml"
MODELS_DIR="/models"

if [ ! -f "/app/config/model_conf.yaml" ] && [ -f "/models/model_conf.yaml" ]; then
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
    DEFAULT_THREADS=$(parse_yaml_val "print(c.get('autocomplete_cpu_threads', c.get('cpu_threads', 4)))" "4")
else
    DEFAULT_MODEL=$(parse_yaml_val "print(c.get('active_chat_model', c.get('active_model', '')))" "")
    DEFAULT_PORT=$(parse_yaml_val "print(c.get('chat_server_port', 8080))" "8080")
    DEFAULT_THREADS=$(parse_yaml_val "print(c.get('chat_cpu_threads', c.get('cpu_threads', 8)))" "8")
fi

ACTIVE_MODEL="${ACTIVE_MODEL:-${DEFAULT_MODEL}}"
SERVER_PORT="${SERVER_PORT:-${DEFAULT_PORT}}"

MODEL_URL=$(parse_yaml_val "print(c['models']['${ACTIVE_MODEL}']['url'])" "")
EXPECTED_SHA256=$(parse_yaml_val "print(c['models']['${ACTIVE_MODEL}']['sha256'])" "")
GPU_LAYERS=$(parse_yaml_val "print(c.get('vulkan_gpu_layers', 99))" "99")
CPU_THREADS="${CPU_THREADS:-${DEFAULT_THREADS}}"
BATCH_SIZE=$(parse_yaml_val "print(c.get('batch_size', 512))" "512")
UBATCH_SIZE=$(parse_yaml_val "print(c.get('ubatch_size', 256))" "256")
if [ "${MODEL_ROLE}" = "autocomplete" ]; then
    CTX_SIZE=$(parse_yaml_val "print(c.get('autocomplete_context_size', 4096))" "4096")
else
    CTX_SIZE=$(parse_yaml_val "print(c.get('context_size', 16384))" "16384")
fi

TARGET_MODEL_PATH="${MODELS_DIR}/${ACTIVE_MODEL}"

echo "Active Model (${MODEL_ROLE}): ${ACTIVE_MODEL}"
echo "Server Port: ${SERVER_PORT}"
echo "Model Path: ${TARGET_MODEL_PATH}"
echo "Expected SHA256: ${EXPECTED_SHA256}"
echo "Batch Size (-b): ${BATCH_SIZE}, Micro Batch Size (-ub): ${UBATCH_SIZE}"

# Function to verify checksum
verify_checksum() {
    local file_path="$1"
    local expected_hash="$2"
    
    if [ ! -f "${file_path}" ]; then
        return 1
    fi
    
    # Check minimum valid file size (>10MB) to reject corrupt or 0-byte / 29-byte HTML/LFS files
    local file_size
    file_size=$(stat -c%s "${file_path}" 2>/dev/null || echo 0)
    if [ "${file_size}" -lt 10485760 ]; then
        echo "File ${file_path} is invalid or corrupted (size: ${file_size} bytes)."
        return 1
    fi
    
    if [ "${expected_hash}" = "auto-verify-on-download" ] || [ -z "${expected_hash}" ]; then
        echo "File ${file_path} size verified (${file_size} bytes). Skipping strict SHA256 hash assertion."
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
    echo "Model file missing, corrupt, or checksum invalid. Initiating download..."
    mkdir -p "${MODELS_DIR}"
    
    TEMP_FILE="${TARGET_MODEL_PATH}.tmp"
    rm -f "${TEMP_FILE}"
    
    echo "Downloading ${MODEL_URL}..."
    curl -L --fail --progress-bar -o "${TEMP_FILE}" "${MODEL_URL}"
    
    echo "Verifying SHA256 checksum after download..."
    if verify_checksum "${TEMP_FILE}" "${EXPECTED_SHA256}"; then
        mv "${TEMP_FILE}" "${TARGET_MODEL_PATH}"
        echo "Download completed and verified successfully!"
    else
        echo "ERROR: Downloaded file failed post-download SHA256 verification!" >&2
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

if [ "${MODEL_ROLE}" = "chat" ] && [ -f "/app/chat_swapper.py" ]; then
    echo "Starting Chat Swapper Supervisor Proxy on port ${SERVER_PORT}..."
    export SERVER_PORT="${SERVER_PORT}"
    export CONFIG_FILE="${CONFIG_FILE}"
    export MODELS_DIR="${MODELS_DIR}"
    exec python3 /app/chat_swapper.py
fi

LLAMA_SERVER_BIN=$(command -v llama-server || command -v llama.cpp-server || echo "/usr/bin/llama-server")

echo "Launching ${LLAMA_SERVER_BIN} with ${CPU_THREADS} CPU threads..."
exec "${LLAMA_SERVER_BIN}" \
    -m "${TARGET_MODEL_PATH}" \
    --host 0.0.0.0 \
    --port "${SERVER_PORT}" \
    -ngl "${GPU_LAYERS}" \
    -t "${CPU_THREADS}" \
    -c "${CTX_SIZE}" \
    -b "${BATCH_SIZE}" \
    -ub "${UBATCH_SIZE}" \
    --flash-attn \
    --jinja \
    --alias "qwen2.5-coder"


