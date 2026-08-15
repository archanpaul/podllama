# Architecture & System Design Document

This document outlines the architecture, container orchestration, network flow, security boundary, and configuration schemas of the **PodLlama Container Environment**.

---

## 1. High-Level Architecture Overview

The system employs a containerized microservices architecture organized into four main operational layers:

1. **Client / Workspace Layer**: VS Code Extension (PodLlama Code), terminal workspace agent (`podllama-cli` / `pi.dev`), or third-party IDE extensions (Continue.dev, Cline, Cursor).
2. **Unified Routing Proxy Layer**: `podllama_proxy` listening on host port `4000`.
3. **Backend Model Server & Supervisor Layer**: Isolated `llama-server` instances managed by `chat_swapper.py` on port `8080` (Chat/Reasoning) and port `8081` (Autocomplete).
4. **Hardware Acceleration & Security Layer**: Vulkan GPU API (`/dev/dri`), rootless Podman user namespaces, and SELinux volume isolation.

```mermaid
flowchart TB
    subgraph IDE_CLIENT_LAYER["1. Client & IDE Integration Layer"]
        VSCodeExt["PodLlama Code VS Code Extension\n(Webview Chat, Inline Diff, Offline Ligatures)"]
        PodLlamaCLI["podllama-cli Container CLI\n(pi.dev Workspace Agent)"]
        ExternalIDE["Third-Party IDE Extensions\n(Continue.dev, Cline, Cursor, Roo Code)"]
    end

    subgraph PROXY_LAYER["2. Unified Routing Proxy Layer (Port 4000)"]
        LiteLLMProxy["podllama_proxy (LiteLLM Router)\nhttp://localhost:4000/v1"]
    end

    subgraph BACKEND_STACK["3. Podman Container Microservices Stack (containers_default network)"]
        subgraph CHAT_SUPERVISOR["Chat & Reasoning Supervisor (Port 8080)"]
            Swapper["chat_swapper.py Supervisor"]
            LlamaChat["llama-server Backend Process\n(podllama-chat / podllama-thinking)"]
            IdleTimer["Idle Auto-Stop Timer\n(0 MB RAM/VRAM when idle > 600s)"]
            Swapper --> LlamaChat
            LlamaChat --> IdleTimer
        end

        subgraph AUTOCOMPLETE_SERVICE["Autocomplete Service (Port 8081)"]
            LlamaAuto["podllama_autocomplete Backend\n(Qwen2.5-Coder-0.5B / 1.5B FIM)"]
        end
    end

    subgraph HARDWARE_SECURITY_LAYER["4. Host Hardware Acceleration & Security Layer"]
        VulkanGPU["Cross-Vendor Vulkan GPU API\n/dev/dri (Intel Arc / AMD Radeon / NVIDIA)"]
        CPUPool["Host Multi-Threaded CPU Fallback Pool"]
        RootlessSELinux["Rootless Podman Namespace (--userns=keep-id)\nSELinux Volume Isolation (:Z / :ro,Z)"]
    end

    %% Flow Connections
    VSCodeExt -->|OpenAI REST API| LiteLLMProxy
    PodLlamaCLI -->|OpenAI REST API| LiteLLMProxy
    ExternalIDE -->|OpenAI REST API| LiteLLMProxy

    LiteLLMProxy -->|Route podllama-chat / podllama-thinking| Swapper
    LiteLLMProxy -->|Route podllama-autocomplete| LlamaAuto

    LlamaChat -->|Offload Vulkan Layers -ngl 99| VulkanGPU
    LlamaChat -->|CPU Fallback| CPUPool
    LlamaAuto -->|Offload Vulkan Layers -ngl 99| VulkanGPU

    BACKEND_STACK --- RootlessSELinux
```

---

## 2. Container Hierarchy & Component Responsibilities

### 2.1 `podllama_proxy`
- **Image**: `ghcr.io/berriai/litellm:main-latest`
- **Exposed Port**: `4000:4000`
- **Role**: Provides a single OpenAI-compatible HTTP interface (`/v1/chat/completions`, `/v1/completions`, `/v1/models`). Translates incoming requests to appropriate upstream model server backends based on `config/litellm_config.yaml`.

### 2.2 `podllama_chat`
- **Image**: `podllama-server:latest` (built from `containers/Containerfile.llamacpp`)
- **Port**: `8080` (internal service port)
- **Role**: Primary Chat, high-reasoning code generation, complex refactoring.

### 2.3 `podllama_autocomplete`
- **Image**: `podllama-server:latest` (built from `containers/Containerfile.llamacpp`)
- **Internal Port**: `8081`
- **Role**: Runs `llama-server` configured with `MODEL_ROLE=autocomplete`. Loads `qwen2.5-coder-0.5b` or `1.5b` for low-latency FIM inline autocomplete.

### 2.4 `podllama-cli`
- **Image**: `podllama-cli:latest` (built from `containers/Containerfile.pi`)
- **Base**: `node:24-bookworm-slim`
- **Role**: Standalone interactive workspace agent container pre-packaged with official `pi.dev` CLI tool (`@earendil-works/pi-coding-agent`). Mounted directly to the project root directory.

### 2.5 `podllama-omp`
- **Image**: `podllama-omp:latest` (built from `containers/Containerfile.omp`)
- **Base**: `node:24-bookworm-slim`
- **Role**: Standalone interactive workspace agent container pre-packaged with Oh My Pi (`omp.sh` / `@oh-my-pi/pi-coding-agent`) CLI agent and `bun` runtime. Mounted directly to the project root directory.

---

## 3. Network Topology & Container Security

```mermaid
graph LR
    subgraph Host Network
        HostIP["Host 127.0.0.1:4000"]
    end

    subgraph Podman User Network (containers_default)
        LiteLLM["podllama_proxy:4000"]
        Chat["podllama_chat:8080"]
        Auto["podllama_autocomplete:8081"]
    end

    HostIP -->|Port Forward 4000| LiteLLM
    LiteLLM -->|Internal DNS| Chat
    LiteLLM -->|Internal DNS| Auto
```

### Security Controls

- **SELinux Isolation (`:Z` & `:ro,Z`)**:
  - Model directory volume: `${MODELS_DIR}:/models:Z`
  - LiteLLM config file: `../config/litellm_config.yaml:/app/config.yaml:ro,Z`
- **Rootless User Namespace (`--userns=keep-id`)**: Maps host UID/GID directly into client containers to prevent root privilege escalation while granting local file write access to project workspace directories.
- **Internal Backend Isolation**: Backend `podllama_chat` and `podllama_autocomplete` services do not publish host ports in Compose mode, preventing direct unauthenticated host access.

---

## 4. Initialization & Model Auto-Swapping Flow

### 4.1 Server Startup Diagnostics
```mermaid
sequenceDiagram
    autonumber
    participant C as Podman Entrypoint Script
    participant V as Vulkan GPU Hardware
    participant M as Model Registry (model_conf.yaml)
    participant S as Llama Server Process

    C->>V: Execute vulkaninfo --summary & check /dev/dri
    alt Vulkan GPU Available
        C->>C: Set vulkan_gpu_layers = 99
    else CPU Fallback
        C->>C: Set vulkan_gpu_layers = 0
    end

    C->>M: Parse active model role (chat, autocomplete, thinking)
    C->>C: Check SHA256 checksum in /models/
    alt Model file missing / invalid
        C->>C: Auto-download GGUF model via curl
    end

    C->>S: Launch llama-server on designated internal port
```

### 4.2 On-Demand Model Auto-Swapping & Idle Reclaim
```mermaid
sequenceDiagram
    autonumber
    participant Client as IDE Client / Workspace Agent
    participant Proxy as podllama_proxy (Port 4000)
    participant Swapper as chat_swapper.py (Port 8080)
    participant Llama as llama-server Process
    participant GPU as Vulkan VRAM / Host RAM

    Client->>Proxy: POST /v1/chat/completions (model: podllama-thinking)
    Proxy->>Swapper: Forward request to Port 8080

    alt Active model != DeepSeek-R1-Distill-Qwen-7B (or server stopped)
        Swapper->>Llama: SIGTERM active llama-server process
        Llama->>GPU: Release Vulkan VRAM allocations
        Swapper->>Llama: Launch llama-server with DeepSeek-R1-Distill-Qwen-7B.gguf
        Llama->>GPU: Allocate Vulkan GPU layers (-ngl 99)
        Llama-->>Swapper: Ready (Health check 200 OK)
    end

    Swapper->>Llama: Proxy HTTP completion request
    Llama-->>Swapper: Stream response tokens
    Swapper-->>Proxy: Stream response tokens
    Proxy-->>Client: Stream response tokens

    Note over Swapper,Llama: Idle Timer: If inactive > 600s, SIGTERM llama-server (0 MB VRAM)
```

---

## 5. Configuration File Formats & Specifications

### 5.1 `config/model_conf.yaml`
```yaml
models:
  - id: "qwen2.5-coder-0.5b"
    filename: "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf"
    role: "autocomplete"
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf"
    sha256: "1d9614638d18024d0fbb36575a15f1302a3adf044df10345688ec4f6e1c4ff32"

active_chat_model: "qwen2.5-coder-7b-instruct-q4_k_m.gguf"
active_autocomplete_model: "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf"
active_thinking_model: "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf"

idle_timeout_seconds: 600
```

### 5.2 `config/litellm_config.yaml`
```yaml
model_list:
  - model_name: podllama-chat
    litellm_params:
      model: openai/qwen2.5-coder-7b-instruct
      api_base: http://podllama_chat:8080/v1
      api_key: sk-local

  - model_name: podllama-thinking
    litellm_params:
      model: openai/DeepSeek-R1-Distill-Qwen-7B
      api_base: http://podllama_chat:8080/v1
      api_key: sk-local

  - model_name: podllama-autocomplete
    litellm_params:
      model: openai/qwen2.5-coder-0.5b-instruct
      api_base: http://podllama_autocomplete:8081/v1
      api_key: sk-local
```
