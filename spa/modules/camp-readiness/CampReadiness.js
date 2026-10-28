/** Camp preparation by the team, distinct from preparation of this device. */
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { formatEquipmentQuantity } from '../../utils/EquipmentUnitUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { CAMP_LOTS } from '../../config/camp-lots.js';
import { getCampReadiness } from '../../api/api-camp-readiness.js';
import styles from '../../../css/camp-readiness.css?url';

export const READINESS_LABELS = {
  signed: 'permission_slip_status_signed', pending: 'permission_slip_status_pending',
  declined: 'permission_slip_status_declined', expired: 'permission_slip_status_expired', revoked: 'permission_slip_status_revoked',
  to_prepare: 'camp_lot_to_prepare', loaded: 'camp_lot_loaded', returned: 'camp_lot_returned',
  todo: 'tasks_status_todo', in_progress: 'tasks_status_in_progress', done: 'tasks_status_done',
  reserved: 'camp_material_status_reserved', available: 'camp_material_status_available', missing: 'camp_material_status_missing',
  unavailable: 'camp_material_status_unavailable', not_in_inventory: 'camp_material_status_not_in_inventory',
};
export class CampReadiness {
  constructor(app, { meetingId }) {
    this.app = app; this.meetingId = meetingId; this.destroyed = false; this.request = 0;
    this.scope = buildScopedCacheKey('');
  }
  destroy() { this.destroyed = true; this.request += 1; }
  root() { return document.getElementById('app'); }
  date(value) { return value ? formatDate(value, this.app.lang || 'fr') : translate('camp_readiness_no_due'); }
  status(value) { return translate(READINESS_LABELS[value] || 'camp_readiness_unknown'); }
  /** Late answers must neither replace a newer refresh nor another session's screen. */
  async init() {
    const request = ++this.request;
    const options = { title: translate('camp_readiness_title'), backHref: '/yearly-planner' };
    loadStylesheet(styles).catch((err) => debugError('Camp readiness stylesheet failed', err));
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await getCampReadiness(this.meetingId);
      if (this.destroyed || request !== this.request || this.scope !== buildScopedCacheKey('')) { return; }
      if (!response?.data?.camp || !response.data.sections) { throw new Error('Missing camp preparation'); }
      this.data = response.data;
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request || this.scope !== buildScopedCacheKey('')) { return; }
      debugError('Camp preparation failed', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'error_loading_data'), retryId: 'camp-readiness-retry' }));
      this.root().querySelector('#camp-readiness-retry')?.addEventListener('click', () => this.init());
    }
  }
  /** Each row links to the existing screen that owns its action. */
  row(title, detail, href, owner = '', due = '') {
    return `<li class="camp-readiness__row"><div><a class="button button--ghost" href="${href}">${escapeHTML(title)}</a>
      <p>${escapeHTML(detail)}</p>${owner ? `<p>${escapeHTML(translate('camp_readiness_owner'))} ${escapeHTML(owner)}</p>` : ''}
      ${due ? `<p>${escapeHTML(translate('camp_readiness_due'))} ${escapeHTML(this.date(due))}</p>` : ''}</div></li>`;
  }
  section(key, rows, href) {
    return `<section class="camp-readiness__section"><h2>${escapeHTML(translate(`camp_readiness_${key}`))}</h2>
      ${rows ? `<ul class="camp-readiness__list">${rows}</ul>` : `<p>${escapeHTML(translate('camp_readiness_unconfigured'))}</p><a class="button button--secondary" href="${href}">${escapeHTML(translate('camp_readiness_open'))}</a>`}</section>`;
  }
  render() {
    const { camp, sections } = this.data;
    const meetingId = Number(camp.id);
    let body = '';
    if (sections.permissions) {
      body += this.section('permissions', sections.permissions.map((row) => this.row(this.status(row.status),
        new Intl.NumberFormat(localeForLanguage(this.app.lang)).format(row.count), `/permission-slips/${Number(camp.activity_id)}`, '', row.deadline)).join(''), `/permission-slips/${Number(camp.activity_id)}`);
    }
    if (sections.material) {
      const material = sections.material;
      const rows = material.items.map((item) => {
        const status = material.inventory_compared ? this.status(item.inventory?.status) : translate('camp_readiness_inventory_unchecked');
        const quantity = formatEquipmentQuantity(item.quantity, item.unit_of_measure, this.app.lang);
        return this.row(item.name, `${translate('camp_readiness_needed')} ${quantity} · ${status}`, `/camp-material/${meetingId}`);
      }).join('');
      body += this.section('material', rows, `/camp-material/${meetingId}`);
      if (material.free_text?.length) { body += `<p role="status">${escapeHTML(translate('camp_readiness_free_text'))}</p>`; }
    }
    if (sections.lots) {
      body += this.section('lots', sections.lots.map((lot) => this.row(lot.name, this.status(lot.status), `/camp-lots/${meetingId}`,
        (lot.roles || []).map((role) => `${translate(CAMP_LOTS.ROLE_KEYS[role.role] || 'camp_readiness_unknown')}: ${role.name}`).join(', '), lot.roles?.find((role) => role.role === 'prepare')?.due_date)).join(''), `/camp-lots/${meetingId}`);
    }
    if (sections.tasks) {
      body += this.section('tasks', sections.tasks.map((task) => this.row(task.title, this.status(task.status),
        task.equipment_lot_id && sections.lots ? `/camp-lots/${meetingId}` : `/tasks?meeting_id=${meetingId}${camp.activity_id ? `&activity_id=${Number(camp.activity_id)}` : ''}`,
        task.assignee_name, task.due_date)).join(''), '/tasks');
    }
    setContent(this.root(), `<section class="page camp-readiness">${renderBackLink('/yearly-planner')}
      <h1>${escapeHTML(translate('camp_readiness_title'))}</h1><h2>${escapeHTML(camp.theme || translate('camp_readiness_camp'))}</h2>
      <p>${escapeHTML(this.date(camp.date_from))} – ${escapeHTML(this.date(camp.date_to))}</p>
      <p>${escapeHTML(translate('camp_readiness_explanation'))}</p>
      ${camp.is_cancelled ? `<p role="status">${escapeHTML(translate('camp_readiness_cancelled'))}</p>` : ''}
      <button class="button button--secondary" type="button" id="camp-readiness-refresh">${escapeHTML(translate('refresh'))}</button>${body}</section>`);
    this.root().querySelector('#camp-readiness-refresh').addEventListener('click', () => this.init());
  }
}
