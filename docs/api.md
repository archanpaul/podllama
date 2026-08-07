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
  "model": "qwen-chat",
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
    "model": "qwen-chat",
    "messages": [
      {"role": "user", "content": "Write a Python function to sort a dictionary by value."}
    ]
  }'
```

---

### 2.2 Text Completions / Autocomplete (`POST /v1/completions`)

Used for low-latency inline code autocompletion and FIM (Fill-In-Middle) requests.

#### Request Body
```json
{
  "model": "qwen-autocomplete",
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
    "model": "qwen-autocomplete",
    "prompt": "def calculate_factorial(n: int) -> int:\n"
  }'
```

---

### 2.3 List Models (`GET /v1/models`)

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
    { "id": "qwen-chat", "object": "model", "owned_by": "litellm" },
    { "id": "qwen-autocomplete", "object": "model", "owned_by": "litellm" },
    { "id": "qwen2.5-coder-7b-instruct", "object": "model", "owned_by": "litellm" },
    { "id": "qwen2.5-coder-0.5b", "object": "model", "owned_by": "litellm" }
  ]
}
```

---

### 2.4 Liveliness & Health (`GET /health/liveliness`)

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

## 3. Model Mapping Table

| Model Alias / ID | Backend Route | Default Model File | Intended Use Case |
| :--- | :--- | :--- | :--- |
| `qwen-chat` | `podllama_chat:8080` | `qwen2.5-coder-7b-instruct-q4_k_m.gguf` | Chat, Code Generation, Refactoring |
| `qwen2.5-coder-7b-instruct` | `podllama_chat:8080` | `qwen2.5-coder-7b-instruct-q4_k_m.gguf` | Chat, High-Reasoning Tasks |
| `gpt-3.5-turbo` | `podllama_chat:8080` | `qwen2.5-coder-7b-instruct-q4_k_m.gguf` | Legacy API Compatibility Fallback |
| `qwen-autocomplete` | `podllama_autocomplete:8081` | `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` | Low-latency Inline Code Completion |
| `qwen2.5-coder-0.5b` | `podllama_autocomplete:8081` | `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` | Fast Autocomplete |
| `qwen2.5-coder-1.5b` | `podllama_autocomplete:8081` | `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` | Balanced Autocomplete |

---

## 3. On-Demand Model Switching & Selection

The LiteLLM Proxy (`http://localhost:4000/v1`) forwards requests to backend supervisors that support on-demand model swapping. You can switch models on the fly by changing the `"model"` field in API requests:

### Available Model Roles & Identifiers
- **Chat Role**: `podllama-chat` or `qwen2.5-coder-7b-instruct-q4_k_m.gguf`
- **Thinking Role**: `podllama-thinking`, `DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf`, or `DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf`
- **Autocomplete Role**: `podllama-autocomplete` or `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf`

### Example: On-Demand Thinking Model Swap
```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "podllama-thinking",
    "messages": [
      {"role": "user", "content": "Analyze time complexity of red-black tree insertion."}
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

### 4.2 Cline / Roo Code Extension Configuration

- **API Provider**: OpenAI Compatible
- **Base URL**: `http://localhost:4000/v1`
- **API Key**: `sk-local`
- **Model ID**: `qwen-chat`

---

## 5. Live Endpoint Smoke Testing

Execute end-to-end verification against the active stack using:

```bash
make smoke-tests
```

This runs `tests/smoke_tests.py` to validate:
- **Proxy Liveliness**: Probes `http://localhost:4000/health/liveliness`.
- **Prompt Processing**: Evaluates input code context prompts and verifies `prompt_tokens` token evaluation and accounting.
- **Chat Model Streaming**: Sends `POST /v1/chat/completions` with `"stream": true` and streams tokens.
- **Autocomplete Model Completion**: Sends `POST /v1/completions` to test inline code completion.
- **Tool Calling Support**: Sends function definitions (`qwen-chat` with `--jinja`) to ensure tool-calling endpoints function without server errors.

