#!/usr/bin/env python3
"""
Dynamic Model Swapper & Idle Supervisor Proxy for Qwen Code Chat Server.
Handles on-demand chat model auto-swapping and 10-minute idle auto-shutdown (0 MB RAM/VRAM mode).
"""

import os
import sys
import re
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
            with open(CONFIG_FILE, "r") as f:
                config_data = yaml.safe_load(f) or {}
        except Exception as e:
            print(f"[Swapper] Error reading config {CONFIG_FILE}: {e}", flush=True)


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


def start_llama_server(target_model_file):
    global llama_process, current_model
    load_config()
    model_meta = config_data.get("models", {}).get(target_model_file, {})
    model_path = os.path.join(MODELS_DIR, target_model_file)

    if not os.path.exists(model_path):
        print(f"[Swapper] ERROR: Target model file {model_path} does not exist!", flush=True)
        return

    gpu_layers = config_data.get("vulkan_gpu_layers", 99)
    model_role = os.environ.get("MODEL_ROLE", "chat")

    if model_role == "autocomplete":
        cpu_threads = config_data.get("autocomplete_cpu_threads", config_data.get("cpu_threads", 4))
        ctx_size = config_data.get("autocomplete_context_size", 4096)
    else:
        cpu_threads = config_data.get("chat_cpu_threads", config_data.get("cpu_threads", 8))
        ctx_size = config_data.get("context_size", 16384)

    llama_bin = "/usr/bin/llama-server"
    if not os.path.exists(llama_bin):
        llama_bin = "llama-server"

    cache_type_k = config_data.get("cache_type_k", "q8_0")
    cache_type_v = config_data.get("cache_type_v", "q8_0")
    batch_size = config_data.get("batch_size", 2048)
    ubatch_size = config_data.get("ubatch_size", 512)

    cmd = [
        llama_bin,
        "-m", model_path,
        "--host", "127.0.0.1",
        "--port", str(LLAMA_PORT),
        "-ngl", str(gpu_layers),
        "-t", str(cpu_threads),
        "-c", str(ctx_size),
        "-b", str(batch_size),
        "-ub", str(ubatch_size),
        "-ctk", str(cache_type_k),
        "-ctv", str(cache_type_v),
        "--flash-attn", "auto",
        "--alias", "qwen2.5-coder"
    ]

    if model_role != "autocomplete":
        cmd.append("--jinja")

    print(f"[Swapper] Launching llama-server with model '{target_model_file}' on internal port {LLAMA_PORT}...", flush=True)
    llama_process = subprocess.Popen(cmd)
    current_model = target_model_file

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



def resolve_model_filename(requested_model_name):
    load_config()
    model_role = os.environ.get("MODEL_ROLE", "chat")
    if model_role == "autocomplete" or requested_model_name == "podllama-autocomplete":
        return config_data.get("active_autocomplete_model")
    if requested_model_name == "podllama-thinking":
        return config_data.get("active_thinking_model", config_data.get("active_chat_model"))
    if requested_model_name == "podllama-chat":
        return config_data.get("active_chat_model")
    if requested_model_name in config_data.get("models", {}):
        return requested_model_name
    for key in config_data.get("models", {}):
        if requested_model_name in key:
            return key
    return config_data.get("active_chat_model")


def ensure_model_running(requested_model_name):
    global last_request_time
    last_request_time = time.time()

    with state_lock:
        load_config()
        model_role = os.environ.get("MODEL_ROLE", "chat")

        target_model = None
        if model_role == "autocomplete":
            target_model = config_data.get("active_autocomplete_model")
        elif requested_model_name == "podllama-thinking":
            target_model = config_data.get("active_thinking_model", config_data.get("active_chat_model"))
        elif requested_model_name in config_data.get("models", {}):
            target_model = requested_model_name
        else:
            target_model = config_data.get("active_chat_model")

        if not target_model:
            if os.path.exists(MODELS_DIR):
                models_found = [f for f in os.listdir(MODELS_DIR) if f.endswith(".gguf")]
                if models_found:
                    target_model = models_found[0]

        if not target_model:
            print("[Swapper] ERROR: No target model configured or found in /models", flush=True)
            return

        if current_model == target_model and llama_process is not None:
            if llama_process.poll() is None:
                return
            else:
                print(f"[Swapper] llama-process died unexpectedly. Restarting '{target_model}'...", flush=True)
                stop_llama_server()

        if current_model != target_model:
            print(f"[Swapper] Auto-swapping model: '{current_model}' -> '{target_model}'...", flush=True)
            stop_llama_server()

        start_llama_server(target_model)


def parse_and_normalize_args(args):
    """Normalize file_path -> path, strip leading @, and strip /workspace/ prefix."""
    if not isinstance(args, dict):
        return args
    norm_args = dict(args)
    if "file_path" in norm_args and "path" not in norm_args:
        norm_args["path"] = norm_args.pop("file_path")
    if "path" in norm_args and isinstance(norm_args["path"], str):
        p = norm_args["path"].strip()
        if p.startswith("@"):
            p = p[1:]
        if p.startswith("/workspace/"):
            p = p[len("/workspace/"):].lstrip("/")
        elif p.startswith("/"):
            p = p.lstrip("/")
        if p.startswith("./"):
            p = p[2:]
        norm_args["path"] = p
    return norm_args


def extract_tool_call_and_prefix(content):
    """Extract tool call structure from plain text JSON blocks or XML tags if model emitted text rather than tool_calls frame."""
    if not content or not isinstance(content, str):
        return content, None, None

    # Pattern 1: <tool_call> ... </tool_call>
    m_tc = re.search(r"<(?:function|function_call|tool_call)>\s*(.*?)\s*</(?:function|function_call|tool_call)>", content, re.DOTALL)
    if m_tc:
        prefix = content[:m_tc.start()]
        raw_json = m_tc.group(1).strip()
        try:
            obj = json.loads(raw_json)
            if "name" in obj and "arguments" in obj:
                args = obj["arguments"]
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        pass
                return prefix, obj["name"], parse_and_normalize_args(args)
        except Exception:
            pass

    # Pattern 2: ```json ... ``` code block
    m_json = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if m_json:
        prefix = content[:m_json.start()]
        raw_json = m_json.group(1).strip()
        try:
            obj = json.loads(raw_json)
            if "name" in obj and "arguments" in obj:
                args = obj["arguments"]
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        pass
                return prefix, obj["name"], parse_and_normalize_args(args)
        except Exception:
            pass

    # Pattern 3: <{ "name": ..., "arguments": ... }>
    m_bracket = re.search(r"<(\{\s*\"name\"\s*:\s*\"[^\"]+\"\s*,\s*\"arguments\"\s*:.*?\})>", content, re.DOTALL)
    if m_bracket:
        prefix = content[:m_bracket.start()]
        try:
            obj = json.loads(m_bracket.group(1))
            if "name" in obj and "arguments" in obj:
                args = obj["arguments"]
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        pass
                return prefix, obj["name"], parse_and_normalize_args(args)
        except Exception:
            pass

    # Pattern 4: XML tag for read (<read path="..." /> or <read>...</read>)
    m_read = re.search(r"<read\s+path=[\"\']?([^\"\'>\s]+)[\"\']?\s*(?:/>|></read>|>)", content, re.IGNORECASE)
    if m_read:
        prefix = content[:m_read.start()]
        return prefix, "read", parse_and_normalize_args({"path": m_read.group(1)})
    
    m_read_tag = re.search(r"<read>([^<]+)</read>", content, re.IGNORECASE)
    if m_read_tag:
        prefix = content[:m_read_tag.start()]
        return prefix, "read", parse_and_normalize_args({"path": m_read_tag.group(1).strip()})

    # Pattern 5: XML tag for write (<write path="...">content</write>)
    m_write = re.search(r"<write\s+path=[\"\']?([^\"\'>\s]+)[\"\']?>(.*?)</write>", content, re.DOTALL | re.IGNORECASE)
    if m_write:
        prefix = content[:m_write.start()]
        return prefix, "write", parse_and_normalize_args({"path": m_write.group(1), "content": m_write.group(2)})

    # Pattern 6: XML tag for edit (<edit path="...">content</edit>)
    m_edit = re.search(r"<edit\s+path=[\"\']?([^\"\'>\s]+)[\"\']?>(.*?)</edit>", content, re.DOTALL | re.IGNORECASE)
    if m_edit:
        prefix = content[:m_edit.start()]
        return prefix, "edit", parse_and_normalize_args({"path": m_edit.group(1), "content": m_edit.group(2)})

    # Pattern 7: XML tag for bash (<bash>command</bash> or <bash command="..."/>)
    m_bash = re.search(r"<bash>(.*?)</bash>", content, re.DOTALL | re.IGNORECASE)
    if m_bash:
        prefix = content[:m_bash.start()]
        return prefix, "bash", {"command": m_bash.group(1).strip()}

    m_bash_attr = re.search(r"<bash\s+command=[\"\'](.*?)[\"\']\s*(?:/>|>)", content, re.DOTALL | re.IGNORECASE)
    if m_bash_attr:
        prefix = content[:m_bash_attr.start()]
        return prefix, "bash", {"command": m_bash_attr.group(1).strip()}

    return content, None, None


def extract_tool_call_from_text(content):
    """Extract tool call structure from plain text JSON blocks or XML tags."""
    _, name, norm_args = extract_tool_call_and_prefix(content)
    if name:
        return name, norm_args
    return None


def normalize_chat_response_payload(response_bytes):
    """Normalize non-streaming chat response to convert plain text tool calls into proper OpenAI tool_calls structure."""
    try:
        data = json.loads(response_bytes.decode("utf-8"))
        choices = data.get("choices", [])
        if not choices:
            return response_bytes

        modified = False
        for choice in choices:
            msg = choice.get("message", {})
            
            # Check existing tool_calls
            if msg.get("tool_calls"):
                for tc in msg["tool_calls"]:
                    fn = tc.get("function", {})
                    if fn.get("arguments"):
                        try:
                            args = json.loads(fn["arguments"]) if isinstance(fn["arguments"], str) else fn["arguments"]
                            norm_args = parse_and_normalize_args(args)
                            fn["arguments"] = json.dumps(norm_args)
                            modified = True
                        except Exception:
                            pass
            else:
                # Attempt extracting text-formatted tool call
                content = msg.get("content", "")
                prefix, name, norm_args = extract_tool_call_and_prefix(content)
                if name:
                    tc_id = f"call_auto_{int(time.time()*1000)}"
                    msg["tool_calls"] = [
                        {
                            "id": tc_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": json.dumps(norm_args)
                            }
                        }
                    ]
                    msg["content"] = prefix.strip() if (prefix and prefix.strip()) else None
                    choice["finish_reason"] = "tool_calls"
                    modified = True

        if modified:
            return json.dumps(data).encode("utf-8")
    except Exception as ex:
        pass

    return response_bytes


def proxy_and_normalize_stream(resp, wfile):
    """Stream SSE chunks immediately to the client to maximize real-time streaming performance."""
    while True:
        line_bytes = resp.readline()
        if not line_bytes:
            break
        wfile.write(line_bytes)
        wfile.flush()

def idle_supervisor_thread():
    """Monitors idle time and stops llama-server after idle threshold of inactivity."""
    while True:
        time.sleep(10)
        idle_timeout = get_idle_timeout()
        if idle_timeout <= 0:
            continue

        with state_lock:
            if llama_process is not None:
                elapsed = time.time() - last_request_time
                if elapsed >= idle_timeout:
                    print(f"[Swapper] [Auto-Stop] No requests received for {int(elapsed)}s (threshold: {idle_timeout}s).", flush=True)
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
        payload = {}
        if body:
            try:
                payload = json.loads(body.decode("utf-8"))
                requested_model = payload.get("model", "")
            except Exception:
                pass

        ensure_model_running(requested_model)

        print(f"[Swapper] [Proxy Request] [{self.command} {self.path}] Model: '{requested_model}' -> Serving with: '{current_model}'", flush=True)

        model_role = os.environ.get("MODEL_ROLE", "chat")
        forward_path = self.path
        forward_body = body
        reconstruct_as_chat_response = False

        if (model_role == "autocomplete"
                and self.path.rstrip("/").endswith("/chat/completions")
                and "messages" in payload):
            messages = payload.get("messages", [])
            fim_prompt = ""
            for msg in reversed(messages):
                content = msg.get("content", "")
                if content:
                    fim_prompt = content
                    break

            completions_payload = {k: v for k, v in payload.items() if k != "messages"}
            completions_payload["prompt"] = fim_prompt
            forward_body = json.dumps(completions_payload).encode("utf-8")
            forward_path = self.path.rstrip("/").replace("/chat/completions", "/completions")
            reconstruct_as_chat_response = True
            print(f"[Swapper] [Autocomplete] LiteLLM chat->completions rewrite active. FIM prompt: {repr(fim_prompt[:60])}", flush=True)

        target_url = f"http://127.0.0.1:{LLAMA_PORT}{forward_path}"
        fwd_headers = {k: v for k, v in self.headers.items() if k.lower() not in ['host', 'content-length']}
        fwd_headers['Content-Length'] = str(len(forward_body))

        try:
            req = urllib.request.Request(target_url, data=forward_body if forward_body else None, headers=fwd_headers, method=self.command)
            with urllib.request.urlopen(req, timeout=300) as resp:
                resp_status = resp.status
                resp_headers = resp.getheaders()

                if reconstruct_as_chat_response:
                    is_streaming = False
                    for k, v in resp_headers:
                        if k.lower() == 'content-type' and 'text/event-stream' in v.lower():
                            is_streaming = True

                    if is_streaming:
                        self.send_response(resp_status)
                        self.send_header('Content-Type', 'text/event-stream')
                        self.send_header('Cache-Control', 'no-cache')
                        self.end_headers()
                        while True:
                            chunk = resp.read(256)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            self.wfile.flush()
                    else:
                        raw = resp.read()
                        try:
                            comp_resp = json.loads(raw.decode("utf-8"))
                            text = comp_resp.get("choices", [{}])[0].get("text", "")
                            chat_resp = {
                                "id": comp_resp.get("id", "cmpl-auto"),
                                "object": "chat.completion",
                                "created": comp_resp.get("created", int(time.time())),
                                "model": comp_resp.get("model", requested_model),
                                "choices": [{
                                    "index": 0,
                                    "message": {"role": "assistant", "content": text},
                                    "finish_reason": comp_resp.get("choices", [{}])[0].get("finish_reason", "stop")
                                }],
                                "usage": comp_resp.get("usage", {})
                            }
                            resp_body = json.dumps(chat_resp).encode("utf-8")
                        except Exception as ex:
                            print(f"[Swapper] Error reconstructing chat response: {ex} | raw response preview: {repr(raw[:100])}", flush=True)
                            resp_body = raw

                        self.send_response(resp_status)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Content-Length', str(len(resp_body)))
                        self.end_headers()
                        self.wfile.write(resp_body)
                else:
                    self.send_response(resp_status)
                    is_streaming = False
                    for k, v in resp_headers:
                        if k.lower() not in ['transfer-encoding', 'content-length']:
                            self.send_header(k, v)
                        if k.lower() == 'content-type' and 'text/event-stream' in v.lower():
                            is_streaming = True

                    if is_streaming:
                        self.send_header('Cache-Control', 'no-cache')
                        self.end_headers()
                        proxy_and_normalize_stream(resp, self.wfile)
                    else:
                        resp_body = resp.read()
                        norm_body = normalize_chat_response_payload(resp_body)
                        self.send_header('Content-Length', str(len(norm_body)))
                        self.end_headers()
                        self.wfile.write(norm_body)
        except (BrokenPipeError, ConnectionResetError):
            print("[Swapper] Client disconnected during proxy streaming.", flush=True)
        except urllib.error.HTTPError as e:
            try:
                self.send_response(e.code)
                self.end_headers()
                err_body = e.read()
                self.wfile.write(err_body)
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

    def do_POST(self):
        self.handle_proxy()

    def do_PUT(self):
        self.handle_proxy()

    def do_DELETE(self):
        self.handle_proxy()

    def send_models_list(self):
        load_config()
        models = config_data.get("models", {})
        active_chat = config_data.get("active_chat_model", "")
        active_thinking = config_data.get("active_thinking_model", "")
        active_autocomplete = config_data.get("active_autocomplete_model", "")

        model_entries = []
        model_entries.append({"id": "podllama-chat", "object": "model", "owned_by": "podllama-swapper", "active_target": active_chat})
        model_entries.append({"id": "podllama-thinking", "object": "model", "owned_by": "podllama-swapper", "active_target": active_thinking})
        model_entries.append({"id": "podllama-autocomplete", "object": "model", "owned_by": "podllama-swapper", "active_target": active_autocomplete})

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


def main():
    print(f"=== Qwen Chat Swapper & Idle Supervisor Starting ===", flush=True)
    print(f"Listening Port: {SERVER_PORT}", flush=True)
    print(f"Internal Llama Port: {LLAMA_PORT}", flush=True)
    print(f"Idle Timeout: {get_idle_timeout()}s ({get_idle_timeout()//60} minutes)", flush=True)

    load_config()
    model_role = os.environ.get("MODEL_ROLE", "chat")

    if model_role == "autocomplete":
        default_model = config_data.get("active_autocomplete_model", "")
    else:
        default_model = config_data.get("active_chat_model", "")

    print(f"Default Active Model ({model_role}): {default_model}", flush=True)

    if default_model:
        ensure_model_running(default_model)

    t = threading.Thread(target=idle_supervisor_thread, daemon=True)
    t.start()

    server = HTTPServer(("0.0.0.0", SERVER_PORT), ProxyHandler)
    print(f"[Swapper] Proxy listening on 0.0.0.0:{SERVER_PORT} ready!", flush=True)

    def signal_handler(signum, frame):
        print("[Swapper] Received shutdown signal. Cleaning up...", flush=True)
        stop_llama_server()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop_llama_server()


if __name__ == "__main__":
    main()
