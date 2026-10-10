// ActivityInviteesPicker.js
// "Who is invited?" in the activity form. An activity invites the whole unit,
// or only some participants: a fall camp for the children aged 10 and over who
// have never been. Only invited children appear in the activity's carpools and
// can receive its permission slips.
//
// Filters (group, minimum age on the first day) narrow the list shown; they
// never change who is checked, so a leader can filter, check those shown, and
// then uncheck the few who already went.
import { translate } from '../../app.js';
import { fetchParticipants, getCurrentOrganizationId } from '../../ajax-functions.js';
import { getGroups } from '../../api/api-endpoints.js';
import { debugError } from '../../utils/DebugUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { setContent } from '../../utils/DOMUtils.js';

const MAX_FILTER_AGE = 99;
const ISO_DATE_LENGTH = 10;
const DATE_PARTS = 3;

/**
 * A participant's age in whole years on a given day.
 * @param {string|null|undefined} birthDate - YYYY-MM-DD (or ISO date-time)
 * @param {string} onDate - YYYY-MM-DD
 * @returns {number|null} Age, or null when either date is missing or malformed
 */
export function ageOn(birthDate, onDate) {
  const birth = String(birthDate || '').slice(0, ISO_DATE_LENGTH).split('-').map(Number);
  const day = String(onDate || '').slice(0, ISO_DATE_LENGTH).split('-').map(Number);
  if (birth.length !== DATE_PARTS || day.length !== DATE_PARTS || [...birth, ...day].some(Number.isNaN)) {
    return null;
  }
  const [birthYear, birthMonth, birthDay] = birth;
  const [year, month, dayOfMonth] = day;
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && dayOfMonth < birthDay)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

/**
 * Build the "Who is invited?" fieldset.
 * @param {Object|null} activity - Activity being edited, or null to create
 * @returns {string} Fieldset HTML
 */
export function buildInviteesFieldsetHTML(activity) {
  const invitesEveryone = activity?.invites_everyone !== false;
  return `
    <fieldset class="form-fieldset activity-invitees" aria-describedby="activity-invitees-help">
      <legend>${escapeHTML(translate('activity_invitees_legend'))}</legend>
      <p class="form-help" id="activity-invitees-help">${escapeHTML(translate('activity_invitees_help'))}</p>

      <div class="radio-group activity-invitees__mode">
        <div class="radio-option">
          <input type="radio" id="activity-invites-everyone" name="invites_everyone" value="true"
                 ${invitesEveryone ? 'checked' : ''}>
          <label for="activity-invites-everyone">${escapeHTML(translate('activity_invitees_everyone'))}</label>
        </div>
        <div class="radio-option">
          <input type="radio" id="activity-invites-some" name="invites_everyone" value="false"
                 aria-controls="activity-invitees-picker"
                 ${invitesEveryone ? '' : 'checked'}>
          <label for="activity-invites-some">${escapeHTML(translate('activity_invitees_some'))}</label>
        </div>
      </div>

      <div id="activity-invitees-picker" class="activity-invitees__picker" ${invitesEveryone ? 'hidden' : ''}>
        <p class="activity-invitees__status" id="activity-invitees-status" role="status"></p>
      </div>
    </fieldset>
  `;
}

/**
 * Markup of the picker once participants and groups are loaded.
 * @param {Array<Object>} participants
 * @param {Array<Object>} groups
 * @returns {string}
 */
function buildPickerBodyHTML(participants, groups) {
  const groupOptions = groups
    .map((group) => `<option value="${escapeHTML(String(group.id))}">${escapeHTML(group.name || '')}</option>`)
    .join('');
  const rows = participants.map((participant) => `
    <li class="activity-invitees__item" data-participant-id="${escapeHTML(String(participant.id))}">
      <input type="checkbox" id="activity-invitee-${escapeHTML(String(participant.id))}"
             name="invited_participant_ids" value="${escapeHTML(String(participant.id))}">
      <label for="activity-invitee-${escapeHTML(String(participant.id))}">
        <span>${escapeHTML(participant.first_name || '')} ${escapeHTML(participant.last_name || '')}</span>
        <span class="activity-invitees__meta" data-invitee-meta></span>
      </label>
    </li>
  `).join('');

  return `
    <div class="form-row activity-invitees__filters">
      <div class="form-group">
        <label for="activity-invitees-group">${escapeHTML(translate('activity_invitees_filter_group'))}</label>
        <select id="activity-invitees-group" class="form-control">
          <option value="">${escapeHTML(translate('activity_invitees_all_groups'))}</option>
          ${groupOptions}
        </select>
      </div>
      <div class="form-group">
        <label for="activity-invitees-min-age">${escapeHTML(translate('activity_invitees_filter_min_age'))}</label>
        <input type="number" id="activity-invitees-min-age" class="form-control"
               min="0" max="${MAX_FILTER_AGE}" step="1" inputmode="numeric"
               aria-describedby="activity-invitees-min-age-help">
        <small class="form-help" id="activity-invitees-min-age-help">${escapeHTML(translate('activity_invitees_filter_min_age_help'))}</small>
      </div>
    </div>

    <div class="activity-invitees__toolbar">
      <button type="button" class="button button--small button--secondary" data-invitees-action="check">
        ${escapeHTML(translate('activity_invitees_select_shown'))}
      </button>
      <button type="button" class="button button--small button--secondary" data-invitees-action="uncheck">
        ${escapeHTML(translate('activity_invitees_clear_shown'))}
      </button>
    </div>

    <p class="activity-invitees__count" id="activity-invitees-count" aria-live="polite"></p>

    <fieldset class="activity-invitees__list-wrapper">
      <legend class="visually-hidden">${escapeHTML(translate('activity_invitees_list_label'))}</legend>
      <ul class="activity-invitees__list">${rows}</ul>
      <p class="activity-invitees__empty" id="activity-invitees-empty" hidden>${escapeHTML(translate('activity_invitees_none_shown'))}</p>
    </fieldset>
  `;
}

/**
 * Wire the "Who is invited?" fieldset inside an open activity form.
 *
 * @param {HTMLElement} root - Element containing the fieldset (the modal overlay)
 * @param {Object} options
 * @param {Object|null} options.activity - Activity being edited (with
 *   `invited_participant_ids` when it invites only some), or null to create
 * @param {Function} options.getStartDate - Returns the form's current start date (YYYY-MM-DD)
 * @param {Function} [options.loadParticipants] - Loads the unit's participants
 * @param {Function} [options.loadGroups] - Loads the unit's groups
 * @param {Function} [options.loadInvitedIds] - Loads the ids already invited
 * @returns {{readInto: Function, validate: Function, refreshAges: Function, ready: Promise<void>}}
 */
export function attachInviteesPicker(root, {
  activity = null,
  getStartDate,
  loadParticipants = () => fetchParticipants(getCurrentOrganizationId()),
  loadGroups = async () => {
    const response = await getGroups();
    return response?.data || response?.groups || [];
  },
  loadInvitedIds = () => Promise.resolve(activity?.invited_participant_ids || [])
}) {
  const picker = root.querySelector('#activity-invitees-picker');
  const everyoneRadio = root.querySelector('#activity-invites-everyone');
  const someRadio = root.querySelector('#activity-invites-some');
  let initiallyInvited = new Set();
  let participants = [];
  let state = 'idle';
  let loading = null;

  const items = () => Array.from(picker.querySelectorAll('.activity-invitees__item'));
  const boxes = () => Array.from(picker.querySelectorAll('input[name="invited_participant_ids"]'));

  const updateCount = () => {
    const count = picker.querySelector('#activity-invitees-count');
    if (!count) {
      return;
    }
    const checked = boxes().filter((box) => box.checked).length;
    count.textContent = translate('activity_invitees_selected_count')
      .replace('{count}', String(checked))
      .replace('{total}', String(participants.length));
  };

  const applyFilters = () => {
    const groupId = picker.querySelector('#activity-invitees-group')?.value || '';
    const minAgeText = picker.querySelector('#activity-invitees-min-age')?.value || '';
    const minAge = minAgeText === '' ? null : Number(minAgeText);
    const startDate = getStartDate();
    let shown = 0;
    items().forEach((item) => {
      const participant = participants.find((p) => String(p.id) === item.dataset.participantId);
      const age = ageOn(participant?.date_naissance, startDate);
      const groupMatches = !groupId || String(participant?.group_id ?? '') === groupId;
      const ageMatches = minAge === null || Number.isNaN(minAge) || (age !== null && age >= minAge);
      item.hidden = !(groupMatches && ageMatches);
      if (!item.hidden) {
        shown += 1;
      }
    });
    const empty = picker.querySelector('#activity-invitees-empty');
    if (empty) {
      empty.hidden = shown > 0;
    }
  };

  const refreshAges = () => {
    if (state !== 'ready') {
      return;
    }
    const startDate = getStartDate();
    items().forEach((item) => {
      const participant = participants.find((p) => String(p.id) === item.dataset.participantId);
      const age = ageOn(participant?.date_naissance, startDate);
      const meta = item.querySelector('[data-invitee-meta]');
      const details = [
        age === null ? null : translate('activity_invitees_age').replace('{age}', String(age)),
        participant?.group_name || null
      ].filter(Boolean).join(' · ');
      meta.textContent = details ? `(${details})` : '';
    });
    applyFilters();
  };

  const renderLoaded = (groups) => {
    setContent(picker, buildPickerBodyHTML(participants, groups));
    boxes().forEach((box) => {
      box.checked = initiallyInvited.has(Number(box.value));
    });
    picker.querySelector('#activity-invitees-group')?.addEventListener('change', applyFilters);
    picker.querySelector('#activity-invitees-min-age')?.addEventListener('input', applyFilters);
    picker.querySelectorAll('[data-invitees-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const check = button.dataset.inviteesAction === 'check';
        items().filter((item) => !item.hidden).forEach((item) => {
          item.querySelector('input[type="checkbox"]').checked = check;
        });
        updateCount();
      });
    });
    picker.addEventListener('change', (event) => {
      if (event.target?.name === 'invited_participant_ids') {
        updateCount();
      }
    });
    state = 'ready';
    refreshAges();
    updateCount();
  };

  const renderError = () => {
    setContent(picker, `
      <p class="activity-invitees__status" id="activity-invitees-status" role="status">
        ${escapeHTML(translate('activity_invitees_load_error'))}
      </p>
      <button type="button" class="button button--small button--secondary" data-invitees-retry>
        ${escapeHTML(translate('activity_invitees_retry'))}
      </button>
    `);
    picker.querySelector('[data-invitees-retry]')?.addEventListener('click', () => load());
  };

  /**
   * Load participants and groups once, then show the list.
   * @returns {Promise<void>}
   */
  function load() {
    if (state === 'ready' || state === 'loading') {
      return loading;
    }
    state = 'loading';
    setContent(picker, `
      <p class="activity-invitees__status" id="activity-invitees-status" role="status">
        ${escapeHTML(translate('activity_invitees_loading'))}
      </p>
    `);
    loading = Promise.all([loadParticipants(), loadGroups(), loadInvitedIds()])
      .then(([loadedParticipants, groups, invitedIds]) => {
        initiallyInvited = new Set((invitedIds || []).map(Number));
        participants = (Array.isArray(loadedParticipants) ? loadedParticipants : [])
          .slice()
          .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
        renderLoaded(Array.isArray(groups) ? groups : []);
      })
      .catch((err) => {
        debugError('Could not load participants for invitations:', err);
        state = 'error';
        renderError();
      });
    return loading;
  }

  const showPicker = () => {
    const some = Boolean(someRadio?.checked);
    picker.hidden = !some;
    if (some) {
      load();
    }
  };

  everyoneRadio?.addEventListener('change', showPicker);
  someRadio?.addEventListener('change', showPicker);
  showPicker();

  return {
    ready: loading || Promise.resolve(),

    /** Re-read ages after the activity's start date changes. */
    refreshAges,

    /**
     * Why the invitation cannot be saved yet.
     * @returns {string|null} Translation key, or null when it can be saved
     */
    validate() {
      if (!someRadio?.checked) {
        return null;
      }
      if (state !== 'ready') {
        return 'activity_invitees_not_loaded';
      }
      return boxes().some((box) => box.checked) ? null : 'activity_invitees_none_selected';
    },

    /**
     * Put the invitation into an activity payload.
     * @param {Object} data - Payload being built from the form
     * @returns {Object} The same payload
     */
    readInto(data) {
      delete data.invited_participant_ids;
      const some = Boolean(someRadio?.checked);
      data.invites_everyone = !some;
      if (some) {
        data.invited_participant_ids = boxes().filter((box) => box.checked).map((box) => Number(box.value));
      }
      return data;
    }
  };
}
