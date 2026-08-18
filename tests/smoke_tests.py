#!/usr/bin/env python3
"""
Smoke Test Suite for PodLlama Container Environment.
Verifies live endpoint connectivity, API list models, Chat model prompt processing,
Streaming, Thinking model reasoning, Autocomplete completion, Personas, Tool calling, and Auto-stop recovery.
"""

import sys
import json
import urllib.request
import urllib.error
import subprocess
import time

BASE_URL = "http://127.0.0.1:4000/v1"
HEALTH_URL = "http://127.0.0.1:4000/health/liveliness"
API_KEY = "sk-local"

test_results = []


def log(msg):
    print(f"[SMOKE TEST] {msg}", flush=True)


def record_result(test_num, name, target, status, duration, error=""):
    test_results.append({
        "num": test_num,
        "name": name,
        "target": target,
        "status": status,
        "duration": duration,
        "error": error
    })


def test_proxy_health():
    log("--------------------------------------------------")
    log("API TEST 1: Proxy Liveliness Check (GET /health/liveliness)")
    log(f"  Target URL: {HEALTH_URL}")
    log("  Expected: Status 200 OK with liveliness message")
    start_t = time.time()
    try:
        req = urllib.request.Request(HEALTH_URL)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read().decode("utf-8")
            log(f"  Response Status: {resp.status}")
            log(f"  Response Payload: {repr(data.strip())}")
            assert resp.status == 200, f"Expected status 200, got {resp.status}"
            log("  -> PASSED: GET /health/liveliness active and healthy.")
            dur = time.time() - start_t
            record_result(1, "Proxy Liveliness Check", "GET /health/liveliness", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Could not connect to LiteLLM Proxy liveliness at {HEALTH_URL}: {e}")
        record_result(1, "Proxy Liveliness Check", "GET /health/liveliness", "FAILED", dur, str(e))
        return False


def test_list_models_api():
    log("--------------------------------------------------")
    log("API TEST 2: List Models API (GET /v1/models)")
    url = f"{BASE_URL}/models"
    headers = {"Authorization": f"Bearer {API_KEY}"}
    log(f"  Target URL: {url}")
    log("  Expected: Status 200 OK with JSON array containing active model objects")
    start_t = time.time()
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            log(f"  Response Status: {resp.status}")
            models = data.get("data", [])
            model_ids = [m.get("id") for m in models]
            log(f"  Registered Model IDs: {model_ids}")
            assert resp.status == 200, f"Expected status 200, got {resp.status}"
            assert len(models) > 0, "No models returned from GET /v1/models!"
            log("  -> PASSED: GET /v1/models returned active model list successfully.")
            dur = time.time() - start_t
            record_result(2, "List Models API", "GET /v1/models", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: List models request failed: {e}")
        record_result(2, "List Models API", "GET /v1/models", "FAILED", dur, str(e))
        return False


def test_personas_api():
    log("--------------------------------------------------")
    log("API TEST 3: Personas Taxonomy & Skills API (GET /v1/personas)")
    urls_to_try = [
        f"{BASE_URL}/personas",
        f"{BASE_URL.rstrip('/')}/personas",
        "http://127.0.0.1:4000/v1/personas",
        "http://127.0.0.1:4000/personas",
        "http://127.0.0.1:8080/v1/personas"
    ]
    headers = {"Authorization": f"Bearer {API_KEY}"}

    start_t = time.time()
    data = None
    successful_url = None
    for url in urls_to_try:
        log(f"  Target URL: {url}")
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    successful_url = url
                    log(f"  Response Status: {resp.status}")
                    break
        except Exception as e:
            log(f"  -> Target URL {url} returned: {e}")

    if data and "personas" in data:
        personas = data.get("personas", [])
        categories = data.get("categories", [])
        p_ids = [p.get("id") for p in personas]
        log(f"  Registered Persona IDs ({len(personas)} total across {len(categories)} categories): {p_ids[:8]}...")
        assert len(personas) >= 30, f"Expected at least 30 personas, got {len(personas)}"
        assert len(categories) >= 11, f"Expected at least 11 categories, got {len(categories)}"

        # New schema uses display_name + ui_icon; old schema used name + icon.
        for cat in categories:
            assert "id" in cat and "description" in cat, f"Category missing id/description: {cat}"
            assert "name" in cat or "display_name" in cat, f"Category missing name/display_name: {cat}"
            assert "icon" in cat or "ui_icon" in cat, f"Category missing icon/ui_icon: {cat}"

        # New schema: fields live under ui_metadata / llm_config / prompt_blueprint.
        # Old schema: flat on the persona object. Both are accepted.
        for p in personas:
            assert "id" in p, f"Persona missing id: {p}"
            ui = p.get("ui_metadata") or {}
            bp = p.get("prompt_blueprint") or {}
            assert p.get("name") or ui.get("display_name"), f"Persona {p['id']} missing name/display_name"
            assert p.get("category_id") or p.get("category"), f"Persona {p['id']} missing category linkage"
            slash = ui.get("slash_command") or p.get("slash_command") or ""
            assert slash.startswith("/"), f"Persona {p['id']} invalid slash command: {slash!r}"
            skills = bp.get("core_skills") or p.get("skills") or []
            assert isinstance(skills, list) and len(skills) > 0, f"Persona {p['id']} has no skills"
            sys_prompt = bp.get("role_definition") or p.get("system_prompt") or ""
            assert len(sys_prompt) > 0, f"Persona {p['id']} has empty system prompt"

        assert "cp-solver" in p_ids, "Missing 'cp-solver' persona in response"
        assert "hackathon-builder" in p_ids, "Missing 'hackathon-builder' persona in response"
        assert "cs-professor" in p_ids, "Missing 'cs-professor' persona in response"
        assert "algo-specialist" in p_ids, "Missing 'algo-specialist' persona in response"
        assert "ai-agent-architect" in p_ids, "Missing 'ai-agent-architect' persona in response"
        assert "code-reviewer" in p_ids, "Missing 'code-reviewer' persona in response"
        assert "terraform-iac-engineer" in p_ids, "Missing 'terraform-iac-engineer' persona in response"
        assert "rust-systems-engineer" in p_ids, "Missing 'rust-systems-engineer' persona in response"

        log(f"  -> PASSED: GET /v1/personas returned in-memory category-wise personas dataset successfully from {successful_url}.")
        dur = time.time() - start_t
        record_result(3, "Personas Taxonomy & Skills", "GET /v1/personas", "PASSED", dur)
        return data
    else:
        dur = time.time() - start_t
        log("  -> FAILED: Could not reach personas endpoint on port 8080 or 4000.")
        record_result(3, "Personas Taxonomy & Skills", "GET /v1/personas", "FAILED", dur, "Could not reach endpoint")
        return None


def test_persona_slash_command_resolution(personas_data=None):
    log("--------------------------------------------------")
    log("API TEST 4: Persona Slash Command Mapping & Resolution")
    start_t = time.time()
    if not personas_data or "personas" not in personas_data:
        try:
            req = urllib.request.Request(f"{BASE_URL}/personas", headers={"Authorization": f"Bearer {API_KEY}"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                personas_data = json.loads(resp.read().decode("utf-8"))
        except Exception:
            pass

    personas = (personas_data or {}).get("personas", [])
    if not personas:
        dur = time.time() - start_t
        log("  -> FAILED: No personas loaded for slash command verification.")
        record_result(4, "Persona Slash Commands", "30 Slash Shortcuts", "FAILED", dur, "No personas available")
        return False

    slash_commands = {}
    for p in personas:
        # New schema: slash_command lives under ui_metadata
        ui = p.get("ui_metadata") or {}
        cmd = (ui.get("slash_command") or p.get("slash_command") or "").lower()
        assert cmd.startswith("/"), f"Invalid slash command for persona {p['id']}: {cmd!r}"
        assert cmd not in slash_commands, f"Duplicate slash command detected: {cmd}"
        slash_commands[cmd] = p["id"]

    log(f"  Verified {len(slash_commands)} unique slash command mappings: {list(slash_commands.keys())[:10]}...")
    assert "/cp" in slash_commands, "Missing /cp slash command"
    assert "/hack" in slash_commands, "Missing /hack slash command"
    assert "/prof" in slash_commands, "Missing /prof slash command"
    assert "/algo" in slash_commands, "Missing /algo slash command"
    assert "/dl" in slash_commands, "Missing /dl slash command"
    assert "/dev" in slash_commands, "Missing /dev slash command"
    assert "/agent" in slash_commands, "Missing /agent slash command"
    assert "/codereview" in slash_commands, "Missing /codereview slash command"
    assert "/terraform" in slash_commands, "Missing /terraform slash command"
    assert "/rust" in slash_commands, "Missing /rust slash command"
    assert "/flutter-android" in slash_commands, "Missing /flutter-android slash command"
    assert "/go-cloud" in slash_commands, "Missing /go-cloud slash command"
    assert "/static" in slash_commands, "Missing /static slash command"
    log("  -> PASSED: Persona slash command mappings and uniqueness verified.")
    dur = time.time() - start_t
    record_result(4, "Persona Slash Commands", "30 Slash Shortcuts", "PASSED", dur)
    return True


def test_prompt_processing():
    log("--------------------------------------------------")
    log("API TEST 5: Chat Completions (POST /v1/chat/completions - 'podllama-chat')")
    payload = {
        "model": "podllama-chat",
        "messages": [
            {"role": "system", "content": "You are a code analyzer."},
            {"role": "user", "content": "Analyze snippet:\ndef add(a: int, b: int) -> int:\n    return a + b\nSummarize function purpose."}
        ],
        "max_tokens": 24,
        "temperature": 0.1
    }
    url = f"{BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']}")
    log("  Expected: Status 200 OK with evaluated prompt_tokens and non-empty completion")

    start_t = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            usage = data.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
            msg = data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content") or msg.get("reasoning_content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Prompt Tokens Evaluated: {prompt_tokens}")
            log(f"  Completion Tokens Generated: {completion_tokens}")
            log(f"  Generated Sample: {repr(content.strip())}")
            assert prompt_tokens > 0, "Prompt tokens count must be > 0"
            assert completion_tokens > 0, "Completion tokens count must be > 0"
            log("  -> PASSED: Chat completions and token accounting verified.")
            dur = time.time() - start_t
            record_result(5, "Chat Completions & Tokens", "podllama-chat", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Prompt processing test failed: {e}")
        record_result(5, "Chat Completions & Tokens", "podllama-chat", "FAILED", dur, str(e))
        return False


def test_thinking_model_api():
    log("--------------------------------------------------")
    log("API TEST 6: Deep Thinking & Reasoning (POST /v1/chat/completions - 'podllama-thinking')")
    payload = {
        "model": "podllama-thinking",
        "messages": [
            {"role": "user", "content": "Explain worst-case time complexity of quicksort in one sentence."}
        ],
        "max_tokens": 24,
        "temperature": 0.1
    }
    url = f"{BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']}")
    log("  Expected: Status 200 OK with DeepSeek-R1 reasoning output")

    start_t = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            msg = data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content") or msg.get("reasoning_content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Thinking Output Sample: {repr(content.strip())}")
            log("  -> PASSED: Thinking model completions API verified successfully.")
            dur = time.time() - start_t
            record_result(6, "Deep Thinking & Reasoning", "podllama-thinking", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Thinking model API request failed: {e}")
        record_result(6, "Deep Thinking & Reasoning", "podllama-thinking", "FAILED", dur, str(e))
        return False


def test_instruct_model_api():
    log("--------------------------------------------------")
    log("API TEST 7: Instruct Completions (POST /v1/chat/completions - 'podllama-instruct')")
    payload = {
        "model": "podllama-instruct",
        "messages": [
            {"role": "system", "content": "You are a code assistant."},
            {"role": "user", "content": "Write a python function to compute factorial."}
        ],
        "max_tokens": 24,
        "temperature": 0.1
    }
    url = f"{BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']}")
    log("  Expected: Status 200 OK with Qwen 2.5 Coder 7B Instruct output")

    start_t = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            msg = data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Instruct Output Sample: {repr(content.strip())}")
            log("  -> PASSED: Instruct model (podllama-instruct) completions API verified successfully.")
            dur = time.time() - start_t
            record_result(7, "Instruct Completions", "podllama-instruct", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Instruct model API request failed: {e}")
        record_result(7, "Instruct Completions", "podllama-instruct", "FAILED", dur, str(e))
        return False


def test_persona_completion_features(personas_data=None):
    log("--------------------------------------------------")
    log("API TEST 8: Persona Prompt Injection & Target Model Execution")
    
    test_cases = [
        {
            "id": "cp-solver",
            "slash": "/cp",
            "prompt": "Find maximum subarray sum using Kadane's Algorithm in C++ with complexity."
        },
        {
            "id": "hackathon-builder",
            "slash": "/hack",
            "prompt": "Suggest a high-impact MVP stack and 2-minute demo hook for an AI note summarizer."
        },
        {
            "id": "cs-professor",
            "slash": "/prof",
            "prompt": "State the Master Theorem recurrence relation in LaTeX notation."
        }
    ]

    personas_map = {}
    if personas_data and "personas" in personas_data:
        personas_map = {p["id"]: p for p in personas_data["personas"]}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    url = f"{BASE_URL}/chat/completions"

    start_t = time.time()
    try:
        for tc in test_cases:
            p_info = personas_map.get(tc["id"], {})
            persona_id = tc["id"]
            persona_slash = tc["slash"]
            sys_prompt = p_info.get("system_prompt", f"You are the {persona_id} specialist.")
            target_model = p_info.get("target_model", "podllama-chat")
            skills = p_info.get("skills", [])
            skills_summary = ", ".join(skills[:3]) if skills else "General"

            log(f"  Testing Persona: '{persona_id}' ({persona_slash}) -> Target Model: '{target_model}'")
            log(f"  Persona Skills: {skills_summary}")

            payload = {
                "model": target_model,
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": tc["prompt"]}
                ],
                "max_tokens": 24,
                "temperature": 0.1
            }

            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                assert resp.status == 200, f"Expected 200, got {resp.status}"
                choices = data.get("choices", [])
                assert len(choices) > 0, "No completion choices returned!"
                msg = choices[0].get("message", {})
                content = msg.get("content") or msg.get("reasoning_content", "")
                tokens = data.get("usage", {}).get("completion_tokens", 0)
                log(f"    Response Status: {resp.status} | Tokens Generated: {tokens}")
                log(f"    Sample Output: {repr(content[:80].strip())}...")
                assert len(content.strip()) > 0, f"Empty content generated for persona {persona_id}"

        log("  -> PASSED: All persona prompt injections and model executions completed successfully.")
        dur = time.time() - start_t
        record_result(8, "Persona Prompt Injection", "/cp, /hack, /prof", "PASSED", dur)
        return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Persona execution failed: {e}")
        record_result(8, "Persona Prompt Injection", "/cp, /hack, /prof", "FAILED", dur, str(e))
        return False


def test_chat_model_streaming():
    log("--------------------------------------------------")
    log("API TEST 9: Chat Streaming SSE (POST /v1/chat/completions with stream=true)")
    payload = {
        "model": "podllama-chat",
        "messages": [
            {"role": "system", "content": "You are a helpful coding assistant."},
            {"role": "user", "content": "Write a one-line Python function to reverse a string."}
        ],
        "max_tokens": 32,
        "temperature": 0.1,
        "stream": True
    }
    url = f"{BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']} (Stream Mode)")
    log("  Expected: Server-Sent Events (SSE) data stream chunks ending with [DONE]")

    start_t = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        tokens_received = 0
        sys.stdout.write("  -> Streaming Output Chunks: ")
        sys.stdout.flush()

        with urllib.request.urlopen(req, timeout=90) as resp:
            for line in resp:
                line_str = line.decode("utf-8").strip()
                if line_str.startswith("data: "):
                    data_content = line_str[6:]
                    if data_content == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_content)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "") or delta.get("reasoning_content", "")
                        if content:
                            sys.stdout.write(content)
                            sys.stdout.flush()
                            tokens_received += 1
                    except json.JSONDecodeError:
                        continue

        sys.stdout.write("\n")
        sys.stdout.flush()

        assert tokens_received > 0, "No tokens streamed from Chat model!"
        log(f"  -> Stream Chunks Received: {tokens_received}")
        log("  -> PASSED: Chat SSE token chunk streaming verified.")
        dur = time.time() - start_t
        record_result(9, "Chat SSE Token Streaming", "Stream SSE Chunks", "PASSED", dur)
        return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Chat model streaming request failed: {e}")
        record_result(9, "Chat SSE Token Streaming", "Stream SSE Chunks", "FAILED", dur, str(e))
        return False


def test_autocomplete_model():
    log("--------------------------------------------------")
    log("API TEST 10: Text Completions / Autocomplete (POST /v1/completions - 'podllama-autocomplete')")
    payload = {
        "model": "podllama-autocomplete",
        "prompt": "<|fim_prefix|>def fibonacci(n: int) -> int:\n    if n <= 1:\n        return n\n    return <|fim_suffix|>\n<|fim_middle|>",
        "max_tokens": 24,
        "temperature": 0.1,
        "stop": ["\n", "\n\n", "<|endoftext|>", "<|file_separator|>", "```", "# Explanation", "# Note", "def "]
    }
    url = f"{BASE_URL}/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']}")
    log("  Expected: Status 200 OK with FIM inline code completion text")

    start_t = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            choices = data.get("choices", [])
            assert len(choices) > 0, "No completion choices returned!"
            text = choices[0].get("text", "")
            usage = data.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
            log(f"  Response Status: {resp.status}")
            log(f"  Prompt Tokens Evaluated: {prompt_tokens}")
            log(f"  Completion Tokens Generated: {completion_tokens}")
            log(f"  Inline Completion Text: {repr(text.strip())}")
            
            clean_text = text.strip()
            assert not clean_text.startswith("The function"), f"Completion returned natural language explanation instead of code: {repr(clean_text)}"
            assert "calculates" not in clean_text.lower(), f"Completion returned conversational text: {repr(clean_text)}"
            log("  -> PASSED: Autocomplete model prompt processing & completion verified.")
            dur = time.time() - start_t
            record_result(10, "Autocomplete FIM Completion", "podllama-autocomplete", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Autocomplete model completion request failed: {e}")
        record_result(10, "Autocomplete FIM Completion", "podllama-autocomplete", "FAILED", dur, str(e))
        return False


def test_tool_calling():
    log("--------------------------------------------------")
    log("API TEST 11: Function & Tool Calling (POST /v1/chat/completions - 'podllama-chat')")
    payload = {
        "model": "podllama-chat",
        "messages": [
            {"role": "user", "content": "What is the weather in Tokyo?"}
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_current_weather",
                    "description": "Get current weather info for a city",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {"type": "string", "description": "City name, e.g. Tokyo"}
                        },
                        "required": ["location"]
                    }
                }
            }
        ],
        "max_tokens": 16
    }
    url = f"{BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']} with function definitions")
    log("  Expected: Status 200 OK without server error")

    start_t = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            log(f"  Response Status: {resp.status}")
            log("  -> PASSED: Tool calling request handled without server error.")
            dur = time.time() - start_t
            record_result(11, "Function & Tool Calling", "Tool Calling Defs", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Tool calling request failed: {e}")
        record_result(11, "Function & Tool Calling", "Tool Calling Defs", "FAILED", dur, str(e))
        return False


def test_auto_stop_and_recovery():
    log("--------------------------------------------------")
    log("API TEST 12: Auto-Stop & Recovery Test (POST /v1/chat/completions after model stop)")
    log("  Simulating model server stop / idle auto-shutdown...")
    
    container_cmd = None
    for tool in ["podman", "docker"]:
        try:
            res = subprocess.run([tool, "exec", "podllama_chat", "python3", "-c", "import chat_swapper; chat_swapper.stop_llama_server()"], capture_output=True, text=True, timeout=10)
            if res.returncode == 0:
                container_cmd = tool
                break
        except Exception:
            pass

    if container_cmd:
        log(f"  -> Successfully stopped backend llama-server via {container_cmd} exec.")
    else:
        log("  -> WARNING: Could not exec container stop command directly; testing model swap endpoint recovery.")

    time.sleep(1)

    payload = {
        "model": "podllama-chat",
        "messages": [
            {"role": "user", "content": "Ping after auto-stop."}
        ],
        "max_tokens": 16,
        "temperature": 0.1
    }
    url = f"{BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']}")
    log("  Expected: Status 200 OK after automatic model reload & swapper recovery")

    start_t = time.time()
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            elapsed = time.time() - start_t
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            msg = data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Recovery Latency: {elapsed:.2f}s")
            log(f"  Response Output Sample: {repr(content.strip())}")
            log("  -> PASSED: Auto-stop recovery verified successfully.")
            dur = time.time() - start_t
            record_result(12, "Auto-Stop & Recovery", "Cold-Start Reload", "PASSED", dur)
            return True
    except Exception as e:
        dur = time.time() - start_t
        log(f"  -> FAILED: Auto-stop & recovery test failed: {e}")
        record_result(12, "Auto-Stop & Recovery", "Cold-Start Reload", "FAILED", dur, str(e))
        return False


def print_summary_report(total_duration):
    print("\n" + "=" * 92)
    print("                      PodLlama API Smoke Test Execution Summary Report")
    print("=" * 92)
    header = f"{'#':<3} | {'Test Name':<32} | {'Target Feature / Endpoint':<28} | {'Status':<8} | {'Duration':>8}"
    print(header)
    print("-" * 92)
    
    passed_count = sum(1 for r in test_results if r["status"] == "PASSED")
    failed_count = sum(1 for r in test_results if r["status"] != "PASSED")
    
    for r in test_results:
        dur_str = f"{r['duration']:.2f}s"
        status_display = r['status']
        row = f"{r['num']:<3} | {r['name']:<32} | {r['target']:<28} | {status_display:<8} | {dur_str:>8}"
        print(row)
        if r.get("error"):
            print(f"    └── Failure Detail: {r['error']}")
            
    print("-" * 92)
    summary_line = f"Total Tests: {len(test_results)} | Passed: {passed_count} | Failed: {failed_count} | Total Elapsed Time: {total_duration:.2f}s"
    print(summary_line)
    print("=" * 92)
    if failed_count == 0 and len(test_results) > 0:
        print(" SUCCESS: All live API endpoint smoke tests passed successfully!")
        print("=" * 92 + "\n")
    else:
        print(" FAILURE: Some smoke test stages failed. Please check the logs above.")
        print("=" * 92 + "\n")


def main():
    print("==================================================================")
    print("       PodLlama Environment Comprehensive API Smoke Test Suite   ")
    print("==================================================================")
    suite_start = time.time()

    test_proxy_health()
    test_list_models_api()
    personas_data = test_personas_api()
    test_persona_slash_command_resolution(personas_data)
    test_prompt_processing()
    test_thinking_model_api()
    test_instruct_model_api()
    test_persona_completion_features(personas_data)
    test_chat_model_streaming()
    test_autocomplete_model()
    test_tool_calling()
    test_auto_stop_and_recovery()

    total_dur = time.time() - suite_start
    print_summary_report(total_dur)

    failed = any(r["status"] != "PASSED" for r in test_results)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
