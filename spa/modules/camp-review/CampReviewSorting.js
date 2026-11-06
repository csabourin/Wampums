/**
 * Sorting one note of a camp's review after the camp (#1257, second slice):
 * to keep or to fix, with a short action; merging it into a note that says the
 * same thing; undoing a merge; removing one particular "+1".
 *
 * Every change here needs the network (the screen offers it only online) and
 * is made against the version the dialog was opened on: a note changed
 * elsewhere meanwhile is refused, never overwritten.
 *
 * @module spa/modules/camp-review/CampReviewSorting
 */
import { translate } from '../../app.js';
import rules from '../../../config/camp_reviews.json';
import { openModal } from '../../utils/ModalUtils.js';
import { withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import {
  sortCampReviewNote, mergeCampReviewNote, unmergeCampReviewNote, removeCampReviewVoteOnline,
} from '../../api/api-camp-reviews.js';

const FORM_ID = 'camp-review-sort-form';
const OUTCOMES = ['keep', 'fix', ''];

/**
 * @param {string} value - An ISO timestamp
 * @param {string} lang - The interface language
 * @returns {string} When, as the person reads it
 */
function when(value, lang) {
  return value
    ? new Intl.DateTimeFormat(localeForLanguage(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : '';
}

/** @returns {string} One "+1", who gave it and when, with a way to remove it */
function voteMarkup(note, vote, lang) {
  const who = translate('camp_review_vote_by').replace('{name}', () => vote.by || translate('camp_review_vote_by_unknown'))
    .replace('{when}', () => when(vote.created_at, lang));
  return `<li><span>${escapeHTML(who)}</span>
    <button type="button" class="button button--ghost button--small" data-sort-remove-vote="${escapeAttribute(vote.id)}"
      data-sort-vote-note="${escapeAttribute(note.id)}"
      aria-label="${escapeAttribute(translate('camp_review_remove_vote_label').replace('{who}', () => who))}">${escapeHTML(translate('camp_review_remove_vote'))}</button></li>`;
}

/**
 * @param {Object} note - The note to sort, with `merged`
 * @param {Object[]} candidates - The notes it may be merged into
 * @param {string} lang - The interface language
 * @returns {string} The dialog's form
 */
function formMarkup(note, candidates, lang) {
  const outcome = note.outcome || '';
  const radios = OUTCOMES.map((value) => `<label class="radio-option">
      <input type="radio" name="camp-review-sort-outcome" value="${value}" ${value === outcome ? 'checked' : ''}>
      <span>${escapeHTML(translate(`camp_review_outcome_${value || 'none'}`))}</span></label>`).join('');
  const merged = note.merged || [];
  const canMerge = !merged.length && candidates.length > 0;
  const votes = [
    ...note.votes.map((vote) => voteMarkup(note, vote, lang)),
    ...merged.flatMap((child) => child.votes.map((vote) => voteMarkup(child, vote, lang))),
  ];
  return `<form id="${FORM_ID}" class="camp-review-sort" novalidate>
      <p class="camp-review-sort__text"><strong>${escapeHTML(note.text)}</strong></p>
      <p class="status-message error" id="camp-review-sort-error" role="alert" hidden></p>
      <fieldset class="camp-review-sort__outcome">
        <legend>${escapeHTML(translate('camp_review_outcome'))}</legend>
        ${radios}
      </fieldset>
      <div class="form-group">
        <label for="camp-review-sort-action">${escapeHTML(translate('camp_review_action'))}</label>
        <input type="text" id="camp-review-sort-action" maxlength="${rules.TEXT_MAX}" value="${escapeAttribute(note.action_text || '')}"
          aria-describedby="camp-review-sort-action-hint">
        <p class="field-hint" id="camp-review-sort-action-hint">${escapeHTML(translate('camp_review_action_hint'))}</p>
      </div>
      ${canMerge ? `<div class="form-group">
        <label for="camp-review-sort-merge">${escapeHTML(translate('camp_review_merge_into'))}</label>
        <select id="camp-review-sort-merge" aria-describedby="camp-review-sort-merge-hint">
          <option value="">${escapeHTML(translate('camp_review_merge_none'))}</option>
          ${candidates.map((other) => `<option value="${escapeAttribute(other.id)}">${escapeHTML(other.text)} (×${Number(other.weight) || 1})</option>`).join('')}
        </select>
        <p class="field-hint" id="camp-review-sort-merge-hint">${escapeHTML(translate('camp_review_merge_hint'))}</p>
      </div>` : ''}
      ${merged.length ? `<h3 class="camp-review-sort__subtitle">${escapeHTML(translate('camp_review_merged_title'))}</h3>
      <ul class="camp-review-sort__list">${merged.map((child) => `<li><span>${escapeHTML(child.text)} (×${Number(child.weight) || 1})</span>
        <button type="button" class="button button--ghost button--small" data-sort-unmerge="${escapeAttribute(child.id)}"
          aria-label="${escapeAttribute(translate('camp_review_unmerge_label').replace('{text}', () => child.text))}">${escapeHTML(translate('camp_review_unmerge'))}</button></li>`).join('')}</ul>` : ''}
      <h3 class="camp-review-sort__subtitle">${escapeHTML(translate('camp_review_votes_title'))}</h3>
      ${votes.length ? `<ul class="camp-review-sort__list">${votes.join('')}</ul>`
    : `<p class="empty-state">${escapeHTML(translate('camp_review_votes_none'))}</p>`}
    </form>`;
}

/**
 * Open the dialog that sorts one note.
 *
 * @param {Object} options
 * @param {Object} options.app - Application instance (showMessage, lang)
 * @param {number} options.meetingId - The planned camp
 * @param {Object} options.note - The note, as the review shows it (with `merged` and `votes`)
 * @param {Object[]} options.candidates - Notes of the same category it may be merged into
 * @param {Function} options.onChanged - Retains a confirmed change and its answer, then reloads the review
 * @returns {Object} The modal handle
 */
export function openSortDialog({ app, meetingId, note, candidates, onChanged }) {
  const lang = app.lang || 'fr';
  let saving = false;
  const modal = openModal({
    id: 'camp-review-sort',
    title: escapeHTML(translate('camp_review_sort_title')),
    body: formMarkup(note, candidates, lang),
    footer: `<button type="button" class="button button--secondary" data-modal-close>${escapeHTML(translate('cancel'))}</button>
      <button type="submit" class="button button--primary" form="${FORM_ID}">${escapeHTML(translate('save'))}</button>`,
    closeOnBackdrop: false,
    canClose: () => !saving,
    initialFocus: 'input[name="camp-review-sort-outcome"]:checked',
  });
  const form = modal.dialog.querySelector(`#${FORM_ID}`);
  const failure = form.querySelector('#camp-review-sort-error');

  const fail = (error, fallback) => {
    debugError('Sorting a camp review note failed:', error);
    failure.textContent = apiErrorMessage(error, fallback);
    failure.hidden = false;
  };
  const done = async (message, change, answer) => {
    modal.close();
    app.showMessage(translate(message), 'success');
    await onChanged(change, answer);
  };
  const run = async (action, message, fallback, change) => {
    saving = true;
    failure.hidden = true;
    try {
      const response = await action();
      saving = false;
      await done(message, change, response?.data);
    } catch (error) {
      saving = false;
      fail(error, fallback);
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    withFormBusy(form, async () => {
      const into = form.querySelector('#camp-review-sort-merge')?.value || '';
      const outcome = form.querySelector('input[name="camp-review-sort-outcome"]:checked')?.value || '';
      const action = form.querySelector('#camp-review-sort-action').value.trim();
      if (into) {
        await run(() => mergeCampReviewNote(meetingId, note.id, { into, expected_version: note.version }),
          'camp_review_merged_done', 'camp_review_sort_failed', { method: 'PUT', noteId: note.id });
        return;
      }
      if (outcome === (note.outcome || '') && action === (note.action_text || '')) {
        modal.close();
        return;
      }
      await run(() => sortCampReviewNote(meetingId, note.id, { outcome: outcome || null, action_text: action || null, expected_version: note.version }),
        'camp_review_sorted_done', 'camp_review_sort_failed', { method: 'PATCH', noteId: note.id });
    });
  });

  form.addEventListener('click', (event) => {
    const unmerge = event.target.closest('[data-sort-unmerge]');
    if (unmerge) {
      run(() => unmergeCampReviewNote(meetingId, unmerge.dataset.sortUnmerge), 'camp_review_unmerged_done', 'camp_review_sort_failed',
        { method: 'DELETE', noteId: unmerge.dataset.sortUnmerge, unmerge: true });
      return;
    }
    const vote = event.target.closest('[data-sort-remove-vote]');
    if (vote) {
      run(() => removeCampReviewVoteOnline(meetingId, vote.dataset.sortVoteNote, vote.dataset.sortRemoveVote),
        'camp_review_vote_removed_done', 'camp_review_sort_failed',
        { method: 'DELETE', noteId: vote.dataset.sortVoteNote, voteId: vote.dataset.sortRemoveVote });
    }
  });
  return modal;
}
