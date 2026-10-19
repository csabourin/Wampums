import { translate } from '../../app.js';
import { CONFIG } from '../../config.js';
import { openModal } from '../../utils/ModalUtils.js';

const REWARD_VALUES = [2, 3, 4, 5];
const CORRECTION_VALUES = [-2, -3, -4, -5];
const GAME_RESULTS = [
  { placeKey: 'points_game_first_place', points: 5 },
  { placeKey: 'points_game_second_place', points: 4 },
  { placeKey: 'points_game_third_place', points: 3 },
  { placeKey: 'points_game_fourth_place', points: 2 }
];

function signedValue(points) {
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

function valueButtons(values, className) {
  return values.map((points) => `
    <button type="button" class="point-btn point-value-menu__option ${className}"
      role="menuitem" data-points="${points}">
      ${signedValue(points)}
    </button>
  `).join('');
}

/**
 * Accessible interaction layer for the fixed points action bar. It owns menu,
 * dialog, focus, busy, and live-region behavior but knows nothing about the
 * points API or selection model.
 */
export class PointActionBar {
  constructor({ onAction }) {
    this.onAction = onAction;
    this.root = null;
    this.appRoot = null;
    this.abortController = null;
    this.resizeObserver = null;
    this.activeMenu = null;
    this.activeMenuTrigger = null;
    this.gameTrigger = null;
    this.gameDialog = null;
    this.gameButtons = '';
    this.feedbackTimer = null;
  }

  render() {
    this.gameButtons = GAME_RESULTS.map(({ placeKey, points }) => `
      <button type="button" class="point-btn game-result-option"
        data-points="${points}" data-game-result>
        <span>${translate(placeKey)}</span>
        <strong>${signedValue(points)} ${translate('points')}</strong>
      </button>
    `).join('');

    return `
      <div class="points-action-bar" id="points-action-bar">
        <div class="points-action-bar__inner">
          <div class="points-action-bar__context">
            <strong id="points-selection-summary" aria-live="polite" aria-atomic="true">
              ${translate('points_selection_none')}
            </strong>
            <div class="points-action-feedback" id="points-action-feedback"
              aria-live="polite" aria-atomic="true">
              <span class="points-action-feedback__visual" aria-hidden="true"></span>
              <span class="sr-only points-action-feedback__announcement"></span>
            </div>
          </div>

          <div class="points-action-bar__actions">
            <div class="point-split-action point-split-action--reward">
              <button type="button" class="point-btn point-split-action__main"
                data-points="1" aria-label="${translate('points_reward')} ${signedValue(1)}">
                <span>${translate('points_reward')}</span><strong>${signedValue(1)}</strong>
              </button>
              <button type="button" class="point-btn point-split-action__toggle"
                data-point-menu-toggle="reward" aria-expanded="false"
                aria-controls="reward-values-menu"
                aria-label="${translate('points_other_reward_values')}">▾</button>
              <div class="point-value-menu" id="reward-values-menu" role="menu"
                aria-label="${translate('points_other_reward_values')}" hidden>
                ${valueButtons(REWARD_VALUES, 'point-value-menu__option--reward')}
              </div>
            </div>

            <div class="point-split-action point-split-action--correction">
              <button type="button" class="point-btn point-split-action__main"
                data-points="-1" aria-label="${translate('points_correction')} ${signedValue(-1)}">
                <span>${translate('points_correction')}</span><strong>${signedValue(-1)}</strong>
              </button>
              <button type="button" class="point-btn point-split-action__toggle"
                data-point-menu-toggle="correction" aria-expanded="false"
                aria-controls="correction-values-menu"
                aria-label="${translate('points_other_correction_values')}">▾</button>
              <div class="point-value-menu" id="correction-values-menu" role="menu"
                aria-label="${translate('points_other_correction_values')}" hidden>
                ${valueButtons(CORRECTION_VALUES, 'point-value-menu__option--correction')}
              </div>
            </div>

            <button type="button" class="point-btn points-game-result-trigger"
              id="points-game-result-trigger" aria-haspopup="dialog" aria-expanded="false">
              ${translate('points_game_result')}
            </button>
          </div>
        </div>

      </div>
    `;
  }

  mount(root, appRoot) {
    this.destroy();
    this.root = root;
    this.appRoot = appRoot;
    if (!this.root) {return;}

    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.root.style.setProperty(
      '--points-feedback-duration',
      `${CONFIG.UI.POINT_FEEDBACK_DURATION}ms`,
    );
    this.root.addEventListener('click', (event) => this.handleClick(event), { signal });
    this.root.addEventListener('keydown', (event) => this.handleKeydown(event), { signal });
    document.addEventListener('pointerdown', (event) => this.handleOutsidePointer(event), { signal });
    document.addEventListener('visibilitychange', () => this.closeTransientUi(), { signal });

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.reservePageSpace());
      this.resizeObserver.observe(this.root);
    }
    this.reservePageSpace();
  }

  async handleClick(event) {
    const menuToggle = event.target.closest('[data-point-menu-toggle]');
    if (menuToggle) {
      this.toggleValueMenu(menuToggle);
      return;
    }

    const gameTrigger = event.target.closest('#points-game-result-trigger');
    if (gameTrigger) {
      this.openGameDialog(gameTrigger);
      return;
    }

    const actionButton = event.target.closest('[data-points]');
    if (!actionButton) {return;}

    if (actionButton.closest('[role="menu"]')) {
      this.closeValueMenu({ restoreFocus: true });
    }
    await this.runAction(Number(actionButton.dataset.points), actionButton);
  }

  handleKeydown(event) {
    const menu = event.target.closest('[role="menu"]');
    if (menu) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeValueMenu({ restoreFocus: true });
        return;
      }

      const options = [...menu.querySelectorAll('[role="menuitem"]')];
      const currentIndex = options.indexOf(document.activeElement);
      let nextIndex = null;
      if (event.key === 'ArrowDown') {nextIndex = (currentIndex + 1) % options.length;}
      if (event.key === 'ArrowUp') {nextIndex = (currentIndex - 1 + options.length) % options.length;}
      if (event.key === 'Home') {nextIndex = 0;}
      if (event.key === 'End') {nextIndex = options.length - 1;}
      if (nextIndex !== null) {
        event.preventDefault();
        options[nextIndex]?.focus();
      }
      return;
    }
  }

  handleOutsidePointer(event) {
    if (!this.activeMenu) {return;}
    if (this.activeMenu.contains(event.target) || this.activeMenuTrigger?.contains(event.target)) {return;}
    this.closeValueMenu();
  }

  toggleValueMenu(trigger) {
    const menu = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!menu) {return;}
    if (this.activeMenu === menu) {
      this.closeValueMenu({ restoreFocus: true });
      return;
    }

    this.closeValueMenu();
    this.activeMenu = menu;
    this.activeMenuTrigger = trigger;
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role="menuitem"]')?.focus();
  }

  closeValueMenu({ restoreFocus = false } = {}) {
    if (!this.activeMenu) {return;}
    this.activeMenu.hidden = true;
    this.activeMenuTrigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {this.activeMenuTrigger?.focus();}
    this.activeMenu = null;
    this.activeMenuTrigger = null;
  }

  /**
   * Choose a game placement in the shared modal; choosing one awards its
   * points and returns focus to the trigger.
   * @param {HTMLElement} trigger - The "game result" button
   */
  openGameDialog(trigger) {
    this.closeValueMenu();
    if (this.gameDialog) {return;}
    this.gameTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    this.gameDialog = openModal({
      id: 'points-game-result-dialog',
      title: translate('points_game_result'),
      size: 'small',
      className: 'points-game-result-dialog',
      body: `<div class="points-game-result-dialog__options">${this.gameButtons}</div>`,
      initialFocus: '[data-game-result]',
      returnFocus: trigger,
      onClose: () => {
        trigger.setAttribute('aria-expanded', 'false');
        this.gameDialog = null;
        this.gameTrigger = null;
      },
    });
    this.gameDialog.overlay.addEventListener('click', (event) => {
      const option = event.target.closest('[data-game-result]');
      if (!option) {return;}
      this.closeGameDialog();
      this.runAction(Number(option.dataset.points), option);
    });
  }

  closeGameDialog({ restoreFocus = true } = {}) {
    if (!this.gameDialog) {return;}
    const trigger = this.gameTrigger;
    this.gameDialog.close(true);
    if (restoreFocus) {trigger?.focus();}
  }

  async runAction(points, sourceButton) {
    if (!Number.isFinite(points) || sourceButton.dataset.actionBusy === 'true') {return;}
    sourceButton.dataset.actionBusy = 'true';
    sourceButton.disabled = true;
    sourceButton.setAttribute('aria-busy', 'true');
    try {
      await this.onAction(points, sourceButton);
    } finally {
      sourceButton.disabled = false;
      sourceButton.removeAttribute('aria-busy');
      delete sourceButton.dataset.actionBusy;
    }
  }

  updateSelection(summary) {
    const element = this.root?.querySelector('#points-selection-summary');
    if (element) {element.textContent = summary;}
    const feedback = this.root?.querySelector('#points-action-feedback');
    feedback?.classList.remove('points-action-feedback--visible');
    const visual = feedback?.querySelector('.points-action-feedback__visual');
    if (visual) {visual.textContent = '';}
  }

  showFeedback(points, announcement) {
    const feedback = this.root?.querySelector('#points-action-feedback');
    if (!feedback) {return;}
    const visual = feedback.querySelector('.points-action-feedback__visual');
    const liveRegion = feedback.querySelector('.points-action-feedback__announcement');
    visual.textContent = signedValue(points);
    liveRegion.textContent = announcement;
    feedback.classList.remove('points-action-feedback--visible');
    void feedback.offsetWidth;
    feedback.classList.add('points-action-feedback--visible');
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      feedback.classList.remove('points-action-feedback--visible');
      visual.textContent = '';
    }, CONFIG.UI.POINT_FEEDBACK_DURATION);
  }

  announce(message) {
    const feedback = this.root?.querySelector('#points-action-feedback');
    if (!feedback) {return;}
    feedback.querySelector('.points-action-feedback__visual').textContent = message;
    feedback.querySelector('.points-action-feedback__announcement').textContent = message;
    feedback.classList.add('points-action-feedback--visible');
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => {
      feedback.classList.remove('points-action-feedback--visible');
      feedback.querySelector('.points-action-feedback__visual').textContent = '';
    }, CONFIG.UI.POINT_FEEDBACK_DURATION);
  }

  reservePageSpace() {
    if (!this.appRoot || !this.root) {return;}
    this.appRoot.style.setProperty('--points-action-bar-height', `${this.root.offsetHeight}px`);
  }

  closeTransientUi() {
    this.closeValueMenu();
    this.closeGameDialog({ restoreFocus: false });
  }

  destroy() {
    this.abortController?.abort();
    this.abortController = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = null;
    this.closeTransientUi();
    this.appRoot?.style.removeProperty('--points-action-bar-height');
    this.root = null;
    this.appRoot = null;
  }
}
