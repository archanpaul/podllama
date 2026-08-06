---
name: litellm-routing
description: Configure and debug LiteLLM Unified Proxy routing, API endpoints, model aliases, and OpenAI API compatibility. Use when modifying litellm_config.yaml, testing proxy health, or troubleshooting request routing on port 4000.
---

# LiteLLM Routing Skill

This skill covers configuring, operating, and troubleshooting the LiteLLM Proxy unified API layer in `qwen_code_container.git`.

## Overview

The LiteLLM Proxy serves as the central gateway on port 4000 (`http://localhost:4000/v1`). It receives OpenAI-compatible requests and routes them to either `qwen_server_chat:8080` or `qwen_server_autocomplete:8081` based on the requested model name.

Configuration file: `config/litellm_config.yaml`

## Model Aliases & Routing Rules

| Model Name Alias | Target Endpoint | Backend Server |
| :--- | :--- | :--- |
| `qwen-chat`, `qwen2.5-coder-7b-instruct`, `gpt-3.5-turbo` | `http://qwen_server_chat:8080/v1` | Chat Server |
| `qwen-autocomplete`, `qwen2.5-coder-0.5b` | `http://qwen_server_autocomplete:8081/v1` | Autocomplete Server |
| `qwen2.5-coder-1.5b` | `http://qwen_server_autocomplete:8081/v1` | Autocomplete Server |

## API Testing Examples

### Chat Completions (`/v1/chat/completions`)

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "qwen-chat",
    "messages": [
      {"role": "user", "content": "Write a quicksort implementation in Python."}
    ]
  }'
```

### Text Completions / Autocomplete (`/v1/completions`)

```bash
curl http://localhost:4000/v1/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-local" \
  -d '{
    "model": "qwen-autocomplete",
    "prompt": "def binary_search(arr, target):\n"
  }'
```

### Health Check

```bash
curl http://localhost:4000/health/liveliness
```
