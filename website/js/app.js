/**
 * PodLlama Master Application Controller
 * Orchestrates Theme Management, Scroll-Spy, Architecture Explorer & Toast System
 * Clean Technical Palette: Blue, Cyan, Emerald, Slate.
 */

class App {
  constructor() {
    this.currentTheme = localStorage.getItem("podllama-theme") || "dark";
    this.init();
  }

  init() {
    this.setupTheme();
    this.setupScrollSpy();
    this.setupCopyButtons();
    this.setupArchitectureExplorer();
    this.renderModelsCatalog();
    this.setupMobileMenu();
  }

  setupTheme() {
    document.documentElement.setAttribute("data-theme", this.currentTheme);
    const themeBtn = document.getElementById("theme-toggle-btn");
    if (!themeBtn) return;

    this.updateThemeIcon(themeBtn);

    themeBtn.addEventListener("click", () => {
      if (this.currentTheme === "dark") {
        this.currentTheme = "cyber";
      } else if (this.currentTheme === "cyber") {
        this.currentTheme = "light";
      } else {
        this.currentTheme = "dark";
      }

      document.documentElement.setAttribute("data-theme", this.currentTheme);
      localStorage.setItem("podllama-theme", this.currentTheme);
      this.updateThemeIcon(themeBtn);
      this.showToast(`Theme switched to: ${this.currentTheme.toUpperCase()}`);
    });
  }

  updateThemeIcon(btn) {
    if (this.currentTheme === "dark") {
      btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
      btn.title = "Theme: Dark Dimmed (Click for Cyber Slate)";
    } else if (this.currentTheme === "cyber") {
      btn.innerHTML = '<i class="fa-solid fa-bolt" style="color: var(--accent-cyan);"></i>';
      btn.title = "Theme: Cyber Slate (Click for Clean Light)";
    } else {
      btn.innerHTML = '<i class="fa-solid fa-sun" style="color: var(--accent-amber);"></i>';
      btn.title = "Theme: Clean Light (Click for Dark Dimmed)";
    }
  }

  setupScrollSpy() {
    const sections = document.querySelectorAll("section[id]");
    const navLinks = document.querySelectorAll(".nav-link");

    window.addEventListener("scroll", () => {
      let currentSection = "";
      const scrollPos = window.scrollY + 120;

      sections.forEach(sec => {
        const top = sec.offsetTop;
        const height = sec.offsetHeight;
        if (scrollPos >= top && scrollPos < top + height) {
          currentSection = sec.getAttribute("id");
        }
      });

      navLinks.forEach(link => {
        link.classList.remove("active");
        if (link.getAttribute("href") === `#${currentSection}`) {
          link.classList.add("active");
        }
      });
    });
  }

  setupCopyButtons() {
    document.querySelectorAll(".copy-btn, [data-copy]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const textToCopy = btn.dataset.copy || btn.parentElement.querySelector("code")?.textContent;
        if (!textToCopy) return;

        navigator.clipboard.writeText(textToCopy);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        btn.classList.add("copied");

        this.showToast(`Copied: "${textToCopy.substring(0, 32)}..."`);

        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove("copied");
        }, 2000);
      });
    });
  }

  setupArchitectureExplorer() {
    const tierCards = document.querySelectorAll(".arch-tier-card");
    const panel = document.getElementById("arch-specs-panel");
    if (!panel || tierCards.length === 0) return;

    tierCards.forEach(card => {
      card.addEventListener("click", () => {
        tierCards.forEach(c => c.classList.remove("active"));
        card.classList.add("active");

        const tierNum = parseInt(card.dataset.tier);
        const tierData = PODLLAMA_DATA.architectureTiers.find(t => t.tier === tierNum);
        if (!tierData) return;

        panel.innerHTML = `
          <div class="arch-detail-header">
            <span class="badge badge-blue" style="margin-bottom: 8px;">Tier ${tierData.tier}</span>
            <h3 style="font-size: 1.3rem; margin-bottom: 6px;">${tierData.name}</h3>
            <p style="font-size: 0.9rem; color: var(--accent-cyan); font-family: var(--font-mono); margin-bottom: 12px;">${tierData.subtitle}</p>
            <p style="font-size: 0.92rem; color: var(--text-secondary); line-height: 1.55;">${tierData.description}</p>
          </div>
          <div class="arch-detail-specs">
            <h4 style="font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 6px;">Layer Specifications</h4>
            ${tierData.specs.map(s => `
              <div class="spec-row">
                <span class="spec-key">${s.key}</span>
                <span class="spec-val">${s.val}</span>
              </div>
            `).join("")}
          </div>
        `;
      });
    });
  }

  renderModelsCatalog() {
    const container = document.getElementById("open-models-catalog");
    if (!container) return;

    container.innerHTML = PODLLAMA_DATA.models.map(m => `
      <div class="feature-card" style="padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div>
            <span class="badge ${m.port === 8081 ? 'badge-green' : 'badge-blue'}" style="margin-bottom: 6px;">
              ${m.role}
            </span>
            <h4 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">${m.name}</h4>
          </div>
          <span class="badge badge-cyan" style="font-family: var(--font-mono);">${m.format}</span>
        </div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 16px;">${m.description}</p>
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; background: var(--bg-code); padding: 12px; border-radius: 8px; border: 1px solid var(--border-muted); margin-bottom: 16px; font-size: 0.82rem;">
          <div><span style="color: var(--text-muted);">Weight Size:</span> <strong style="color: var(--accent-cyan);">${m.size}</strong></div>
          <div><span style="color: var(--text-muted);">VRAM Footprint:</span> <strong style="color: var(--accent-blue);">${m.vram}</strong></div>
          <div><span style="color: var(--text-muted);">Throughput:</span> <strong style="color: var(--accent-green);">${m.speed}</strong></div>
          <div><span style="color: var(--text-muted);">Context:</span> <strong style="color: var(--text-primary);">${m.context}</strong></div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-muted); padding-top: 10px;">
          <span style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono);">Port ${m.port}</span>
          <button class="btn btn-secondary btn-sm copy-model-btn" data-copy="${m.id}" style="padding: 4px 10px; font-size: 0.78rem;">
            <i class="fa-solid fa-download"></i> GGUF Alias
          </button>
        </div>
      </div>
    `).join("");

    container.querySelectorAll(".copy-model-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(btn.dataset.copy);
        this.showToast(`Copied model alias: ${btn.dataset.copy}`);
      });
    });
  }

  setupMobileMenu() {
    const toggle = document.getElementById("mobile-menu-toggle");
    const navLinks = document.getElementById("nav-links");
    if (!toggle || !navLinks) return;

    toggle.addEventListener("click", () => {
      const isVisible = navLinks.style.display === "flex";
      navLinks.style.display = isVisible ? "none" : "flex";
      if (!isVisible) {
        navLinks.style.flexDirection = "column";
        navLinks.style.position = "absolute";
        navLinks.style.top = "var(--nav-height)";
        navLinks.style.left = "0";
        navLinks.style.width = "100%";
        navLinks.style.background = "var(--bg-surface)";
        navLinks.style.padding = "24px";
        navLinks.style.borderBottom = "1px solid var(--border-default)";
      }
    });
  }

  showToast(message) {
    let toast = document.getElementById("global-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "global-toast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--accent-green);"></i> <span>${message}</span>`;
    toast.classList.add("show");

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }
}

window.showToast = (msg) => {
  if (window.app) window.app.showToast(msg);
};

document.addEventListener("DOMContentLoaded", () => {
  window.app = new App();
});