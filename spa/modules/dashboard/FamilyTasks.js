/**
 * "To do for your family" — the parent dashboard's tasks, one per thing to do.
 *
 * A family with several children used to find the same permission slip, form
 * or payment repeated in each child's card. Here an action shared by several
 * children appears once and names them: tasks are grouped by event (the
 * activity a permission slip is for, the form to fill or re-read, the
 * authorization to sign again), then a single payment task.
 *
 * `buildFamilyTasks` is pure: it reads what the dashboard already loaded and
 * never asks the server. Only children in `participants` count, which is the
 * account's own children in the scout year being consulted.
 *
 * @module spa/modules/dashboard/FamilyTasks
 */
import { translate } from '../../app.js';
import { escapeAttribute, escapeHTML } from '../../utils/SecurityUtils.js';
import { formTypeLabel } from '../../utils/FormLabelUtils.js';
import { hasUnpackedItems } from '../personal-equipment/packingStorage.js';
import { isoToDateString } from '../../utils/DateUtils.js';

/** The filter value showing every child. */
export const ALL_CHILDREN = 'all';

/** Kinds of task, in the order a family sees them after the dated events. */
export const FAMILY_TASK_KIND = Object.freeze({
  PERMISSION: 'permission',
  FORM: 'form',
  REVIEW: 'review',
  AUTHORIZATION: 'authorization',
  PAYMENT: 'payment',
  EQUIPMENT: 'equipment',
});

const UNDATED_KIND_ORDER = [
  FAMILY_TASK_KIND.FORM,
  FAMILY_TASK_KIND.REVIEW,
  FAMILY_TASK_KIND.AUTHORIZATION,
  FAMILY_TASK_KIND.PAYMENT,
];

/**
 * How each child is named in a task: the first name, or the full name when
 * two of the family's children share a first name.
 *
 * @param {Array<Object>} participants - The account's children
 * @returns {Map<number, string>} Display name by participant id
 */
export function childDisplayNames(participants) {
  const firstNameCounts = new Map();
  participants.forEach((child) => {
    const first = String(child.first_name ?? '').trim();
    firstNameCounts.set(first, (firstNameCounts.get(first) || 0) + 1);
  });
  return new Map(participants.map((child) => {
    const first = String(child.first_name ?? '').trim();
    const full = `${first} ${String(child.last_name ?? '').trim()}`.trim();
    return [Number(child.id), firstNameCounts.get(first) > 1 || !first ? full : first];
  }));
}

/**
 * Whether the account may submit a form, by the rights the formats carry.
 * A format listed without rights is one the server already let it see.
 *
 * @param {Object|undefined} meta - The format's metadata
 * @returns {boolean} True when the form can be filled in
 */
function canSubmitForm(meta) {
  return meta?.permissions?.can_submit !== false;
}

/**
 * The key grouping the slips of one event, for every child.
 *
 * @param {Object} slip - Permission slip
 * @returns {string} Group key
 */
function eventKey(slip) {
  if (slip.activity_id) {
    return `permission:activity:${Number(slip.activity_id)}`;
  }
  return `permission:meeting:${isoToDateString(slip.meeting_date)}:${slip.activity_title || ''}`;
}

/**
 * Add a child's row to the task under `key`, creating it on first sight.
 *
 * @param {Map<string, Object>} tasks - Tasks by key
 * @param {string} key - Task key
 * @param {Function} create - Builds the task without rows
 * @param {Object} row - The child's part of the task
 */
function addRow(tasks, key, create, row) {
  if (!tasks.has(key)) {
    tasks.set(key, { ...create(), key, rows: [] });
  }
  tasks.get(key).rows.push(row);
}

/**
 * Build the family's tasks from what the dashboard loaded.
 *
 * @param {Object} data - Dashboard data
 * @param {Array<Object>} data.participants - The account's children
 * @param {Map<number, Array<Object>>} [data.permissionSlips] - Slips by child
 * @param {Object} [data.formFormats] - Participant forms the account may see
 * @param {Object} [data.formMeta] - Their display names and rights
 * @param {Array<Object>} [data.formsToReview] - Submissions to re-read
 * @param {Array<Object>} [data.authorizationsToSign] - Authorizations to sign again
 * @param {Map<number, Object>} [data.statements] - Statements by child
 * @param {string} data.today - Today, YYYY-MM-DD: earlier events are past
 * @param {number|string} [filter=ALL_CHILDREN] - A child's id, or every child
 * @returns {Array<Object>} Tasks, each naming its children in `rows`
 */
export function buildFamilyTasks(data, filter = ALL_CHILDREN) {
  const participants = Array.isArray(data.participants) ? data.participants : [];
  const names = childDisplayNames(participants);
  const included = new Set(participants
    .map((child) => Number(child.id))
    .filter((id) => filter === ALL_CHILDREN || id === Number(filter)));
  const childRow = (participantId, extra = {}) => ({
    participantId,
    name: names.get(participantId),
    ...extra,
  });
  const tasks = new Map();

  included.forEach((participantId) => {
    const slips = data.permissionSlips?.get(participantId) || [];
    slips
      .filter((slip) => slip.status === 'pending'
        && isoToDateString(slip.meeting_date) >= data.today)
      .forEach((slip) => addRow(tasks, eventKey(slip), () => ({
        kind: FAMILY_TASK_KIND.PERMISSION,
        title: slip.activity_title || slip.activity_name || '',
        date: isoToDateString(slip.meeting_date),
      }), childRow(participantId, { slipId: Number(slip.id), deadline: slip.deadline_date || null })));
  });

  participants
    .filter((child) => included.has(Number(child.id)))
    .forEach((child) => {
      const participantId = Number(child.id);
      Object.keys(data.formFormats || {}).forEach((formType) => {
        const meta = data.formMeta?.[formType];
        const done = child[`has_${formType}`] === true || child[`has_${formType}`] === 1;
        if (done || !canSubmitForm(meta)) {
          return;
        }
        addRow(tasks, `form:${formType}`, () => ({
          kind: FAMILY_TASK_KIND.FORM,
          formType,
          title: formTypeLabel(formType, meta?.display_name),
        }), childRow(participantId));
      });
    });

  (data.formsToReview || [])
    .filter((form) => included.has(Number(form.participant_id)))
    .forEach((form) => addRow(tasks, `review:${form.form_type}`, () => ({
      kind: FAMILY_TASK_KIND.REVIEW,
      formType: form.form_type,
      title: formTypeLabel(form.form_type, form.display_name),
    }), childRow(Number(form.participant_id), { submissionId: Number(form.id) })));

  (data.authorizationsToSign || [])
    .filter((authorization) => included.has(Number(authorization.participant_id)))
    .forEach((authorization) => {
      const kind = authorization.kind === 'treatment' ? 'treatment' : 'administration';
      const participantId = Number(authorization.participant_id);
      // Two medications of one kind are signed on the same page: name the child once.
      if (tasks.get(`authorization:${kind}`)?.rows.some((row) => row.participantId === participantId)) {
        return;
      }
      addRow(tasks, `authorization:${kind}`, () => ({
        kind: FAMILY_TASK_KIND.AUTHORIZATION,
        title: translate(`authorization_kind_${kind}`),
      }), childRow(participantId));
    });

  included.forEach((participantId) => {
    const outstanding = Number(data.statements?.get(participantId)?.totals?.total_outstanding ?? 0);
    if (outstanding > 0) {
      addRow(tasks, 'payment', () => ({
        kind: FAMILY_TASK_KIND.PAYMENT,
        title: translate('family_tasks_payment_title'),
      }), childRow(participantId, { amount: outstanding }));
    }
  });

  (data.packingLists || []).filter((row) => included.has(Number(row.participant_id)) && row.date >= data.today && hasUnpackedItems(row))
    .forEach((row) => addRow(tasks, `equipment:${row.meeting_id}`, () => ({ kind: FAMILY_TASK_KIND.EQUIPMENT, title: row.title, date: row.date, meetingId: Number(row.meeting_id) }), childRow(Number(row.participant_id))));

  // An event's deadline is the earliest any of its slips asks for.
  const list = [...tasks.values()].map((task) => {
    const deadlines = task.rows.map((row) => row.deadline).filter(Boolean).sort();
    return { ...task, deadline: deadlines[0] || null };
  });

  const events = list
    .filter((task) => [FAMILY_TASK_KIND.PERMISSION, FAMILY_TASK_KIND.EQUIPMENT].includes(task.kind))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const others = list
    .filter((task) => ![FAMILY_TASK_KIND.PERMISSION, FAMILY_TASK_KIND.EQUIPMENT].includes(task.kind))
    .sort((a, b) => UNDATED_KIND_ORDER.indexOf(a.kind) - UNDATED_KIND_ORDER.indexOf(b.kind)
      || a.title.localeCompare(b.title));
  return [...events, ...others];
}

/**
 * The children a task concerns, once each, joined for reading.
 *
 * @param {Object} task - A family task
 * @param {string} lang - Interface language
 * @returns {string} Names, e.g. "Ada and Léa"
 */
export function taskChildNames(task, lang) {
  const unique = [...new Set(task.rows.map((row) => row.name))];
  try {
    return new Intl.ListFormat(lang, { style: 'long', type: 'conjunction' }).format(unique);
  } catch {
    return unique.join(', ');
  }
}

/**
 * Markup of one task's actions.
 *
 * @param {Object} task - A family task
 * @param {Object} context - Rendering context (see renderFamilyTasks)
 * @param {string} titleId - Id of the task's title, naming its buttons
 * @returns {string} Markup
 */
function renderTaskActions(task, context, titleId) {
  const forTask = (labelKey, name) => `${translate(labelKey)}<span class="visually-hidden"> — ${escapeHTML(name)}</span>`;
  switch (task.kind) {
    case FAMILY_TASK_KIND.PERMISSION:
      return `
        <div class="family-task__actions">
          <button type="button" class="button button--primary js-family-sign" data-task-key="${escapeAttribute(task.key)}" aria-describedby="${titleId}">
            ${translate('permission_slip_sign')}
          </button>
          <button type="button" class="button button--secondary js-family-decline" data-task-key="${escapeAttribute(task.key)}" aria-describedby="${titleId}">
            ${translate('permission_slip_decline')}
          </button>
        </div>`;
    case FAMILY_TASK_KIND.EQUIPMENT:
      return `<a href="/personal-equipment/${task.meetingId}" class="button button--primary">${translate('personal_equipment_open')}</a>`;
    case FAMILY_TASK_KIND.PAYMENT: {
      const rows = task.rows.map((row) => `
        <li class="family-task__row">
          <span>${escapeHTML(row.name)}</span>
          <span class="family-task__amount">${escapeHTML(context.formatMoney(row.amount))}</span>
          ${context.financeHidden ? `
            <button type="button" class="button button--small button--secondary js-family-statement" data-participant-id="${row.participantId}">
              ${forTask('view_statement', row.name)}
            </button>` : ''}
        </li>`).join('');
      return `
        <ul class="family-task__rows">${rows}</ul>
        ${context.financeHidden ? '' : `
          <div class="family-task__actions">
            <a href="/parent-finance" class="button button--primary">${translate('family_tasks_pay')}</a>
          </div>`}`;
    }
    default: {
      const rows = task.rows.map((row) => {
        const name = escapeHTML(row.name);
        let actions = '';
        if (task.kind === FAMILY_TASK_KIND.FORM) {
          actions = `<a href="/dynamic-form/${encodeURIComponent(task.formType)}/${row.participantId}" class="button button--small button--primary">${forTask('family_tasks_fill', row.name)}</a>`;
        } else if (task.kind === FAMILY_TASK_KIND.REVIEW) {
          actions = `
            <button type="button" class="button button--small button--secondary js-confirm-review" data-submission-id="${row.submissionId}">
              ${forTask('form_review_confirm', row.name)}
            </button>
            <a href="/dynamic-form/${encodeURIComponent(task.formType)}/${row.participantId}" class="button button--small button--primary">
              ${forTask('form_review_update', row.name)}
            </a>`;
        } else {
          actions = `<a href="/medication-authorizations/${row.participantId}" class="button button--small button--primary">${forTask('authorization_sign_again', row.name)}</a>`;
        }
        return `
          <li class="family-task__row">
            <span>${name}</span>
            <span class="family-task__row-actions">${actions}</span>
          </li>`;
      }).join('');
      return `<ul class="family-task__rows">${rows}</ul>`;
    }
  }
}

/**
 * Markup of one task.
 *
 * @param {Object} task - A family task
 * @param {number} index - Its position, for unique ids
 * @param {Object} context - Rendering context (see renderFamilyTasks)
 * @returns {string} Markup
 */
function renderTask(task, index, context) {
  const titleId = `family-task-title-${index}`;
  const title = task.title || translate('permission_slip_section_title');
  const when = [];
  if (task.date) {
    when.push(`<span>${escapeHTML(context.formatDate(task.date))}</span>`);
  }
  if (task.deadline) {
    when.push(`<span>${translate('family_tasks_deadline').replace('{date}', escapeHTML(context.formatDate(task.deadline)))}</span>`);
  }
  return `
    <li class="family-task family-task--${task.kind}" data-task-key="${escapeAttribute(task.key)}">
      <div class="family-task__text">
        <p class="family-task__kind">${translate(`family_tasks_kind_${task.kind}`)}</p>
        <h3 class="family-task__title" id="${titleId}">${escapeHTML(title)}</h3>
        ${when.length ? `<p class="family-task__when">${when.join(' · ')}</p>` : ''}
        <p class="family-task__children">${translate('family_tasks_concerns').replace('{children}', escapeHTML(taskChildNames(task, context.lang)))}</p>
      </div>
      ${renderTaskActions(task, context, titleId)}
    </li>`;
}

/**
 * Markup of the "show tasks for" filter: every child, or one. Not offered to a
 * family of one child. The chosen option carries a check mark as well as
 * `aria-pressed`, so its state does not rest on colour.
 *
 * @param {Array<Object>} participants - The account's children
 * @param {number|string} filter - The current choice
 * @param {Map<number, number>} counts - Tasks per child
 * @returns {string} Markup, empty for a single child
 */
export function renderFamilyFilter(participants, filter, counts) {
  if (participants.length <= 1) {
    return '';
  }
  const names = childDisplayNames(participants);
  const option = (value, label, pressed) => `
    <button type="button" class="button button--small ${pressed ? 'button--primary' : 'button--secondary'} family-filter__option" data-family-filter="${escapeAttribute(String(value))}" aria-pressed="${pressed}">
      <span class="family-filter__mark" aria-hidden="true">${pressed ? '✓' : ''}</span>
      ${label}
    </button>`;
  const children = participants.map((child) => {
    const id = Number(child.id);
    const label = translate('family_filter_child')
      .replace('{name}', escapeHTML(names.get(id)))
      .replace('{count}', String(counts.get(id) || 0));
    return option(id, label, String(filter) === String(id));
  }).join('');
  return `
    <div class="family-filter" role="group" aria-label="${escapeAttribute(translate('family_filter_label'))}">
      ${option(ALL_CHILDREN, translate('family_filter_all'), filter === ALL_CHILDREN)}
      ${children}
    </div>`;
}

/**
 * Markup of the task list and its count, or what explains its absence.
 *
 * @param {Array<Object>} tasks - Tasks to show
 * @param {Object} context - Rendering context
 * @param {string} context.lang - Interface language
 * @param {Function} context.formatDate - Formats a YYYY-MM-DD or ISO date
 * @param {Function} context.formatMoney - Formats an amount
 * @param {boolean} context.financeHidden - The unit hides the finance page
 * @param {boolean} context.incomplete - Some tasks could not be loaded
 * @returns {string} Markup
 */
export function renderFamilyTaskList(tasks, context) {
  const countKey = tasks.length === 1 ? 'family_tasks_count_one' : 'family_tasks_count_other';
  const incomplete = context.incomplete ? `
    <div class="family-tasks__incomplete" role="alert">
      <p>${translate('family_tasks_incomplete')}</p>
      <button type="button" class="button button--small button--secondary" id="family-tasks-retry">${translate('retry')}</button>
    </div>` : '';
  if (!tasks.length) {
    return `
      ${incomplete}
      <p class="family-tasks__empty" role="status">${translate(context.incomplete ? 'family_tasks_none_loaded' : 'family_tasks_empty')}</p>`;
  }
  return `
    ${incomplete}
    <p class="visually-hidden" role="status">${translate(countKey).replace('{count}', String(tasks.length))}</p>
    <ul class="family-tasks__list">${tasks.map((task, index) => renderTask(task, index, context)).join('')}</ul>`;
}
