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
- **On-Demand Model Auto-Swapping**: Automatically intercepts incoming model requests across the 6 supported GGUF model files (`Qwen2.5-Coder-0.5B/1.5B/3B/7B` and `DeepSeek-R1-Distill-Qwen-7B/14B`), stops the active `llama-server` process, loads the target GGUF model into Vulkan VRAM, and streams back responses.
- **Supported GGUF Models Suite**:
  1. `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` (~491 MB): Ultra-low latency Fill-In-Middle (FIM) autocomplete model running on dedicated Port 8081.
  2. `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` (~1.12 GB): Higher-capacity autocomplete / lightweight chat model for extended context completions.
  3. `qwen2.5-coder-3b-instruct-q4_k_m.gguf` (~2.10 GB): Mid-sized code instruction model for fast chat and editing on constrained hardware.
  4. `qwen2.5-coder-7b-instruct-q4_k_m.gguf` (~4.68 GB): Default active chat model (`podllama-chat`) with full tool-calling support.
  5. `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` (~4.68 GB): Default active thinking model (`podllama-thinking`) for chain-of-thought logic and math reasoning.
  6. `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` (~8.99 GB): High-parameter thinking model for deep architectural synthesis and complex deduction.
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

## 5. Official pi.dev CLI Integration

- **`Containerfile.pi`**: Packages the official [pi.dev](https://pi.dev) terminal agent on `node:24-bookworm-slim` per containerization standards.
- **Automatic Configuration Injection**: Automatically generates `${PI_CODING_AGENT_DIR}/models.json`, `auth.json`, `settings.json`, and `trust.json` pre-configured to connect seamlessly to the local PodLlama LiteLLM endpoint.
- **Version Pinning**: Supports custom release pinning via `--build-arg PI_VERSION=vX.Y.Z`.
- **Interactive Workspace Shell**: Runs inside user workspaces with full access to project file trees (`make run-pi`).

---

## 6. Rootless Podman & SELinux Security

- **Rootless User Namespace Mapping**: Employs `--userns=keep-id` so container processes map directly to the host user UID/GID without root privilege escalation.
- **SELinux Container Isolation**: Mounts workspace and configuration volumes with `:Z` and `:ro,Z` flags to strictly scope container read/write access to approved directory trees.

---

## 7. Zero-Compilation Base Images

- **Prebuilt RPM Packages**: Server container uses `fedora-minimal:latest` base image and installs precompiled `llama.cpp` and `llama.cpp-vulkan` binaries directly via `microdnf`.
- **Fast Build Times**: Eliminates lengthy C++ source builds, lowering container build time from tens of minutes to seconds.

---

## 8. Automated Model Management & Checksum Verification

- **Centralized Model Registry**: `config/model_conf.yaml` maps model identifiers for all 6 GGUF models to download URLs, repository origins, and SHA256 hashes.
- **Automated Downloads & Verification**: `scripts/download_models.py` downloads missing models into `./models` and validates SHA256 checksums before initiating model server processes.
- **Selective Download Modes**:
  - `make download-models`: Downloads the complete catalog of 6 GGUF models (~22 GB total).
  - `make download-active-models`: Downloads only the currently active chat, autocomplete, and thinking models (~9.8 GB total).

---

## 9. Automated Testing & Live Smoke Verification

- **Unit Test Suite (`make test` / `tests/unit_tests.py`)**: Validates YAML configuration schemas, file permissions, container definition files, and idle supervisor configuration.
- **Live Smoke Test Suite (`make smoke-tests` / `tests/smoke_tests.py`)**: Executes live end-to-end verification against the running Podman stack with verbose diagnostic logs for 7 distinct API endpoints:
  - **1. Proxy Liveliness**: Probes `GET /health/liveliness`.
  - **2. List Models API**: Probes `GET /v1/models` and verifies registered model aliases.
  - **3. Chat Completions & Prompt Processing**: Sends `podllama-chat` prompt and verifies `prompt_tokens` accounting.
  - **4. Deep Thinking & Reasoning**: Sends `podllama-thinking` request and verifies reasoning model output.
  - **5. Chat Model Streaming**: Sends `podllama-chat` streaming request and validates SSE token chunk streaming.
  - **6. Autocomplete Model Completion**: Sends `podllama-autocomplete` FIM request and validates inline code completion.
  - **7. Function & Tool Calling**: Sends tool definitions to validate tool support without server error.

---

## 10. Official VS Code Extension (PodLlama Code)

A companion extension, **PodLlama Code**, is bundled with the project to streamline developer workflows locally:
- **Offline Fonts & Styles**: Self-contains Fira Sans and Fira Code fonts, enabling coding ligatures and offline privacy.
- **Antigravity-inspired Sidebar**: A webview chat panel featuring a compact header, renamed conversation sessions, themed model dropdown controls, and scalable play/stop generation icons.
- **Decoupled Dual-Buffer Architecture**: Ingestion buffer (`streamDataBuffer`) and presentation buffer (`viewBuffer` / `lastGoodHtml`) decouple network packet reception from browser UI paints.
- **Exception-Guarded Live Markdown**: Formats Markdown live during streaming with `lastGoodHtml` retry buffer protection against incomplete tokens, split backticks, and TCP packet fragmentation.
- **Context Attachments**: Injects complete files into chat inputs via a custom `+` context attachment button.
- **Editor Integration ('Chat' Menu)**: Right-clicking highlighted code pastes it instantly as active chat context.
- **Inline Proposed Change Diffing**: Allows reviewing applied code patches inline using VS Code's native accept/reject actions.
- **Asynchronous Context Summarization Engine**: Triggers context summarization asynchronously via `podllama-chat` once a conversation exceeds 6 message turns. Compresses details into structured context points to save token history overhead while allowing live chat completions to stream immediately without blocking.
