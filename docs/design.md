# Architecture & System Design Document

This document outlines the architecture, container orchestration, network flow, security boundary, and configuration schemas of the **PodLlama Container Environment**.

---

## 1. High-Level Architecture Overview

The system employs a containerized microservices architecture organized into three main layers:

1. **Client / Workspace Layer**: The user's workstation or `qwen-client` terminal agent.
2. **Unified Routing Proxy Layer**: `podllama_proxy` listening on host port `4000`.
3. **Backend Model Server Layer**: Isolated `llama-server` instances with Vulkan GPU layer offloading.

```mermaid
flowchart TD
    subgraph Host Workstation / IDE
        Client Agent["qwen-client CLI / VS Code Extensions"]
    end

    subgraph Podman Container Stack (containers_default network)
        LiteLLM["podllama_proxy\n(Port 4000:4000)"]
        ChatServer["podllama_chat\n(Port 8080 internal)\nQwen2.5-Coder-7B"]
        AutoServer["podllama_autocomplete\n(Port 8081 internal)\nQwen2.5-Coder-0.5B / 1.5B"]
    end

    subgraph GPU Hardware Layer
        Vulkan["/dev/dri (Intel / AMD / NVIDIA GPU)"]
    end

    Client Agent -->|HTTP / OpenAI API| LiteLLM
    LiteLLM -->|Route qwen-chat| ChatServer
    LiteLLM -->|Route qwen-autocomplete| AutoServer
    ChatServer -->|Vulkan Offload -ngl 99| Vulkan
    AutoServer -->|Vulkan Offload -ngl 99| Vulkan
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

### 2.4 `qwen-client`
- **Image**: `qwen-client:latest` (built from `containers/Containerfile.qwencoder`)
- **Role**: Standalone interactive workspace agent container pre-packaged with official `QwenLM/qwen-code` CLI tool. Mounted directly to the project root directory.

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

    C->>S: Launch llama-server --model <file> --port <port> --n-gpu-layers 99
```

### 4.2 On-Demand Model Switching Mechanism (`chat_swapper.py`)

When an incoming API request targets a different model (e.g., switching from `podllama-chat` to `podllama-thinking` or requesting `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` directly), the proxy automatically performs an on-demand model swap:

```mermaid
sequenceDiagram
    autonumber
    participant Client as Client / IDE / Agent
    participant Proxy as Proxy Swapper (Port 8080)
    participant Llama as llama-server Process
    participant VRAM as Host Vulkan VRAM

    Client->>Proxy: POST /v1/chat/completions { model: "podllama-thinking" }
    Proxy->>Proxy: Resolve requested model -> "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf"
    
    alt Requested model != Currently running model
        Proxy->>Llama: Terminate running llama-server process (SIGTERM)
        Llama->>VRAM: Release 100% VRAM / RAM (0 MB idle mode)
        Proxy->>Proxy: Ensure GGUF model file downloaded in /models
        Proxy->>Llama: Launch llama-server with target GGUF model
        Proxy->>Llama: Wait for http://127.0.0.1:8082/health readiness (up to 45s)
    end

    Proxy->>Llama: Forward HTTP request payload
    Llama-->>Proxy: Stream response tokens / SSE chunks
    Proxy-->>Client: Return completion stream
```

---

## 5. Configuration Schemas

### 5.1 `config/model_conf.yaml`
Centralized YAML schema specifying active models, URLs, ports, and checksums:

```yaml
active_chat_model: qwen2.5-coder-7b-instruct-q4_k_m.gguf
active_autocomplete_model: qwen2.5-coder-0.5b-instruct-q4_k_m.gguf
active_thinking_model: DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf
chat_server_port: 8080
autocomplete_server_port: 8081
idle_timeout_seconds: 600
vulkan_gpu_layers: 99
context_size: 65536

models:
  qwen2.5-coder-7b-instruct-q4_k_m.gguf:
    url: https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf
    sha256: 509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c

  DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf:
    url: https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-7B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf
    sha256: auto-verify-on-download

  DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf:
    url: https://huggingface.co/unsloth/DeepSeek-R1-Distill-Qwen-14B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf
    sha256: auto-verify-on-download
```

### 5.2 `config/litellm_config.yaml`
LiteLLM model aliases and routing table:

```yaml
model_list:
  - model_name: podllama-chat
    litellm_params:
      model: custom_openai/qwen2.5-coder
      api_base: http://podllama_chat:8080/v1
      api_key: sk-local

  - model_name: podllama-autocomplete
    litellm_params:
      model: custom_openai/qwen2.5-coder
      api_base: http://podllama_autocomplete:8081/v1
      api_key: sk-local

  - model_name: podllama-thinking
    litellm_params:
      model: custom_openai/qwen2.5-coder
      api_base: http://podllama_chat:8080/v1
      api_key: sk-local

general_settings:
  master_key: sk-local
  disable_master_key_auth: true

router_settings:
  num_retries: 3
  timeout: 120

litellm_settings:
  max_tokens: 65536
  max_input_tokens: 65536
  truncate_input_tokens: true
  drop_params: true
```
