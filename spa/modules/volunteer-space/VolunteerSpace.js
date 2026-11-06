/**
 * Volunteer space (#1360): everything a member needs for the camps they take part in, in one place.
 *
 * `/volunteer-space` gathers the member's camps, their upcoming places on shifts, their open tasks,
 * and the parts of their account a camp relies on (certifications, allergies). `/volunteer-space/:id`
 * opens one camp: the member's shifts, the daily schedule, what their shift types call for (menus for
 * a cook, the departure for a driver, emergencies first for a night watch), the site and emergency
 * numbers, the team's instructions, and their tasks. A camp opens only to those who take part in it
 * (a place on one of its shifts, or a seat on its team); the server decides. Nothing here names a
 * youth or another volunteer. Places are taken on /volunteers and tasks changed on /tasks: this
 * space reads and leads there.
 *
 * @module spa/modules/volunteer-space/VolunteerSpace
 */
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute, sanitizeURL } from '../../utils/SecurityUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { formatDate, getTodayISO } from '../../utils/DateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { richTextOrPlain } from '../../utils/RichTextUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { requirementsLabel, shiftName, volunteerTypeLabel } from '../../utils/VolunteerTypeUtils.js';
import { getCampContacts } from '../../api/api-member-profile.js';
import { getVolunteerSpace, getVolunteerSpaceCamp } from '../../api/api-volunteer-space.js';
import styles from '../../../css/volunteer-space.css?url';

const HTTP_NOT_FOUND = 404;
/** The team's instructions, in the plan's order; emergencies are shown with the site. */
const INSTRUCTION_SECTIONS = ['rules_of_life', 'camp_rules', 'code_of_ethics'];
const EMERGENCY_SECTION = 'emergency_procedures';

/** @param {string} phone @returns {string} A phone number as a link that dials it */
function phoneLink(phone) {
  const dial = String(phone).replace(/[^\d+]/g, '');
  return dial
    ? `<a class="volunteer-space__phone" href="tel:${escapeAttribute(dial)}">${escapeHTML(phone)}</a>`
    : escapeHTML(phone);
}

export class VolunteerSpace {
  /**
   * @param {Object} app - Application instance
   * @param {{activityId?: number|string|null}} [options] - A camp to open (the route's id); none for the space's first page
   */
  constructor(app, { activityId = null } = {}) {
    this.app = app;
    this.activityId = activityId === null || activityId === undefined || activityId === '' ? null : Number(activityId);
    this.data = null;
    this.destroyed = false;
    this.scope = buildScopedCacheKey('');
  }

  destroy() {
    this.destroyed = true;
  }

  root() { return document.getElementById('app'); }

  lang() { return this.app.lang || 'fr'; }

  /** A late answer must not draw over the next screen, or over another account's or unit's. */
  stale() { return this.destroyed || this.scope !== buildScopedCacheKey(''); }

  isCamp() { return this.activityId !== null; }

  async init() {
    loadStylesheet(styles).catch((err) => debugError('Volunteer space stylesheet failed', err));
    if (this.isCamp() && !(Number.isInteger(this.activityId) && this.activityId > 0)) {
      this.renderError({ status: HTTP_NOT_FOUND });
      return;
    }
    this.renderLoading();
    try {
      const response = this.isCamp() ? await getVolunteerSpaceCamp(this.activityId) : await getVolunteerSpace();
      this.data = response?.data || null;
      if (this.stale()) { return; }
      if (this.isCamp()) {
        this.renderCamp();
        await this.loadContacts();
      } else {
        this.renderOverview();
      }
    } catch (err) {
      debugError('Failed to load the volunteer space:', err);
      this.renderError(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Shared pieces
  // ---------------------------------------------------------------------------

  /** Back link and heading, the same in every state. */
  header(title = translate('volunteer_space_title'), intro = translate('volunteer_space_intro')) {
    return `${renderBackLink(this.isCamp() ? '/volunteer-space' : '/dashboard')}
      <h1>${escapeHTML(title)}</h1>
      ${intro ? `<p class="volunteer-space__intro">${escapeHTML(intro)}</p>` : ''}`;
  }

  renderLoading() {
    setContent(this.root(), `<section class="page volunteer-space" aria-busy="true">${this.header()}
      <p role="status">${escapeHTML(translate('loading'))}</p></section>`);
  }

  renderError(err) {
    if (this.stale()) { return; }
    // A camp the member takes no part in reads as not found: a reload would not change it.
    const notFound = err?.status === HTTP_NOT_FOUND;
    setContent(this.root(), `<section class="page volunteer-space">${this.header()}
      <p class="status-message error" role="alert">${escapeHTML(notFound
    ? translate('volunteer_space_camp_not_found') : apiErrorMessage(err, 'volunteer_space_load_failed'))}</p>
      ${notFound ? '' : `<button type="button" class="button button--primary" id="volunteer-space-retry">${escapeHTML(translate('retry'))}</button>`}
      </section>`);
    this.root().querySelector('#volunteer-space-retry')?.addEventListener('click', () => this.init());
  }

  dates(from, to) {
    return from === to || !to
      ? formatDate(from, this.lang())
      : translate('camp_readiness_upcoming_dates')
        .replace('{from}', formatDate(from, this.lang())).replace('{to}', formatDate(to, this.lang()));
  }

  /** A section with its heading; `id` is the in-page link's target. */
  section(id, titleKey, body, { icon = '' } = {}) {
    return `<section class="volunteer-space__section" id="${id}" aria-labelledby="${id}-title" tabindex="-1">
      <h2 id="${id}-title">${icon ? `<i class="fa-solid ${icon}" aria-hidden="true"></i> ` : ''}${escapeHTML(translate(titleKey))}</h2>
      ${body}</section>`;
  }

  empty(key, action = '') {
    return `<p class="volunteer-space__empty">${escapeHTML(translate(key))}</p>${action}`;
  }

  link(href, labelKey, variant = 'secondary') {
    return `<a class="button button--${variant}" href="${escapeAttribute(href)}">${escapeHTML(translate(labelKey))}</a>`;
  }

  /** A place on a shift: what, when, and whether it is confirmed, in words. */
  shiftItem(shift, { withActivity = false } = {}) {
    const when = translate('volunteers_when')
      .replace('{date}', formatDate(shift.shift_date, this.lang()))
      .replace('{start}', shift.start_time).replace('{end}', shift.end_time);
    const status = shift.status === 'pending'
      ? translate('volunteers_your_place_pending').replace('{missing}', requirementsLabel(shift.missing || []))
      : translate('volunteers_your_place');
    return `<li class="volunteer-space__card ${shift.status === 'pending' ? 'is-pending' : 'is-confirmed'}">
      <h3>${escapeHTML(shiftName(shift))}</h3>
      ${withActivity ? `<p class="volunteer-space__muted">${escapeHTML(shift.activity_name)}</p>` : ''}
      <p>${escapeHTML(when)}</p>
      <p class="volunteer-space__state">${escapeHTML(status)}</p></li>`;
  }

  taskItem(task) {
    const where = task.activity_name || task.meeting_name || '';
    return `<li class="volunteer-space__task is-${escapeAttribute(task.status)}">
      <span class="volunteer-space__task-title">${escapeHTML(task.title)}</span>
      <span class="volunteer-space__muted">${escapeHTML(translate('volunteer_space_task_due')
    .replace('{date}', formatDate(task.due_date, this.lang())))}${where ? ` · ${escapeHTML(where)}` : ''}</span>
      <span class="volunteer-space__state">${escapeHTML(translate(`tasks_status_${task.status}`))}</span></li>`;
  }

  // ---------------------------------------------------------------------------
  // The space's first page
  // ---------------------------------------------------------------------------

  /** What the member does at a camp: their seat on the team, then their shift types. */
  campRole(camp) {
    const parts = [];
    if (camp.team_role) { parts.push(translate(`camp_roster_role_${camp.team_role}`)); }
    if (camp.shift_count) {
      parts.push(translate('volunteer_space_camp_shifts').replace('{count}', String(camp.shift_count)));
    }
    if (camp.pending_count) {
      parts.push(translate('volunteer_space_camp_pending').replace('{count}', String(camp.pending_count)));
    }
    return parts.join(' · ');
  }

  campCard(camp) {
    const today = getTodayISO();
    const now = camp.start_date <= today && today <= camp.end_date;
    return `<li class="volunteer-space__card volunteer-space__camp">
      <h3><a href="/volunteer-space/${Number(camp.activity_id)}">${escapeHTML(camp.name)}</a></h3>
      <p>${now ? `<span class="volunteer-space__chip">${escapeHTML(translate('volunteer_space_camp_now'))}</span> ` : ''}${escapeHTML(this.dates(camp.start_date, camp.end_date))}</p>
      <p class="volunteer-space__muted">${escapeHTML(this.campRole(camp))}</p></li>`;
  }

  profileMarkup() {
    return `<a class="volunteer-space__link" href="/account-info#my-profile">
      <i class="fa-solid fa-id-card" aria-hidden="true"></i>
      <span><span class="volunteer-space__link-label">${escapeHTML(translate('member_profile_open'))}</span>
      <span class="volunteer-space__muted">${escapeHTML(translate('member_profile_open_hint'))}</span></span></a>`;
  }

  renderOverview() {
    const { camps = [], shifts = [], tasks = [], open_tasks: openTasks = 0 } = this.data || {};
    const canTakeShifts = hasPermission('volunteers.view');
    const canSeeTasks = hasPermission('tasks.view');
    const takeShift = canTakeShifts ? this.link('/volunteers', 'volunteer_space_take_shift', 'primary') : '';
    const campsBody = camps.length
      ? `<ul class="volunteer-space__grid">${camps.map((camp) => this.campCard(camp)).join('')}</ul>`
      : this.empty('volunteer_space_camps_empty', takeShift);
    const shiftsBody = shifts.length
      ? `<ul class="volunteer-space__grid">${shifts.map((shift) => this.shiftItem(shift, { withActivity: true })).join('')}</ul>
        ${canTakeShifts ? `<p>${this.link('/volunteers', 'volunteer_space_more_shifts')}</p>` : ''}`
      : this.empty('volunteer_space_shifts_empty', camps.length ? takeShift : '');
    const more = openTasks > tasks.length
      ? translate('volunteer_space_tasks_more').replace('{count}', String(openTasks)) : translate('volunteer_space_tasks_all');
    const tasksBody = tasks.length
      ? `<ul class="volunteer-space__tasks">${tasks.map((task) => this.taskItem(task)).join('')}</ul>
        ${canSeeTasks ? `<p><a class="button button--secondary" href="/tasks">${escapeHTML(more)}</a></p>` : ''}`
      : this.empty('volunteer_space_tasks_empty');
    setContent(this.root(), `<section class="page volunteer-space">${this.header()}
      ${this.section('volunteer-space-camps', 'volunteer_space_camps_title', campsBody, { icon: 'fa-campground' })}
      ${this.section('volunteer-space-shifts', 'volunteer_space_shifts_title', shiftsBody, { icon: 'fa-handshake-angle' })}
      ${this.section('volunteer-space-tasks', 'volunteer_space_tasks_title', tasksBody, { icon: 'fa-list-check' })}
      ${this.section('volunteer-space-profile', 'volunteer_space_profile_title', `<p class="volunteer-space__muted">${escapeHTML(translate('volunteer_space_profile_intro'))}</p>${this.profileMarkup()}`, { icon: 'fa-id-card' })}
      </section>`);
  }

  // ---------------------------------------------------------------------------
  // One camp
  // ---------------------------------------------------------------------------

  /** The day to open first: today during the camp, otherwise its first day. */
  openDay(schedule) {
    const today = getTodayISO();
    return schedule.some((day) => day.date === today) ? today : schedule[0]?.date;
  }

  scheduleMarkup() {
    const schedule = Array.isArray(this.data.schedule) ? this.data.schedule : [];
    const written = schedule.some((day) => day.title || day.items.length);
    if (!written) {
      return this.empty('volunteer_space_schedule_empty');
    }
    const open = this.openDay(schedule);
    const today = getTodayISO();
    return schedule.map((day) => {
      const label = translate('volunteer_space_day').replace('{number}', String(day.day_offset + 1))
        .replace('{date}', formatDate(day.date, this.lang()));
      const items = day.items.map((item) => {
        const time = item.start_time ? escapeHTML(item.start_time) : escapeHTML(translate('volunteer_space_no_time'));
        const duration = item.duration_minutes
          ? ` <span class="volunteer-space__muted">${escapeHTML(translate('volunteer_space_minutes').replace('{count}', String(item.duration_minutes)))}</span>` : '';
        return `<li><span class="volunteer-space__time">${time}</span><span>${escapeHTML(item.name)}${duration}</span></li>`;
      }).join('');
      return `<details class="volunteer-space__day"${day.date === open ? ' open' : ''}>
        <summary><span>${escapeHTML(label)}</span>${day.date === today ? ` <span class="volunteer-space__chip">${escapeHTML(translate('volunteer_space_today'))}</span>` : ''}
          ${day.title ? `<span class="volunteer-space__day-title">${escapeHTML(day.title)}</span>` : ''}</summary>
        ${items ? `<ul class="volunteer-space__timeline">${items}</ul>` : `<p class="volunteer-space__empty">${escapeHTML(translate('volunteer_space_day_empty'))}</p>`}
      </details>`;
    }).join('');
  }

  menusMarkup() {
    const menus = Array.isArray(this.data.menus) ? this.data.menus : [];
    if (!menus.length) {
      return this.empty('volunteer_space_menus_empty');
    }
    return `<ul class="volunteer-space__grid">${menus.map((meal) => `<li class="volunteer-space__card volunteer-space__menu">
      <h3>${escapeHTML(meal.title || volunteerTypeLabel('cook'))}</h3>
      <p class="volunteer-space__muted">${escapeHTML(translate('volunteers_when').replace('{date}', formatDate(meal.shift_date, this.lang()))
    .replace('{start}', meal.start_time).replace('{end}', meal.end_time))}</p>
      <p class="volunteer-space__menu-text">${escapeHTML(meal.notes)}</p></li>`).join('')}</ul>`;
  }

  fact(labelKey, value) {
    if (value === null || value === undefined || value === '') { return ''; }
    return `<div class="volunteer-space__fact"><dt>${escapeHTML(translate(labelKey))}</dt><dd>${value}</dd></div>`;
  }

  externalLink(url, labelKey) {
    const safe = sanitizeURL(url || '', { allowMailto: false });
    return safe ? `<a class="button button--secondary" href="${escapeAttribute(safe)}" target="_blank" rel="noopener noreferrer">
      ${escapeHTML(translate(labelKey))}<span class="sr-only"> ${escapeHTML(translate('camp_site_opens_new_tab'))}</span></a>` : '';
  }

  transportMarkup() {
    const { camp } = this.data;
    const going = [
      this.fact('volunteer_space_meeting_place', camp.meeting_location_going ? escapeHTML(camp.meeting_location_going) : ''),
      this.fact('volunteer_space_meeting_time', camp.meeting_time_going ? escapeHTML(camp.meeting_time_going) : ''),
      this.fact('volunteer_space_departure_time', camp.departure_time_going ? escapeHTML(camp.departure_time_going) : ''),
    ].join('');
    const back = [
      this.fact('volunteer_space_meeting_place', camp.meeting_location_return ? escapeHTML(camp.meeting_location_return) : ''),
      this.fact('volunteer_space_meeting_time', camp.meeting_time_return ? escapeHTML(camp.meeting_time_return) : ''),
      this.fact('volunteer_space_departure_time', camp.departure_time_return ? escapeHTML(camp.departure_time_return) : ''),
    ].join('');
    const actions = [
      hasPermission('carpools.view') ? this.link(`/carpool/${Number(camp.activity_id)}`, 'volunteer_space_carpool') : '',
      this.externalLink(this.data.site?.directions_url, 'camp_site_directions'),
    ].filter(Boolean).join('');
    return `${going ? `<h3>${escapeHTML(translate('volunteer_space_going'))}</h3><dl class="volunteer-space__facts">${going}</dl>` : ''}
      ${back ? `<h3>${escapeHTML(translate('volunteer_space_return'))}</h3><dl class="volunteer-space__facts">${back}</dl>` : ''}
      ${going || back ? '' : this.empty('volunteer_space_transport_empty')}
      ${actions ? `<p class="volunteer-space__actions">${actions}</p>` : ''}`;
  }

  siteMarkup() {
    const { site } = this.data;
    const emergency = (this.data.sections || []).find((section) => section.key === EMERGENCY_SECTION);
    const procedures = emergency ? `<h3>${escapeHTML(translate('camp_plan_section_emergency_procedures'))}</h3>
      <div class="volunteer-space__rich">${richTextOrPlain(emergency.body_html, emergency.body_text)}</div>` : '';
    if (!site) {
      return `${this.empty(this.data.has_plan ? 'volunteer_space_site_empty' : 'volunteer_space_site_unplanned')}${procedures}`;
    }
    const travel = site.hospital_travel_minutes !== null && site.hospital_travel_minutes !== undefined
      ? escapeHTML(translate('camp_site_minutes_value').replace('{count}', String(site.hospital_travel_minutes))) : '';
    const place = [
      this.fact('camp_site_name', site.name ? escapeHTML(site.name) : ''),
      this.fact('camp_site_address', site.address ? `<span class="volunteer-space__pre">${escapeHTML(site.address)}</span>` : ''),
      this.fact('camp_site_lead', site.on_site_lead_name ? escapeHTML(site.on_site_lead_name) : ''),
      this.fact('camp_site_contact_phone', site.contact_phone || site.phone ? phoneLink(site.contact_phone || site.phone) : ''),
    ].join('');
    const help = [
      this.fact('camp_site_hospital_name', site.hospital_name ? escapeHTML(site.hospital_name) : ''),
      this.fact('camp_site_hospital_address', site.hospital_address ? `<span class="volunteer-space__pre">${escapeHTML(site.hospital_address)}</span>` : ''),
      this.fact('camp_site_hospital_phone', site.hospital_phone ? phoneLink(site.hospital_phone) : ''),
      this.fact('camp_site_hospital_travel', travel),
      this.fact('camp_site_poison_centre', site.poison_centre_phone ? phoneLink(site.poison_centre_phone) : ''),
      this.fact('camp_site_other_numbers', site.other_emergency_numbers ? `<span class="volunteer-space__pre">${escapeHTML(site.other_emergency_numbers)}</span>` : ''),
    ].join('');
    const links = [
      this.externalLink(site.directions_url, 'camp_site_directions'),
      this.externalLink(site.hospital_directions_url, 'camp_site_hospital_directions'),
    ].filter(Boolean).join('');
    return `${place ? `<dl class="volunteer-space__facts">${place}</dl>` : ''}
      ${help ? `<h3>${escapeHTML(translate('camp_site_section_emergency'))}</h3><dl class="volunteer-space__facts">${help}</dl>` : ''}
      ${links ? `<p class="volunteer-space__actions">${links}</p>` : ''}
      ${procedures}`;
  }

  instructionsMarkup() {
    const sections = (this.data.sections || []).filter((section) => INSTRUCTION_SECTIONS.includes(section.key));
    if (!sections.length) {
      return this.empty('volunteer_space_instructions_empty');
    }
    return sections.map((section) => `<h3>${escapeHTML(translate(`camp_plan_section_${section.key}`))}</h3>
      <div class="volunteer-space__rich">${richTextOrPlain(section.body_html, section.body_text)}</div>`).join('');
  }

  campTasksMarkup() {
    const tasks = Array.isArray(this.data.tasks) ? this.data.tasks : [];
    if (!tasks.length) {
      return this.empty('volunteer_space_camp_tasks_empty');
    }
    return `<ul class="volunteer-space__tasks">${tasks.map((task) => this.taskItem(task)).join('')}</ul>
      ${hasPermission('tasks.view') ? `<p>${this.link('/tasks', 'volunteer_space_tasks_open')}</p>` : ''}`;
  }

  campShiftsMarkup() {
    const shifts = Array.isArray(this.data.shifts) ? this.data.shifts : [];
    const take = hasPermission('volunteers.view') ? this.link('/volunteers', 'volunteer_space_take_shift') : '';
    return shifts.length
      ? `<ul class="volunteer-space__grid">${shifts.map((shift) => this.shiftItem(shift)).join('')}</ul>${take ? `<p>${take}</p>` : ''}`
      : this.empty(this.data.team_role ? 'volunteer_space_camp_shifts_team' : 'volunteer_space_shifts_empty', take);
  }

  /** The parts of the camp page, in the order the member's shift types call for. */
  campParts() {
    const panels = this.data.panels || [];
    const parts = [
      { id: 'volunteer-space-my-shifts', title: 'volunteer_space_my_shifts_title', icon: 'fa-handshake-angle', body: () => this.campShiftsMarkup() },
      { id: 'volunteer-space-schedule', title: 'volunteer_space_schedule_title', icon: 'fa-clock', body: () => this.scheduleMarkup() },
    ];
    if (panels.includes('menus')) {
      parts.push({ id: 'volunteer-space-menus', title: 'volunteer_space_menus_title', icon: 'fa-utensils', body: () => this.menusMarkup() });
    }
    if (panels.includes('transport')) {
      parts.push({ id: 'volunteer-space-transport', title: 'volunteer_space_transport_title', icon: 'fa-car', body: () => this.transportMarkup() });
    }
    const site = { id: 'volunteer-space-site', title: 'volunteer_space_site_title', icon: 'fa-kit-medical', body: () => this.siteMarkup() };
    // A night watch or first aid reads emergencies right after their shifts.
    if (panels.includes('emergency_first')) {
      parts.splice(1, 0, site);
    } else {
      parts.push(site);
    }
    parts.push(
      { id: 'volunteer-space-instructions', title: 'volunteer_space_instructions_title', icon: 'fa-book-open', body: () => this.instructionsMarkup() },
      { id: 'volunteer-space-contacts', title: 'member_profile_camp_contacts', icon: 'fa-address-book', body: () => `<div id="camp-peer-contacts"><p role="status">${escapeHTML(translate('loading'))}</p></div>` },
      { id: 'volunteer-space-camp-tasks', title: 'volunteer_space_camp_tasks_title', icon: 'fa-list-check', body: () => this.campTasksMarkup() },
    );
    return parts;
  }

  /** Consent may have been withdrawn: peer contacts never use an offline or cached answer. */
  async loadContacts() {
    try {
      const result = await getCampContacts(this.activityId);
      if (this.stale()) { return; }
      const people = Array.isArray(result.data) ? result.data : [];
      setContent(document.getElementById('camp-peer-contacts'), people.length
        ? `<ul class="volunteer-space__tasks">${people.map((person) => `<li><strong>${escapeHTML(person.nickname || person.name)}</strong> ${phoneLink(person.phone)}</li>`).join('')}</ul>`
        : `<p>${escapeHTML(translate('member_profile_contacts_empty'))}</p>`);
    } catch (_err) {
      if (this.stale()) { return; }
      setContent(document.getElementById('camp-peer-contacts'), `<p role="status">${escapeHTML(translate('member_profile_contacts_unavailable'))}</p>
        <button class="button button--secondary" type="button" id="camp-contacts-retry">${escapeHTML(translate('retry'))}</button>`);
      document.getElementById('camp-contacts-retry')?.addEventListener('click', () => this.loadContacts());
    }
  }

  renderCamp() {
    const { camp } = this.data;
    const parts = this.campParts();
    const role = [
      this.data.team_role ? translate(`camp_roster_role_${this.data.team_role}`) : '',
      ...[...new Set((this.data.shifts || []).map((shift) => shift.volunteer_type))].map((type) => volunteerTypeLabel(type)),
    ].filter(Boolean);
    const nav = `<nav class="volunteer-space__nav" aria-label="${escapeAttribute(translate('volunteer_space_nav_label'))}">
      <ul>${parts.map((part) => `<li><a href="#${part.id}">${escapeHTML(translate(part.title))}</a></li>`).join('')}</ul></nav>`;
    setContent(this.root(), `<section class="page volunteer-space">
      ${this.header(camp.name, '')}
      <p class="volunteer-space__camp-dates">${escapeHTML(this.dates(camp.start_date, camp.end_date))}</p>
      ${role.length ? `<p class="volunteer-space__roles">${role.map((label) => `<span class="volunteer-space__chip">${escapeHTML(label)}</span>`).join(' ')}</p>` : ''}
      ${nav}
      ${parts.map((part) => this.section(part.id, part.title, part.body(), { icon: part.icon })).join('')}
      </section>`);
    this.bindNav();
  }

  /** In-page links move focus to their section, so the next Tab continues from there. */
  bindNav() {
    this.root().querySelectorAll('.volunteer-space__nav a').forEach((anchor) => {
      anchor.addEventListener('click', (event) => {
        const target = document.getElementById(anchor.getAttribute('href').slice(1));
        if (!target) { return; }
        event.preventDefault();
        target.scrollIntoView?.({ block: 'start' });
        target.focus({ preventScroll: true });
      });
    });
  }
}
