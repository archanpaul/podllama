#!/usr/bin/env python3
"""
Automated Test Suite for PodLlama Container Environment.
Validates YAML configs, model swapper resolution logic, SELinux volume flags,
executable script permissions, container definitions, and Makefile target parity.
"""

import os
import sys
import yaml

PROJECT_ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), ".."))


def test_yaml_configurations():
    """Test model_conf.yaml, litellm_config.yaml, and continue.yaml parsing and required schema keys."""
    print("[1/6] Testing YAML Configuration Files & Sync...")
    model_conf_path = os.path.join(PROJECT_ROOT, "config", "model_conf.yaml")
    litellm_conf_path = os.path.join(PROJECT_ROOT, "config", "litellm_config.yaml")
    continue_conf_path = os.path.join(PROJECT_ROOT, "config", "continue.yaml")

    assert os.path.exists(model_conf_path), "config/model_conf.yaml missing!"
    assert os.path.exists(litellm_conf_path), "config/litellm_config.yaml missing!"
    assert os.path.exists(continue_conf_path), "config/continue.yaml missing!"

    with open(continue_conf_path, "r", encoding="utf-8") as f:
        continue_conf = yaml.safe_load(f)
    assert "models" in continue_conf, "Missing models in config/continue.yaml"
    assert "version" in continue_conf, "Missing version in config/continue.yaml"
    assert "schema" in continue_conf, "Missing schema in config/continue.yaml"

    with open(model_conf_path, "r", encoding="utf-8") as f:
        model_conf = yaml.safe_load(f)

    assert "active_chat_model" in model_conf, "Missing active_chat_model in model_conf.yaml"
    assert "active_autocomplete_model" in model_conf, "Missing active_autocomplete_model in model_conf.yaml"
    assert "active_thinking_model" in model_conf, "Missing active_thinking_model in model_conf.yaml"
    assert "idle_timeout_seconds" in model_conf, "Missing idle_timeout_seconds in model_conf.yaml"
    assert isinstance(model_conf["idle_timeout_seconds"], int) and model_conf["idle_timeout_seconds"] > 0, "idle_timeout_seconds must be a positive integer"
    assert "models" in model_conf, "Missing models section in model_conf.yaml"
    assert "context_size" in model_conf, "Missing context_size in model_conf.yaml"
    assert model_conf["context_size"] == 16384, f"Expected context_size 16384, got {model_conf['context_size']}"

    models_map = model_conf["models"]
    assert model_conf["active_chat_model"] in models_map, f"Active chat model {model_conf['active_chat_model']} not in models map"
    assert model_conf["active_autocomplete_model"] in models_map, f"Active autocomplete model {model_conf['active_autocomplete_model']} not in models map"
    assert model_conf["active_thinking_model"] in models_map, f"Active thinking model {model_conf['active_thinking_model']} not in models map"

    for model_key, meta in models_map.items():
        assert "url" in meta, f"Model {model_key} missing download url"
        assert "sha256" in meta, f"Model {model_key} missing sha256 entry"

    with open(litellm_conf_path, "r", encoding="utf-8") as f:
        litellm_conf = yaml.safe_load(f)

    assert "model_list" in litellm_conf, "Missing model_list in litellm_config.yaml"
    litellm_models = {entry["model_name"] for entry in litellm_conf["model_list"]}

    # Ensure primary role aliases exist
    assert "podllama-chat" in litellm_models, "podllama-chat alias missing in litellm_config.yaml"
    assert "podllama-autocomplete" in litellm_models, "podllama-autocomplete alias missing in litellm_config.yaml"
    assert "podllama-thinking" in litellm_models, "podllama-thinking alias missing in litellm_config.yaml"

    # Ensure all model_conf.yaml GGUF files are exposed in litellm_config.yaml
    for gguf_file in models_map.keys():
        assert gguf_file in litellm_models, f"GGUF model file '{gguf_file}' missing from litellm_config.yaml"

    print("  -> PASSED: YAML configurations, context length, and LiteLLM model sync validated.")


def test_model_resolution_logic():
    """Test chat_swapper.resolve_model_filename role aliases and substring matching."""
    print("[2/6] Testing Model Swapper Resolution Logic...")
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "containers"))
    try:
        import chat_swapper
        chat_swapper.CONFIG_FILE = os.path.join(PROJECT_ROOT, "config", "model_conf.yaml")
        chat_swapper.load_config()

        # Role alias resolution
        chat_res = chat_swapper.resolve_model_filename("podllama-chat")
        assert chat_res == "qwen2.5-coder-7b-instruct-q4_k_m.gguf", f"podllama-chat resolved to unexpected '{chat_res}'"

        think_res = chat_swapper.resolve_model_filename("podllama-thinking")
        assert think_res == "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf", f"podllama-thinking resolved to unexpected '{think_res}'"

        # Direct exact match
        direct_res = chat_swapper.resolve_model_filename("qwen2.5-coder-3b-instruct-q4_k_m.gguf")
        assert direct_res == "qwen2.5-coder-3b-instruct-q4_k_m.gguf", f"Direct GGUF lookup failed: '{direct_res}'"

        # Substring fuzzy match
        sub_res = chat_swapper.resolve_model_filename("DeepSeek-R1-Distill-Qwen-14B")
        assert sub_res == "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf", f"Substring lookup failed: '{sub_res}'"

        print("  -> PASSED: Model resolution logic (podllama-chat, podllama-thinking, GGUF) verified.")
    except Exception as e:
        print(f"  -> FAILED: Model resolution logic test failed: {e}")
        raise


def test_script_permissions():
    """Test executable bit permissions on shell scripts."""
    print("[3/6] Testing Shell Script Executable Permissions...")
    scripts = [
        os.path.join(PROJECT_ROOT, "scripts", "run_podman.sh"),
        os.path.join(PROJECT_ROOT, "containers", "entrypoint-llamacpp.sh"),
        os.path.join(PROJECT_ROOT, "containers", "entrypoint-client.sh"),
    ]

    for script_path in scripts:
        assert os.path.exists(script_path), f"Script missing: {script_path}"
        assert os.access(script_path, os.X_OK), f"Script not executable: {script_path}"
    print("  -> PASSED: All shell scripts are executable.")


def test_container_definitions():
    """Test presence of Containerfiles, Compose file, and SELinux shared read flag (:ro,z)."""
    print("[4/6] Testing Container Definitions & SELinux Volume Flags...")
    compose_file = os.path.join(PROJECT_ROOT, "containers", "compose.yaml")
    container_files = [
        os.path.join(PROJECT_ROOT, "containers", "Containerfile.llamacpp"),
        os.path.join(PROJECT_ROOT, "containers", "Containerfile.qwencoder"),
        compose_file,
        os.path.join(PROJECT_ROOT, "containers", "chat_swapper.py"),
    ]

    for cfile in container_files:
        assert os.path.exists(cfile), f"Container definition missing: {cfile}"

    # Assert SELinux volume mount uses lowercase 'z' for shared read access on model_conf.yaml
    with open(compose_file, "r", encoding="utf-8") as f:
        compose_content = f.read()
    assert ":ro,z" in compose_content, "compose.yaml must use ':ro,z' (lowercase z) for shared SELinux read access"
    assert ":ro,Z" not in compose_content, "compose.yaml should not use uppercase ':ro,Z' as it prevents shared access across containers"

    print("  -> PASSED: All container definitions present and SELinux shared flags verified.")


def test_chat_swapper_idle_config():
    """Test chat_swapper idle timeout resolution from YAML and environment override."""
    print("[5/6] Testing Chat Swapper Idle Timeout Configuration Resolution...")
    sys.path.insert(0, os.path.join(PROJECT_ROOT, "containers"))
    try:
        import chat_swapper
        chat_swapper.CONFIG_FILE = os.path.join(PROJECT_ROOT, "config", "model_conf.yaml")
        timeout = chat_swapper.get_idle_timeout()
        assert isinstance(timeout, int) and timeout > 0, f"Expected positive integer idle timeout, got {timeout}"

        # Test environment variable override when idle_timeout_seconds is absent
        os.environ["IDLE_TIMEOUT_SECONDS"] = "300"
        old_data = dict(chat_swapper.config_data)
        chat_swapper.config_data.clear()
        
        # Test env override with fallback file path
        old_config_file = chat_swapper.CONFIG_FILE
        chat_swapper.CONFIG_FILE = "/nonexistent/model_conf.yaml"
        assert chat_swapper.get_idle_timeout() == 300, "Env override for IDLE_TIMEOUT_SECONDS failed"
        
        # Restore state
        chat_swapper.CONFIG_FILE = old_config_file
        chat_swapper.config_data = old_data
        del os.environ["IDLE_TIMEOUT_SECONDS"]
        print("  -> PASSED: Chat swapper idle timeout configuration resolved successfully.")
    except Exception as e:
        print(f"  -> FAILED: Chat swapper idle config test failed: {e}")
        raise


def test_makefile_targets():
    """Test Makefile target presence and alias mapping."""
    print("[6/6] Testing Makefile Targets & Alias Parity...")
    makefile_path = os.path.join(PROJECT_ROOT, "Makefile")
    assert os.path.exists(makefile_path), "Makefile missing!"

    with open(makefile_path, "r", encoding="utf-8") as f:
        makefile_content = f.read()

    required_targets = [
        "service-up:",
        "service-down:",
        "service-logs:",
        "service-status:",
        "service-restart:",
        "unit-tests:",
        "smoke-tests:",
        "download-active-models:",
        "download-models:",
    ]

    for target in required_targets:
        assert target in makefile_content, f"Makefile missing target '{target}'"

    # Alias checks
    assert "compose-up: service-up" in makefile_content, "compose-up alias missing"
    assert "compose-down: service-down" in makefile_content, "compose-down alias missing"
    assert "compose-logs: service-logs" in makefile_content, "compose-logs alias missing"
    assert "status: service-status" in makefile_content, "status alias missing"

    print("  -> PASSED: Makefile target parity and alias mappings verified.")


def run_all_tests():
    print("==================================================")
    print("       PodLlama Comprehensive Unit Test Suite     ")
    print("==================================================")
    test_yaml_configurations()
    test_model_resolution_logic()
    test_script_permissions()
    test_container_definitions()
    test_chat_swapper_idle_config()
    test_makefile_targets()
    print("==================================================")
    print(" SUCCESS: All automated unit tests passed!       ")
    print("==================================================")


if __name__ == "__main__":
    run_all_tests()

