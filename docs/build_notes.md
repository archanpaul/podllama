# Build Notes and Container Architecture

This document details the multi-stage build system, container layer caching strategies, and hardware acceleration options for the PodLlama container environment.

---

## 1. Qwen Model Server Container (`Containerfile.llamacpp`)

The model server container builds and packages `llama-server` with Vulkan GPU acceleration on top of Fedora Minimal.

### Multi-Stage Build Pipeline

1. **`builder_deps` Stage**: Installs C++ compilation tools (`cmake`, `gcc-c++`, `git`) and Vulkan development headers (`vulkan-headers`, `vulkan-loader-devel`, `glslc`, `spirv-tools-devel`) via `microdnf`.
2. **`builder` Stage**: Clones the `ggerganov/llama.cpp` repository, configures CMake with `-DGGML_VULKAN=ON`, and compiles the `llama-server` binary.
3. **`runtime_deps` Stage**: Prepares a lean runtime container containing runtime graphics drivers (`mesa-vulkan-drivers`, `vulkan-loader`, `vulkan-tools`) and Python dependencies (`python3-pyyaml`).
4. **`runner` Stage**: Copies compiled binaries from `builder` to `/usr/bin/` and sets the entrypoint script.

### Layer Caching Strategy (`LLAMA_CPP_TAG`)

To prevent lengthy C++ compilation on every `make build` invocation, `Containerfile.llamacpp` uses the `LLAMA_CPP_TAG` build argument:

```dockerfile
ARG LLAMA_CPP_TAG=""

WORKDIR /build
RUN if [ -n "${LLAMA_CPP_TAG}" ]; then \
        echo "Cloning llama.cpp pinned release: ${LLAMA_CPP_TAG}"; \
        git clone --depth 1 --branch "${LLAMA_CPP_TAG}" https://github.com/ggml-org/llama.cpp.git .; \
    else \
        echo "Cloning llama.cpp latest main branch..."; \
        git clone --depth 1 https://github.com/ggml-org/llama.cpp.git .; \
    fi && \
    cmake -B build -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build --config Release -j$(nproc) --target llama-server
```

#### Cache Behavior & Tag Resolution:
- **Pinned Default Tag (`make build-server`)**: `make build-server` defaults to a pinned release tag (`LLAMA_CPP_TAG ?= b6070`) defined in `Makefile`. This ensures build caching is preserved and prevents source recompilation on consecutive runs.
- **Fetching Latest Tag**: To explicitly query GitHub API for the newest `llama.cpp` release tag:
  ```bash
  make build-server LLAMA_CPP_TAG=latest
  ```
- **Custom Tag Override**: You can target any specific `llama.cpp` release tag:
  ```bash
  make build-server LLAMA_CPP_TAG=b6153
  ```

---

## 2. Qwen Encoder Client Container (`Containerfile.crush`)

The workspace agent container packages the official standalone release binary of `QwenLM/qwen-code`.

### Features:
- **Automatic Latest Release Redirect**: By default, downloads from `https://github.com/QwenLM/qwen-code/releases/latest/download/qwen-code-linux-x64.tar.gz`.
- **Version Pinning (`CRUSH_VERSION`)**: You can pin a specific release version during container image build:
  ```bash
  podman build --build-arg CRUSH_VERSION="v0.1.0" -t qwen-client:latest -f containers/Containerfile.crush .
  ```
- **User Namespace Isolation**: Runs with `--userns=keep-id` to match host user permissions on mounted workspaces.

---

## 3. Model Storage & Checksum Verification (`scripts/download_models.py`)

All model weights are stored in the host `./models/` directory, which is mounted into model server containers via SELinux-isolated volumes (`${MODELS_DIR}:/models:Z`).

### Download & Verification Logic:
1. **Registry Resolution (`config/model_conf.yaml`)**: `scripts/download_models.py` reads the configured model list, URLs, expected SHA256 hashes, and download targets.
2. **SHA256 Checksum Verification**:
   - For models with explicit SHA256 hashes (e.g. `qwen2.5-coder-0.5b`, `1.5b`, `7b`), the downloader verifies file integrity before and after downloading. If an existing file fails hash validation, it is removed and re-downloaded automatically.
   - For models with `auto-verify-on-download` (e.g. `qwen2.5-coder-3b`, `DeepSeek-R1-Distill-Qwen-7B/14B`), files larger than 10 MB are verified as valid pre-downloaded GGUF models.
3. **Atomic Downloads**: Downloads write to temporary `.tmp` files first, ensuring incomplete transfers never corrupt model file integrity.
4. **Selective Downloading**:
   - `make download-models`: Fetches all 6 GGUF model files defined in `config/model_conf.yaml`.
   - `make download-active-models`: Downloads only models currently assigned to `active_chat_model`, `active_autocomplete_model`, and `active_thinking_model`.

---

## 4. Build & Maintenance Commands

| Command | Description |
| :--- | :--- |
| `make check-infra` | Verifies host build and runtime infrastructure (Podman, Python 3, PyYAML, curl, DRI) |
| `make build` | Builds both `podllama-server:latest` and `qwen-client:latest` images |
| `make build-server` | Builds only the model server container image |
| `make build-client` | Builds only the workspace encoder agent container image |
| `make test` | Executes unit test suite verifying configs and file permissions |
| `make clean` | Removes built Podman images and temporary files |
