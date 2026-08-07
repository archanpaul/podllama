#!/usr/bin/env python3
"""
Smoke Test Suite for PodLlama Container Environment.
Verifies live endpoint connectivity, Prompt processing token evaluation, Chat model streaming, Autocomplete model completion, and Tool calling.
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
    log("Checking LiteLLM Proxy liveliness...")
    try:
        req = urllib.request.Request(HEALTH_URL)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = resp.read().decode("utf-8")
            log(f"  -> Liveliness status: {resp.status} ({data.strip()})")
            assert resp.status == 200, f"Expected status 200, got {resp.status}"
            log("  -> PASSED: Proxy health endpoint active.")
    except Exception as e:
        log(f"  -> FAILED: Could not connect to LiteLLM Proxy liveliness at {HEALTH_URL}: {e}")
        sys.exit(1)


def test_prompt_processing():
    log("Testing Prompt Processing & Token Accounting ('qwen-chat')...")
    payload = {
        "model": "qwen-chat",
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            usage = data.get("usage", {})
            prompt_tokens = usage.get("prompt_tokens", 0)
            completion_tokens = usage.get("completion_tokens", 0)
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            log(f"  -> Prompt evaluated: {prompt_tokens} tokens processed.")
            log(f"  -> Response generated: {completion_tokens} tokens ({repr(content.strip())}).")
            assert prompt_tokens > 0, "Prompt tokens count must be > 0"
            assert completion_tokens > 0, "Completion tokens count must be > 0"
            log("  -> PASSED: Prompt processing and token accounting verified.")
    except Exception as e:
        log(f"  -> FAILED: Prompt processing test failed: {e}")
        sys.exit(1)


def test_chat_model_streaming():
    log("Testing Chat Model ('qwen-chat') streaming response...")
    payload = {
        "model": "qwen-chat",
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        tokens_received = 0
        sys.stdout.write("  -> Output: ")
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
        log(f"  -> PASSED: Chat model streamed {tokens_received} token chunks successfully.")
    except Exception as e:
        log(f"  -> FAILED: Chat model streaming request failed: {e}")
        sys.exit(1)


def test_autocomplete_model():
    log("Testing Autocomplete Model ('qwen-autocomplete') prompt processing & completion...")
    payload = {
        "model": "qwen-autocomplete",
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
            log(f"  -> Prompt evaluated: {prompt_tokens} tokens processed.")
            log(f"  -> Completion generated: {completion_tokens} tokens ({repr(text.strip())}).")
            log("  -> PASSED: Autocomplete model prompt processing & completion verified.")
    except Exception as e:
        log(f"  -> FAILED: Autocomplete model completion request failed: {e}")
        sys.exit(1)


def test_tool_calling():
    log("Testing Tool Calling on Chat Model ('qwen-chat')...")
    payload = {
        "model": "qwen-chat",
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

    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert resp.status == 200, f"Expected 200, got {resp.status}"
            log("  -> PASSED: Tool calling request handled without server error.")
    except Exception as e:
        log(f"  -> FAILED: Tool calling request failed: {e}")
        sys.exit(1)


def main():
    print("==================================================")
    print("       PodLlama Environment Smoke Test           ")
    print("==================================================")
    test_proxy_health()
    test_autocomplete_model()
    test_prompt_processing()
    test_chat_model_streaming()
    test_tool_calling()
    print("==================================================")
    print(" SUCCESS: All smoke tests passed!                ")
    print("==================================================")


if __name__ == "__main__":
    main()
