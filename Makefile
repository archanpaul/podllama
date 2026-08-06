# Makefile for Qwen Code Podman Environment (Vulkan GPU Accelerated)

.PHONY: help build build-server build-client start-server stop-server compose-up compose-down compose-logs compose-start compose-stop compose-restart service-up service-down service-start service-stop service-restart service-logs service-status show-live-logs status unit-tests test smoke-tests smoke_tests smoke-test run-qwencode run-pod check-checksum download-active-models download-models clean

# Variables
PODMAN ?= podman
PODMAN_COMPOSE ?= podman compose
MODELS_DIR ?= ./models
WORKSPACE_DIR ?= $(shell pwd)
SERVER_IMAGE ?= qwen-server:latest
CLIENT_IMAGE ?= qwen-client:latest
POD_NAME ?= qwen_code_pod

help:
	@echo "Available Makefile targets:"
	@echo "  make build               - Build both server and client Podman images using fedora-minimal:44"
	@echo "  make compose-up          - Launch Chat, Autocomplete & LiteLLM Proxy via Podman Compose (Port 4000)"
	@echo "  make compose-down        - Stop Podman Compose services"
	@echo "  make compose-logs        - View Podman Compose logs"
	@echo "  make show-live-logs      - Alias for make compose-logs"
	@echo "  make service-up          - Alias for make compose-up"
	@echo "  make service-down        - Alias for make compose-down"
	@echo "  make service-logs        - Alias for make compose-logs"
	@echo "  make service-status      - Alias for make status"
	@echo "  make service-restart     - Restart all services (compose-down then compose-up)"
	@echo "  make start-server        - Start Vulkan chat model server container on port 8080"
	@echo "  make start-autocomplete-server - Start Vulkan autocomplete model server container on port 8081"
	@echo "  make start-all           - Start both model server containers"
	@echo "  make stop-server         - Stop model server containers"
	@echo "  make status              - Check running status and health of qwen services"
	@echo "  make unit-tests          - Run automated unit test suite (config schema, permissions, container files)"
	@echo "  make test                - Alias for make unit-tests"
	@echo "  make smoke-tests         - Run live smoke test on Chat (streaming), Autocomplete, and Tool Calling"
	@echo "  make smoke-test          - Alias for make smoke-tests"
	@echo "  make download-active-models - Download active chat and autocomplete models into $(MODELS_DIR)"
	@echo "  make download-models     - Download ALL registered GGUF models into $(MODELS_DIR)"
	@echo "  make check-checksum      - Verify SHA256 checksum of local model files"
	@echo "  make run-qwencode        - Run workspace agent client in current directory ($(WORKSPACE_DIR))"
	@echo "  make run-pod             - Run server + client together in a Podman pod"
	@echo "  make clean               - Clean Podman containers and images"


build: build-server build-client

build-server:
	@echo "Building Qwen Model Server image (Fedora 44 Minimal + Vulkan)..."
	$(PODMAN) build -t $(SERVER_IMAGE) -f containers/Containerfile.server .

build-client:
	@echo "Building Qwen Encoder Agent image (Fedora 44 Minimal)..."
	$(PODMAN) build -t $(CLIENT_IMAGE) -f containers/Containerfile.qwencoder .

start-server:
	@echo "Starting Vulkan Chat Model Server container (port 8080)..."
	@mkdir -p $(MODELS_DIR)
	$(PODMAN) run -d \
		--name qwen_server_chat \
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
		--name qwen_server_autocomplete \
		--replace \
		--device /dev/dri \
		-e MODEL_ROLE=autocomplete \
		-p 8081:8081 \
		-v "$(MODELS_DIR):/models:Z" \
		$(SERVER_IMAGE)
	@echo "Autocomplete model server started on http://127.0.0.1:8081"

start-all: start-server start-autocomplete-server

compose-up:
	@echo "Starting Chat, Autocomplete & LiteLLM Proxy via Podman Compose..."
	@mkdir -p $(MODELS_DIR)
	$(PODMAN_COMPOSE) -f containers/compose.yaml up -d
	@echo "LiteLLM Proxy is running on http://127.0.0.1:4000/v1"

compose-start: compose-up
service-up: compose-up
service-start: compose-up

compose-down:
	@echo "Stopping Podman Compose services..."
	$(PODMAN_COMPOSE) -f containers/compose.yaml down

compose-stop: compose-down
service-down: compose-down
service-stop: compose-down

compose-restart: compose-down compose-up
service-restart: compose-down compose-up

compose-logs:
	$(PODMAN_COMPOSE) -f containers/compose.yaml logs -f

show-live-logs: compose-logs
service-logs: compose-logs
service-status: status

stop-server:
	@echo "Stopping Model Server containers..."
	-$(PODMAN) stop qwen_server_chat qwen_server_autocomplete qwen_server || true
	-$(PODMAN) rm qwen_server_chat qwen_server_autocomplete qwen_server || true

status:
	@echo "=== Checking Qwen Container Status ==="
	@$(PODMAN) ps --filter "name=qwen" --filter "name=litellm"
	@echo ""
	@echo "=== Checking API Health Endpoint ==="
	@curl -s -m 3 http://127.0.0.1:4000/health/liveliness || curl -s -m 3 -H "Authorization: Bearer sk-local" http://127.0.0.1:4000/v1/models || curl -s -m 3 http://127.0.0.1:8080/health || echo "API endpoint (http://127.0.0.1:4000 or 8080) is unreachable."

unit-tests:
	python3 tests/unit_tests.py

test: unit-tests

smoke-tests:
	python3 tests/smoke_tests.py

smoke_tests: smoke-tests
smoke-test: smoke-tests

run-qwencode:
	@CLIENT_IMAGE="$(CLIENT_IMAGE)" ./scripts/run_qwencode.sh "$(WORKSPACE_DIR)"

run-pod:
	./scripts/run_podman.sh pod "$(WORKSPACE_DIR)"

check-checksum:
	@echo "Verifying SHA256 checksums from config/model_conf.yaml..."
	@python3 -c "import yaml, hashlib, os; conf=yaml.safe_load(open('config/model_conf.yaml')); active={conf.get('active_chat_model'), conf.get('active_autocomplete_model')}; [print(f'  {\"[ACTIVE]  \" if m in active else \"[OPTIONAL]\"} {m}:', 'OK' if (p:=os.path.join('$(MODELS_DIR)', m)) and os.path.exists(p) and os.path.getsize(p)>=10485760 and (info['sha256']=='auto-verify-on-download' or hashlib.sha256(open(p,'rb').read()).hexdigest()==info['sha256']) else ('CHECKSUM FAILED' if os.path.exists(p) else 'Not Downloaded')) for m, info in conf['models'].items()]"

download-active-models:
	@mkdir -p $(MODELS_DIR)
	@cp -f config/model_conf.yaml $(MODELS_DIR)/model_conf.yaml
	@python3 scripts/download_models.py --active-only --models-dir $(MODELS_DIR)
	@$(MAKE) check-checksum

download-models:
	@mkdir -p $(MODELS_DIR)
	@cp -f config/model_conf.yaml $(MODELS_DIR)/model_conf.yaml
	@python3 scripts/download_models.py --models-dir $(MODELS_DIR)
	@$(MAKE) check-checksum

clean:
	-$(PODMAN) rmi $(SERVER_IMAGE) $(CLIENT_IMAGE) || true
