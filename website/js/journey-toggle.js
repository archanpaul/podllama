/**
 * PodLlama Interactive Journey Switcher
 * Visual comparison between Local Sovereign Flow and Cloud AI API Risks
 */

class JourneyToggle {
  constructor() {
    this.mode = "podllama";
    this.init();
  }

  init() {
    this.render();
    this.setupListeners();
  }

  setupListeners() {
    const btnPod = document.getElementById("toggle-journey-podllama");
    const btnCloud = document.getElementById("toggle-journey-cloud");

    if (btnPod && btnCloud) {
      btnPod.addEventListener("click", () => {
        if (this.mode === "podllama") return;
        this.mode = "podllama";
        btnCloud.classList.remove("active");
        btnPod.classList.add("active");
        this.render();
      });

      btnCloud.addEventListener("click", () => {
        if (this.mode === "cloud") return;
        this.mode = "cloud";
        btnPod.classList.remove("active");
        btnCloud.classList.add("active");
        this.render();
      });
    }
  }

  render() {
    const container = document.getElementById("journey-flow-cards");
    if (!container) return;

    if (this.mode === "podllama") {
      container.innerHTML = `
        <div class="flow-step-card" style="border-color: rgba(86, 211, 100, 0.35); background: rgba(86, 211, 100, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(86, 211, 100, 0.2); color: var(--accent-green);">1</div>
            <i class="fa-solid fa-laptop-code" style="color: var(--accent-green);"></i>
          </div>
          <div class="flow-step-title">1. Local Host Workspace</div>
          <div class="flow-step-desc">Your source code, secrets, and git history never leave your workstation. 100% air-gapped ready.</div>
        </div>

        <div class="flow-step-card" style="border-color: rgba(86, 211, 100, 0.35); background: rgba(86, 211, 100, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(86, 211, 100, 0.2); color: var(--accent-green);">2</div>
            <i class="fa-solid fa-network-wired" style="color: var(--accent-cyan);"></i>
          </div>
          <div class="flow-step-title">2. Port 4000 LiteLLM Router</div>
          <div class="flow-step-desc">Dispatches FIM autocomplete to Port 8081 and deep reasoning / chat to Port 8080 instantaneously.</div>
        </div>

        <div class="flow-step-card" style="border-color: rgba(86, 211, 100, 0.35); background: rgba(86, 211, 100, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(86, 211, 100, 0.2); color: var(--accent-green);">3</div>
            <i class="fa-solid fa-microchip" style="color: var(--accent-blue);"></i>
          </div>
          <div class="flow-step-title">3. Universal Vulkan GPU</div>
          <div class="flow-step-desc">Hardware layer offload (-ngl 99) accelerates natively on Intel Arc, AMD Radeon, or NVIDIA GPUs.</div>
        </div>

        <div class="flow-step-card" style="border-color: rgba(86, 211, 100, 0.35); background: rgba(86, 211, 100, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(86, 211, 100, 0.2); color: var(--accent-green);">4</div>
            <i class="fa-solid fa-power-off" style="color: var(--accent-teal);"></i>
          </div>
          <div class="flow-step-title">4. 0 MB Idle Auto-Stop</div>
          <div class="flow-step-desc">After 10m idle, LLM processes automatically terminate, releasing 100% of VRAM for your games & apps.</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="flow-step-card" style="border-color: rgba(248, 81, 73, 0.35); background: rgba(248, 81, 73, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(248, 81, 73, 0.2); color: var(--accent-red);">1</div>
            <i class="fa-solid fa-cloud-arrow-up" style="color: var(--accent-red);"></i>
          </div>
          <div class="flow-step-title">1. Public Internet Upload</div>
          <div class="flow-step-desc">Source files, AST context, and active buffers are serialized and transmitted over WAN to external servers.</div>
        </div>

        <div class="flow-step-card" style="border-color: rgba(248, 81, 73, 0.35); background: rgba(248, 81, 73, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(248, 81, 73, 0.2); color: var(--accent-red);">2</div>
            <i class="fa-solid fa-server" style="color: var(--accent-red);"></i>
          </div>
          <div class="flow-step-title">2. Remote Cloud Storage</div>
          <div class="flow-step-desc">Proprietary IP and context logs are processed on multi-tenant cloud servers subject to remote policies.</div>
        </div>

        <div class="flow-step-card" style="border-color: rgba(248, 81, 73, 0.35); background: rgba(248, 81, 73, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(248, 81, 73, 0.2); color: var(--accent-red);">3</div>
            <i class="fa-solid fa-receipt" style="color: var(--accent-amber);"></i>
          </div>
          <div class="flow-step-title">3. Per-Token Metering</div>
          <div class="flow-step-desc">Monthly SaaS subscriptions, token throttling, rate limits, and vendor billing spikes.</div>
        </div>

        <div class="flow-step-card" style="border-color: rgba(248, 81, 73, 0.35); background: rgba(248, 81, 73, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div class="flow-step-badge" style="background: rgba(248, 81, 73, 0.2); color: var(--accent-red);">4</div>
            <i class="fa-solid fa-plane-slash" style="color: var(--accent-red);"></i>
          </div>
          <div class="flow-step-title">4. Offline Breakage</div>
          <div class="flow-step-desc">Complete loss of AI assistance on flights, trains, VPN outages, or air-gapped development labs.</div>
        </div>
      `;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.journeyToggle = new JourneyToggle();
});