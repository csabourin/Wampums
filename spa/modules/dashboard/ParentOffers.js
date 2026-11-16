/**
 * One-time offers on the parent dashboard (#1426): turning on notifications and installing the
 * app. Each is a banner the parent can close. It disappears once its action is done (permission
 * answered, app installed), and a closed banner stays closed on this device: the choice is a
 * local preference (`CONFIG.STORAGE_KEYS.PARENT_OFFERS_DISMISSED`), kept across sign-outs like the
 * language, and read and written through `StorageUtils`, which never throws.
 *
 * @module spa/modules/dashboard/ParentOffers
 */
import { translate } from '../../app.js';
import { getStorageKey } from '../../config.js';
import { getStorageJSON, setStorage } from '../../utils/StorageUtils.js';

/** The offers, in the order they are shown. */
export const PARENT_OFFER = Object.freeze({
  NOTIFICATIONS: 'notifications',
  INSTALL: 'install',
});

/** The action button of each offer; the ids the dashboard has always used. */
const ACTION_IDS = Object.freeze({
  [PARENT_OFFER.NOTIFICATIONS]: 'enableNotifications',
  [PARENT_OFFER.INSTALL]: 'installPwaButton',
});

/** Everything that can take focus, to find what follows a banner once it is gone. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const storageKey = () => getStorageKey('PARENT_OFFERS_DISMISSED');

/** @returns {Set<string>} The offers closed on this device */
export function dismissedOffers() {
  const stored = getStorageJSON(storageKey(), false, []);
  return new Set(Array.isArray(stored) ? stored : []);
}

/**
 * Remember on this device that the parent closed an offer.
 *
 * @param {string} offer - A PARENT_OFFER value
 */
export function rememberDismissed(offer) {
  const closed = dismissedOffers();
  closed.add(offer);
  setStorage(storageKey(), [...closed]);
}

/**
 * Whether the browser can still ask about notifications. Once the parent answered, in either
 * direction, the offer has nothing left to do: a refusal is changed in the browser's settings.
 *
 * @returns {boolean}
 */
export function canAskForNotifications() {
  return typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default';
}

/**
 * The banners still to show.
 *
 * @param {{notifications: boolean, install: boolean}} available - Offers whose action can still be done
 * @returns {Array<string>} PARENT_OFFER values, not closed on this device
 */
export function offersToShow(available) {
  const closed = dismissedOffers();
  return Object.values(PARENT_OFFER).filter((offer) => available[offer] && !closed.has(offer));
}

/**
 * @param {Array<string>} offers - From offersToShow
 * @returns {string} Markup; empty when there is nothing to offer
 */
export function renderOfferBanners(offers) {
  if (!offers.length) {
    return '';
  }
  return `<div class="parent-offers">${offers.map((offer) => `
    <section class="parent-offer" data-offer="${offer}" aria-labelledby="parent-offer-${offer}-text">
      <p class="parent-offer__text" id="parent-offer-${offer}-text">${translate(`parent_offer_${offer}_text`)}</p>
      <div class="parent-offer__actions">
        <button type="button" id="${ACTION_IDS[offer]}" class="button button--secondary button--small">${translate(`parent_offer_${offer}_action`)}</button>
        <button type="button" class="button button--ghost button--small" data-offer-close="${offer}">
          ${translate('close')}<span class="visually-hidden"> — ${translate(`parent_offer_${offer}_action`)}</span>
        </button>
      </div>
    </section>`).join('')}</div>`;
}

/**
 * Take a banner off the page. When focus was inside it, it moves to whatever comes next, so a
 * keyboard user carries on where they were rather than at the top of the page.
 *
 * @param {string} offer - A PARENT_OFFER value
 * @param {HTMLElement} [root=document.body] - Where the dashboard is drawn
 * @returns {boolean} True when a banner was removed
 */
export function removeOfferBanner(offer, root = document.body) {
  const banner = root.querySelector(`.parent-offer[data-offer="${offer}"]`);
  if (!banner) {
    return false;
  }
  const hadFocus = banner.contains(document.activeElement);
  const next = hadFocus
    ? [...root.querySelectorAll(FOCUSABLE)].find((element) => !banner.contains(element)
      // eslint-disable-next-line no-bitwise -- compareDocumentPosition answers with a bit mask
      && (banner.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
    : null;
  const group = banner.parentElement;
  banner.remove();
  if (group?.classList.contains('parent-offers') && !group.children.length) {
    group.remove();
  }
  next?.focus();
  return true;
}
