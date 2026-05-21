/**
 * CommandPalette
 *
 * Dual-form launcher used as Cmd/Ctrl+K on desktop and as a bottom-sheet
 * triggered by the header search icon or the FAB on mobile. Filters the
 * passed list of tiles by translated label, navigates on selection.
 *
 * Usage:
 *   const palette = new CommandPalette(app, tiles);
 *   palette.attachGlobalShortcut();   // wires Cmd/Ctrl+K
 *   palette.open();                   // open programmatically (FAB tap)
 */

import { translate } from "../app.js";
import { setContent } from "../utils/DOMUtils.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { debugLog } from "../utils/DebugUtils.js";

const OVERLAY_ID = "command-palette-overlay";

export class CommandPalette {
  constructor(app, tiles = []) {
    this.app = app;
    this.tiles = tiles;
    this.isOpen = false;
    this._keyHandler = null;
    this._overlay = null;
  }

  /**
   * Replace the tile set (called after permissions change or palette opens).
   */
  setTiles(tiles) {
    this.tiles = tiles;
  }

  attachGlobalShortcut() {
    if (this._keyHandler) return;
    this._keyHandler = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        this.toggle();
        return;
      }
      if (this.isOpen && e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener("keydown", this._keyHandler);
  }

  detach() {
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler);
      this._keyHandler = null;
    }
    this.close();
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "cmd-palette";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", translate("dashboard_search_label"));

    setContent(overlay, `
      <div class="cmd-palette__backdrop" data-close="true"></div>
      <div class="cmd-palette__panel" role="document">
        <div class="cmd-palette__drag-handle" aria-hidden="true"></div>
        <div class="cmd-palette__search">
          <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input
            type="search"
            id="cmd-palette-input"
            class="cmd-palette__input"
            autocomplete="off"
            placeholder="${escapeHTML(translate("dashboard_search_placeholder"))}"
            aria-controls="cmd-palette-results"
          />
          <button type="button" class="cmd-palette__close" data-close="true" aria-label="${escapeHTML(translate("close"))}">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <ul
          id="cmd-palette-results"
          class="cmd-palette__results"
          role="listbox"
          aria-label="${escapeHTML(translate("dashboard_search_results"))}"
        ></ul>
        <div class="cmd-palette__hint" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> ${escapeHTML(translate("dashboard_search_hint_navigate"))}</span>
          <span><kbd>⏎</kbd> ${escapeHTML(translate("dashboard_search_hint_open"))}</span>
          <span><kbd>Esc</kbd> ${escapeHTML(translate("close"))}</span>
        </div>
      </div>
    `);

    document.body.appendChild(overlay);
    this._overlay = overlay;
    document.body.classList.add("cmd-palette-open");

    this._renderResults("");
    this._wireEvents(overlay);

    const input = overlay.querySelector("#cmd-palette-input");
    // Avoid focus jumping the page on mobile
    requestAnimationFrame(() => input?.focus({ preventScroll: true }));
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    document.body.classList.remove("cmd-palette-open");
  }

  _wireEvents(overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) {
        this.close();
      }
    });

    const input = overlay.querySelector("#cmd-palette-input");
    input.addEventListener("input", (e) => {
      this._renderResults(e.target.value);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this._moveActive(e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this._activateSelected();
      }
    });

    overlay.querySelector(".cmd-palette__results").addEventListener("click", (e) => {
      const item = e.target.closest("[data-href]");
      if (!item) return;
      this._navigate(item.dataset.href);
    });
  }

  _filter(query) {
    const q = (query || "").trim().toLocaleLowerCase();
    const scored = this.tiles
      .map((tile) => {
        const label = translate(tile.label).toLocaleLowerCase();
        if (!q) return { tile, score: 0 };
        if (label.startsWith(q)) return { tile, score: 3 };
        if (label.includes(q)) return { tile, score: 2 };
        // Fallback fuzzy: every char present in order
        let i = 0;
        for (const c of label) {
          if (c === q[i]) i++;
          if (i === q.length) break;
        }
        return i === q.length ? { tile, score: 1 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || translate(a.tile.label).localeCompare(translate(b.tile.label)));

    return scored.slice(0, 30).map((r) => r.tile);
  }

  _renderResults(query) {
    const list = this._overlay?.querySelector("#cmd-palette-results");
    if (!list) return;
    const results = this._filter(query);

    if (results.length === 0) {
      setContent(
        list,
        `<li class="cmd-palette__empty">${escapeHTML(translate("dashboard_search_no_results"))}</li>`,
      );
      const input = this._overlay?.querySelector("#cmd-palette-input");
      input?.removeAttribute("aria-activedescendant");
      return;
    }

    const html = results
      .map((tile, idx) => {
        const label = escapeHTML(translate(tile.label));
        const icon = escapeHTML(tile.icon || "fa-circle");
        return `
          <li role="option"
              id="cmd-palette-option-${idx}"
              class="cmd-palette__item${idx === 0 ? " is-active" : ""}"
              aria-selected="${idx === 0 ? "true" : "false"}"
              data-href="${escapeHTML(tile.href)}"
              tabindex="-1">
            <i class="fa-solid ${icon}" aria-hidden="true"></i>
            <span>${label}</span>
            <span class="cmd-palette__path">${escapeHTML(tile.href)}</span>
          </li>
        `;
      })
      .join("");
    setContent(list, html);
    const input = this._overlay?.querySelector("#cmd-palette-input");
    input?.setAttribute("aria-activedescendant", "cmd-palette-option-0");
  }

  _moveActive(delta) {
    const items = this._overlay?.querySelectorAll(".cmd-palette__item") || [];
    if (!items.length) return;
    let idx = Array.from(items).findIndex((el) => el.classList.contains("is-active"));
    items[idx]?.classList.remove("is-active");
    items[idx]?.setAttribute("aria-selected", "false");
    idx = (idx + delta + items.length) % items.length;
    items[idx].classList.add("is-active");
    items[idx].setAttribute("aria-selected", "true");
    const input = this._overlay?.querySelector("#cmd-palette-input");
    if (items[idx].id) {
      input?.setAttribute("aria-activedescendant", items[idx].id);
    }
    items[idx].scrollIntoView({ block: "nearest" });
  }

  _activateSelected() {
    const active = this._overlay?.querySelector(".cmd-palette__item.is-active");
    if (active) this._navigate(active.dataset.href);
  }

  _navigate(href) {
    this.close();
    debugLog("CommandPalette navigate:", href);
    if (this.app?.router?.navigate) {
      this.app.router.navigate(href);
    } else {
      window.location.href = href;
    }
  }
}
