/**
 * Page mount contract.
 *
 * Historically every page module rendered straight into `#app`, which made it
 * impossible to host two of them side by side. A page that opts into this
 * contract can be rendered either standalone (the router owns `#app`) or
 * embedded inside another page, such as a `TabbedPage` panel.
 *
 * A page opts in with two lines in its constructor:
 *
 * ```javascript
 * constructor(app, options = {}) {
 *   this.app = app;
 *   Object.assign(this, resolveMountOptions(options));
 * }
 * ```
 *
 * then renders into `getMountPoint(this)` instead of
 * `document.getElementById("app")`, and skips its own back link and `<h1>`
 * when `this.embedded` is true — the host already draws them.
 *
 * @module utils/PageMount
 */

import { debugWarn } from "./DebugUtils.js";

export const APP_CONTAINER_ID = "app";

/**
 * Resolve the element a page should render into.
 *
 * Falls back to `#app` when the requested container is gone: a host can be torn
 * down by navigation while an in-flight fetch is still pending, and a page that
 * silently renders nowhere is far harder to diagnose than one that renders in
 * the wrong place.
 *
 * @param {{containerId?: string}} page - Page instance, or any object carrying `containerId`.
 * @returns {HTMLElement|null} The mount element, or null when even `#app` is missing.
 */
export function getMountPoint(page) {
  const id = page?.containerId || APP_CONTAINER_ID;
  const element = document.getElementById(id);
  if (element) return element;

  if (id !== APP_CONTAINER_ID) {
    debugWarn(`Mount point "${id}" not found, falling back to #${APP_CONTAINER_ID}`);
  }
  return document.getElementById(APP_CONTAINER_ID);
}

/**
 * Normalize the mount-related options a page receives.
 *
 * @param {{containerId?: string, embedded?: boolean}} [options]
 * @returns {{containerId: string, embedded: boolean}}
 */
export function resolveMountOptions(options = {}) {
  return {
    containerId: options.containerId || APP_CONTAINER_ID,
    embedded: !!options.embedded,
  };
}
