/**
 * The stylesheet shared by the family access screens.
 *
 * Loaded on demand rather than bundled into the main sheet, since most people
 * never open these screens. One small file serves all four of them.
 *
 * @module spa/modules/family-access/styles
 */

import { loadStylesheet } from '../../utils/DOMUtils.js';
import { debugError } from '../../utils/DebugUtils.js';

/**
 * Load the family access stylesheet once. A failure only costs styling, so it
 * is logged and never blocks the page.
 *
 * @returns {void}
 */
export function loadFamilyAccessStyles() {
  loadStylesheet('/css/family-access.css').catch((error) => {
    debugError('Failed to load family access styles:', error);
  });
}
