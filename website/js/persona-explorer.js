/**
 * PodLlama 21-Persona Taxonomy Explorer
 * Category Filtering, Live Keyword Search & Interactive Modal Inspector
 * Clean Technical Palette: Blue, Cyan, Emerald.
 */

class PersonaExplorer {
  constructor() {
    this.activeCategory = "all";
    this.searchQuery = "";
    this.personas = PODLLAMA_DATA.personas;
    this.categories = PODLLAMA_DATA.categories;
    this.init();
  }

  init() {
    this.renderCategoryTabs();
    this.renderPersonas();
    this.setupSearch();
    this.setupModal();
  }

  renderCategoryTabs() {
    const container = document.getElementById("category-tabs-container");
    if (!container) return;

    container.innerHTML = this.categories.map(cat => `
      <button class="category-btn ${cat.id === this.activeCategory ? 'active' : ''}" data-cat="${cat.id}">
        <i class="${cat.icon}"></i> ${cat.name}
      </button>
    `).join("");

    container.querySelectorAll(".category-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.activeCategory = btn.dataset.cat;
        this.renderPersonas();
      });
    });
  }

  renderPersonas() {
    const grid = document.getElementById("personas-grid-container");
    if (!grid) return;

    const filtered = this.personas.filter(p => {
      const matchCat = this.activeCategory === "all" || p.category_id === this.activeCategory;
      const q = this.searchQuery.toLowerCase();
      const matchQuery = !q || 
        p.name.toLowerCase().includes(q) || 
        p.slash_command.toLowerCase().includes(q) || 
        p.description.toLowerCase().includes(q) ||
        p.skills.some(s => s.toLowerCase().includes(q));
      return matchCat && matchQuery;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
          <i class="fa-solid fa-user-slash" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
          No personas found matching "<strong>${this.searchQuery}</strong>". Try another keyword or category.
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(p => `
      <div class="persona-card" data-id="${p.id}">
        <div class="persona-card-top">
          <span class="persona-slash">${p.slash_command}</span>
          <span class="badge ${p.target_model === 'podllama-thinking' ? 'badge-cyan' : 'badge-blue'}">
            <i class="${p.target_model === 'podllama-thinking' ? 'fa-solid fa-brain' : 'fa-solid fa-bolt'}"></i> ${p.target_model}
          </span>
        </div>
        <h4 class="persona-name"><i class="${p.icon}" style="color: var(--accent-blue); margin-right: 6px;"></i> ${p.name}</h4>
        <p class="persona-desc">${p.description}</p>
        <div class="persona-skills-preview">
          ${p.skills.slice(0, 3).map(s => `<span class="skill-pill">${s}</span>`).join("")}
          ${p.skills.length > 3 ? `<span class="skill-pill">+${p.skills.length - 3} more</span>` : ''}
        </div>
        <div class="persona-card-footer">
          <span style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono);">${p.category}</span>
          <button class="btn btn-secondary btn-sm inspect-persona-btn" data-id="${p.id}">
            Inspect <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      </div>
    `).join("");

    grid.querySelectorAll(".inspect-persona-btn, .persona-card").forEach(el => {
      el.addEventListener("click", (e) => {
        const id = el.dataset.id || el.closest(".persona-card").dataset.id;
        this.openPersonaModal(id);
      });
    });
  }

  setupSearch() {
    const input = document.getElementById("persona-search-input");
    if (!input) return;

    input.addEventListener("input", (e) => {
      this.searchQuery = e.target.value.trim();
      this.renderPersonas();
    });
  }

  setupModal() {
    const overlay = document.getElementById("persona-modal-overlay");
    const closeBtn = document.getElementById("persona-modal-close");
    if (!overlay || !closeBtn) return;

    closeBtn.addEventListener("click", () => overlay.classList.remove("active"));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("active");
    });
  }

  openPersonaModal(personaId) {
    const persona = this.personas.find(p => p.id === personaId);
    if (!persona) return;

    const overlay = document.getElementById("persona-modal-overlay");
    const body = document.getElementById("persona-modal-body");
    if (!overlay || !body) return;

    body.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: rgba(83, 155, 245, 0.15); display: flex; align-items: center; justify-content: center; color: var(--accent-blue); font-size: 1.3rem;">
            <i class="${persona.icon}"></i>
          </div>
          <div>
            <h3 style="font-size: 1.35rem; font-weight: 700;">${persona.name}</h3>
            <span style="font-size: 0.82rem; color: var(--text-muted); font-family: var(--font-mono);">${persona.category}</span>
          </div>
        </div>
        <span class="persona-slash" style="font-size: 1rem; padding: 4px 12px;">${persona.slash_command}</span>
      </div>

      <p style="color: var(--text-secondary); margin-bottom: 20px; font-size: 0.95rem;">${persona.description}</p>

      <div style="margin-bottom: 20px;">
        <h5 style="font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 10px;">Recommended Target Model</h5>
        <div style="display: flex; align-items: center; gap: 10px; background: var(--bg-code); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-muted);">
          <i class="${persona.target_model === 'podllama-thinking' ? 'fa-solid fa-brain' : 'fa-solid fa-bolt'}" style="color: var(--accent-cyan);"></i>
          <span style="font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); font-size: 0.92rem;">${persona.target_model}</span>
          <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: auto;">(${persona.target_model === 'podllama-thinking' ? 'DeepSeek-R1 Distill 7B/14B' : 'Qwen3.5-9B / 7B'})</span>
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <h5 style="font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 10px;">Actionable Domain Skillset</h5>
        <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px;">
          ${persona.skills.map(s => `
            <li style="display: flex; align-items: flex-start; gap: 8px; font-size: 0.88rem; color: var(--text-secondary);">
              <i class="fa-solid fa-check" style="color: var(--accent-green); margin-top: 4px;"></i> ${s}
            </li>
          `).join("")}
        </ul>
      </div>

      <div style="margin-bottom: 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <h5 style="font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);">Injected System Prompt</h5>
          <button class="btn btn-secondary btn-sm" id="copy-prompt-btn" style="padding: 4px 10px; font-size: 0.78rem;">
            <i class="fa-regular fa-copy"></i> Copy Prompt
          </button>
        </div>
        <pre style="background: var(--bg-code); padding: 14px; border-radius: 8px; border: 1px solid var(--border-muted); font-size: 0.82rem; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word;">${persona.system_prompt}</pre>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 12px;">
        <button class="btn btn-primary btn-sm" id="copy-slash-btn">
          <i class="fa-solid fa-terminal"></i> Copy Shortcut (${persona.slash_command})
        </button>
      </div>
    `;

    document.getElementById("copy-prompt-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(persona.system_prompt);
      if (window.showToast) window.showToast("System prompt copied to clipboard!");
    });

    document.getElementById("copy-slash-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(persona.slash_command);
      if (window.showToast) window.showToast(`Shortcut ${persona.slash_command} copied to clipboard!`);
    });

    overlay.classList.add("active");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  window.personaExplorer = new PersonaExplorer();
});