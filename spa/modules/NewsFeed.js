/**
 * NewsFeed Module
 * Handles all news-related functionality: fetching, caching, rendering, formatting
 */

import { getNews } from "../ajax-functions.js";
import { translate } from "../app.js";
import { getCachedData, setCachedData } from "../indexedDB.js";
import { CONFIG } from "../ajax-functions.js";
import { debugLog, debugError } from "../utils/DebugUtils.js";
import { escapeHTML, sanitizeHTML, sanitizeURL } from "../utils/SecurityUtils.js";

export class NewsFeed {
  constructor(app) {
    this.app = app;
    this.newsItems = [];
    this.isLoading = false;
    this.error = null;
  }

  /**
   * Load news from API or cache
   * @param {boolean} force - Force refresh from API
   */
  async load(force = false) {
    if (!force) {
      const cached = await getCachedData("dashboard_news");
      if (cached?.length) {
        this.newsItems = cached;
        this.isLoading = false;
        return;
      }
    }

    this.isLoading = true;
    this.error = null;

    try {
      const res = await getNews();
      this.newsItems = this.normalizeItems(res);
      this.isLoading = false;
      await this.cacheItems();
    } catch (e) {
      this.isLoading = false;
      this.error = translate("news_error");
      debugError("Error loading news:", e);
    }
  }

  /**
   * Normalize news items from API response
   * @param {*} response - Raw API response
   * @returns {Array} Normalized news items
   */
  normalizeItems(response) {
    const list = Array.isArray(response?.news)
      ? response.news
      : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
          ? response
          : [];

    return list.slice(0, 5).map((item, index) => {
      const safeTitle = escapeHTML(
        item.title || item.heading || translate("news_untitled")
      );
      const safeSummary = sanitizeHTML(
        item.summary || item.description || item.content || "",
        { stripAll: true }
      );
      const safeLink = sanitizeURL(item.link || item.url || null);
      const date = item.published_at || item.date || item.created_at || "";

      return {
        id: item.id || `news-${index}`,
        title: safeTitle,
        summary: safeSummary,
        link: safeLink,
        date,
      };
    });
  }

  /**
   * Format news date for display
   * @param {string} raw - Raw date string
   * @returns {string} Formatted date
   */
  formatDate(raw) {
    if (!raw) return "";
    const date = new Date(raw);
    if (isNaN(date)) return "";

    const locale = this.app.currentLanguage || CONFIG.DEFAULT_LANG;
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  /**
   * Cache news items
   */
  async cacheItems() {
    try {
      await setCachedData(
        "dashboard_news",
        this.newsItems,
        CONFIG.CACHE_DURATION.SHORT
      );
    } catch (error) {
      debugError("Error caching news:", error);
    }
  }

  /**
   * Render single news item as HTML
   * @param {Object} item - News item object
   * @returns {string} HTML string
   */
  renderItem(item) {
    const date = this.formatDate(item.date);
    const more = item.link
      ? `<a class="text-link" href="${item.link}" target="_blank" rel="noopener noreferrer">${translate("news_read_more")}</a>`
      : "";

    return `
      <li class="news-item" data-news-id="${item.id}">
        <div class="news-item-header">
          <p class="news-title">${item.title}</p>
          ${date ? `<span class="news-date">${translate("news_published")}: ${date}</span>` : ""}
        </div>
        <p class="news-summary">${item.summary || translate("news_no_summary")}</p>
        ${more}
      </li>
    `;
  }

  /**
   * Render all news items as HTML
   * @returns {string} HTML string
   */
  renderContent() {
    if (this.isLoading && this.newsItems.length === 0) {
      return `<p class="muted-text">${translate("news_loading")}</p>`;
    }

    const error = this.error
      ? `<p class="error-text">${this.error}</p>`
      : "";

    if (this.newsItems.length === 0) {
      return error || `<p class="muted-text">${translate("news_empty")}</p>`;
    }

    return `
      ${error}
      <ul class="news-list">
        ${this.newsItems.map((item) => this.renderItem(item)).join("")}
      </ul>
    `;
  }

  /**
   * Get loading state
   */
  getIsLoading() {
    return this.isLoading;
  }

  /**
   * Get error state
   */
  getError() {
    return this.error;
  }
}
