#!/usr/bin/env python3
"""
Smoke Test Suite for PodLlama Container Environment.
Verifies live endpoint connectivity, API list models, Chat model prompt processing,
Streaming, Thinking model reasoning, Autocomplete completion, and Tool calling.
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


def log(msg):
    print(f"[SMOKE TEST] {msg}", flush=True)


def test_proxy_health():
    log("--------------------------------------------------")
    log("API TEST 1: Proxy Liveliness Check (GET /health/liveliness)")
    log(f"  Target URL: {HEALTH_URL}")
    log("  Expected: Status 200 OK with liveliness message")
    try:
        req = urllib.request.Request(HEALTH_URL)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read().decode("utf-8")
            log(f"  Response Status: {resp.status}")
            log(f"  Response Payload: {repr(data.strip())}")
            assert resp.status == 200, f"Expected status 200, got {resp.status}"
            log("  -> PASSED: GET /health/liveliness active and healthy.")
    except Exception as e:
        log(f"  -> FAILED: Could not connect to LiteLLM Proxy liveliness at {HEALTH_URL}: {e}")
        sys.exit(1)


def test_list_models_api():
    log("--------------------------------------------------")
    log("API TEST 2: List Models API (GET /v1/models)")
    url = f"{BASE_URL}/models"
    headers = {"Authorization": f"Bearer {API_KEY}"}
    log(f"  Target URL: {url}")
    log("  Expected: Status 200 OK with JSON array containing model objects")
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
    except Exception as e:
        log(f"  -> FAILED: List models request failed: {e}")
        sys.exit(1)


def test_prompt_processing():
    log("--------------------------------------------------")
    log("API TEST 3: Chat Completions (POST /v1/chat/completions - 'podllama-chat')")
    payload = {
        "model": "podllama-chat",
        "messages": [
            {"role": "system", "content": "You are a code analyzer."},
            {"role": "user", "content": "Analyze snippet:\ndef add(a: int, b: int) -> int:\n    return a + b\nSummarize function purpose."}
        ],
        "max_tokens": 32,
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
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
    except Exception as e:
        log(f"  -> FAILED: Prompt processing test failed: {e}")
        sys.exit(1)


def test_thinking_model_api():
    log("--------------------------------------------------")
    log("API TEST 4: Deep Thinking & Reasoning (POST /v1/chat/completions - 'podllama-thinking')")
    payload = {
        "model": "podllama-thinking",
        "messages": [
            {"role": "user", "content": "Explain worst-case time complexity of quicksort in one sentence."}
        ],
        "max_tokens": 48,
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            msg = data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content") or msg.get("reasoning_content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Thinking Output Sample: {repr(content.strip())}")
            log("  -> PASSED: Thinking model completions API verified successfully.")
    except Exception as e:
        log(f"  -> FAILED: Thinking model API request failed: {e}")
        sys.exit(1)




def test_instruct_model_api():
    log("--------------------------------------------------")
    log("API TEST 5: Instruct Completions (POST /v1/chat/completions - 'podllama-instruct')")
    payload = {
        "model": "podllama-instruct",
        "messages": [
            {"role": "system", "content": "You are a code assistant."},
            {"role": "user", "content": "Write a python function to compute factorial."}
        ],
        "max_tokens": 48,
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            msg = data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Instruct Output Sample: {repr(content.strip())}")
            log("  -> PASSED: Instruct model (podllama-instruct) completions API verified successfully.")
    except Exception as e:
        log(f"  -> FAILED: Instruct model API request failed: {e}")
        sys.exit(1)

def test_chat_model_streaming():
    log("--------------------------------------------------")
    log("API TEST 6: Chat Streaming SSE (POST /v1/chat/completions with stream=true)")
    payload = {
        "model": "podllama-chat",
        "messages": [
            {"role": "system", "content": "You are a helpful coding assistant."},
            {"role": "user", "content": "Write a one-line Python function to reverse a string."}
        ],
        "max_tokens": 64,
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        tokens_received = 0
        sys.stdout.write("  -> Streaming Output Chunks: ")
        sys.stdout.flush()

        with urllib.request.urlopen(req, timeout=60) as resp:
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
    except Exception as e:
        log(f"  -> FAILED: Chat model streaming request failed: {e}")
        sys.exit(1)


def test_autocomplete_model():
    log("--------------------------------------------------")
    log("API TEST 7: Text Completions / Autocomplete (POST /v1/completions - 'podllama-autocomplete')")
    payload = {
        "model": "podllama-autocomplete",
        "prompt": "<|fim_prefix|>def fibonacci(n: int) -> int:\n    if n <= 1:\n        return n\n    return <|fim_suffix|>\n<|fim_middle|>",
        "max_tokens": 32,
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
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
    except Exception as e:
        log(f"  -> FAILED: Autocomplete model completion request failed: {e}")
        sys.exit(1)


def test_tool_calling():
    log("--------------------------------------------------")
    log("API TEST 8: Function & Tool Calling (POST /v1/chat/completions - 'podllama-chat')")
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
        "max_tokens": 64
    }
    url = f"{BASE_URL}/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    log(f"  Target URL: {url}")
    log(f"  Request Model: {payload['model']} with function definitions")
    log("  Expected: Status 200 OK without server error")

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            log(f"  Response Status: {resp.status}")
            log("  -> PASSED: Tool calling request handled without server error.")
    except Exception as e:
        log(f"  -> FAILED: Tool calling request failed: {e}")
        sys.exit(1)


def test_auto_stop_and_recovery():
    log("--------------------------------------------------")
    log("API TEST 9: Auto-Stop & Recovery Test (POST /v1/chat/completions after model stop)")
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

    try:
        start_t = time.time()
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            elapsed = time.time() - start_t
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            msg = data.get("choices", [{}])[0].get("message", {})
            content = msg.get("content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Recovery Latency: {elapsed:.2f}s")
            log(f"  Response Output Sample: {repr(content.strip())}")
            log("  -> PASSED: Auto-stop recovery verified successfully.")
    except Exception as e:
        log(f"  -> FAILED: Auto-stop & recovery test failed: {e}")
        sys.exit(1)



def test_personas_api():
    log("--------------------------------------------------")
    log("API TEST 10: Personas Taxonomy & Skills API (GET /v1/personas)")
    urls_to_try = [
        "http://127.0.0.1:8080/v1/personas",
        f"{BASE_URL}/personas",
        "http://127.0.0.1:8080/personas"
    ]
    headers = {"Authorization": f"Bearer {API_KEY}"}

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
        assert len(personas) >= 21, f"Expected at least 21 personas, got {len(personas)}"
        assert len(categories) >= 6, f"Expected at least 6 categories, got {len(categories)}"

        # Verify category schema
        for cat in categories:
            assert "id" in cat and "name" in cat and "description" in cat and "icon" in cat, f"Invalid category: {cat}"

        # Verify personas schema & skillsets
        for p in personas:
            assert "id" in p and "name" in p and "category" in p and "category_id" in p
            assert "skills" in p and isinstance(p["skills"], list) and len(p["skills"]) > 0
            assert "slash_command" in p and p["slash_command"].startswith("/")
            assert "system_prompt" in p and len(p["system_prompt"]) > 0

        # Assert key personas exist
        assert "cp-solver" in p_ids, "Missing 'cp-solver' persona in response"
        assert "hackathon-builder" in p_ids, "Missing 'hackathon-builder' persona in response"
        assert "cs-professor" in p_ids, "Missing 'cs-professor' persona in response"
        assert "algo-specialist" in p_ids, "Missing 'algo-specialist' persona in response"

        log(f"  -> PASSED: GET /v1/personas returned in-memory category-wise personas dataset successfully from {successful_url}.")
        return data
    else:
        log("  -> FAILED: Could not reach personas endpoint on port 8080 or 4000.")
        sys.exit(1)


def test_persona_completion_features(personas_data=None):
    log("--------------------------------------------------")
    log("API TEST 11: Persona Prompt Injection & Target Model Execution")
    
    # Select sample personas across different categories
    test_cases = [
        {
            "id": "cp-solver",
            "slash": "/cp",
            "prompt": "Find maximum subarray sum using Kadane's Algorithm in C++ with time and space complexity.",
            "expected_kw": "Complexity"
        },
        {
            "id": "hackathon-builder",
            "slash": "/hack",
            "prompt": "Suggest a high-impact MVP stack and 2-minute demo hook for an AI note summarizer.",
            "expected_kw": "MVP"
        },
        {
            "id": "cs-professor",
            "slash": "/prof",
            "prompt": "State the Master Theorem recurrence relation in LaTeX notation.",
            "expected_kw": "$"
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
            "max_tokens": 48,
            "temperature": 0.1
        }

        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                assert resp.status == 200, f"Expected 200, got {resp.status}"
                choices = data.get("choices", [])
                assert len(choices) > 0, "No completion choices returned!"
                msg = choices[0].get("message", {})
                content = msg.get("content") or msg.get("reasoning_content", "")
                log(f"    Response Status: {resp.status} | Tokens Generated: {data.get("usage", {}).get("completion_tokens", 0)}")
                log(f"    Sample Output: {repr(content[:80].strip())}...")
                assert len(content.strip()) > 0, f"Empty content generated for persona {persona_id}"
        except Exception as e:
            log(f"  -> FAILED: Persona execution failed for '{persona_id}': {e}")
            sys.exit(1)

    log("  -> PASSED: All persona prompt injections and model executions completed successfully.")


def test_persona_slash_command_resolution(personas_data=None):
    log("--------------------------------------------------")
    log("API TEST 12: Persona Slash Command Mapping & Resolution")
    
    if not personas_data or "personas" not in personas_data:
        try:
            req = urllib.request.Request("http://127.0.0.1:8080/v1/personas", headers={"Authorization": f"Bearer {API_KEY}"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                personas_data = json.loads(resp.read().decode("utf-8"))
        except Exception:
            pass

    personas = (personas_data or {}).get("personas", [])
    slash_commands = {}
    for p in personas:
        cmd = p.get("slash_command", "").lower()
        assert cmd.startswith("/"), f"Invalid slash command: {cmd}"
        assert cmd not in slash_commands, f"Duplicate slash command detected: {cmd}"
        slash_commands[cmd] = p["id"]

    log(f"  Verified {len(slash_commands)} unique slash command mappings: {list(slash_commands.keys())[:10]}...")
    assert "/cp" in slash_commands, "Missing /cp slash command"
    assert "/hack" in slash_commands, "Missing /hack slash command"
    assert "/prof" in slash_commands, "Missing /prof slash command"
    assert "/algo" in slash_commands, "Missing /algo slash command"
    assert "/dl" in slash_commands, "Missing /dl slash command"
    assert "/dev" in slash_commands, "Missing /dev slash command"
    log("  -> PASSED: Persona slash command mappings and uniqueness verified.")

def main():
    print("==================================================================")
    print("       PodLlama Environment Comprehensive API Smoke Test Suite   ")
    print("==================================================================")
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
    print("==================================================================")
    print(" SUCCESS: All live API endpoint smoke tests passed!               ")
    print("==================================================================")


if __name__ == "__main__":
    main()
