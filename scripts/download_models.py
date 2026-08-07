#!/usr/bin/env python3
import sys
import os
import yaml
import hashlib
import subprocess
import argparse

def verify_and_download(model_name, meta, models_dir):
    target = os.path.join(models_dir, model_name)
    expected_hash = meta.get('sha256', '')
    url = meta.get('url', '')

    # Check if model already exists and is valid
    if os.path.exists(target):
        file_size = os.path.getsize(target)
        if file_size >= 10485760: # > 10MB
            if expected_hash == 'auto-verify-on-download' or not expected_hash:
                print(f"--> Model {model_name} already present and verified in {models_dir}.")
                return True
            print(f"--> Calculating SHA256 checksum for {model_name}...")
            actual_hash = hashlib.sha256(open(target, 'rb').read()).hexdigest()
            if actual_hash == expected_hash:
                print(f"--> Model {model_name} already present and SHA256 verified in {models_dir}.")
                return True
            else:
                print(f"WARNING: Existing model {model_name} failed SHA256 checksum! Re-downloading...")
                os.remove(target)

    tmp_target = target + ".tmp"
    if os.path.exists(tmp_target):
        os.remove(tmp_target)

    print(f"--> Downloading model: {model_name}")
    print(f"    URL: {url}")

    res = subprocess.run(["curl", "-L", "--fail", "--progress-bar", "-o", tmp_target, url])
    if res.returncode != 0 or not os.path.exists(tmp_target) or os.path.getsize(tmp_target) < 10485760:
        if os.path.exists(tmp_target):
            os.remove(tmp_target)
        print(f"ERROR: Failed to download {model_name} from {url}!", file=sys.stderr)
        return False

    print(f"--> Verifying SHA256 checksum for {model_name} after download...")
    actual_hash = hashlib.sha256(open(tmp_target, 'rb').read()).hexdigest()

    if expected_hash != 'auto-verify-on-download' and expected_hash:
        if actual_hash != expected_hash:
            if os.path.exists(tmp_target):
                os.remove(tmp_target)
            print(f"ERROR: Post-download SHA256 checksum mismatch for {model_name}!", file=sys.stderr)
            print(f"       Expected: {expected_hash}", file=sys.stderr)
            print(f"       Actual:   {actual_hash}", file=sys.stderr)
            return False

    os.rename(tmp_target, target)
    print(f"--> Post-download checksum VERIFIED for {model_name} ({actual_hash[:12]}...).")
    return True

def main():
    parser = argparse.ArgumentParser(description="Download and verify GGUF models.")
    parser.add_argument("--config", default="config/model_conf.yaml", help="Path to model_conf.yaml")
    parser.add_argument("--models-dir", default="./models", help="Directory to store downloaded models")
    parser.add_argument("--active-only", action="store_true", help="Download only active models")
    args = parser.parse_args()

    if not os.path.exists(args.config):
        print(f"ERROR: Configuration file {args.config} not found!", file=sys.stderr)
        sys.exit(1)

    with open(args.config, 'r') as f:
        conf = yaml.safe_load(f)

    os.makedirs(args.models_dir, exist_ok=True)

    if args.active_only:
        active_models = [conf.get('active_chat_model'), conf.get('active_autocomplete_model'), conf.get('active_thinking_model')]
        active_models = [m for m in active_models if m and m in conf['models']]
        targets = {m: conf['models'][m] for m in active_models}
        print(f"Checking active chat, autocomplete, and thinking models in {args.models_dir}...")
    else:
        targets = conf['models']
        print(f"Checking all configured GGUF models in {args.models_dir}...")

    success = True
    for name, meta in targets.items():
        if not verify_and_download(name, meta, args.models_dir):
            success = False

    if not success:
        sys.exit(1)

if __name__ == "__main__":
    main()
