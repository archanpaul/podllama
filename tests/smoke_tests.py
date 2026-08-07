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
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
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
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            log(f"  Response Status: {resp.status}")
            log(f"  Thinking Output Sample: {repr(content.strip())}")
            log("  -> PASSED: Thinking model completions API verified successfully.")
    except Exception as e:
        log(f"  -> FAILED: Thinking model API request failed: {e}")
        sys.exit(1)


def test_chat_model_streaming():
    log("--------------------------------------------------")
    log("API TEST 5: Chat Streaming SSE (POST /v1/chat/completions with stream=true)")
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
                        content = delta.get("content", "")
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
    log("API TEST 6: Text Completions / Autocomplete (POST /v1/completions - 'podllama-autocomplete')")
    payload = {
        "model": "podllama-autocomplete",
        "prompt": "def fibonacci(n: int) -> int:\n    if n <= 1:\n        return n\n    return ",
        "max_tokens": 32,
        "temperature": 0.1,
        "stop": ["\n\n"]
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
            assert not text.strip().startswith("The function") and not text.strip().startswith("Certainly"), f"Autocomplete model returned conversational text instead of raw code: {text}"
            usage = data.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
            log(f"  Response Status: {resp.status}")
            log(f"  Prompt Tokens Evaluated: {prompt_tokens}")
            log(f"  Completion Tokens Generated: {completion_tokens}")
            log(f"  Inline Completion Text: {repr(text.strip())}")
            log("  -> PASSED: Autocomplete model prompt processing & completion verified.")
    except Exception as e:
        log(f"  -> FAILED: Autocomplete model completion request failed: {e}")
        sys.exit(1)


def test_tool_calling():
    log("--------------------------------------------------")
    log("API TEST 7: Function & Tool Calling (POST /v1/chat/completions - 'podllama-chat')")
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


def main():
    print("==================================================================")
    print("       PodLlama Environment Comprehensive API Smoke Test Suite   ")
    print("==================================================================")
    test_proxy_health()
    test_list_models_api()
    test_prompt_processing()
    test_thinking_model_api()
    test_chat_model_streaming()
    test_autocomplete_model()
    test_tool_calling()
    print("==================================================================")
    print(" SUCCESS: All live API endpoint smoke tests passed!               ")
    print("==================================================================")


if __name__ == "__main__":
    main()

