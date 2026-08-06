#!/usr/bin/env python3
"""
Automated Test Suite for Qwen Code Podman Container Environment.
Validates YAML configs, executable script permissions, and container files.
"""

import os
import sys
import yaml

PROJECT_ROOT = os.path.realpath(os.path.join(os.path.dirname(__file__), ".."))


def test_yaml_configurations():
    """Test model_conf.yaml and litellm_config.yaml parsing and required schema keys."""
    print("[1/3] Testing YAML Configuration Files...")
    model_conf_path = os.path.join(PROJECT_ROOT, "config", "model_conf.yaml")
    litellm_conf_path = os.path.join(PROJECT_ROOT, "config", "litellm_config.yaml")

    assert os.path.exists(model_conf_path), "config/model_conf.yaml missing!"
    assert os.path.exists(litellm_conf_path), "config/litellm_config.yaml missing!"

    with open(model_conf_path, "r", encoding="utf-8") as f:
        model_conf = yaml.safe_load(f)

    assert "active_chat_model" in model_conf, "Missing active_chat_model in model_conf.yaml"
    assert "active_autocomplete_model" in model_conf, "Missing active_autocomplete_model in model_conf.yaml"
    assert "models" in model_conf, "Missing models section in model_conf.yaml"

    models_map = model_conf["models"]
    assert model_conf["active_chat_model"] in models_map, f"Active chat model {model_conf['active_chat_model']} not in models map"
    assert model_conf["active_autocomplete_model"] in models_map, f"Active autocomplete model {model_conf['active_autocomplete_model']} not in models map"

    for model_key, meta in models_map.items():
        assert "url" in meta, f"Model {model_key} missing download url"
        assert "sha256" in meta, f"Model {model_key} missing sha256 entry"

    with open(litellm_conf_path, "r", encoding="utf-8") as f:
        litellm_conf = yaml.safe_load(f)

    assert "model_list" in litellm_conf, "Missing model_list in litellm_config.yaml"
    litellm_models = {entry["model_name"] for entry in litellm_conf["model_list"]}

    # Ensure every model key in model_conf.yaml is registered in litellm_config.yaml
    for model_key in models_map:
        assert model_key in litellm_models, f"Model {model_key} from model_conf.yaml is NOT registered in litellm_config.yaml"

    # Ensure primary role aliases exist
    assert "qwen-chat" in litellm_models, "qwen-chat alias missing in litellm_config.yaml"
    assert "qwen-autocomplete" in litellm_models, "qwen-autocomplete alias missing in litellm_config.yaml"

    print("  -> PASSED: YAML configurations and LiteLLM model sync validated successfully.")


def test_script_permissions():
    """Test executable bit permissions on shell scripts."""
    print("[2/3] Testing Shell Script Executable Permissions...")
    scripts = [
        os.path.join(PROJECT_ROOT, "scripts", "run_podman.sh"),
        os.path.join(PROJECT_ROOT, "containers", "entrypoint-server.sh"),
        os.path.join(PROJECT_ROOT, "containers", "entrypoint-client.sh"),
    ]

    for script_path in scripts:
        assert os.path.exists(script_path), f"Script missing: {script_path}"
        assert os.access(script_path, os.X_OK), f"Script not executable: {script_path}"
    print("  -> PASSED: All shell scripts are executable.")


def test_container_definitions():
    """Test presence of Containerfiles and Compose file."""
    print("[3/3] Testing Container Definitions & Compose YAML...")
    container_files = [
        os.path.join(PROJECT_ROOT, "containers", "Containerfile.server"),
        os.path.join(PROJECT_ROOT, "containers", "Containerfile.qwencoder"),
        os.path.join(PROJECT_ROOT, "containers", "compose.yaml"),
    ]

    for cfile in container_files:
        assert os.path.exists(cfile), f"Container definition missing: {cfile}"
    print("  -> PASSED: All container definition files present.")


def run_all_tests():
    print("==================================================")
    print("       Qwen Code Automated Test Suite            ")
    print("==================================================")
    test_yaml_configurations()
    test_script_permissions()
    test_container_definitions()
    print("==================================================")
    print(" SUCCESS: All automated unit tests passed!       ")
    print("==================================================")


if __name__ == "__main__":
    run_all_tests()
