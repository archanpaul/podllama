#!/usr/bin/env python3
"""
Dynamic Model Swapper & Idle Supervisor Proxy for Qwen Code Chat Server.
Handles on-demand chat model auto-swapping and 10-minute idle auto-shutdown (0 MB RAM/VRAM mode).
"""

import os
import sys
import time
import json
import signal
import urllib.request
import urllib.error
import subprocess
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import yaml

# Configurations & Environment Defaults
CONFIG_FILE = os.environ.get("CONFIG_FILE", "/app/config/model_conf.yaml")
if not os.path.exists(CONFIG_FILE) and os.path.exists("/models/model_conf.yaml"):
    CONFIG_FILE = "/models/model_conf.yaml"

MODELS_DIR = os.environ.get("MODELS_DIR", "/models")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8080"))
LLAMA_PORT = int(os.environ.get("LLAMA_PORT", "8082"))
DEFAULT_IDLE_TIMEOUT = 600  # 10 minutes default


def get_idle_timeout():
    load_config()
    timeout = config_data.get("idle_timeout_seconds")
    if timeout is not None:
        try:
            return int(timeout)
        except ValueError:
            pass
    return int(os.environ.get("IDLE_TIMEOUT_SECONDS", str(DEFAULT_IDLE_TIMEOUT)))

# Global Supervisor State
state_lock = threading.Lock()
current_model = None
llama_process = None
last_request_time = time.time()
config_data = {}


def load_config():
    global config_data
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                config_data = yaml.safe_load(f) or {}
        except Exception as e:
            print(f"[Swapper] Error reading config file {CONFIG_FILE}: {e}", flush=True)


def resolve_model_filename(requested_name):
    """Resolves a model name/alias (e.g. 'podllama-thinking', 'qwen-chat', 'qwen2.5-coder-3b-instruct') to GGUF filename."""
    load_config()
    models = config_data.get("models", {})
    default_model = config_data.get("active_chat_model", "")
    thinking_model = config_data.get("active_thinking_model", "")

    if requested_name in ["podllama-thinking", "deepseek-r1", "thinking"]:
        return thinking_model or default_model

    if not requested_name or requested_name in ["podllama-chat", "podllama", "qwen-chat", "qwen2.5-coder", "gpt-3.5-turbo", "default"]:
        return default_model

    # Direct match in model_conf.yaml
    if requested_name in models:
        return requested_name

    # Partial / substring match (e.g., 'qwen2.5-coder-3b-instruct' -> 'qwen2.5-coder-3b-instruct-q4_k_m.gguf')
    for model_file in models:
        if requested_name in model_file or model_file.startswith(requested_name):
            return model_file

    return default_model


def stop_llama_server():
    global llama_process, current_model
    if llama_process is not None:
        print(f"[Swapper] Stopping llama-server (Process PID {llama_process.pid}) for model '{current_model}'...", flush=True)
        try:
            llama_process.terminate()
            llama_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print("[Swapper] Force killing llama-server process...", flush=True)
            llama_process.kill()
            llama_process.wait()
        except Exception as e:
            print(f"[Swapper] Error stopping llama-server: {e}", flush=True)
        llama_process = None
        current_model = None
        print("[Swapper] llama-server stopped. Memory freed (0 MB LLM RAM/VRAM mode).", flush=True)


def check_gpu_availability():
    vulkan_found = False
    try:
        res = subprocess.run(["vulkaninfo", "--summary"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and "deviceName" in res.stdout:
            vulkan_found = True
    except Exception:
        pass

    if not vulkan_found and os.path.exists("/dev/dri"):
        vulkan_found = True

    gpu_layers = config_data.get("vulkan_gpu_layers", 99)
    if not vulkan_found:
        print("[Swapper] No Vulkan GPU hardware detected. Using CPU layers (gpu_layers=0).", flush=True)
        gpu_layers = 0
    else:
        print(f"[Swapper] Vulkan GPU acceleration enabled ({gpu_layers} layers offloaded).", flush=True)
    return gpu_layers


def start_llama_server(target_model_file):
    global llama_process, current_model
    load_config()

    models = config_data.get("models", {})
    if target_model_file not in models:
        print(f"[Swapper] Model file '{target_model_file}' not found in configuration models section!", flush=True)
        # Fall back to active_chat_model if missing
        target_model_file = config_data.get("active_chat_model", list(models.keys())[0] if models else "")

    model_path = os.path.join(MODELS_DIR, target_model_file)
    if not os.path.exists(model_path):
        print(f"[Swapper] Model file missing at {model_path}. Running download/verification...", flush=True)
        model_meta = models.get(target_model_file, {})
        url = model_meta.get("url", "")
        if url:
            os.makedirs(MODELS_DIR, exist_ok=True)
            tmp_path = f"{model_path}.tmp"
            print(f"[Swapper] Downloading {url}...", flush=True)
            subprocess.run(["curl", "-L", "--fail", "--progress-bar", "-o", tmp_path, url], check=True)
            os.rename(tmp_path, model_path)

    gpu_layers = check_gpu_availability()
    cpu_threads = config_data.get("chat_cpu_threads", config_data.get("cpu_threads", 8))
    ctx_size = config_data.get("context_size", 16384)

    llama_bin = "/usr/bin/llama-server"
    if not os.path.exists(llama_bin):
        llama_bin = "llama-server"

    cmd = [
        llama_bin,
        "-m", model_path,
        "--host", "127.0.0.1",
        "--port", str(LLAMA_PORT),
        "-ngl", str(gpu_layers),
        "-t", str(cpu_threads),
        "-c", str(ctx_size),
        "--flash-attn", "auto",
        "--jinja",
        "--alias", "qwen2.5-coder"
    ]

    print(f"[Swapper] Launching llama-server with model '{target_model_file}' on internal port {LLAMA_PORT}...", flush=True)
    llama_process = subprocess.Popen(cmd)
    current_model = target_model_file

    # Wait for llama-server readiness
    health_url = f"http://127.0.0.1:{LLAMA_PORT}/health"
    start_time = time.time()
    ready = False
    while time.time() - start_time < 45:
        try:
            req = urllib.request.Request(health_url)
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status == 200:
                    ready = True
                    break
        except Exception:
            pass
        time.sleep(0.3)

    if ready:
        print(f"[Swapper] llama-server ready and serving model '{target_model_file}'!", flush=True)
    else:
        print(f"[Swapper] WARNING: llama-server did not respond OK on {health_url} within 45s.", flush=True)


def ensure_model_running(requested_model_name):
    global last_request_time
    last_request_time = time.time()

    target_file = resolve_model_filename(requested_model_name)
    display_name = requested_model_name if requested_model_name else "podllama-chat"

    with state_lock:
        if llama_process is None:
            print(f"[Swapper] [Cold-Start] [{display_name}] Booting backend model '{target_file}'...", flush=True)
            start_llama_server(target_file)
        elif current_model != target_file:
            print(f"[Swapper] [Auto-Swap] [{display_name}] Model swap requested: current='{current_model}' -> target='{target_file}'", flush=True)
            stop_llama_server()
            start_llama_server(target_file)


def idle_supervisor_thread():
    """Monitors idle time and stops llama-server after idle threshold of inactivity."""
    while True:
        time.sleep(10)
        timeout_sec = get_idle_timeout()
        with state_lock:
            if llama_process is not None:
                idle_duration = time.time() - last_request_time
                if idle_duration >= timeout_sec:
                    print(f"[Swapper] [Auto-Stop] No requests received for {int(idle_duration)}s (threshold: {timeout_sec}s).", flush=True)
                    stop_llama_server()


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress standard HTTP request logging

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def handle_proxy(self):
        global last_request_time
        last_request_time = time.time()

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b""

        requested_model = ""
        if body:
            try:
                payload = json.loads(body.decode("utf-8"))
                requested_model = payload.get("model", "")
            except Exception:
                pass

        # Ensure active model is running and auto-swapped if needed
        ensure_model_running(requested_model)

        print(f"[Swapper] [Proxy Request] [{self.command} {self.path}] Model: '{requested_model}' -> Serving with: '{current_model}'", flush=True)

        # Forward request to internal llama-server
        target_url = f"http://127.0.0.1:{LLAMA_PORT}{self.path}"
        headers = {k: v for k, v in self.headers.items() if k.lower() != 'host'}

        try:
            req = urllib.request.Request(target_url, data=body if body else None, headers=headers, method=self.command)
            with urllib.request.urlopen(req, timeout=120) as resp:
                self.send_response(resp.status)
                is_streaming = False
                for k, v in resp.getheaders():
                    if k.lower() not in ['transfer-encoding', 'content-length']:
                        self.send_header(k, v)
                    if k.lower() == 'content-type' and 'text/event-stream' in v.lower():
                        is_streaming = True

                if is_streaming:
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    while True:
                        chunk = resp.read(256)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        self.wfile.flush()
                else:
                    resp_body = resp.read()
                    self.send_header('Content-Length', str(len(resp_body)))
                    self.end_headers()
                    self.wfile.write(resp_body)
        except (BrokenPipeError, ConnectionResetError):
            # Client disconnected before request completed (e.g. user stopped generation in UI)
            print("[Swapper] Client disconnected during proxy streaming.", flush=True)
        except urllib.error.HTTPError as e:
            try:
                self.send_response(e.code)
                self.end_headers()
                self.wfile.write(e.read())
            except (BrokenPipeError, ConnectionResetError):
                pass
        except Exception as e:
            print(f"[Swapper] Error proxying request to llama-server: {e}", flush=True)
            try:
                self.send_response(503)
                self.end_headers()
                self.wfile.write(json.dumps({"error": f"Model server proxy error: {str(e)}"}).encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_GET(self):
        if self.path == "/v1/models" or self.path == "/models":
            self.send_models_list()
        else:
            self.handle_proxy()

    def send_models_list(self):
        load_config()
        models = config_data.get("models", {})
        active_chat = config_data.get("active_chat_model", "")
        active_thinking = config_data.get("active_thinking_model", "")
        active_autocomplete = config_data.get("active_autocomplete_model", "")

        model_entries = []
        # Add registered role aliases
        model_entries.append({"id": "podllama-chat", "object": "model", "owned_by": "podllama-swapper", "active_target": active_chat})
        model_entries.append({"id": "podllama-thinking", "object": "model", "owned_by": "podllama-swapper", "active_target": active_thinking})
        model_entries.append({"id": "podllama-autocomplete", "object": "model", "owned_by": "podllama-swapper", "active_target": active_autocomplete})

        # Add all configured GGUF files
        for model_file, meta in models.items():
            model_entries.append({
                "id": model_file,
                "object": "model",
                "owned_by": "podllama-registry",
                "details": meta
            })

        response_body = json.dumps({"object": "list", "data": model_entries}, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def do_POST(self):
        self.handle_proxy()

    def do_OPTIONS(self):
        self.handle_proxy()

    def do_HEAD(self):
        self.handle_proxy()

    def do_PUT(self):
        self.handle_proxy()

    def do_DELETE(self):
        self.handle_proxy()


def main():
    timeout_sec = get_idle_timeout()
    print(f"=== Qwen Chat Swapper & Idle Supervisor Starting ===", flush=True)
    print(f"Listening Port: {SERVER_PORT}", flush=True)
    print(f"Internal Llama Port: {LLAMA_PORT}", flush=True)
    print(f"Idle Timeout: {timeout_sec}s ({timeout_sec // 60} minutes)", flush=True)

    load_config()
    default_model = config_data.get("active_chat_model", "")
    print(f"Default Active Chat Model: {default_model}", flush=True)

    # Initial start of default model
    if default_model:
        ensure_model_running(default_model)

    # Start idle supervisor background thread
    t = threading.Thread(target=idle_supervisor_thread, daemon=True)
    t.start()

    # Graceful signal handling
    def signal_handler(sig, frame):
        print("[Swapper] Received shutdown signal. Terminating...", flush=True)
        with state_lock:
            stop_llama_server()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    server = HTTPServer(("0.0.0.0", SERVER_PORT), ProxyHandler)
    print(f"[Swapper] Proxy listening on 0.0.0.0:{SERVER_PORT} ready!", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_llama_server()


if __name__ == "__main__":
    main()
