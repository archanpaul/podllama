/**
 * PodLlama Configuration Generator & API Sandbox Tester
 */

class ConfigGenerator {
  constructor() {
    this.chatModel = "Qwen3.5-9B-Q4_K_M.gguf";
    this.thinkingModel = "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf";
    this.autoModel = "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf";
    this.idleTimeout = 600;
    this.gpuLayers = 99;
    this.contextSize = 16384;
    this.init();
  }

  init() {
    this.setupConfigListeners();
    this.renderConfigYaml();
    this.setupApiSandbox();
  }

  setupConfigListeners() {
    const chatSelect = document.getElementById("cfg-chat-model");
    const thinkSelect = document.getElementById("cfg-think-model");
    const autoSelect = document.getElementById("cfg-auto-model");
    const timeoutInput = document.getElementById("cfg-idle-timeout");
    const layersInput = document.getElementById("cfg-gpu-layers");
    const copyYamlBtn = document.getElementById("copy-yaml-btn");

    if (chatSelect) {
      chatSelect.addEventListener("change", (e) => {
        this.chatModel = e.target.value;
        this.renderConfigYaml();
      });
    }

    if (thinkSelect) {
      thinkSelect.addEventListener("change", (e) => {
        this.thinkingModel = e.target.value;
        this.renderConfigYaml();
      });
    }

    if (autoSelect) {
      autoSelect.addEventListener("change", (e) => {
        this.autoModel = e.target.value;
        this.renderConfigYaml();
      });
    }

    if (timeoutInput) {
      timeoutInput.addEventListener("input", (e) => {
        this.idleTimeout = parseInt(e.target.value) || 600;
        this.renderConfigYaml();
      });
    }

    if (layersInput) {
      layersInput.addEventListener("input", (e) => {
        this.gpuLayers = parseInt(e.target.value) || 99;
        this.renderConfigYaml();
      });
    }

    if (copyYamlBtn) {
      copyYamlBtn.addEventListener("click", () => {
        const yamlText = document.getElementById("generated-yaml-output").textContent;
        navigator.clipboard.writeText(yamlText);
        if (window.showToast) window.showToast("Configuration YAML copied to clipboard!");
      });
    }
  }

  renderConfigYaml() {
    const output = document.getElementById("generated-yaml-output");
    if (!output) return;

    const yaml = `# PodLlama Container Environment Configuration
active_chat_model: ${this.chatModel}
active_autocomplete_model: ${this.autoModel}
active_thinking_model: ${this.thinkingModel}
chat_server_port: 8080
autocomplete_server_port: 8081
idle_timeout_seconds: ${this.idleTimeout} # 0 MB VRAM when idle > ${this.idleTimeout}s
models_dir: /models
workspace_dir: /workspace
server_host: 0.0.0.0
vulkan_gpu_layers: ${this.gpuLayers} # -ngl ${this.gpuLayers}
chat_cpu_threads: 8
autocomplete_cpu_threads: 4
context_size: ${this.contextSize}
autocomplete_context_size: 4096
batch_size: 2048
ubatch_size: 512
`;
    output.textContent = yaml;
  }

  setupApiSandbox() {
    const sendBtn = document.getElementById("api-send-test-btn");
    const methodSelect = document.getElementById("api-endpoint-select");
    const payloadArea = document.getElementById("api-payload-input");
    const responseArea = document.getElementById("api-response-output");

    if (methodSelect && payloadArea) {
      methodSelect.addEventListener("change", (e) => {
        if (e.target.value === "chat") {
          payloadArea.value = JSON.stringify({
            model: "podllama-chat",
            messages: [
              { role: "system", content: "You are an expert polyglot developer." },
              { role: "user", content: "Implement a thread-safe LRU Cache in Rust using Arc<Mutex>." }
            ],
            temperature: 0.2,
            max_tokens: 512
          }, null, 2);
        } else if (e.target.value === "thinking") {
          payloadArea.value = JSON.stringify({
            model: "podllama-thinking",
            messages: [
              { role: "user", content: "/prof Prove that the halting problem is undecidable via Cantor diagonalization." }
            ],
            temperature: 0.6
          }, null, 2);
        } else if (e.target.value === "autocomplete") {
          payloadArea.value = JSON.stringify({
            model: "podllama-autocomplete",
            prompt: "<fim_prefix>def binary_search(arr, target):\n    left, right = 0, len(arr) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        <fim_suffix>\n    return -1<fim_middle>",
            max_tokens: 64,
            temperature: 0.0
          }, null, 2);
        } else if (e.target.value === "health") {
          payloadArea.value = "GET /health/liveliness HTTP/1.1\nHost: localhost:4000\nAccept: application/json";
        }
      });
    }

    if (sendBtn && responseArea) {
      sendBtn.addEventListener("click", () => {
        responseArea.textContent = "⏳ Sending simulated request to LiteLLM Proxy on http://localhost:4000...";
        
        setTimeout(() => {
          const endpoint = methodSelect.value;
          if (endpoint === "chat") {
            responseArea.textContent = JSON.stringify({
              id: "chatcmpl-" + Math.random().toString(36).substr(2, 9),
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: "podllama-chat",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: "Here is the production-grade, thread-safe LRU Cache in Rust using Arc and parking_lot::Mutex for zero lock contention..."
                  },
                  finish_reason: "stop"
                }
              ],
              usage: {
                prompt_tokens: 46,
                completion_tokens: 312,
                total_tokens: 358
              },
              system_fingerprint: "podllama-vulkan-qwen7b"
            }, null, 2);
          } else if (endpoint === "thinking") {
            responseArea.textContent = JSON.stringify({
              id: "chatcmpl-think-" + Math.random().toString(36).substr(2, 9),
              object: "chat.completion",
              model: "podllama-thinking",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    reasoning_content: "1. Assume a Turing Machine H(M, w) exists that decides halting.\n2. Construct machine D(M) that calls H(M, M) and loops infinitely if H accepts.\n3. Feed D to itself: D(D) halts iff D(D) loops. Contradiction.",
                    content: "### Formal Proof of Undecidability (Turing Halting Problem)\n\n**Theorem:** There exists no algorithm that can determine whether an arbitrary Turing machine halts on a given input."
                  },
                  finish_reason: "stop"
                }
              ],
              usage: { prompt_tokens: 38, completion_tokens: 420, total_tokens: 458 }
            }, null, 2);
          } else if (endpoint === "autocomplete") {
            responseArea.textContent = JSON.stringify({
              id: "cmpl-fim-" + Math.random().toString(36).substr(2, 9),
              object: "text_completion",
              model: "podllama-autocomplete",
              choices: [
                {
                  text: "if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1",
                  index: 0,
                  finish_reason: "stop"
                }
              ],
              usage: { prompt_tokens: 35, completion_tokens: 28, total_tokens: 63 }
            }, null, 2);
          } else {
            responseArea.textContent = JSON.stringify({
              status: "healthy",
              uptime_seconds: 48120,
              active_services: {
                podllama_proxy: "healthy (port 4000)",
                podllama_chat: "running (port 8080, model: Qwen2.5-Coder-7B)",
                podllama_autocomplete: "running (port 8081, model: Qwen2.5-Coder-0.5B)"
              },
              vulkan_acceleration: "enabled (/dev/dri: Intel Arc A770)"
            }, null, 2);
          }
        }, 350);
      });
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.configGenerator = new ConfigGenerator();
});