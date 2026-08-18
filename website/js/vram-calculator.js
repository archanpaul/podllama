/**
 * PodLlama Hardware & VRAM Advisor Engine
 * Calculates optimal GGUF models, layer offloads (-ngl), and token speeds
 * Clean Technical Palette: Electric Blue, Cyan, Emerald.
 */

class VramCalculator {
  constructor() {
    this.selectedVram = 16;
    this.selectedVendor = "vulkan";
    this.init();
  }

  init() {
    this.setupListeners();
    this.updateCalculation();
  }

  setupListeners() {
    const slider = document.getElementById("vram-slider");
    const vramDisplay = document.getElementById("vram-val-display");

    if (slider && vramDisplay) {
      slider.addEventListener("input", (e) => {
        this.selectedVram = parseInt(e.target.value);
        vramDisplay.textContent = `${this.selectedVram} GB`;
        this.updatePresetButtons();
        this.updateCalculation();
      });
    }

    const presetBtns = document.querySelectorAll(".vram-preset-btn");
    presetBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const val = parseInt(btn.dataset.vram);
        this.selectedVram = val;
        if (slider) slider.value = val;
        if (vramDisplay) vramDisplay.textContent = `${val} GB`;
        this.updatePresetButtons();
        this.updateCalculation();
      });
    });
  }

  updatePresetButtons() {
    document.querySelectorAll(".vram-preset-btn").forEach(btn => {
      if (parseInt(btn.dataset.vram) === this.selectedVram) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
  }

  updateCalculation() {
    const vram = this.selectedVram;
    let autoModel = "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf";
    let autoLabel = "Qwen2.5-Coder-0.5B (FIM, 491 MB)";
    let autoVram = 0.8;

    let chatModel = "Qwen3.5-9B-Q4_K_M.gguf";
    let chatLabel = "Qwen3.5-9B (Flagship Active Chat, 5.8 GB)";
    let chatVram = 6.8;

    let thinkModel = "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf";
    let thinkLabel = "DeepSeek-R1-Distill-Qwen-7B (4.68 GB)";
    let thinkVram = 5.5;

    let nglLayers = 99;
    let offloadText = "100% GPU Offload (99 Layers to Vulkan)";
    let estSpeed = "45 - 60 tokens/sec";
    let idleVram = "0 MB (100% Reclaimed after 10m idle)";

    if (vram <= 4) {
      autoModel = "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf";
      autoLabel = "Qwen2.5-Coder-0.5B (FIM, 491 MB)";
      chatModel = "qwen2.5-coder-3b-instruct-q4_k_m.gguf";
      chatLabel = "Qwen2.5-Coder-3B-Instruct (2.10 GB)";
      thinkModel = "qwen2.5-coder-3b-instruct-q4_k_m.gguf";
      thinkLabel = "Qwen2.5-Coder-3B (Compact Reasoning)";
      nglLayers = 24;
      offloadText = "Partial Vulkan Offload (24 Layers, Rest in RAM)";
      estSpeed = "22 - 35 tokens/sec";
    } else if (vram <= 8) {
      autoModel = "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf";
      autoLabel = "Qwen2.5-Coder-0.5B (FIM, 491 MB)";
      chatModel = "qwen2.5-coder-7b-instruct-q4_k_m.gguf";
      chatLabel = "Qwen2.5-Coder-7B-Instruct (4.68 GB)";
      thinkModel = "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf";
      thinkLabel = "DeepSeek-R1-Distill-Qwen-7B (4.68 GB)";
      nglLayers = 99;
      offloadText = "100% GPU Offload (99 Layers to Vulkan)";
      estSpeed = "38 - 50 tokens/sec";
    } else if (vram <= 12) {
      autoModel = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
      autoLabel = "Qwen2.5-Coder-1.5B (Extended FIM, 1.12 GB)";
      chatModel = "qwen2.5-coder-7b-instruct-q4_k_m.gguf";
      chatLabel = "Qwen2.5-Coder-7B-Instruct (4.68 GB)";
      thinkModel = "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf";
      thinkLabel = "DeepSeek-R1-Distill-Qwen-7B (4.68 GB)";
      nglLayers = 99;
      offloadText = "100% GPU Offload with 4K Autocomplete Buffer";
      estSpeed = "48 - 65 tokens/sec";
    } else if (vram <= 16) {
      autoModel = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
      autoLabel = "Qwen2.5-Coder-1.5B (Extended FIM, 1.12 GB)";
      chatModel = "Qwen3.5-9B-Q4_K_M.gguf";
      chatLabel = "Qwen3.5-9B (Next-Gen Flagship, 5.8 GB)";
      thinkModel = "DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf";
      thinkLabel = "DeepSeek-R1-Distill-Qwen-7B (4.68 GB)";
      nglLayers = 99;
      offloadText = "100% GPU Offload (Full 16K Context in VRAM)";
      estSpeed = "55 - 75 tokens/sec";
    } else {
      // 24GB+
      autoModel = "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf";
      autoLabel = "Qwen2.5-Coder-1.5B (Extended FIM, 1.12 GB)";
      chatModel = "Qwen3.5-9B-Q4_K_M.gguf";
      chatLabel = "Qwen3.5-9B (Flagship, 5.8 GB)";
      thinkModel = "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf";
      thinkLabel = "DeepSeek-R1-Distill-Qwen-14B (8.99 GB Deep Deduction)";
      nglLayers = 99;
      offloadText = "Full Dual 14B High-Reasoning & 1.5B Autocomplete in VRAM";
      estSpeed = "65 - 90+ tokens/sec";
    }

    const recBox = document.getElementById("calc-recommendations-content");
    if (!recBox) return;

    recBox.innerHTML = `
      <div class="model-recommendation-item">
        <div>
          <div style="font-size: 0.78rem; color: var(--accent-cyan); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">Port 8081 • Fast Autocomplete (FIM)</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin-top: 2px;">${autoLabel}</div>
        </div>
        <span class="badge badge-green">Dedicated Server</span>
      </div>

      <div class="model-recommendation-item">
        <div>
          <div style="font-size: 0.78rem; color: var(--accent-blue); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">Port 8080 • Chat & Refactoring (podllama-chat)</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin-top: 2px;">${chatLabel}</div>
        </div>
        <span class="badge badge-blue">Auto-Swapped</span>
      </div>

      <div class="model-recommendation-item">
        <div>
          <div style="font-size: 0.78rem; color: var(--accent-teal); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">Port 8080 • Deep Thinking (podllama-thinking)</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text-primary); margin-top: 2px;">${thinkLabel}</div>
        </div>
        <span class="badge badge-teal">CoT Reasoning</span>
      </div>

      <div style="background: var(--bg-code); padding: 16px; border-radius: 8px; border: 1px solid var(--border-muted); margin-top: 6px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.88rem;">
          <span style="color: var(--text-muted);">Vulkan Layer Offloading:</span>
          <span style="color: var(--accent-green); font-family: var(--font-mono); font-weight: 600;">${offloadText}</span>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 0.88rem;">
          <span style="color: var(--text-muted);">Inference Generation Speed:</span>
          <span style="color: var(--accent-cyan); font-family: var(--font-mono); font-weight: 600;">${estSpeed}</span>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 0.88rem;">
          <span style="color: var(--text-muted);">Idle Memory Footprint:</span>
          <span style="color: var(--accent-teal); font-family: var(--font-mono); font-weight: 600;">${idleVram}</span>
        </div>
      </div>
    `;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.vramCalculator = new VramCalculator();
});