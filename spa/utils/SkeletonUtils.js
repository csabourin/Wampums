/**
 * SkeletonUtils.js
 * Utility functions for generating skeleton loading states
 */

/**
 * Generate a skeleton placeholder for a header
 * @returns {string} HTML for a skeleton header
 */
export function skeletonHeader() {
  return `<div class="skeleton skeleton--header"></div>`;
}

/**
 * Generate a skeleton placeholder for a card
 * @param {boolean} small - Whether to use small variant
 * @returns {string} HTML for a skeleton card
 */
export function skeletonCard(small = false) {
  const className = small ? 'skeleton--card-small' : 'skeleton--card';
  return `<div class="skeleton ${className}"></div>`;
}

/**
 * Generate multiple skeleton cards
 * @param {number} count - Number of cards to generate
 * @param {boolean} small - Whether to use small variant
 * @returns {string} HTML for multiple skeleton cards
 */
export function skeletonCards(count = 3, small = false) {
  return Array(count)
    .fill(0)
    .map(() => skeletonCard(small))
    .join('');
}

/**
 * Generate a skeleton placeholder for text
 * @param {string} variant - 'wide', 'short', or default
 * @returns {string} HTML for a skeleton text line
 */
export function skeletonText(variant = '') {
  const className = variant ? `skeleton--text-${variant}` : 'skeleton--text';
  return `<div class="skeleton ${className}"></div>`;
}

/**
 * Generate multiple skeleton text lines
 * @param {number} count - Number of text lines to generate
 * @param {string} variant - 'wide', 'short', or default
 * @returns {string} HTML for multiple skeleton text lines
 */
export function skeletonTextLines(count = 3, variant = '') {
  return Array(count)
    .fill(0)
    .map(() => skeletonText(variant))
    .join('');
}

/**
 * Generate a skeleton placeholder for a button
 * @returns {string} HTML for a skeleton button
 */
export function skeletonButton() {
  return `<div class="skeleton skeleton--button"></div>`;
}

/**
 * Generate a skeleton placeholder for an avatar
 * @returns {string} HTML for a skeleton avatar
 */
export function skeletonAvatar() {
  return `<div class="skeleton skeleton--avatar"></div>`;
}

/**
 * Generate a complete skeleton dashboard layout
 * @returns {string} HTML for a skeleton dashboard
 */
export function skeletonDashboard() {
  return `
    <section class="page dashboard-page loading-state">
      ${skeletonHeader()}
      <div class="skeleton-grid skeleton-grid--2col">
        ${skeletonCards(4)}
      </div>
    </section>
  `;
}

/**
 * Generate a skeleton activity list layout
 * @returns {string} HTML for a skeleton activity list
 */
export function skeletonActivityList() {
  return `
    <section class="page activities-page loading-state">
      <header class="page__header">
        ${skeletonText('wide')}
        ${skeletonButton()}
      </header>
      <div class="activities-container">
        ${skeletonCards(3)}
      </div>
    </section>
  `;
}

/**
 * Generate a skeleton carpool dashboard layout
 * @returns {string} HTML for a skeleton carpool dashboard
 */
export function skeletonCarpoolDashboard() {
  return `
    <section class="page carpool-page loading-state">
      ${skeletonHeader()}
      <div class="skeleton-grid skeleton-grid--2col">
        ${skeletonCards(4, true)}
      </div>
    </section>
  `;
}

/**
 * Generate a skeleton list item
 * @returns {string} HTML for a skeleton list item
 */
export function skeletonListItem() {
  return `
    <div class="skeleton-list-item" style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem;">
      ${skeletonAvatar()}
      <div style="flex: 1;">
        ${skeletonText('wide')}
        ${skeletonText('short')}
      </div>
    </div>
  `;
}

/**
 * Generate a skeleton list item
 * @returns {string} HTML for a skeleton list item
 */
export function skeletonList() {
  return `
    <div class="skeleton-list-item" style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem;">
      ${skeletonAvatar()}
      <div style="flex: 1;">
        ${skeletonText('wide')}
        ${skeletonText('short')}
      </div>
    </div>
  `;
}

/**
 * Generate multiple skeleton list items
 * @param {number} count - Number of list items to generate
 * @returns {string} HTML for multiple skeleton list items
 */
export function skeletonListItems(count = 5) {
  return Array(count)
    .fill(0)
    .map(() => skeletonListItem())
    .join('');
}

/**
 * Generate a skeleton table layout
 * @param {number} rows - Number of rows to generate
 * @param {number} cols - Number of columns to generate
 * @returns {string} HTML for a skeleton table
 */
export function skeletonTable(rows = 5, cols = 4) {
  const rowHtml = `
    <tr>
      ${Array(cols).fill(0).map(() => `<td>${skeletonText()}</td>`).join('')}
    </tr>
  `;

  return `
    <table class="table">
      <thead>
        <tr>
          ${Array(cols).fill(0).map(() => `<th>${skeletonText('short')}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${Array(rows).fill(0).map(() => rowHtml).join('')}
      </tbody>
    </table>
  `;
}

/**
 * Add loading class to a button and disable it
 * @param {HTMLButtonElement} button - Button element to set loading state
 * @param {boolean} isLoading - Whether button should be in loading state
 */
export function setButtonLoading(button, isLoading) {
  if (!button) return;

  if (isLoading) {
    button.classList.add('button--loading');
    button.disabled = true;
    // Store original text
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }
  } else {
    button.classList.remove('button--loading');
    button.disabled = false;
    // Restore original text if it was stored
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
      delete button.dataset.originalText;
    }
  }
}

/**
 * Create a spinner element
 * @param {boolean} large - Whether to use large variant
 * @returns {string} HTML for a spinner
 */
export function spinner(large = false) {
  const className = large ? 'spinner spinner--large' : 'spinner';
  return `<span class="${className}"></span>`;
}
