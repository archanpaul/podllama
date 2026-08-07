# Features Overview

The **PodLlama Container Environment** provides a local, GPU-accelerated, containerized AI coding workspace. Below is a breakdown of the primary features and technical capabilities.

---

## 1. 100% Data Privacy & Local Sovereignty

- **Zero Cloud Leakage**: Code processing, context window indexing, and LLM inference occur entirely on your local machine.
- **Air-Gapped Operation**: Once model files are downloaded, no external network connections are required for code generation, autocomplete, or workspace agent tasks.

---

## 2. Cross-Vendor Vulkan GPU Acceleration

- **`llama.cpp-vulkan` Backend**: Leverages the Vulkan API for GPU layer offloading (`-ngl 99`).
- **Broad Hardware Compatibility**: Works natively on Linux with Intel Arc / Iris Xe GPUs, AMD Radeon GPUs, and NVIDIA GPUs without complex CUDA toolchains or proprietary kernel drivers.
- **Automated Hardware Fallback**: Pre-flight diagnostics run `vulkaninfo --summary` and inspect `/dev/dri`. If a hardware Vulkan device is unavailable, the server falls back to multi-threaded CPU inference.

---

## 3. Multi-Model Architecture & On-Demand Swapping

- **Dedicated Chat & Thinking Model Supervisor**: Runs `containers/chat_swapper.py` on port `8080` for chat, reasoning, refactoring, and thinking tasks (`podllama-chat` and `podllama-thinking`).
- **On-Demand Model Auto-Swapping**: Automatically intercepts incoming model requests (e.g. swapping between `Qwen2.5-Coder-7B`, `DeepSeek-R1-Distill-Qwen-7B`, and `DeepSeek-R1-Distill-Qwen-14B`), stops the active `llama-server` process, loads the target GGUF model into Vulkan VRAM, and streams back responses.
- **Configurable Thinking Model Selection**: Switch `active_thinking_model` in `config/model_conf.yaml` between `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` (7B) and `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` (14B) for high-tier reasoning.
- **Auto-Stop After Idle (0 MB LLM RAM/VRAM)**: Automatically terminates the underlying `llama-server` process after a configurable idle threshold (`idle_timeout_seconds` in `config/model_conf.yaml` or `IDLE_TIMEOUT_SECONDS` env var, defaulting to 10 minutes / 600s), releasing 100% of LLM VRAM and RAM back to the host system until the next request triggers a cold-start.
- **Low-Latency Autocomplete Model**: Runs `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` or `1.5b` on port `8081` for low-latency inline code completions.
- **Resource Optimization**: CPU and RAM allocations are managed independently for chat (`8 CPUs / 8GB RAM`) and autocomplete (`2 CPUs / 4GB RAM`) services in Podman Compose.

---

## 4. Unified LiteLLM Proxy (Port 4000)

- **Single OpenAI-Compatible API Endpoint**: Exposes `http://localhost:4000/v1` to interface with editors and IDE extensions.
- **Dynamic Routing**: Inspects request parameters and routes `podllama-chat` / `podllama-thinking` requests to port 8080 and `podllama-autocomplete` requests to port 8081.
- **Model Aliases**: Exposes standardized role model aliases (`podllama-chat`, `podllama-thinking`, `podllama-autocomplete`).
- **Health & Diagnostics**: Provides `/health/liveliness` and `/v1/models` health monitoring endpoints.

---

## 5. Official QwenLM CLI Integration

- **`Containerfile.qwencoder`**: Packages the official [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) terminal agent inside a Fedora 44 Minimal container.
- **Dynamic Binary Fetching**: Fetches the latest GitHub release of `qwen-code` at build time without hardcoded version locks, with optional version pinning via `--build-arg QWEN_CODE_VERSION=vX.Y.Z`.
- **Interactive Workspace Shell**: Runs inside user workspaces with full access to project file trees.

---

## 6. Rootless Podman & SELinux Security

- **Rootless User Namespace Mapping**: Employs `--userns=keep-id` so container processes map directly to the host user UID/GID without root privilege escalation.
- **SELinux Container Isolation**: Mounts workspace and configuration volumes with `:Z` and `:ro,Z` flags to strictly scope container read/write access to approved directory trees.

---

## 7. Zero-Compilation Fedora 44 Minimal Base

- **Prebuilt RPM Packages**: Uses `fedora-minimal:latest` base images and installs precompiled `llama.cpp` and `llama.cpp-vulkan` binaries directly via `microdnf`.
- **Fast Build Times**: Eliminates lengthy C++ source builds, lowering container build time from tens of minutes to seconds.

---

## 8. Automated Model Management & Checksum Verification

- **Centralized Model Registry**: `config/model_conf.yaml` maps model identifiers to download URLs and SHA256 hashes.
- **Automated Downloads & Verification**: `scripts/download_models.py` downloads missing models into `./models` and validates SHA256 checksums before initiating model server processes.

---

## 9. Automated Testing & Live Smoke Verification

- **Unit Test Suite (`make unit-tests` / `tests/unit_tests.py`)**: Validates YAML configuration schemas, file permissions, container definition files, and idle supervisor configuration.
- **Live Smoke Test Suite (`make smoke-tests` / `tests/smoke_tests.py`)**: Executes live end-to-end verification against the running Podman stack with verbose diagnostic logs for 7 distinct API endpoints:
  - **1. Proxy Liveliness**: Probes `GET /health/liveliness`.
  - **2. List Models API**: Probes `GET /v1/models` and verifies registered model aliases.
  - **3. Chat Completions & Prompt Processing**: Sends `podllama-chat` prompt and verifies `prompt_tokens` accounting.
  - **4. Deep Thinking & Reasoning**: Sends `podllama-thinking` request and verifies reasoning model output.
  - **5. Chat Model Streaming**: Sends `podllama-chat` streaming request and validates SSE token chunk streaming.
  - **6. Autocomplete Model Completion**: Sends `podllama-autocomplete` FIM request and validates inline code completion.
  - **7. Function & Tool Calling**: Sends tool definitions to validate tool support without server error.
