# Build Notes and Container Architecture

This document details the multi-stage build system, container layer caching strategies, and hardware acceleration options for the Qwen Code Podman container environment.

---

## 1. Qwen Model Server Container (`Containerfile.server`)

The model server container builds and packages `llama-server` with Vulkan GPU acceleration on top of Fedora Minimal.

### Multi-Stage Build Pipeline

1. **`builder_deps` Stage**: Installs C++ compilation tools (`cmake`, `gcc-c++`, `git`) and Vulkan development headers (`vulkan-headers`, `vulkan-loader-devel`, `glslc`, `spirv-tools-devel`) via `microdnf`.
2. **`builder` Stage**: Clones the `ggerganov/llama.cpp` repository, configures CMake with `-DGGML_VULKAN=ON`, and compiles the `llama-server` binary.
3. **`runtime_deps` Stage**: Prepares a lean runtime container containing runtime graphics drivers (`mesa-vulkan-drivers`, `vulkan-loader`, `vulkan-tools`) and Python dependencies (`python3-pyyaml`).
4. **`runner` Stage**: Copies compiled binaries from `builder` to `/usr/bin/` and sets the entrypoint script.

### Layer Caching Strategy (`LLAMA_CPP_TAG`)

To prevent lengthy C++ compilation on every `make build` invocation, `Containerfile.server` uses the `LLAMA_CPP_TAG` build argument:

```dockerfile
ARG LLAMA_CPP_TAG=""

WORKDIR /build
RUN if [ -n "${LLAMA_CPP_TAG}" ]; then \
        echo "Cloning llama.cpp pinned release: ${LLAMA_CPP_TAG}"; \
        git clone --depth 1 --branch "${LLAMA_CPP_TAG}" https://github.com/ggerganov/llama.cpp.git .; \
    else \
        echo "Cloning llama.cpp latest main branch..."; \
        git clone --depth 1 https://github.com/ggerganov/llama.cpp.git .; \
    fi && \
    cmake -B build -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build --config Release -j$(nproc) --target llama-server
```

#### Cache Behavior & Automated Tag Resolution:
- **Automated Tag Detection (`make build-server`)**: `make build-server` automatically queries GitHub API for the latest `llama.cpp` release tag and passes it as `--build-arg LLAMA_CPP_TAG="..."`.
- **Deterministic Layer Caching**: When a tag is detected, Podman reuses cached compilation layers (`--> Using cache`), skipping source compilation completely on subsequent builds (takes 0 seconds).
- **Offline / Rate-Limit Fallback**: If GitHub API is offline or rate-limited, `make build-server` automatically falls back to an empty tag (`LLAMA_CPP_TAG=""`), cloning the latest `main` branch directly.
- **Custom Tag Override**: You can target a specific `llama.cpp` release tag:
  ```bash
  podman build --build-arg LLAMA_CPP_TAG="b6153" -t qwen-server:latest -f containers/Containerfile.server .
  ```

---

## 2. Qwen Encoder Client Container (`Containerfile.qwencoder`)

The workspace agent container packages the official standalone release binary of `QwenLM/qwen-code`.

### Features:
- **Automatic Latest Release Redirect**: By default, downloads from `https://github.com/QwenLM/qwen-code/releases/latest/download/qwen-code-linux-x64.tar.gz`.
- **Version Pinning (`QWEN_CODE_VERSION`)**: You can pin a specific release version during container image build:
  ```bash
  podman build --build-arg QWEN_CODE_VERSION="v0.1.0" -t qwen-client:latest -f containers/Containerfile.qwencoder .
  ```
- **User Namespace Isolation**: Runs with `--userns=keep-id` to match host user permissions on mounted workspaces.

---

## 3. Build & Maintenance Commands

| Command | Description |
| :--- | :--- |
| `make build` | Builds both `qwen-server:latest` and `qwen-client:latest` images |
| `make build-server` | Builds only the model server container image |
| `make build-client` | Builds only the workspace encoder agent container image |
| `make test` | Executes unit test suite verifying configs and file permissions |
| `make clean` | Removes built Podman images and temporary files |
