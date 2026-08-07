---
name: testing-and-diagnostics
description: Execute unit tests, live smoke tests, and hardware/Vulkan pre-flight diagnostics for qwen_code_container. Use when verifying code changes, running tests/unit_tests.py or tests/smoke_tests.py, or debugging container execution failures.
---

# Testing and Diagnostics Skill

This skill provides guidelines and procedure protocols for testing and diagnosing the `qwen_code_container` repository.

## Test Suites

### 1. Unit Tests (`tests/unit_tests.py`)

Validates YAML configuration schemas, permissions, file integrity, and Containerfile configurations:

```bash
make unit-tests
```

### 2. Smoke Tests (`tests/smoke_tests.py`)

Executes live endpoint tests against active LiteLLM Proxy / llama-server endpoints. Tests chat completion, streaming, autocomplete, and tool calling capabilities:

```bash
make smoke-tests
```

### 3. Full Test Execution

Run both unit tests and smoke tests sequentially:

```bash
make tests
```

## Diagnostic Steps

When diagnosing issues:

1. **Verify configuration files**:
   - `python3 tests/unit_tests.py`

2. **Check Vulkan GPU access inside server container**:
   - `podman run --rm --device /dev/dri podllama-server:latest vulkaninfo --summary`

3. **Check container logs**:
   - `make service-logs`

4. **Verify checksums of downloaded GGUF models**:
   - `make check-checksum`
