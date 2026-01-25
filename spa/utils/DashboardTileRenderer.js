/**
 * DashboardTileRenderer
 * Handles tile filtering, sorting, and HTML rendering
 * Encapsulates all tile-rendering logic in one place
 */

import { translate } from "../app.js";
import { debugError } from "./DebugUtils.js";
import { hasPermission, hasAnyPermission } from "./PermissionUtils.js";

export class DashboardTileRenderer {
  /**
   * Filter tiles based on permissions
   * @param {Array} tiles - Array of tile objects
   * @returns {Array} Filtered tiles
   */
  static filterByPermission(tiles) {
    return tiles.filter((tile) => {
      if (!tile.permission) return true;

      // Check if permission is an array (multiple permissions, any match)
      if (Array.isArray(tile.permission)) {
        return hasAnyPermission(...tile.permission);
      }

      // Single permission
      return hasPermission(tile.permission);
    });
  }

  /**
   * Sort tiles alphabetically by translated label
   * @param {Array} tiles - Array of tile objects
   * @returns {Array} Sorted tiles
   */
  static sortByLabel(tiles) {
    return tiles.slice().sort((a, b) => {
      const labelA = translate(a.label).toLocaleLowerCase();
      const labelB = translate(b.label).toLocaleLowerCase();
      return labelA.localeCompare(labelB);
    });
  }

  /**
   * Process tiles: filter by permission and sort by label
   * @param {Array} tiles - Array of tile objects
   * @param {boolean} shouldSort - Whether to sort tiles
   * @returns {Array} Processed tiles
   */
  static processTiles(tiles, shouldSort = true) {
    const filtered = this.filterByPermission(tiles);
    return shouldSort ? this.sortByLabel(filtered) : filtered;
  }

  /**
   * Render a single tile as HTML
   * @param {Object} tile - Tile object with href, icon, label, optional id
   * @returns {string} HTML string
   */
  static renderTile(tile) {
    const idAttr = tile.id ? ` id="${tile.id}"` : "";
    const label = translate(tile.label);

    return `<a href="${tile.href}"${idAttr}><i class="fa-solid ${tile.icon}"></i><span>${label}</span></a>`;
  }

  /**
   * Render a group of tiles
   * @param {Array} tiles - Array of tile objects
   * @returns {string} HTML string for all tiles
   */
  static renderTiles(tiles) {
    return tiles.map((tile) => this.renderTile(tile)).join("\n");
  }

  /**
   * Render a complete section with heading and tiles
   * @param {string} headingKey - Translation key for heading
   * @param {Array} tiles - Array of tile objects
   * @returns {string} HTML string for the section
   */
  static renderSection(headingKey, tiles) {
    if (!tiles.length) return "";

    const heading = translate(headingKey);
    const tilesHtml = this.renderTiles(tiles);

    return `
      <section class="dashboard-section">
        <h3>${heading}</h3>
        <div class="manage-items">
          ${tilesHtml}
        </div>
      </section>
    `;
  }

  /**
   * Render top row tiles (no sorting, no permission filtering)
   * @param {Array} tiles - Array of tile objects
   * @returns {string} HTML string
   */
  static renderTopRow(tiles) {
    return `
      <div class="dashboard-section">
        <div class="manage-items">
          ${this.renderTiles(tiles)}
        </div>
      </div>
    `;
  }
}
