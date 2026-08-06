---
name: model-management
description: Manage GGUF LLM models, SHA256 checksum verification, model downloading, and YAML configuration for qwen_code_container. Use when updating model weights, modifying active models in model_conf.yaml, or verifying model file integrity.
---

# Model Management Skill

This skill provides guidelines for configuring, downloading, verifying, and managing GGUF model files within `qwen_code_container.git`.

## Overview

Models are stored in `./models/` and configured via `config/model_conf.yaml`. The system supports dual-model architecture:
- **Chat Model**: High-reasoning model (e.g., `qwen2.5-coder-7b-instruct-q4_k_m.gguf`) served on port 8080.
- **Autocomplete Model**: Low-latency model (e.g., `qwen2.5-coder-0.5b-instruct-q4_k_m.gguf` or `1.5b`) served on port 8081.

## Workflow Operations

### 1. Downloading Models

Model downloads are managed via `scripts/download_models.py`:

```bash
# Download only active chat & autocomplete models specified in config/model_conf.yaml
make download-active-models

# Download ALL models configured in model_conf.yaml
make download-models
```

### 2. Checksum Verification

Verify SHA256 hashes of model files against `config/model_conf.yaml`:

```bash
make check-checksum
```

### 3. Modifying Active Models

To switch active models:
1. Open `config/model_conf.yaml`.
2. Update `active_chat_model` or `active_autocomplete_model` to point to a valid entry under `models`.
3. If necessary, update `config/litellm_config.yaml` to ensure proper routing and aliases.
4. Restart services via `make service-restart`.
