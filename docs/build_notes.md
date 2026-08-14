# Build Notes and Container Architecture

This document details the multi-stage build system, container layer caching strategies, and hardware acceleration options for the PodLlama container environment.

---

## 1. Model Server Container (`Containerfile.llamacpp`)

The model server container packages `llama-server` with Vulkan GPU acceleration on top of Fedora Minimal.

### Build Details
- **Base Image**: `registry.fedoraproject.org/fedora-minimal:latest`
- **Prebuilt RPM Packages**: Uses official precompiled Fedora RPMs (`llama.cpp`, `llama.cpp-vulkan`) installed via `microdnf`.
- **Runtime Graphics Drivers**: Includes `mesa-vulkan-drivers`, `vulkan-loader`, and `vulkan-tools` for dynamic hardware GPU layer offloading.

---

## 2. Workspace CLI Agent Container (`Containerfile.pi`)

The workspace agent container packages the official **pi.dev** coding agent (`@earendil-works/pi-coding-agent`).

### Build Details:
- **Base Image**: `node:24-bookworm-slim` (per official [pi.dev containerization specification](https://pi.dev/docs/latest/containerization)).
- **System Utilities**: Packages `bash`, `ca-certificates`, `git`, `ripgrep`, `curl`, `python3`, `python3-requests`, and `python3-urllib3`.
- **Agent Package Installation**: Installs official `@earendil-works/pi-coding-agent` via `npm install -g --ignore-scripts`.
- **Version Pinning (`PI_VERSION`)**: You can pin a specific release version during container build:
  ```bash
  podman build --build-arg PI_VERSION="v0.84.2" -t podllama-cli:latest -f containers/Containerfile.pi .
  ```
- **Rootless User Namespace Isolation**: Runs with `--userns=keep-id` to match host user permissions on mounted workspaces. Automatically registers mapped UIDs into `/etc/passwd` dynamically at runtime.

---

## 3. Model Storage & Checksum Verification (`scripts/download_models.py`)

All model weights are stored in the host `./models/` directory, which is mounted into model server containers via SELinux-isolated volumes (`${MODELS_DIR}:/models:Z`).

### Download & Verification Logic:
1. **Registry Resolution (`config/model_conf.yaml`)**: `scripts/download_models.py` reads the configured model list, URLs, expected SHA256 hashes, and download targets.
2. **SHA256 Checksum Verification**:
   - For models with explicit SHA256 hashes (e.g. `qwen2.5-coder-0.5b`, `1.5b`, `7b`), the downloader verifies file integrity before and after downloading. If an existing file fails hash validation, it is removed and re-downloaded automatically.
   - For models with `auto-verify-on-download` (e.g. `qwen2.5-coder-3b`, `DeepSeek-R1-Distill-Qwen-7B/14B`), files larger than 10 MB are verified as valid pre-downloaded GGUF models.
3. **Atomic Downloads**: Downloads write to temporary `.tmp` files first, ensuring incomplete transfers never corrupt model file integrity.
4. **Selective Downloading**:
   - `make download-models`: Fetches all 6 GGUF model files defined in `config/model_conf.yaml`.
   - `make download-active-models`: Downloads only models currently assigned to `active_chat_model`, `active_autocomplete_model`, and `active_thinking_model`.

---

## 4. Build & Maintenance Commands

| Command | Description |
| :--- | :--- |
| `make check-infra` | Verifies host build and runtime infrastructure (Podman, Python 3, PyYAML, curl, DRI) |
| `make build` | Builds both `podllama-server:latest` and `podllama-cli:latest` images |
| `make build-server` | Builds only the model server container image |
| `make build-cli` | Builds only the pi.dev workspace agent container image |
| `make run-pi` | Launches the interactive pi.dev workspace agent container |
| `make test` | Executes unit test suite verifying configs and file permissions |
| `make clean` | Removes built Podman images and temporary files |
