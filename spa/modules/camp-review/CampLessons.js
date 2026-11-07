/**
 * Lessons of earlier camps (#1257, third slice): what closed reviews kept
 * (good moves to repeat) and fixed (weaknesses to correct), heaviest first.
 *
 * Shared by the history (`/camp-reviews`), the camp plan, camp readiness and
 * the dialog that reuses an earlier camp. `mountPreviousLessons` loads "Last
 * time" for a camp into a container the caller owns, and draws nothing over a
 * page that has moved on.
 *
 * @module spa/modules/camp-review/CampLessons
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { getPreviousLessons } from '../../api/api-camp-reviews.js';
import styles from '../../../css/camp-lessons.css?url';

/**
 * @param {Object} review - A closed review, as the history and "last time" answer it
 * @param {string} lang - Interface language
 * @returns {string} The camp's name and dates
 */
export function reviewTitle(review, lang) {
  const name = review.camp.theme || translate('camp_readiness_camp');
  const dates = review.camp.date_from
    ? `${formatDate(review.camp.date_from, lang)} – ${formatDate(review.camp.date_to, lang)}` : '';
  return dates ? `${name} · ${dates}` : name;
}

/** @returns {string} One kept or fixed note, its weight and its action */
function itemMarkup(item) {
  const weight = Number(item.weight) || 1;
  return `<li><span class="camp-lessons__weight" aria-hidden="true">×${weight}</span>
    <span class="sr-only">${escapeHTML(translate('camp_review_weight').replace('{count}', String(weight)))}</span>
    <span>${escapeHTML(item.text)}</span>${item.action_text
  ? `<span class="camp-lessons__action">${escapeHTML(translate('camp_review_action_value').replace('{action}', () => item.action_text))}</span>` : ''}</li>`;
}

/**
 * What one closed review keeps and fixes.
 *
 * @param {Object} review - { keep, fix }
 * @param {string} heading - Heading element of the two lists: 'h3' or 'h4'
 * @returns {string}
 */
export function lessonsListMarkup(review, heading = 'h4') {
  const part = (outcome) => {
    const items = review[outcome] || [];
    return `<div class="camp-lessons__part">
        <${heading}>${escapeHTML(translate(`camp_review_outcome_${outcome}`))}</${heading}>
        ${items.length ? `<ul>${items.map(itemMarkup).join('')}</ul>`
    : `<p class="empty-state">${escapeHTML(translate('camp_review_summary_none'))}</p>`}
      </div>`;
  };
  return `<div class="camp-lessons__parts">${part('keep')}${part('fix')}</div>`;
}

/**
 * "Last time" for a camp: the panel, or nothing when no earlier camp of its kind was reviewed.
 *
 * @param {{basis: ?string, reviews: Object[]}} data - From GET …/camps/:id/previous
 * @param {string} lang - Interface language
 * @param {string} idPrefix - Prefix for ids, unique on the page
 * @returns {string}
 */
export function previousLessonsMarkup(data, lang, idPrefix) {
  if (!data?.reviews?.length) {
    return '';
  }
  return `<section class="camp-lessons" aria-labelledby="${idPrefix}-title">
      <h2 id="${idPrefix}-title">${escapeHTML(translate('camp_lessons_title'))}</h2>
      <p>${escapeHTML(translate(`camp_lessons_basis_${data.basis}`))}</p>
      ${data.reviews.map((review) => `<article class="camp-lessons__review">
          <h3><a href="/camp-review/${Number(review.camp.id)}">${escapeHTML(reviewTitle(review, lang))}</a></h3>
          ${lessonsListMarkup(review, 'h4')}
        </article>`).join('')}
      <p><a href="/camp-reviews">${escapeHTML(translate('camp_lessons_all'))}</a></p>
    </section>`;
}

/**
 * Load "Last time" for a camp into a container the page owns. Without the
 * right to read reviews, nothing is asked. A failure says so in the container,
 * never as "nothing learned".
 *
 * @param {HTMLElement|null} container - Where to draw it
 * @param {number} meetingId - The camp being prepared
 * @param {string} lang - Interface language
 * @param {string} idPrefix - Prefix for ids, unique on the page
 * @returns {Promise<void>}
 */
export async function mountPreviousLessons(container, meetingId, lang, idPrefix) {
  if (!container || !hasPermission('camp_reviews.view')) {
    return;
  }
  loadStylesheet(styles).catch((err) => debugError('Camp lessons stylesheet failed', err));
  try {
    const response = await getPreviousLessons(meetingId);
    if (container.isConnected) {
      setContent(container, previousLessonsMarkup(response?.data, lang, idPrefix));
    }
  } catch (err) {
    debugError('Lessons of earlier camps could not be loaded', err);
    if (container.isConnected) {
      setContent(container, `<p class="status-message warning">${escapeHTML(translate('camp_lessons_load_failed'))}</p>`);
    }
  }
}
