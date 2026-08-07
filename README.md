# PodLlama Container Environment

A high-performance, containerized AI coding environment powered by PodLlama running in Podman, with Vulkan GPU Acceleration, LiteLLM Unified Proxy API, Podman Compose Orchestration, and Official QwenLM/qwen-code CLI Integration.

---

## Motivation

Modern AI coding assistants often rely on cloud-hosted LLM APIs, requiring developers to send proprietary source code, secrets, and intellectual property to external servers. Furthermore, running local models can present setup friction, GPU driver incompatibilities, high resource overhead, and security concerns when granting AI agents terminal access.

This project addresses these challenges by delivering an enterprise-ready, self-hosted local AI coding environment built on five core principles:

1. **Complete Data Privacy & Sovereignty**: All code processing and model inference happen 100% locally on your machine. Proprietary source code never leaves your workspace.
2. **Cross-Vendor Hardware Acceleration (Vulkan)**: Uses `llama.cpp-vulkan` to provide high-speed GPU layer offloading across Intel Arc/Iris Xe, AMD Radeon, and NVIDIA GPUs without requiring complex CUDA installations.
3. **Optimized Dual-Model Architecture**: Serves low-latency autocomplete models (0.5B / 1.5B) alongside high-reasoning chat models (7B Instruct) simultaneously, orchestrated behind a single unified LiteLLM Proxy endpoint on port 4000.
4. **Strict Workspace Container Isolation**: Enforces rootless Podman user namespace mapping (`--userns=keep-id`) and SELinux volume isolation (`:z`/`:ro,Z`) so that AI agent file operations and command executions are strictly confined to your workspace directory.
5. **Zero-Compilation Instant Deployment**: Employs `fedora-minimal:latest` base images with prebuilt RPM packages, eliminating lengthy C++ source builds and ensuring fast, reproducible deployments.

---

## Key Features

- **Fedora 44 Minimal & Prebuilt RPMs**: Server containers use official prebuilt Fedora RPM packages (`llama.cpp`, `llama.cpp-vulkan`) installed via `microdnf` inside `fedora-minimal:latest`. This avoids source compilation, saving build time, disk space, and bandwidth.
- **Vulkan GPU Acceleration & Automated Pre-flight Diagnostics**: Checks for hardware Vulkan GPU devices (`vulkaninfo --summary` & `/dev/dri`). Automatically offloads layers to GPU (`-ngl 99`) or falls back gracefully to CPU if no GPU device is detected.
- **Dual Model Support (Chat & Autocomplete)**: Run dedicated Chat (`qwen2.5-coder-7b-instruct`) and Autocomplete (`qwen2.5-coder-0.5b` or `1.5b`) models simultaneously on separate ports.
- **Unified LiteLLM Proxy API (Port 4000)**: Exposes a single, multithreaded OpenAI-compatible API endpoint on port 4000 (`http://localhost:4000/v1`) that dynamically routes requests to the appropriate model server backend based on the model name in API requests.
- **Official QwenLM/qwen-code CLI Integration**: The workspace agent container (`Containerfile.qwencoder`) automatically installs the latest release of [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) directly from GitHub releases without API rate limits or hardcoded versions. Supports build-time version pinning via `QWEN_CODE_VERSION`.
- **Podman Compose Orchestration**: Easily manage the entire stack (`podllama_chat`, `podllama_autocomplete`, `podllama_proxy`) with a single command (`make compose-up`).
- **YAML Model Configuration (`config/model_conf.yaml`)**: Centralized model registry specifying download URLs, active chat/autocomplete model selections, ports, context sizes, and SHA256 checksums.

---

## Documentation

Detailed documentation is available in the [`docs/`](./docs) directory:

- **[docs/features.md](./docs/features.md)**: Technical feature overview, Vulkan acceleration, rootless Podman security, and model management.
- **[docs/api.md](./docs/api.md)**: OpenAI-compatible API reference (`/v1/chat/completions`, `/v1/completions`, `/health/liveliness`) and VS Code / Continue integration guides.
- **[docs/design.md](./docs/design.md)**: Architecture design document with Mermaid sequence/flow diagrams, network topology, and SELinux volume isolation.
- **[docs/build_notes.md](./docs/build_notes.md)**: Container multi-stage build pipeline, Vulkan compilation, layer caching, and version pinning notes.

---

## Repository Directory Structure

```
.
├── LICENSE                      # GNU General Public License v3.0 (GPLv3)
├── Makefile                     # Root Makefile for build, run, and compose targets
├── .gitignore                   # Excludes GGUF models, temporary downloads, and bytecode
├── config/
│   ├── model_conf.yaml          # Model registry & server configuration (YAML)
│   ├── litellm_config.yaml      # LiteLLM Proxy routing configuration & model aliases
│   └── continue.yaml            # Continue IDE extension configuration template
├── containers/
│   ├── Containerfile.llamacpp    # Fedora 44 Minimal image for llama-server (Vulkan & RPMs)
│   ├── Containerfile.qwencoder  # Fedora 44 Minimal image for Qwen workspace agent
│   ├── compose.yaml             # Podman Compose orchestration stack
│   ├── entrypoint-llamacpp.sh   # Server entrypoint (Vulkan GPU check, checksums, auto-download)
│   └── entrypoint-client.sh     # Client agent entrypoint
├── docs/
│   ├── api.md                   # Complete API specification & IDE setup guide
│   ├── build_notes.md           # Multi-stage build system & compilation caching notes
│   ├── design.md                # System architecture, sequence diagrams & SELinux design
│   └── features.md              # Technical feature overview
├── models/
│   └── .gitkeep                 # Storage directory for local GGUF model files
├── scripts/
│   ├── download_models.py       # Python downloader and SHA256 verifier
│   ├── run_podman.sh            # Podman container launcher script
│   └── run_qwencode.sh          # Interactive workspace agent launcher script
├── tests/
│   ├── unit_tests.py            # Automated unit test suite
│   └── smoke_tests.py           # Live endpoint smoke test suite (Chat, Autocomplete, Tool Calling)
└── README.md                    # Main repository documentation
```

---

## Quick Start Guide

### 0. Verify System Infrastructure

Verify host system prerequisites (Podman, Python 3, PyYAML, curl, and GPU hardware DRI drivers):

```bash
make check-infra
```

### 1. Download Model Files

Download all configured GGUF model files (0.5B, 1.5B, 7B) into `./models`:

```bash
make download-models
```

Or download only the active chat and autocomplete models:

```bash
make download-active-models
```

### 2. Build Container Images

Build the server and workspace agent images (automatically fetches latest `QwenLM/qwen-code`):

```bash
make build
```

Optional: To build with a specific version of `qwen-code`:

```bash
podman build --build-arg QWEN_CODE_VERSION=v0.21.6 -t qwen-client:latest -f containers/Containerfile.qwencoder .
```

### 3. Launch Full Stack with Podman Compose (Recommended)

Start Chat Server, Autocomplete Server, and LiteLLM Proxy on port 4000:

```bash
make compose-up
```

Check status:

```bash
make status
```

View live logs:

```bash
make compose-logs
```

Stop stack:

```bash
make compose-down
```

### 4. Launch Workspace Agent CLI

Run the workspace agent inside your current project folder:

```bash
# Option A: From inside the qwen_code_container directory
make run-qwencode

# Option B: From inside any target project directory
cd /path/to/your/project
make -C /path/to/qwen_code_container run-qwencode WORKSPACE_DIR=$(pwd)

# Option C: Direct script invocation
/path/to/qwen_code_container/scripts/run_qwencode.sh /path/to/your/project
```

---

## LiteLLM Proxy & API Model Selection (Port 4000)

The LiteLLM Proxy runs on `http://localhost:4000/v1`. You can select chat or autocomplete models directly in your API calls:

### 1. Chat Completion API (`qwen-chat` / `qwen2.5-coder-7b-instruct`)

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "qwen-chat",
    "messages": [
      {"role": "user", "content": "Write a python function to compute prime numbers."}
    ]
  }'
```

### 2. Autocomplete Completion API (`qwen-autocomplete` / `qwen2.5-coder-0.5b`)

```bash
curl http://localhost:4000/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "qwen-autocomplete",
    "prompt": "def fibonacci(n):\n"
  }'
```

### 3. Model Aliases Map

| Request Model Name | Backend Target Server | Loaded GGUF Model |
| :--- | :--- | :--- |
| `qwen-chat`, `qwen2.5-coder-7b-instruct`, `gpt-3.5-turbo` | `podllama_chat:8080` | `qwen2.5-coder-7b-instruct-q4_k_m.gguf` |
| `qwen-autocomplete`, `qwen2.5-coder-0.5b` | `podllama_autocomplete:8081` | `qwen2.5-coder-0.5b-q4_k_m.gguf` |
| `qwen2.5-coder-1.5b` | `podllama_autocomplete:8081` | `qwen2.5-coder-1.5b-q4_k_m.gguf` |

---

## Model Configuration (`config/model_conf.yaml`)

Edit `config/model_conf.yaml` to change default models or settings:

```yaml
active_chat_model: qwen2.5-coder-7b-instruct-q4_k_m.gguf
active_autocomplete_model: qwen2.5-coder-0.5b-instruct-q4_k_m.gguf
chat_server_port: 8080
autocomplete_server_port: 8081
models_dir: /models
workspace_dir: /workspace
vulkan_gpu_layers: 99
context_size: 16384

models:
  qwen2.5-coder-0.5b-instruct-q4_k_m.gguf:
    url: https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf
    sha256: 1d9614638d18024d0fbb36575a15f1302a3adf044df10345688ec4f6e1c4ff32

  qwen2.5-coder-0.5b-q4_k_m.gguf:
    url: https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-GGUF/resolve/main/qwen2.5-coder-0.5b-q4_k_m.gguf
    sha256: auto-verify-on-download

  qwen2.5-coder-7b-instruct-q4_k_m.gguf:
    url: https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf
    sha256: 509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c
```

---

## VS Code Integration (Qwen Code Companion / Continue / Cline)

To use the local GPU-accelerated server with VS Code AI extensions:

### Option A: Via LiteLLM Unified Proxy (Port 4000)
- **API Provider**: OpenAI / Local Server
- **Base URL**: `http://localhost:4000/v1`
- **Chat Model**: `qwen-chat`
- **Autocomplete Model**: `qwen-autocomplete`
- **API Key**: `sk-local`

#### Pre-configured `config/continue.yaml` Template:
A ready-to-use template is provided in [`config/continue.yaml`](./config/continue.yaml):

```yaml
name: Qwen Code Local (Vulkan GPU Accelerated)
version: 0.0.1
schema: v1

models:
  - name: Qwen Chat (Local Vulkan)
    provider: openai
    model: qwen-chat
    apiBase: http://localhost:4000/v1
    apiKey: sk-local
    contextLength: 16384
    roles:
      - chat
      - edit

  - name: Qwen Autocomplete (Local Vulkan)
    provider: openai
    model: qwen-autocomplete
    apiBase: http://localhost:4000/v1
    apiKey: sk-local
    roles:
      - autocomplete
```

---

## Testing & Verification

The project includes both static unit tests and live endpoint smoke verification:

### 1. Automated Unit Tests (`make unit-tests`)
Validates configuration YAML schemas, script permissions, and container definitions:
```bash
make unit-tests
# or alias:
make test
```

### 2. Live Endpoint Smoke Testing (`make smoke-tests`)
Performs live end-to-end verification against the running Podman stack:
```bash
make smoke-tests
# or alias:
make smoke-test
```

This runs `tests/smoke_tests.py` to verify:
- **Proxy Liveliness**: Probes `http://localhost:4000/health/liveliness`.
- **Autocomplete Model Prompt Processing & Completion**: Tests `qwen-autocomplete` prompt prefill (`prompt_tokens`) and code output.
- **Chat Model Prompt Processing & Token Accounting**: Tests `qwen-chat` prompt evaluation tokens (`prompt_tokens`).
- **Chat Model Token Streaming**: Validates real-time SSE chunk streaming output.
- **Tool Calling Support**: Validates function tool definitions (`qwen-chat` with `--jinja`) to ensure tool support functions without server error.

---

## Security & Workspace Isolation

The workspace agent container (`Containerfile.qwencoder`) is launched with:
- `-v "$(pwd):/workspace:Z"`: SELinux-labeled volume mount restricted strictly to the current working directory.
- `--userns=keep-id`: Preserves host user UID/GID without root privileges in workspace.

---

## Makefile Command Reference

| Command | Description |
| :--- | :--- |
| `make check-infra` | Verifies host build and runtime infrastructure (Podman, Python 3, PyYAML, curl, DRI) |
| `make build` | Builds `podllama-server` and `qwen-client` Podman images |
| `make service-up` | Launches Chat Server, Autocomplete Server & LiteLLM Proxy via Podman Compose |
| `make service-down` | Stops Podman Compose stack |
| `make service-logs` | Displays live logs from all running containers |
| `make service-status` | Checks running container status and health endpoints |
| `make service-restart` | Restarts all Podman Compose stack services |
| `make compose-up` | Alias for `make service-up` |
| `make compose-down` | Alias for `make service-down` |
| `make compose-logs` | Alias for `make service-logs` |
| `make show-live-logs` | Alias for `make service-logs` |
| `make start-server` | Launches Chat Model Server container standalone (Port 8080) |
| `make start-autocomplete-server` | Launches Autocomplete Model Server container standalone (Port 8081) |
| `make start-all` | Launches both standalone model servers |
| `make stop-server` | Stops all standalone server containers |
| `make status` | Checks running container status and health endpoints |
| `make unit-tests` | Runs automated unit test suite (config schema, script permissions, container files) |
| `make test` | Alias for `make unit-tests` |
| `make smoke-tests` | Runs live smoke test on Chat (streaming), Autocomplete, and Tool Calling endpoints |
| `make smoke-test` | Alias for `make smoke-tests` |
| `make download-active-models` | Downloads active chat and autocomplete models into models directory |
| `make download-models` | Downloads ALL configured GGUF models into models directory |
| `make run-qwencode` | Runs Qwen workspace agent CLI client in current workspace directory |
| `make run-pod` | Runs server and client together inside a single Podman pod |
| `make clean` | Cleans Podman container images and temporary files |

---

## License

This project is licensed under the [GNU General Public License v3.0 (GPL-3.0)](./LICENSE).
