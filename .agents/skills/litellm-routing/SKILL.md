---
name: litellm-routing
description: Configure and debug LiteLLM Unified Proxy routing, API endpoints, model aliases, and OpenAI API compatibility. Use when modifying litellm_config.yaml, testing proxy health, or troubleshooting request routing on port 4000.
---

# LiteLLM Routing Skill

This skill covers configuring, operating, and troubleshooting the LiteLLM Proxy unified API layer in `qwen_code_container.git`.

## Overview

The LiteLLM Proxy serves as the central gateway on port 4000 (`http://localhost:4000/v1`). It receives OpenAI-compatible requests and routes them to either `podllama_chat:8080` (chat & thinking models) or `podllama_autocomplete:8081` (autocomplete models) based on the requested model name.

Configuration file: `config/litellm_config.yaml`

## Model Aliases & Routing Rules

| Model Name Alias | Target Endpoint | Backend Server |
| :--- | :--- | :--- |
| `podllama-chat` | `http://podllama_chat:8080/v1` | Chat Server (`qwen2.5-coder-7b-instruct`) |
| `podllama-thinking` | `http://podllama_chat:8080/v1` | Chat Server (`DeepSeek-R1-Distill-Qwen-7B` / `14B`) |
| `podllama-autocomplete` | `http://podllama_autocomplete:8081/v1` | Autocomplete Server (`qwen2.5-coder-0.5b`) |

## API Testing Examples

### Chat Completions (`/v1/chat/completions`)

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "podllama-chat",
    "messages": [
      {"role": "user", "content": "Write a quicksort implementation in Python."}
    ]
  }'
```

### Deep Thinking / Reasoning Request (`/v1/chat/completions`)

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "podllama-thinking",
    "messages": [
      {"role": "user", "content": "Prove prime number distribution theorem."}
    ]
  }'
```

### Text Completions / Autocomplete (`/v1/completions`)

```bash
curl http://localhost:4000/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "podllama-autocomplete",
    "prompt": "def binary_search(arr, target):\n"
  }'
```

### Health Check

```bash
curl http://localhost:4000/health/liveliness
```
