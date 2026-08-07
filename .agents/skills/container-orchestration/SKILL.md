---
name: container-orchestration
description: Manage and operate Podman container workflows, builds, service stack lifecycle, and execution for the qwen_code_container environment. Use when building images, launching compose services, inspecting container status, or running the agent container.
---

# Container Orchestration Skill

This skill provides guidelines and operational procedures for managing the Podman container infrastructure in `qwen_code_container.git`.

## Overview

The repository manages two main container images and a Podman Compose service stack:
- **Server Image (`podllama-server:latest`)**: Built via `containers/Containerfile.server`. Runs `llama-server` with Vulkan GPU acceleration on Fedora minimal.
- **Client Image (`qwen-client:latest`)**: Built via `containers/Containerfile.qwencoder`. Houses the Qwen CLI agent.
- **Compose Stack (`containers/compose.yaml`)**: Manages `podllama_chat` (port 8080), `podllama_autocomplete` (port 8081), and `podllama_proxy` (port 4000).

## Common Workflow Tasks

### 1. Building Container Images

Always build using rootless Podman via Makefile targets or direct commands:

```bash
# Build both server and client images
make build

# Build individual targets
make build-server
make build-client
```

### 2. Service Stack Lifecycle

Manage the full stack via Podman Compose:

```bash
# Start all services in background
make service-up

# Check running container and endpoint status
make status

# View live service logs
make service-logs

# Stop services
make service-down

# Restart services
make service-restart
```

### 3. Interactive Agent Execution

Run the `qwen-code` client agent inside a target workspace:

```bash
# Run agent in current workspace directory
make run-qwencode WORKSPACE_DIR=$(pwd)

# Direct script invocation for external project path
./scripts/run_qwencode.sh /path/to/target/project
```

### 4. Health Diagnostics & Troubleshooting

When diagnosing container or API issues:
1. Verify container status: `podman ps --filter "name=qwen" --filter "name=litellm"`
2. Check LiteLLM health endpoint: `curl -s http://127.0.0.1:4000/health/liveliness`
3. Inspect model server health endpoints directly: `curl -s http://127.0.0.1:8080/health` and `http://127.0.0.1:8081/health`
4. Check GPU device availability inside container: `podman run --rm --device /dev/dri podllama-server:latest vulkaninfo --summary`
