/**
 * PodLlama Privacy & Open Architecture Threat Inspector
 * Interactive comparison between 100% Local Sandboxing vs Cloud API Vulnerabilities
 */

class PrivacyInspector {
  constructor() {
    this.threatVectors = [
      {
        id: "source-code-retention",
        title: "Proprietary Code & IP Transmission",
        local: "Zero bytes leave your host machine. Inference, context indexing, and completions execute 100% in local memory.",
        cloud: "Full file contents, ASTs, and git history are sent over public internet to remote cloud servers for embedding and generation.",
        status: "safe"
      },
      {
        id: "secrets-leakage",
        title: "Workspace Secrets & API Keys Exposure",
        local: "SELinux volume scoping (:Z, :ro,Z) and rootless user mapping ensure container processes cannot read external ssh keys or credentials.",
        cloud: "Unvetted context aggregators frequently capture .env files, credentials, and API keys inside model context buffers.",
        status: "safe"
      },
      {
        id: "offline-continuity",
        title: "Air-Gapped & Offline Reliability",
        local: "Fully functional with zero active internet connection. Perfect for air-gapped defense, aerospace, financial, and offline travel setups.",
        cloud: "Instant failure upon loss of internet connectivity, ISP routing outages, or cloud provider rate-limit throttling.",
        status: "safe"
      },
      {
        id: "vendor-lockin",
        title: "Cross-Vendor Hardware Independence",
        local: "Open Vulkan acceleration runs natively on Intel Arc / Iris Xe, AMD Radeon, and NVIDIA GPUs without proprietary CUDA drivers.",
        cloud: "Tied to single cloud provider billing tiers, closed API changes, and proprietary runtime licensing.",
        status: "safe"
      },
      {
        id: "agent-sandboxing",
        title: "Agent Execution & Privilege Isolation",
        local: "Terminal agents (pi.dev / OMP) run inside rootless Podman containers (--userns=keep-id) strictly confined to active project root.",
        cloud: "Desktop agent extensions frequently run with full host user root/admin privileges across entire disk filesystems.",
        status: "safe"
      },
      {
        id: "model-weight-audit",
        title: "Open Weights & Cryptographic Verification",
        local: "Every GGUF model is SHA256-verified upon download. Inspect open weights without silent behavioral model deprecation.",
        cloud: "Black-box models modified or swapped silently by providers without developer knowledge or reproducible weights.",
        status: "safe"
      }
    ];
    this.init();
  }

  init() {
    this.renderThreatMatrix();
  }

  renderThreatMatrix() {
    const container = document.getElementById("privacy-threat-matrix");
    if (!container) return;

    container.innerHTML = this.threatVectors.map(v => `
      <div style="background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 20px; margin-bottom: 16px;">
        <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <span>${v.title}</span>
          <span class="badge badge-green"><i class="fa-solid fa-shield-check"></i> PodLlama Sovereign</span>
        </h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <div style="background: rgba(87, 171, 90, 0.08); border-left: 3px solid var(--accent-green); padding: 12px; border-radius: 4px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--accent-green); text-transform: uppercase; margin-bottom: 4px;">
              <i class="fa-solid fa-lock"></i> PodLlama Local Container
            </div>
            <p style="font-size: 0.88rem; color: var(--text-secondary); margin: 0;">${v.local}</p>
          </div>
          <div style="background: rgba(244, 112, 103, 0.08); border-left: 3px solid var(--accent-red); padding: 12px; border-radius: 4px;">
            <div style="font-size: 0.78rem; font-weight: 700; color: var(--accent-red); text-transform: uppercase; margin-bottom: 4px;">
              <i class="fa-solid fa-cloud-arrow-up"></i> Cloud AI APIs (Copilot/Cursor)
            </div>
            <p style="font-size: 0.88rem; color: var(--text-muted); margin: 0;">${v.cloud}</p>
          </div>
        </div>
      </div>
    `).join("");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.privacyInspector = new PrivacyInspector();
});