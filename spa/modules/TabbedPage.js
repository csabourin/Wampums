/**
 * TabbedPage
 *
 * Hosts several existing page modules under one route, one heading and one tab
 * bar. Used to merge dashboard destinations that were only ever separate
 * because they happened to be written as separate files — "Suivre les badges"
 * and "Étapes du programme" are two views of progression, not two places.
 *
 * The shell owns `#app`; each tab's module renders into the panel below the tab
 * bar and must follow the `spa/utils/PageMount.js` contract. Modules are
 * imported lazily, so opening a tabbed page costs no more than opening the
 * single page it replaced.
 *
 * Usage:
 *   const page = new TabbedPage(app, TABBED_PAGES.progression);
 *   await page.init();
 */

import { translate } from "../app.js";
import { setContent } from "../utils/DOMUtils.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import { debugLog, debugError } from "../utils/DebugUtils.js";
import { BaseModule } from "../utils/BaseModule.js";

const PANEL_ID = "tabbed-page-panel";

export class TabbedPage extends BaseModule {
  /**
   * @param {Object} app - Application instance.
   * @param {Object} config - One entry from `spa/config/tabbed-pages.js`.
   */
  constructor(app, config) {
    super(app);
    this.config = config;
    this.tabs = (config.tabs || []).filter((tab) => !tab.gate || tab.gate());
    this.activeKey = null;
    this.activeModule = null;
  }

  async init() {
    if (!this.tabs.length) {
      this.renderEmpty();
      return;
    }

    this.activeKey = this.resolveInitialTab();
    this.render();
    this.attachEventListeners();
    await this.mountActiveTab();
  }

  /**
   * Pick the tab to open: `?tab=` when it names a tab this user can see,
   * otherwise the configured default, otherwise the first visible tab.
   *
   * @returns {string} Tab key.
   */
  resolveInitialTab() {
    let requested = null;
    try {
      requested = new URL(window.location.href).searchParams.get("tab");
    } catch (error) {
      debugLog("Could not read tab from URL:", error);
    }

    if (requested && this.tabs.some((tab) => tab.key === requested)) {
      return requested;
    }
    if (this.tabs.some((tab) => tab.key === this.config.defaultTab)) {
      return this.config.defaultTab;
    }
    return this.tabs[0].key;
  }

  render() {
    const tabsHtml = this.tabs
      .map((tab) => {
        const isActive = tab.key === this.activeKey;
        return `
          <button type="button"
                  class="tabbed-page__tab${isActive ? " is-active" : ""}"
                  role="tab"
                  id="tabbed-page-tab-${escapeHTML(tab.key)}"
                  aria-selected="${isActive}"
                  aria-controls="${PANEL_ID}"
                  tabindex="${isActive ? "0" : "-1"}"
                  data-tab="${escapeHTML(tab.key)}">
            ${escapeHTML(translate(tab.labelKey))}
          </button>
        `;
      })
      .join("");

    setContent(
      document.getElementById("app"),
      `
      <section class="tabbed-page">
        <header class="tabbed-page__header">
          <a href="/dashboard" class="button button--ghost">← ${escapeHTML(translate("back"))}</a>
          <h1>${escapeHTML(translate(this.config.titleKey))}</h1>
        </header>
        <div class="tabbed-page__tabs" role="tablist" aria-label="${escapeHTML(translate(this.config.titleKey))}">
          ${tabsHtml}
        </div>
        <div id="${PANEL_ID}" class="tabbed-page__panel" role="tabpanel" aria-live="polite"></div>
      </section>
    `,
    );
  }

  renderEmpty() {
    setContent(
      document.getElementById("app"),
      `
      <section class="tabbed-page">
        <header class="tabbed-page__header">
          <a href="/dashboard" class="button button--ghost">← ${escapeHTML(translate("back"))}</a>
          <h1>${escapeHTML(translate(this.config.titleKey))}</h1>
        </header>
        <p class="empty-state">${escapeHTML(translate("no_access"))}</p>
      </section>
    `,
    );
  }

  attachEventListeners() {
    document.querySelectorAll(".tabbed-page__tab").forEach((button) => {
      this.addEventListener(button, "click", () => {
        this.switchTo(button.dataset.tab);
      });
      this.addEventListener(button, "keydown", (event) => {
        this.handleTabKeydown(event);
      });
    });
  }

  /**
   * Left/right arrows move between tabs, per the ARIA tabs pattern.
   *
   * @param {KeyboardEvent} event
   */
  handleTabKeydown(event) {
    const delta = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!delta) return;

    event.preventDefault();
    const index = this.tabs.findIndex((tab) => tab.key === this.activeKey);
    const next = this.tabs[(index + delta + this.tabs.length) % this.tabs.length];
    this.switchTo(next.key);
    document.getElementById(`tabbed-page-tab-${next.key}`)?.focus();
  }

  /**
   * @param {string} key - Tab to activate.
   */
  async switchTo(key) {
    if (!key || key === this.activeKey) return;
    if (!this.tabs.some((tab) => tab.key === key)) return;

    this.activeKey = key;
    this.syncUrl(key);
    this.render();
    this.attachEventListeners();
    await this.mountActiveTab();
  }

  /**
   * Reflect the active tab in the URL without adding a history entry per click.
   *
   * @param {string} key
   */
  syncUrl(key) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", key);
      window.history.replaceState({}, "", url);
    } catch (error) {
      debugLog("Could not sync tab to URL:", error);
    }
  }

  /**
   * Tear down the previous tab's module and mount the active one.
   *
   * A tab that fails to load must not take the whole page down: the shell and
   * the other tabs stay usable and the failure is shown inside the panel.
   */
  async mountActiveTab() {
    this.destroyActiveModule();

    const tab = this.tabs.find((t) => t.key === this.activeKey);
    if (!tab) return;

    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    setContent(panel, `<p class="loading-state">${escapeHTML(translate("loading"))}</p>`);

    try {
      const PageClass = await tab.load();
      // The tab may have changed while the import was in flight.
      if (this.isDestroyed || this.activeKey !== tab.key) return;

      const instance = new PageClass(this.app, {
        ...(tab.options || {}),
        containerId: PANEL_ID,
        embedded: true,
      });
      this.activeModule = instance;
      await instance.init();
      debugLog(`TabbedPage mounted tab "${tab.key}"`);
    } catch (error) {
      debugError(`Failed to mount tab "${tab.key}":`, error);
      if (this.activeKey !== tab.key) return;
      const target = document.getElementById(PANEL_ID);
      if (target) {
        setContent(target, `<p class="error-message">${escapeHTML(translate("error_loading_data"))}</p>`);
      }
    }
  }

  destroyActiveModule() {
    if (!this.activeModule) return;
    try {
      this.activeModule.destroy?.();
    } catch (error) {
      debugError("Error destroying tab module:", error);
    }
    this.activeModule = null;
  }

  destroy() {
    super.destroy();
    this.destroyActiveModule();
  }
}
