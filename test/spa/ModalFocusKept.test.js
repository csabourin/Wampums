/**
 * @jest-environment jsdom
 */

/**
 * Opening a hand-authored dialog moves focus into it, one frame later. A
 * screen that rebuilds its open dialog on every change (the district Units
 * tab, at each ticked role) has already put focus back where the person was;
 * moving it to the first control stole it and scrolled the dialog to the top.
 *
 * @module test/spa/ModalFocusKept
 */

import { enhanceModalAccessibility } from '../../spa/utils/ModalAccessibility.js';

/**
 * Add a dialog to the page and enhance it.
 *
 * @returns {HTMLElement} The overlay
 */
function addDialog() {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay show">
      <div class="modal-content">
        <h2>Roles</h2>
        <button id="close">Close</button>
        <input type="checkbox" id="role-3" />
      </div>
    </div>`);
  const overlay = document.querySelector('.modal-overlay');
  enhanceModalAccessibility(overlay);
  return overlay;
}

beforeEach(() => {
  document.body.innerHTML = '<button id="opener">Open</button>';
  window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
});

afterEach(async () => {
  // Closing the dialog lets its observer disconnect before jsdom is torn down.
  document.querySelectorAll('.modal-overlay').forEach((overlay) => overlay.remove());
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('moves focus into a newly opened dialog', async () => {
  document.getElementById('opener').focus();
  addDialog();
  await new Promise((resolve) => setTimeout(resolve, 0));

  // jsdom has no layout (offsetParent is always null), so the module falls
  // back to focusing the dialog itself; what matters is that focus entered it.
  const dialog = document.querySelector('.modal-content');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement.id).not.toBe('opener');
});

test('leaves focus where it is when it is already inside the dialog', async () => {
  addDialog();
  document.getElementById('role-3').focus();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(document.activeElement.id).toBe('role-3');
});
