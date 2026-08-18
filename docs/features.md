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

- **Dedicated Chat & Thinking Model Supervisor**: Runs multithreaded `containers/chat_swapper.py` (`ThreadingHTTPServer`) on port `8080` for chat, reasoning, refactoring, and thinking tasks (`podllama-chat`, `podllama-instruct`, and `podllama-thinking`).
- **On-Demand Model Auto-Swapping**: Automatically intercepts incoming model requests across the 6 supported GGUF model files (`Qwen2.5-Coder-0.5B/1.5B/3B/7B` and `DeepSeek-R1-Distill-Qwen-7B/14B`), stops the active `llama-server` process, loads the target GGUF model into Vulkan VRAM, and streams back responses.
- **Supported GGUF Models Suite**:
  1. `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` (~491 MB): Ultra-low latency Fill-In-Middle (FIM) autocomplete model running on dedicated Port 8081.
  2. `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` (~1.12 GB): Higher-capacity autocomplete / lightweight chat model for extended context completions.
  3. `qwen2.5-coder-3b-instruct-q4_k_m.gguf` (~2.10 GB): Mid-sized code instruction model for fast chat and editing on constrained hardware.
  4. `qwen2.5-coder-7b-instruct-q4_k_m.gguf` (~4.68 GB): Default active chat model (`podllama-chat`) with full tool-calling support.
  5. `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` (~4.68 GB): Default active thinking model (`podllama-thinking`) for chain-of-thought logic and math reasoning.
  6. `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` (~8.99 GB): High-parameter thinking model for deep architectural synthesis and complex deduction.
- **Configurable Thinking Model Selection**: Switch `active_thinking_model` in `config/model_conf.yaml` between `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` (7B) and `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` (14B) for high-tier reasoning.
- **Auto-Stop After Idle (0 MB LLM RAM/VRAM)**: Automatically terminates the underlying `llama-server` process after a configurable idle threshold (`idle_timeout_seconds` in `config/model_conf.yaml` or `IDLE_TIMEOUT_SECONDS` env var, defaulting to 10 minutes / 600s), releasing 100% of LLM VRAM and RAM back to the host system until the next request triggers a cold-start swapper recovery.
- **Low-Latency Autocomplete Model**: Runs `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` or `1.5b` on port `8081` for low-latency inline code completions.
- **Resource Optimization**: CPU and RAM allocations are managed independently for chat (`8 CPUs / 8GB RAM`) and autocomplete (`2 CPUs / 4GB RAM`) services in Podman Compose.

---

## 4. Unified LiteLLM Proxy (Port 4000)

- **Single OpenAI-Compatible API Endpoint**: Exposes `http://localhost:4000/v1` to interface with editors and IDE extensions.
- **Dynamic Routing**: Inspects request parameters and routes `podllama-chat` / `podllama-thinking` requests to port 8080 and `podllama-autocomplete` requests to port 8081.
- **Model Aliases**: Exposes standardized role model aliases (`podllama-chat`, `podllama-thinking`, `podllama-autocomplete`).
- **Health & Diagnostics**: Provides `/health/liveliness` and `/v1/models` health monitoring endpoints.

---

## 5. Official pi.dev & Oh My Pi (omp.sh) CLI Integrations

- **`Containerfile.pi`**: Packages the official [pi.dev](https://pi.dev) terminal agent on `node:24-bookworm-slim` (`@earendil-works/pi-coding-agent`) per containerization standards. Supports build-time release pinning via `PI_VERSION`.
- **`Containerfile.omp`**: Packages [Oh My Pi (omp.sh)](https://omp.sh/) (`@oh-my-pi/pi-coding-agent`) on `node:24-bookworm-slim` with `bun` runtime. Supports build-time release pinning via `OMP_VERSION`.
- **Automatic Configuration Injection**: Automatically generates provider and model configurations (`models.yml` and `config.json` for OMP, `models.json`/`settings.json` for pi.dev) pre-configured to connect seamlessly to the local PodLlama LiteLLM endpoint (`http://127.0.0.1:4000/v1`) with `podllama/podllama-chat` and `podllama/podllama-thinking`.
- **Interactive Workspace Shells**: Runs inside user workspaces with full access to project file trees (`make run-pi` for pi.dev agent, `make run-omp` for Oh My Pi agent).

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
- **Live Smoke Test Suite (`make smoke-tests` / `tests/smoke_tests.py`)**: Executes live end-to-end verification against the running Podman stack with verbose diagnostic logs for 12 distinct API verification stages:
  - **1. Proxy Liveliness**: Probes `GET /health/liveliness`.
  - **2. List Models API**: Probes `GET /v1/models` and verifies registered model aliases.
  - **3. Personas Taxonomy & Skills API**: Probes `GET /v1/personas` on Port 8080/4000, asserting all 6 domain categories and 21 personas with complete `skills` arrays.
  - **4. Persona Slash Command Mapping**: Verifies uniqueness and resolution of all 21 slash shortcuts (`/cp`, `/hack`, `/prof`, `/algo`, `/dl`, etc.).
  - **5. Chat Completions & Prompt Processing**: Sends `podllama-chat` prompt and verifies `prompt_tokens` accounting.
  - **6. Deep Thinking & Reasoning**: Sends `podllama-thinking` request and verifies reasoning model output.
  - **7. Instruct Completions**: Sends `podllama-instruct` request and verifies Qwen 2.5 Coder 7B Instruct output.
  - **8. Persona Prompt Injection & Target Model Execution**: Tests chat completions with injected persona system prompts (`/cp`, `/hack`, `/prof`) across designated target models.
  - **9. Chat Model Streaming**: Sends `podllama-chat` streaming request and validates SSE token chunk streaming.
  - **10. Autocomplete Model Completion**: Sends `podllama-autocomplete` FIM request and validates inline code completion.
  - **11. Function & Tool Calling**: Sends tool definitions to validate tool support without server error.
  - **12. Auto-Stop & Recovery Test**: Simulates backend model server stop (`stop_llama_server()`) and verifies automatic cold-start model reload and completion recovery.

---

## 10. Official VS Code Extension (PodLlama Code)

A companion extension, **PodLlama Code**, is bundled with the project to streamline developer workflows locally:
- **GitHub Primer Design System Theming**: Includes bundled official **GitHub Light Default** and **GitHub Dark Dimmed** color themes. The chat webview seamlessly inherits Primer design tokens (`#22272e` canvas, `#1c2128` inset, `#444c56` border, `#539bf5` blue accent, `#347d39` green buttons) with offline **Fira Sans** and **Fira Code** typography (with programming ligatures).
- **Simultaneous Multi-Session Chat Execution**: Run parallel AI generation streams across multiple sessions concurrently without blocking or aborting background conversations. Tokens accumulate in memory and save to persistent history upon completion.
- **Dynamic Active Webview Synchronization**: Switching between conversations in the History drawer immediately displays the target session's latest state. If a switched session is currently streaming in the background, all completed messages and in-progress tokens are restored instantly with live stream continuation and per-session stop controls.
- **Real-Time Running Indicators & Drawer Count**: The history drawer highlights the active session and displays live spinning badges (`Generating...`) alongside an active background session counter (e.g. `(2 running)`).
- **Session Export (Copy as Markdown & Insert to Active File)**: Export any chat session directly from the header export menu or via the VS Code Command Palette (`PodLlama: Copy Chat as Markdown` and `PodLlama: Insert Chat into Active File`).
- **Decoupled Dual-Buffer Architecture**: Ingestion buffer (`streamDataBuffer`) and presentation buffer (`viewBuffer` / `lastGoodHtml`) decouple network packet reception from browser UI paints for real-time token-by-token streaming.
- **Resilient Fallback Live Markdown Renderer**: Formats Markdown live during streaming with `fallbackMarkdown` protection against CDN script unavailability, unparsed tokens, split backticks, and TCP packet fragmentation.
- **Multi-Field SSE Delta Streaming**: Extracts and streams token chunks seamlessly across standard responses (`content`), DeepSeek reasoning traces (`reasoning_content`), and thinking models (`thinking`).
- **Context Attachments**: Injects complete files into chat inputs via a custom `+` context attachment button.
- **Service Availability Status Bar Monitor**: Continuously polls service liveliness, displaying `$(circle-slash) PodLlama Unavailable` in grey when the stack is stopped.
- **Editor Integration ('Chat' Menu)**: Right-clicking highlighted code pastes it instantly as active chat context.
- **Inline Proposed Change Diffing**: Allows reviewing applied code patches inline using VS Code's native accept/reject actions.
- **Asynchronous Context Summarization Engine**: Triggers context summarization asynchronously via `podllama-chat` once a conversation exceeds 6 message turns. Compresses details into structured context points to save token history overhead while allowing live chat completions to stream immediately without blocking.


---

## 11. Server-Side Personas System & LaTeX Math Rendering

- **21 Category-Wise CS, AI, Engineering & Research Personas**: Configured in `config/personas.json` and loaded into memory on startup by `containers/chat_swapper.py`. Organized across 6 distinct domain categories (`cs-theory`, `ai-ml`, `software-engineering`, `systems-devops`, `security-governance`, `research-data-science`) with 5 concrete, actionable skills defined per persona.
  - **Computer Science & Foundations**: University CS Professor (`/prof`), Algorithm Specialist (`/algo`), Competitive Programming Solver (`/cp`), Theoretical Computer Scientist (`/theorist`).
  - **Artificial Intelligence & Machine Learning**: Deep Learning Scientist (`/dl`), MLOps & Inference Engineer (`/mlops`), AI Safety Auditor (`/safety`), NLP & LLM Specialist (`/nlp`).
  - **Software Engineering & Architecture**: Enterprise Solution Architect (`/architect`), Senior Polyglot Engineer (`/dev`), Full-Stack Web Architect (`/web`), Database & Storage Specialist (`/db`), Hackathon MVP Prototyper (`/hack`).
  - **Systems, DevOps & Cloud Infrastructure**: DevOps Container Lead (`/devops`), Linux Systems & Kernel Engineer (`/systems`), Site Reliability Engineer (`/sre`).
  - **Cybersecurity & Governance**: Cybersecurity Specialist (`/sec`), Cloud Security Architect (`/cloudsec`).
  - **Research, Academia & Data Science**: Academic Paper Author (`/paper`), Scientific Peer Reviewer (`/review`), Data Scientist & Quant Analyst (`/data`).
- **Dynamic System Prompt, Skillset & Model Pairings**: Choosing a persona automatically injects its domain-specific system prompt, category metadata, and routes to its recommended target model (`podllama-thinking`, `podllama-chat`, or `podllama-instruct`).
- **KaTeX LaTeX Formula Rendering**: The VS Code extension chat panel natively renders math expressions (`$$...$$`, `\[...\]`, `\(...\)`, `$..$`) using embedded KaTeX styling.
- **Out Directory VSIX Artifact**: The extension build script packages `.vsix` bundles into `vscode-extension/out/podllama-code-1.2.1.vsix` and `make install-vscode-extension` dynamically detects and installs the latest built package.