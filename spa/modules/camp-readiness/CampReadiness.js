/**
 * Camp preparation by the team, distinct from preparation of this device.
 *
 * "What is left" comes first, one line per section the person may see; each row then links
 * to the screen that owns its action. An empty or hidden section is never read as ready.
 *
 * @module spa/modules/camp-readiness/CampReadiness
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate, getTodayISO } from '../../utils/DateUtils.js';
import { formatEquipmentQuantity } from '../../utils/EquipmentUnitUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { CAMP_LOTS } from '../../config/camp-lots.js';
import { getCampReadiness, getActivityCampReadiness } from '../../api/api-camp-readiness.js';
import { shiftName } from '../../utils/VolunteerTypeUtils.js';
import styles from '../../../css/camp-readiness.css?url';

export const READINESS_LABELS = {
  signed: 'permission_slip_status_signed', pending: 'permission_slip_status_pending',
  declined: 'permission_slip_status_declined', expired: 'permission_slip_status_expired', revoked: 'permission_slip_status_revoked',
  to_prepare: 'camp_lot_to_prepare', loaded: 'camp_lot_loaded', returned: 'camp_lot_returned',
  todo: 'tasks_status_todo', in_progress: 'tasks_status_in_progress', done: 'tasks_status_done',
  reserved: 'camp_material_status_reserved', available: 'camp_material_status_available', missing: 'camp_material_status_missing',
  unavailable: 'camp_material_status_unavailable', not_in_inventory: 'camp_material_status_not_in_inventory',
};

/** Standings that still call for reserving, borrowing or buying; an article outside the inventory has neither. */
const MATERIAL_TO_DO = ['available', 'missing', 'unavailable', 'not_in_inventory'];
const SECTION_ORDER = ['permissions', 'material', 'lots', 'volunteers', 'tasks'];
/** A consent deadline is an instant; its calendar date is its first YYYY-MM-DD characters. */
const ISO_DATE_LENGTH = 10;

export class CampReadiness {
  /** @param {Object} app @param {{meetingId?: number, activityId?: number}} camp - A planned camp, or a camp recorded as an activity */
  constructor(app, { meetingId = null, activityId = null }) {
    this.app = app;
    this.meetingId = meetingId;
    this.activityId = activityId;
    this.destroyed = false;
    this.request = 0;
    this.scope = buildScopedCacheKey('');
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
  }

  root() { return document.getElementById('app'); }

  lang() { return this.app.lang || 'fr'; }

  date(value) { return value ? formatDate(value, this.lang()) : translate('camp_readiness_no_due'); }

  status(value) { return translate(READINESS_LABELS[value] || 'camp_readiness_unknown'); }

  count(value) { return new Intl.NumberFormat(localeForLanguage(this.lang())).format(value); }

  /** @returns {string} Back to the camp's year plan, where its schedule opens, or to the activities */
  backHref() {
    if (this.activityId && !this.data?.camp?.id) { return '/activities'; }
    const planId = Number(this.data?.camp?.year_plan_id);
    return Number.isInteger(planId) && planId > 0 ? `/yearly-planner/${planId}` : '/yearly-planner';
  }

  /** Late answers must neither replace a newer refresh nor another session's screen. */
  stale(request) {
    return this.destroyed || request !== this.request || this.scope !== buildScopedCacheKey('');
  }

  async init() {
    const request = ++this.request;
    const options = { title: translate('camp_readiness_title'), backHref: this.backHref() };
    loadStylesheet(styles).catch((err) => debugError('Camp readiness stylesheet failed', err));
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await (this.activityId ? getActivityCampReadiness(this.activityId) : getCampReadiness(this.meetingId));
      if (this.stale(request)) { return; }
      if (!response?.data?.camp || !response.data.sections) { throw new Error('Missing camp preparation'); }
      this.data = response.data;
      this.render();
    } catch (err) {
      if (this.stale(request)) { return; }
      debugError('Camp preparation failed', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'error_loading_data'), retryId: 'camp-readiness-retry' }));
      this.root().querySelector('#camp-readiness-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @param {string|null} due @param {boolean} done @returns {boolean} */
  overdue(due, done) {
    return Boolean(due) && !done && String(due).slice(0, ISO_DATE_LENGTH) < getTodayISO();
  }

  /**
   * What is left in one section, as a sentence, and whether it still needs someone.
   * @param {string} key - Section
   * @returns {{text: string, attention: boolean}}
   */
  leftIn(key) {
    const section = this.data.sections[key];
    const recorded = (rows) => rows.length > 0;
    if (key === 'permissions') {
      if (!recorded(section)) { return { text: translate('camp_readiness_left_none'), attention: true }; }
      const total = (status) => section.filter((row) => row.status === status).reduce((sum, row) => sum + Number(row.count), 0);
      const pending = total('pending');
      return { attention: pending > 0, text: translate('camp_readiness_left_permissions')
        .replace('{pending}', this.count(pending)).replace('{signed}', this.count(total('signed'))) };
    }
    if (key === 'material') {
      if (!recorded(section.items) && !recorded(section.free_text || [])) { return { text: translate('camp_readiness_left_none'), attention: true }; }
      const parts = [];
      if (!section.inventory_compared) {
        parts.push(translate('camp_readiness_left_material_unchecked').replace('{count}', this.count(section.items.length)));
      } else {
        const left = section.items.filter((item) => MATERIAL_TO_DO.includes(item.inventory?.status)).length;
        parts.push(left ? translate('camp_readiness_left_material').replace('{count}', this.count(left)) : translate('camp_readiness_left_material_done'));
      }
      if (section.free_text?.length) {
        parts.push(translate('camp_readiness_left_free_text').replace('{count}', this.count(section.free_text.length)));
      }
      const attention = !section.inventory_compared || Boolean(section.free_text?.length)
        || section.items.some((item) => MATERIAL_TO_DO.includes(item.inventory?.status));
      return { text: parts.join(' · '), attention };
    }
    if (key === 'lots') {
      if (!recorded(section)) { return { text: translate('camp_readiness_left_none'), attention: true }; }
      const left = section.filter((lot) => lot.status === 'to_prepare').length;
      return { attention: left > 0, text: left
        ? translate('camp_readiness_left_lots').replace('{count}', this.count(left)).replace('{total}', this.count(section.length))
        : translate('camp_readiness_left_lots_done') };
    }
    if (key === 'volunteers') {
      if (!recorded(section)) { return { text: translate('camp_readiness_left_none'), attention: true }; }
      const vacant = section.reduce((sum, shift) => sum + Math.max(0, Number(shift.slots) - Number(shift.taken)), 0);
      const total = section.reduce((sum, shift) => sum + Number(shift.slots), 0);
      // A place held while its requirements are verified is taken, but not yet settled.
      const pending = section.reduce((sum, shift) => sum + Number(shift.pending || 0), 0);
      const parts = [vacant
        ? translate('camp_readiness_left_volunteers').replace('{vacant}', this.count(vacant)).replace('{total}', this.count(total))
        : translate('camp_readiness_left_volunteers_done')];
      if (pending) { parts.push(translate('volunteers_pending_count').replace('{count}', this.count(pending))); }
      return { attention: vacant > 0 || pending > 0, text: parts.join(' · ') };
    }
    if (!recorded(section)) { return { text: translate('camp_readiness_left_none'), attention: true }; }
    const open = section.filter((task) => task.status !== 'done');
    const late = open.filter((task) => this.overdue(task.due_date, false)).length;
    if (!open.length) { return { text: translate('camp_readiness_left_tasks_done'), attention: false }; }
    const text = late
      ? translate('camp_readiness_left_tasks_late').replace('{count}', this.count(open.length)).replace('{late}', this.count(late))
      : translate('camp_readiness_left_tasks').replace('{count}', this.count(open.length));
    return { text, attention: true };
  }

  leftMarkup() {
    const lines = SECTION_ORDER.filter((key) => this.data.sections[key]).map((key) => {
      const { text, attention } = this.leftIn(key);
      return `<li class="${attention ? 'is-attention' : 'is-clear'}">
        <a href="#camp-readiness-${key}">${escapeHTML(translate(`camp_readiness_${key}`))}</a>
        <span>${escapeHTML(text)}</span></li>`;
    }).join('');
    return `<section class="camp-readiness__left" aria-labelledby="camp-readiness-left-title">
      <h2 id="camp-readiness-left-title">${escapeHTML(translate('camp_readiness_left_title'))}</h2>
      <ul>${lines}</ul></section>`;
  }

  /**
   * One row: what it is (a link to the screen that owns it), its state in words, then details.
   * @param {{title: string, href: string, detail?: string, chip?: string, late?: boolean, owner?: string, due?: string}} row
   */
  row({ title, href, detail = '', chip = '', late = false, owner = '', due = '' }) {
    return `<li class="camp-readiness__row">
      <div class="camp-readiness__row-head"><a class="camp-readiness__link" href="${escapeAttribute(href)}">${escapeHTML(title)}</a>
        ${chip ? `<span class="camp-readiness__chip">${escapeHTML(chip)}</span>` : ''}
        ${late ? `<span class="camp-readiness__chip camp-readiness__chip--late">${escapeHTML(translate('tasks_overdue'))}</span>` : ''}</div>
      ${detail ? `<p>${escapeHTML(detail)}</p>` : ''}
      ${owner ? `<p>${escapeHTML(translate('camp_readiness_owner'))} ${escapeHTML(owner)}</p>` : ''}
      ${due ? `<p>${escapeHTML(translate('camp_readiness_due'))} ${escapeHTML(this.date(due))}</p>` : ''}</li>`;
  }

  section(key, rows, href) {
    return `<section class="camp-readiness__section" id="camp-readiness-${key}" aria-labelledby="camp-readiness-${key}-title" tabindex="-1">
      <h2 id="camp-readiness-${key}-title">${escapeHTML(translate(`camp_readiness_${key}`))}</h2>
      ${rows ? `<ul class="camp-readiness__list">${rows}</ul>`
    : `<p>${escapeHTML(translate('camp_readiness_unconfigured'))}</p><a class="button button--secondary" href="${escapeAttribute(href)}">${escapeHTML(translate('camp_readiness_open'))}</a>`}
    </section>`;
  }

  sectionsMarkup() {
    const { camp, sections } = this.data;
    const meetingId = Number(camp.id);
    const slipsHref = `/permission-slips/${Number(camp.activity_id)}`;
    let body = '';
    if (sections.permissions) {
      body += this.section('permissions', sections.permissions.map((row) => this.row({
        title: this.status(row.status), href: slipsHref, detail: this.count(row.count), due: row.deadline,
      })).join(''), slipsHref);
    }
    if (sections.material) {
      const material = sections.material;
      const rows = material.items.map((item) => this.row({
        title: item.name, href: `/camp-material/${meetingId}`,
        chip: material.inventory_compared ? this.status(item.inventory?.status) : translate('camp_readiness_inventory_unchecked'),
        detail: `${translate('camp_readiness_needed')} ${formatEquipmentQuantity(item.quantity, item.unit_of_measure, this.lang())}`,
      })).join('');
      body += this.section('material', rows, `/camp-material/${meetingId}`);
    }
    if (sections.lots) {
      body += this.section('lots', sections.lots.map((lot) => {
        const due = lot.roles?.find((role) => role.role === 'prepare')?.due_date;
        return this.row({
          title: lot.name, href: `/camp-lots/${meetingId}`, chip: this.status(lot.status), due,
          late: this.overdue(due, lot.status !== 'to_prepare'),
          owner: (lot.roles || []).map((role) => `${translate(CAMP_LOTS.ROLE_KEYS[role.role] || 'camp_readiness_unknown')}: ${role.name}`).join(', '),
        });
      }).join(''), `/camp-lots/${meetingId}`);
    }
    if (sections.volunteers) {
      body += this.section('volunteers', sections.volunteers.map((shift) => {
        const free = Math.max(0, Number(shift.slots) - Number(shift.taken));
        const places = free ? translate('volunteers_places_free').replace('{free}', this.count(free)).replace('{slots}', this.count(shift.slots))
          : translate('volunteers_full');
        return this.row({
          title: shiftName(shift), href: '/volunteers',
          chip: Number(shift.pending) > 0
            ? `${places} · ${translate('volunteers_pending_count').replace('{count}', this.count(shift.pending))}` : places,
          detail: translate('volunteers_when').replace('{date}', this.date(shift.shift_date))
            .replace('{start}', shift.start_time).replace('{end}', shift.end_time),
        });
      }).join(''), '/volunteers');
    }
    if (sections.tasks) {
      const tasksHref = `/tasks?${[meetingId ? `meeting_id=${meetingId}` : '', camp.activity_id ? `activity_id=${Number(camp.activity_id)}` : '']
        .filter(Boolean).join('&')}`;
      body += this.section('tasks', sections.tasks.map((task) => this.row({
        title: task.title, href: task.equipment_lot_id && sections.lots ? `/camp-lots/${meetingId}` : tasksHref,
        chip: this.status(task.status), late: this.overdue(task.due_date, task.status === 'done'),
        owner: task.assignee_name, due: task.due_date,
      })).join(''), '/tasks');
    }
    return body;
  }

  render() {
    const { camp } = this.data;
    setContent(this.root(), `<section class="page camp-readiness">${renderBackLink(this.backHref())}
      <h1>${escapeHTML(translate('camp_readiness_title'))}</h1>
      <p class="camp-readiness__camp"><strong>${escapeHTML(camp.theme || translate('camp_readiness_camp'))}</strong>
        <span>${escapeHTML(this.date(camp.date_from))} – ${escapeHTML(this.date(camp.date_to))}</span></p>
      ${camp.is_cancelled ? `<p role="status">${escapeHTML(translate('camp_readiness_cancelled'))}</p>` : ''}
      ${camp.scheduled === false ? `<p class="camp-readiness__notice">${escapeHTML(translate('camp_readiness_unscheduled'))}</p>` : ''}
      ${this.leftMarkup()}
      <p class="camp-readiness__explanation">${escapeHTML(translate('camp_readiness_explanation'))}</p>
      <button class="button button--secondary button--small" type="button" id="camp-readiness-refresh">${escapeHTML(translate('refresh'))}</button>
      ${this.sectionsMarkup()}</section>`);
    this.root().querySelector('#camp-readiness-refresh').addEventListener('click', () => this.init());
  }
}
