// ─────────────────────────────────────────────────────────────
//  PTMS – EmailSettingsPanel component
//
//  Replaces the semicolon-separated text inputs with a
//  chip/tag UI: type an address → press Enter or Add → chip
//  appears; click ✕ on a chip to remove it.
//
//  Usage (replace your existing email settings section):
//
//    import { EmailSettingsPanel } from "./EmailSettingsPanel.js";
//
//    // Inside your admin page render:
//    <EmailSettingsPanel
//      config={emailConfig}          // { onDispatch:{to:[],cc:[]}, … }
//      onSave={handleSaveConfig}     // async (config) => void
//    />
//
//  The component is framework-agnostic vanilla JS / Web Component.
//  If you use a framework (React/Vue/Svelte) adapt the render()
//  section to match – the logic is identical.
// ─────────────────────────────────────────────────────────────

// ── Vanilla-JS Web Component version ────────────────────────
//    Drop <email-settings-panel> anywhere in your HTML once
//    you've called EmailSettingsPanel.register().
// ────────────────────────────────────────────────────────────

export class EmailSettingsPanel extends HTMLElement {

  // Public API ───────────────────────────────────────────────
  static register() {
    if (!customElements.get("email-settings-panel"))
      customElements.define("email-settings-panel", EmailSettingsPanel);
  }

  /** @param {{ onDispatch:{to:string[],cc:string[]}, onReceipt:{to:string[],cc:string[]}, onDiscrepancy:{to:string[],cc:string[]} }} config */
  set config(val) {
    this._config = this._normalise(val);
    this._render();
  }
  get config() { return this._config; }

  /** @param {(config) => Promise<void>} fn */
  set onSave(fn) { this._onSave = fn; }

  // Lifecycle ────────────────────────────────────────────────
  connectedCallback() {
    this._config   = this._normalise({});
    this._pending  = {};   // draft state before save
    this._inputs   = {};   // { "onDispatch-to": "", … }
    this._render();
  }

  // Helpers ──────────────────────────────────────────────────
  _normalise(cfg = {}) {
    const def = { to: [], cc: [] };
    return {
      onDispatch:    { ...def, ...(cfg.onDispatch    || {}) },
      onReceipt:     { ...def, ...(cfg.onReceipt     || {}) },
      onDiscrepancy: { ...def, ...(cfg.onDiscrepancy || {}) },
    };
  }

  _toArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.filter(Boolean);
    return String(val).split(/[,;]+/).map(v => v.trim()).filter(Boolean);
  }

  _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  // ── State mutators ─────────────────────────────────────────
  _addChip(eventKey, field, raw) {
    const emails = raw.split(/[,;\s]+/).map(e => e.trim()).filter(this._isValidEmail.bind(this));
    if (!emails.length) return false;
    const existing = this._toArray(this._config[eventKey][field]);
    const merged   = [...new Set([...existing, ...emails])];
    this._config[eventKey][field] = merged;
    return true;
  }

  _removeChip(eventKey, field, email) {
    this._config[eventKey][field] = this._toArray(this._config[eventKey][field])
      .filter(e => e !== email);
    this._render();
  }

  // ── Render ─────────────────────────────────────────────────
  _render() {
    this.innerHTML = "";
    this.appendChild(this._buildStyles());
    this.appendChild(this._buildPanel());
    this._attachListeners();
  }

  _buildStyles() {
    const s = document.createElement("style");
    s.textContent = `
      email-settings-panel * { box-sizing: border-box; }

      .esp-wrap {
        font-family: 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 14px;
        color: #1f2937;
      }
      .esp-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        font-weight: 700;
        color: #1e3a5f;
        margin-bottom: 4px;
      }
      .esp-subtext {
        font-size: 12.5px;
        color: #6b7280;
        margin-bottom: 20px;
        line-height: 1.5;
      }
      .esp-subtext strong { color: #3b82f6; }

      /* ── Event section ── */
      .esp-section {
        border: 1.5px solid #e5e7eb;
        border-radius: 14px;
        overflow: hidden;
        margin-bottom: 16px;
        background: #fff;
        box-shadow: 0 1px 4px rgba(0,0,0,.05);
      }
      .esp-section-header {
        background: #f8faff;
        border-bottom: 1.5px solid #e5e7eb;
        padding: 12px 18px;
        font-size: 13px;
        font-weight: 700;
        color: #374151;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .esp-fields { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }

      /* ── Field label ── */
      .esp-field-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .05em;
        text-transform: uppercase;
        color: #6b7280;
        margin-bottom: 6px;
      }
      .esp-field-label span {
        font-weight: 400;
        color: #9ca3af;
        text-transform: none;
        letter-spacing: 0;
        margin-left: 4px;
      }

      /* ── Chip input box ── */
      .esp-chip-box {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        min-height: 42px;
        border: 1.5px solid #d1d5db;
        border-radius: 10px;
        padding: 6px 8px;
        background: #fff;
        transition: border-color .2s;
        cursor: text;
      }
      .esp-chip-box:focus-within { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.12); }

      /* ── Chip ── */
      .esp-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #eff6ff;
        color: #1d4ed8;
        border: 1px solid #bfdbfe;
        border-radius: 50px;
        padding: 3px 10px 3px 12px;
        font-size: 12.5px;
        font-weight: 500;
        white-space: nowrap;
        max-width: 280px;
      }
      .esp-chip span { overflow: hidden; text-overflow: ellipsis; }
      .esp-chip button {
        background: none;
        border: none;
        cursor: pointer;
        color: #93c5fd;
        font-size: 14px;
        line-height: 1;
        padding: 0;
        display: flex;
        align-items: center;
        transition: color .15s;
      }
      .esp-chip button:hover { color: #1d4ed8; }

      /* ── Inline text input ── */
      .esp-chip-input {
        border: none;
        outline: none;
        font-size: 13px;
        color: #1f2937;
        flex: 1;
        min-width: 180px;
        background: transparent;
        padding: 2px 4px;
      }
      .esp-chip-input::placeholder { color: #9ca3af; }

      /* ── Add button ── */
      .esp-add-btn {
        background: #eff6ff;
        color: #1d4ed8;
        border: 1.5px solid #bfdbfe;
        border-radius: 7px;
        padding: 4px 11px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: background .15s, border-color .15s;
        flex-shrink: 0;
      }
      .esp-add-btn:hover { background: #dbeafe; border-color: #93c5fd; }

      /* ── Validation hint ── */
      .esp-hint { font-size: 11.5px; color: #ef4444; margin-top: 4px; min-height: 16px; }

      /* ── Save button ── */
      .esp-save-row { display: flex; justify-content: flex-end; margin-top: 4px; }
      .esp-save-btn {
        background: linear-gradient(135deg, #1d4ed8, #2563eb);
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 10px 26px;
        font-size: 13.5px;
        font-weight: 700;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 7px;
        transition: opacity .15s, transform .1s;
        box-shadow: 0 2px 8px rgba(29,78,216,.35);
      }
      .esp-save-btn:hover  { opacity: .92; transform: translateY(-1px); }
      .esp-save-btn:active { transform: translateY(0); }
      .esp-save-btn:disabled { opacity: .55; cursor: not-allowed; transform: none; }
      .esp-toast {
        display: inline-flex; align-items: center; gap: 6px;
        background: #dcfce7; color: #15803d;
        border: 1px solid #86efac; border-radius: 8px;
        padding: 8px 14px; font-size: 13px; font-weight: 600;
        margin-top: 10px;
        animation: esp-fade-in .25s ease;
      }
      @keyframes esp-fade-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
    `;
    return s;
  }

  _buildPanel() {
    const wrap = document.createElement("div");
    wrap.className = "esp-wrap";

    wrap.innerHTML = `
      <div class="esp-header">
        <span style="width:10px;height:10px;border-radius:50%;background:#3b82f6;display:inline-block"></span>
        Email Notification Settings
      </div>
      <p class="esp-subtext">
        Emails are sent via <strong>Gmail SMTP</strong> using your 16-digit App Password,
        securely stored in Firebase Cloud Functions (never in the browser).<br>
        <strong>Plant contact</strong> emails are added automatically from each plant's profile.
        Add extra recipients below — press <kbd style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:4px;padding:1px 5px;font-size:11px">Enter</kbd> or click <strong>+ Add</strong>.
      </p>
    `;

    const sections = [
      { key: "onDispatch",    icon: "🚚", label: "On Dispatch Created" },
      { key: "onReceipt",     icon: "✅", label: "On Receipt Confirmed" },
      { key: "onDiscrepancy", icon: "⚠️", label: "On Discrepancy Detected" },
    ];

    for (const { key, icon, label } of sections) {
      wrap.appendChild(this._buildSection(key, icon, label));
    }

    // Save button + toast
    const saveRow = document.createElement("div");
    saveRow.className = "esp-save-row";
    saveRow.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0">
        <button class="esp-save-btn" id="esp-save-btn">
          💾 Save Email Settings
        </button>
        <div id="esp-toast" style="display:none" class="esp-toast">✅ Settings saved!</div>
      </div>
    `;
    wrap.appendChild(saveRow);

    return wrap;
  }

  _buildSection(eventKey, icon, label) {
    const sec = document.createElement("div");
    sec.className = "esp-section";

    sec.innerHTML = `
      <div class="esp-section-header">${icon} ${label}</div>
      <div class="esp-fields">
        ${this._buildField(eventKey, "to",  "TO", "Required recipients — at least one address")}
        ${this._buildField(eventKey, "cc",  "CC", "Optional — receives a copy")}
      </div>
    `;
    return sec;
  }

  _buildField(eventKey, field, labelText, hint) {
    const id      = `esp-${eventKey}-${field}`;
    const chips   = this._toArray(this._config[eventKey][field]);
    const chipsHtml = chips.map(email => this._chipHtml(eventKey, field, email)).join("");

    return `
      <div>
        <div class="esp-field-label">${labelText} <span>(${hint})</span></div>
        <div class="esp-chip-box" id="${id}-box">
          ${chipsHtml}
          <input
            class="esp-chip-input"
            id="${id}-input"
            type="email"
            multiple
            placeholder="name@company.com"
            autocomplete="off"
            data-event="${eventKey}"
            data-field="${field}"
          />
          <button class="esp-add-btn" data-event="${eventKey}" data-field="${field}" data-action="add">+ Add</button>
        </div>
        <div class="esp-hint" id="${id}-hint"></div>
      </div>
    `;
  }

  _chipHtml(eventKey, field, email) {
    return `<span class="esp-chip" data-event="${eventKey}" data-field="${field}" data-email="${email}">
      <span title="${email}">${email}</span>
      <button type="button" aria-label="Remove ${email}" data-action="remove" data-event="${eventKey}" data-field="${field}" data-email="${email}">✕</button>
    </span>`;
  }

  // ── Event wiring ───────────────────────────────────────────
  _attachListeners() {

    // Remove chip
    this.querySelectorAll("[data-action='remove']").forEach(btn => {
      btn.addEventListener("click", e => {
        const { event: eventKey, field, email } = e.currentTarget.dataset;
        this._removeChip(eventKey, field, email);
      });
    });

    // Add button
    this.querySelectorAll("[data-action='add']").forEach(btn => {
      btn.addEventListener("click", e => {
        const { event: eventKey, field } = e.currentTarget.dataset;
        this._tryAddFromInput(eventKey, field);
      });
    });

    // Enter key in input
    this.querySelectorAll(".esp-chip-input").forEach(input => {
      input.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          const { event: eventKey, field } = input.dataset;
          this._tryAddFromInput(eventKey, field);
        }
      });
      // Clear hint on typing
      input.addEventListener("input", e => {
        const { event: eventKey, field } = input.dataset;
        this.querySelector(`#esp-${eventKey}-${field}-hint`).textContent = "";
      });
      // Click on chip-box focuses the input
      const box = this.querySelector(`#esp-${input.dataset.event}-${input.dataset.field}-box`);
      if (box) box.addEventListener("click", ev => {
        if (!ev.target.closest(".esp-chip")) input.focus();
      });
    });

    // Save
    const saveBtn = this.querySelector("#esp-save-btn");
    if (saveBtn) saveBtn.addEventListener("click", () => this._handleSave());
  }

  _tryAddFromInput(eventKey, field) {
    const input   = this.querySelector(`#esp-${eventKey}-${field}-input`);
    const hint    = this.querySelector(`#esp-${eventKey}-${field}-hint`);
    const raw     = input.value.trim();
    if (!raw) return;

    const invalid = raw.split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(e => e && !this._isValidEmail(e));

    if (invalid.length) {
      hint.textContent = `Invalid email: ${invalid.join(", ")}`;
      return;
    }

    const added = this._addChip(eventKey, field, raw);
    if (added) {
      input.value = "";
      hint.textContent = "";
      this._render();
      // Restore focus after re-render
      this.querySelector(`#esp-${eventKey}-${field}-input`)?.focus();
    }
  }

  async _handleSave() {
    const btn   = this.querySelector("#esp-save-btn");
    const toast = this.querySelector("#esp-toast");
    btn.disabled = true;
    btn.textContent = "Saving…";

    try {
      if (typeof this._onSave === "function") {
        await this._onSave(this._config);
      }
      toast.style.display = "inline-flex";
      setTimeout(() => { toast.style.display = "none"; }, 3000);
    } catch (e) {
      alert("Failed to save: " + e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = "💾 Save Email Settings";
    }
  }
}

// Auto-register if running in a browser
if (typeof customElements !== "undefined") {
  EmailSettingsPanel.register();
}
