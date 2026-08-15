# API Specification & Integration Guide

The PodLlama Container Environment exposes an OpenAI-compatible HTTP API hosted by the **LiteLLM Proxy** on port **4000** (`http://localhost:4000/v1`). 

---

## 1. Authentication & Base URL

- **Base URL**: `http://localhost:4000/v1`
- **Authentication**: Bearer Token
- **Default Master Key**: `sk-local` (configured in `config/litellm_config.yaml`)

All requests require the HTTP header:
```http
Authorization: Bearer sk-local
```

---

## 2. API Endpoints

### 2.1 Chat Completions (`POST /v1/chat/completions`)

Used for multi-turn chat, code refactoring, explanation, and workspace agent tasks.

#### Request Body
```json
{
  "model": "podllama-chat",
  "messages": [
    { "role": "system", "content": "You are an expert software developer." },
    { "role": "user", "content": "Write a Python function to sort a dictionary by value." }
  ],
  "temperature": 0.2,
  "max_tokens": 1024,
  "stream": false
}
```

#### Example cURL
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "podllama-chat",
    "messages": [
      {"role": "user", "content": "Write a Python function to sort a dictionary by value."}
    ]
  }'
```

### 2.2 Deep Thinking & Reasoning (`POST /v1/chat/completions`)

Used for deep reasoning, mathematical proofs, logic analysis, and complex code architecture tasks using `podllama-thinking` (`DeepSeek-R1-Distill-Qwen-7B` or `14B`).

#### Request Body
```json
{
  "model": "podllama-thinking",
  "messages": [
    { "role": "system", "content": "You are a logic and reasoning expert." },
    { "role": "user", "content": "Analyze algorithm time complexity for quicksort best vs worst case." }
  ],
  "temperature": 0.1,
  "max_tokens": 2048,
  "stream": false
}
```

#### Example cURL
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "podllama-thinking",
    "messages": [
      {"role": "user", "content": "Analyze algorithm time complexity for quicksort best vs worst case."}
    ]
  }'
```

> [!NOTE]
> **VRAM/RAM Memory Isolation & Concurrency**:
> - **`podllama-chat` & `podllama-thinking`** both run on backend port `8080` via `chat_swapper.py`. Due to GPU VRAM and system RAM limitations, only **one** chat or thinking model runs in VRAM at a time. Requesting `podllama-thinking` automatically unloads `podllama-chat` (and vice-versa) before cold-starting the target model.
> - **`podllama-autocomplete`** runs on dedicated backend port `8081` and operates **in parallel** with chat/thinking models without triggering swaps.

---

### 2.3 Text Completions / Autocomplete (`POST /v1/completions`)

Used for low-latency inline code autocompletion and FIM (Fill-In-Middle) requests.

#### Request Body
```json
{
  "model": "podllama-autocomplete",
  "prompt": "def calculate_factorial(n: int) -> int:\n",
  "max_tokens": 128,
  "temperature": 0.1,
  "stop": ["\n\n", "def "]
}
```

#### Example cURL
```bash
curl http://localhost:4000/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "podllama-autocomplete",
    "prompt": "def calculate_factorial(n: int) -> int:\n"
  }'
```

---

### 2.4 List Models (`GET /v1/models`)

Retrieves available models and registered aliases.

#### Example cURL
```bash
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-local"
```

#### Response
```json
{
  "object": "list",
  "data": [
    { "id": "podllama-chat", "object": "model", "owned_by": "litellm" },
    { "id": "podllama-autocomplete", "object": "model", "owned_by": "litellm" },
    { "id": "podllama-thinking", "object": "model", "owned_by": "litellm" },
    { "id": "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf", "object": "model", "owned_by": "litellm" },
    { "id": "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf", "object": "model", "owned_by": "litellm" },
    { "id": "qwen2.5-coder-3b-instruct-q4_k_m.gguf", "object": "model", "owned_by": "litellm" },
    { "id": "qwen2.5-coder-7b-instruct-q4_k_m.gguf", "object": "model", "owned_by": "litellm" },
    { "id": "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf", "object": "model", "owned_by": "litellm" },
    { "id": "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf", "object": "model", "owned_by": "litellm" }
  ]
}
```

---

### 2.5 Liveliness & Health (`GET /health/liveliness`)

Probes whether the LiteLLM Proxy is active and responding (unauthenticated).

#### Example cURL
```bash
curl http://localhost:4000/health/liveliness
```

#### Response
```json
"I'm alive!"
```

---

## 3. Model Mapping & Execution Specification

| Model Alias / GGUF Identifier | Role / Category | Backend Target Server | Loaded Model File | Disk Size | Concurrency & Execution Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `podllama-chat` | Default Chat | `podllama_chat:8080` | `qwen2.5-coder-7b-instruct-q4_k_m.gguf` | ~4.68 GB | Auto-swaps on port 8080 (Single active chat/thinking model) |
| `podllama-thinking` | Default Reasoning | `podllama_chat:8080` | `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` | ~4.68 GB | Auto-swaps on port 8080 (Single active chat/thinking model) |
| `podllama-autocomplete` | Default Autocomplete | `podllama_autocomplete:8081` | `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` | ~491 MB | Dedicated port 8081 (Runs in parallel with chat) |
| `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` | Direct File (Autocomplete) | `podllama_autocomplete:8081` | `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` | ~491 MB | Dedicated port 8081 (Real-time FIM inline completions) |
| `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` | Direct File (Autocomplete/Chat) | `podllama_autocomplete:8081` | `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` | ~1.12 GB | Dedicated port 8081 (Enhanced multi-line completions) |
| `qwen2.5-coder-3b-instruct-q4_k_m.gguf` | Direct File (Medium Chat) | `podllama_chat:8080` | `qwen2.5-coder-3b-instruct-q4_k_m.gguf` | ~2.10 GB | Auto-swaps on port 8080 (Fast mid-sized code chat) |
| `qwen2.5-coder-7b-instruct-q4_k_m.gguf` | Direct File (Flagship Chat) | `podllama_chat:8080` | `qwen2.5-coder-7b-instruct-q4_k_m.gguf` | ~4.68 GB | Auto-swaps on port 8080 (State-of-the-art coding chat) |
| `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` | Direct File (7B Reasoning) | `podllama_chat:8080` | `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` | ~4.68 GB | Auto-swaps on port 8080 (Chain-of-thought logic & math) |
| `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` | Direct File (14B Reasoning) | `podllama_chat:8080` | `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` | ~8.99 GB | Auto-swaps on port 8080 (High-capacity deep synthesis) |

---

## 4. On-Demand Model Switching & Selection

The LiteLLM Proxy (`http://localhost:4000/v1`) forwards requests to backend supervisors that support on-demand model swapping. You can switch models on the fly by specifying the exact `"model"` identifier in API requests:

### Available Model Roles & GGUF Identifiers
- **Autocomplete Models (Port 8081)**:
  - `podllama-autocomplete` (Default alias for `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf`)
  - `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` (491 MB)
  - `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` (1.12 GB)
- **Chat Models (Port 8080)**:
  - `podllama-chat` (Default alias for `qwen2.5-coder-7b-instruct-q4_k_m.gguf`)
  - `qwen2.5-coder-3b-instruct-q4_k_m.gguf` (2.10 GB)
  - `qwen2.5-coder-7b-instruct-q4_k_m.gguf` (4.68 GB)
- **Thinking & Reasoning Models (Port 8080)**:
  - `podllama-thinking` (Default alias for `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf`)
  - `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf` (4.68 GB)
  - `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf` (8.99 GB)

### Example: On-Demand Model Swap API Requests

#### 1. On-Demand 14B Deep Reasoning Swap:
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
    "messages": [
      {"role": "user", "content": "Analyze algorithm time complexity of red-black tree insertion."}
    ]
  }'
```

#### 2. On-Demand 3B Fast Chat Swap:
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    "messages": [
      {"role": "user", "content": "Write a bash script to back up a postgres database."}
    ]
  }'
```

---

## 4. IDE Integration Guide

### 4.1 Continue Extension (`config/continue.yaml` / `~/.continue/config.yaml`)

Use the pre-configured [config/continue.yaml](file:///home/arp/workspace/grokking.workspace/qwen_code_container.git/config/continue.yaml) template:

```yaml
name: Qwen Code Local (Vulkan GPU Accelerated)
version: 0.0.1
schema: v1

models:
  - name: PodLlama Chat (Local Vulkan)
    provider: openai
    model: podllama-chat
    apiBase: http://localhost:4000/v1
    apiKey: sk-local
    contextLength: 65536
    roles:
      - chat
      - edit

  - name: PodLlama Thinking (DeepSeek-R1 Local Vulkan)
    provider: openai
    model: podllama-thinking
    apiBase: http://localhost:4000/v1
    apiKey: sk-local
    contextLength: 65536
    roles:
      - chat

  - name: PodLlama Autocomplete (Local Vulkan)
    provider: openai
    model: podllama-autocomplete
    apiBase: http://localhost:4000/v1
    apiKey: sk-local
    useLegacyCompletionsEndpoint: true
    roles:
      - autocomplete
    promptTemplates:
      autocomplete: "<|fim_prefix|>{{{prefix}}}<|fim_suffix|>{{{suffix}}}<|fim_middle|>"
```

### 4.2 Cline / Roo Code Extension Configuration

- **API Provider**: OpenAI Compatible
- **Base URL**: `http://localhost:4000/v1`
- **API Key**: `sk-local`
- **Model ID**: `podllama-chat`

### 4.3 Terminal Workspace CLI Agents

- **pi.dev Workspace Agent**: `make run-pi` (uses `podllama-cli:latest` container and connects automatically to `http://localhost:4000/v1`).
- **Oh My Pi (omp.sh) Agent**: `make run-omp` (uses `podllama-omp:latest` container and connects automatically to `http://localhost:4000/v1`).

---



## 5. Live Endpoint Smoke Testing

Execute end-to-end verification against the active stack using:

```bash
make smoke-tests
```

This runs `tests/smoke_tests.py` to validate:
- **1. Proxy Liveliness**: Probes `GET /health/liveliness`.
- **2. List Models API**: Probes `GET /v1/models` and parses registered model IDs.
- **3. Chat Completions**: Sends `POST /v1/chat/completions` with `podllama-chat` to evaluate input code context prompts and verify `prompt_tokens` accounting.
- **4. Deep Thinking & Reasoning**: Sends `POST /v1/chat/completions` with `podllama-thinking` to test reasoning model output.
- **5. Chat Model Streaming**: Sends `POST /v1/chat/completions` with `"stream": true` and streams Server-Sent Events (SSE) token chunks.
- **6. Autocomplete Model Completion**: Sends `POST /v1/completions` with `podllama-autocomplete` to test inline FIM code completion.
- **7. Tool Calling Support**: Sends function tool definitions (`podllama-chat` with `--jinja`) to ensure tool-calling endpoints function without server errors.

