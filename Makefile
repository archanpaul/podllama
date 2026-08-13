# Makefile for PodLlama Container Environment (Vulkan GPU Accelerated)

.PHONY: help build build-server build-cli build-litellm build-proxy build-extension build-vscode-extension install-extension install-vscode-extension start-server stop-server compose-up compose-down compose-logs compose-start compose-stop compose-restart service-up service-down service-start service-stop service-restart service-logs service-status show-live-logs status unit-tests test smoke-tests smoke_tests smoke-test run-crush run-pod check-checksum download-active-models download-models clean

# Variables
PODMAN ?= podman
PODMAN_COMPOSE ?= podman compose
MODELS_DIR ?= ./models
WORKSPACE_DIR ?= $(shell pwd)
SERVER_IMAGE ?= podllama-server:latest
CLI_IMAGE ?= podllama-cli:latest
CLIENT_IMAGE ?= $(CLI_IMAGE)
POD_NAME ?= podllama_pod
LLAMA_CPP_TAG ?= b10327

help:
	@echo "Available Makefile targets:"
	@echo "  make check-infra         - Verify host build/run infrastructure (Podman, Python 3, PyYAML, curl, DRI)"
	@echo "  make build               - Build server, client, and LiteLLM proxy Podman images using fedora-minimal:latest"
	@echo "  make build-litellm       - Build LiteLLM Proxy image (fedora-minimal staged build)"
	@echo "  make build-vscode-extension - Build VS Code extension package (vscode-extension/*.vsix)"
	@echo "  make install-vscode-extension - Build and install VS Code extension into VS Code ('code --install-extension')"
	@echo "  make service-up          - Launch Chat, Autocomplete & LiteLLM Proxy via Podman Compose (Port 4000)"
	@echo "  make service-down        - Stop Podman Compose services"
	@echo "  make service-logs        - View live logs from all running services"
	@echo "  make service-status      - Check running status and health of podllama services"
	@echo "  make service-restart     - Restart all services (service-down then service-up)"
	@echo "  make start-server        - Start Vulkan chat model server container on port 8080"
	@echo "  make start-autocomplete-server - Start Vulkan autocomplete model server container on port 8081"
	@echo "  make start-all           - Start both model server containers"
	@echo "  make stop-server         - Stop model server containers"
	@echo "  make unit-tests          - Run automated unit test suite (config schema, permissions, container files)"
	@echo "  make tests               - Run all unit and smoke test suites"
	@echo "  make smoke-tests         - Run live smoke test on Chat (streaming), Autocomplete, and Tool Calling"
	@echo "  make download-active-models - Download active chat and autocomplete models into $(MODELS_DIR)"
	@echo "  make download-models     - Download ALL registered GGUF models into $(MODELS_DIR)"
	@echo "  make check-checksum      - Verify SHA256 checksum of local model files"
	@echo "  make run-crush        - Run workspace agent client in current directory ($(WORKSPACE_DIR))"
	@echo "  make run-pod             - Run server + client together in a Podman pod"
check-infra:
	@echo "=== Checking System Build & Runtime Infrastructure ==="
	@which podman >/dev/null 2>&1 || (echo "ERROR: 'podman' is not installed. Please install Podman." && exit 1)
	@which python3 >/dev/null 2>&1 || (echo "ERROR: 'python3' is not installed. Please install Python 3." && exit 1)
	@which curl >/dev/null 2>&1 || (echo "ERROR: 'curl' is not installed. Please install curl." && exit 1)
	@python3 -c "import yaml" >/dev/null 2>&1 || (echo "ERROR: Python 'pyyaml' module is missing. Install with 'pip install pyyaml' or distribution package." && exit 1)
	@which $(PODMAN_COMPOSE) >/dev/null 2>&1 || (which podman-compose >/dev/null 2>&1 || which docker-compose >/dev/null 2>&1 || echo "NOTICE: Podman Compose plugin recommended for compose operations.")
	@[ -e /dev/dri ] && echo "  -> GPU Hardware DRI (/dev/dri): Present (Vulkan acceleration enabled)." || echo "  -> GPU Hardware DRI (/dev/dri): Not found (CPU fallback mode will be used)."
	@echo "  -> System Infrastructure Check: PASSED"
	@echo ""

build: check-infra build-server build-cli build-litellm

build-server:
	@echo "Building Qwen Model Server image (Fedora 44 Minimal + Vulkan, LLAMA_CPP_TAG=$(LLAMA_CPP_TAG))..."
	@if [ "$(LLAMA_CPP_TAG)" = "latest" ] || [ "$(LLAMA_CPP_TAG)" = "fetch" ]; then \
		DETECTED_TAG=$$(curl -sL https://api.github.com/repos/ggml-org/llama.cpp/releases/latest 2>/dev/null | grep -o '"tag_name": "[^"]*"' | head -n 1 | cut -d'"' -f4); \
		if [ -z "$${DETECTED_TAG}" ]; then \
			DETECTED_TAG=$$(curl -sL https://api.github.com/repos/ggml-org/llama.cpp/tags 2>/dev/null | grep -o '"name": "b[0-9]*"' | head -n 1 | cut -d'"' -f4); \
		fi; \
		if [ -n "$${DETECTED_TAG}" ]; then \
			echo "Fetched latest release tag from GitHub API: $${DETECTED_TAG}"; \
			TAG_TO_PASS="$${DETECTED_TAG}"; \
		else \
			echo "GitHub API unavailable or rate-limited. Falling back to latest main branch..."; \
			TAG_TO_PASS=""; \
		fi; \
	else \
		TAG_TO_PASS="$(LLAMA_CPP_TAG)"; \
	fi; \
	$(PODMAN) build --build-arg LLAMA_CPP_TAG="$${TAG_TO_PASS}" -t $(SERVER_IMAGE) -f containers/Containerfile.llamacpp .

build-cli:
	@echo "Building PodLlama CLI Agent image (Fedora 44 Minimal)..."
	$(PODMAN) build -t $(CLIENT_IMAGE) -f containers/Containerfile.crush .

build-litellm:
	@echo "Building LiteLLM Proxy image (Fedora Minimal staged build)..."
	$(PODMAN) build -t podllama-litellm:latest -f containers/Containerfile.litellm .

build-proxy: build-litellm

build-vscode-extension:
	@echo "Building PodLlama Code VS Code Extension..."
	@which node >/dev/null 2>&1 || (echo "ERROR: 'node' is required to build the VS Code extension." && exit 1)
	@which npm >/dev/null 2>&1 || (echo "ERROR: 'npm' is required to build the VS Code extension." && exit 1)
	@if [ ! -d "vscode-extension/node_modules" ]; then \
		echo "Installing dependencies in vscode-extension..."; \
		(cd vscode-extension && npm install); \
	fi
	(cd vscode-extension && npm run compile)
	(cd vscode-extension && npx @vscode/vsce package --allow-missing-repository --allow-star-activation --no-dependencies)

build-extension: build-vscode-extension

install-vscode-extension: build-vscode-extension
	@echo "Installing PodLlama Code extension into VS Code..."
	@which code >/dev/null 2>&1 || (echo "ERROR: 'code' CLI is not found on PATH." && exit 1)
	code --install-extension vscode-extension/podllama-code-0.1.0.vsix --force

install-extension: install-vscode-extension

start-server:
	@echo "Starting Vulkan Chat Model Server container (port 8080)..."
	@mkdir -p $(MODELS_DIR)
	$(PODMAN) run -d \
		--name podllama_chat \
		--replace \
		--device /dev/dri \
		-e MODEL_ROLE=chat \
		-p 8080:8080 \
		-v "$(MODELS_DIR):/models:Z" \
		$(SERVER_IMAGE)
	@echo "Chat model server started on http://127.0.0.1:8080"

start-autocomplete-server:
	@echo "Starting Vulkan Autocomplete Model Server container (port 8081)..."
	@mkdir -p $(MODELS_DIR)
	$(PODMAN) run -d \
		--name podllama_autocomplete \
		--replace \
		--device /dev/dri \
		-e MODEL_ROLE=autocomplete \
		-p 8081:8081 \
		-v "$(MODELS_DIR):/models:Z" \
		$(SERVER_IMAGE)
	@echo "Autocomplete model server started on http://127.0.0.1:8081"

start-all: start-server start-autocomplete-server

service-up: check-infra
	@echo "Starting Chat, Autocomplete & LiteLLM Proxy via Podman Compose..."
	@mkdir -p $(MODELS_DIR)
	$(PODMAN_COMPOSE) -f containers/compose.yaml up -d
	@echo "LiteLLM Proxy is running on http://127.0.0.1:4000/v1"

service-start: service-up
compose-up: service-up
compose-start: service-up

service-down:
	@echo "Stopping Podman Compose services..."
	$(PODMAN_COMPOSE) -f containers/compose.yaml down

service-stop: service-down
compose-down: service-down
compose-stop: service-down

service-restart: service-down service-up
compose-restart: service-restart

service-logs:
	$(PODMAN_COMPOSE) -f containers/compose.yaml logs -f

compose-logs: service-logs
show-live-logs: service-logs
service-status:
	@echo "=== Checking PodLlama Container Status ==="
	@$(PODMAN) ps --filter "name=podllama" --filter "name=qwen" --filter "name=litellm"
	@echo ""
	@echo "=== Checking API Health Endpoint ==="
	@for i in $$(seq 1 30); do \
		OUTPUT=$$(curl -s -m 1 http://127.0.0.1:4000/health/liveliness || curl -s -m 1 -H "Authorization: Bearer sk-local" http://127.0.0.1:4000/v1/models || curl -s -m 1 http://127.0.0.1:8080/health); \
		if [ -n "$$OUTPUT" ]; then \
			echo "  -> Service Health Endpoint Active: $$OUTPUT"; \
			exit 0; \
		fi; \
		sleep 0.5; \
	done; \
	echo "  -> WARNING: Health endpoints not responding yet."

status: service-status

stop-server:
	@echo "Stopping Model Server containers..."
	-$(PODMAN) stop podllama_chat podllama_autocomplete podllama qwen_server_chat qwen_server_autocomplete qwen_server || true
	-$(PODMAN) rm podllama_chat podllama_autocomplete podllama qwen_server_chat qwen_server_autocomplete qwen_server || true

tests: unit-tests smoke-tests

unit-tests:
	python3 tests/unit_tests.py

test: unit-tests

smoke-tests:
	python3 tests/smoke_tests.py

smoke_tests: smoke-tests
smoke-test: smoke-tests

run-crush:
	@CLIENT_IMAGE="$(CLIENT_IMAGE)" ./scripts/run_crush.sh "$(WORKSPACE_DIR)"

run-pod:
	./scripts/run_podman.sh pod "$(WORKSPACE_DIR)"

check-checksum:
	@echo "Verifying SHA256 checksums from config/model_conf.yaml..."
	@python3 -c "import yaml, hashlib, os; conf=yaml.safe_load(open('config/model_conf.yaml')); active={conf.get('active_chat_model'), conf.get('active_autocomplete_model')}; [print(f'  {\"[ACTIVE]  \" if m in active else \"[OPTIONAL]\"} {m}:', 'OK' if (p:=os.path.join('$(MODELS_DIR)', m)) and os.path.exists(p) and os.path.getsize(p)>=10485760 and (info['sha256']=='auto-verify-on-download' or hashlib.sha256(open(p,'rb').read()).hexdigest()==info['sha256']) else ('CHECKSUM FAILED' if os.path.exists(p) else 'Not Downloaded')) for m, info in conf['models'].items()]"

download-active-models:
	@mkdir -p $(MODELS_DIR)
	@python3 scripts/download_models.py --active-only --models-dir $(MODELS_DIR)
	@$(MAKE) check-checksum

download-models:
	@mkdir -p $(MODELS_DIR)
	@python3 scripts/download_models.py --models-dir $(MODELS_DIR)
	@$(MAKE) check-checksum

clean:
	-$(PODMAN) rmi $(SERVER_IMAGE) $(CLIENT_IMAGE) podllama-litellm:latest qwen-litellm:latest podllama-cli:latest || true

