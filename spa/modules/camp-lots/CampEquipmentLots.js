/** Camp packing and personal duties, with explicit device-pending progress. */
import { translate } from '../../app.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { setContent, loadStylesheet, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { hasAllPermissions, isDemoUser } from '../../utils/PermissionUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { formatDate, formatTimestamp } from '../../utils/DateUtils.js';
import { formatEquipmentQuantity } from '../../utils/EquipmentUnitUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { getCurrentUserId } from '../../api/api-helpers.js';
import { buildScopedCacheKey } from '../../utils/OfflineCacheKeys.js';
import { getCampLots, getCampLotOptions, saveCampLot, changeCampLotStatus } from '../../api/api-camp-lots.js';
import { getLotSnapshot, pendingLotChanges, overlayLotChanges } from './CampLotOffline.js';
import { verifyOfflineAssets } from '../offline/OfflineAssets.js';
import { CAMP_LOTS } from '../../config/camp-lots.js';
import stylesUrl from '../../../css/camp-lots.css?url';

export class CampEquipmentLots extends BaseModule {
  constructor(app, { meetingId, ownOnly = false }) {
    super(app);
    this.meetingId = meetingId;
    this.ownOnly = ownOnly;
    this.canManage = !ownOnly && hasAllPermissions('camp_lots.manage', 'tasks.manage') && !isDemoUser();
    this.readOnly = isDemoUser();
    this.lots = [];
    this.ready = false;
    this.generation = 0;
    this.notice = null;
    this.saving = false;
    this.backHref = ownOnly ? '/tasks' : hasAllPermissions('meetings.view') ? `/camp-material/${Number(meetingId)}` : '/dashboard';
  }

  /** Register lifecycle listeners once; every later refresh replaces only the page. */
  async init() {
    loadStylesheet(stylesUrl).catch((err) => debugError('Camp lot styles unavailable', err));
    for (const name of ['online', 'offline']) {
      this.addEventListener(window, name, () => { void this.load(); });
    }
    for (const name of ['offlineMutationReplayed', 'offlineMutationRejected']) {
      this.addEventListener(window, name, (event) => {
        if (event.detail?.kind !== 'camp_lots') { return; }
        this.notice = { key: name === 'offlineMutationRejected' ? 'camp_lot_sync_refused' : 'camp_lot_synced',
          type: name === 'offlineMutationRejected' ? 'error' : 'success' };
        void this.load();
      });
    }
    this.addEventListener(document, 'visibilitychange', () => { if (!document.hidden) { void this.load(); } });
    await this.load();
  }

  title() { return translate(this.ownOnly ? 'camp_lots_mine' : 'camp_lots_title'); }
  root() { return document.getElementById('app'); }
  noticeMarkup() {
    return this.notice ? `<p class="camp-lots__notice" role="${this.notice.type === 'error' ? 'alert' : 'status'}">${translate(this.notice.key)}</p>` : '';
  }

  /** Do not let a delayed read redraw a newer request, another unit or another page. */
  async load() {
    const generation = ++this.generation;
    const scope = buildScopedCacheKey('');
    const current = () => !this.isDestroyed && generation === this.generation && scope === buildScopedCacheKey('');
    this.renderState('loading');
    try {
      const response = await getCampLots(this.meetingId, this.ownOnly);
      const pending = await pendingLotChanges();
      const snapshot = await getLotSnapshot(this.meetingId, this.ownOnly);
      const ready = !response.offlinePreparationFailed && Boolean(snapshot) && await verifyOfflineAssets();
      if (!current()) { return; }
      this.lots = overlayLotChanges(response.data, pending);
      this.ready = ready;
      this.render();
    } catch (err) {
      if (current()) { this.renderState('error', apiErrorMessage(err, 'camp_lots_load_failed')); }
    }
  }

  renderState(state, message = '') {
    if (this.isDestroyed) { return; }
    const options = { title: this.title(), className: 'camp-lots page', backHref: this.backHref };
    const markup = state === 'loading' ? pageLoadingMarkup(options)
      : pageErrorMarkup({ ...options, message, retryId: 'camp-lots-retry' });
    setContent(this.root(), markup.replace('</h1>', `</h1>${this.noticeMarkup()}`));
    document.getElementById('camp-lots-retry')?.addEventListener('click', () => this.load());
  }

  /** Managers can correct states; personal actions follow the matching assigned duty. */
  transitions(lot) {
    if (this.readOnly || lot.camp_cancelled) { return []; }
    const candidates = CAMP_LOTS.LOT_TRANSITIONS[lot.status] || [];
    if (!this.ownOnly) { return this.canManage ? candidates : []; }
    return candidates.filter((status) => {
      if (status === 'to_prepare' || lot.status === 'returned') { return false; }
      const duty = status === 'returned' ? 'return' : 'transport';
      const assignment = lot.roles.find((entry) => entry.role === duty) || lot.roles.find((entry) => entry.role === 'prepare');
      return assignment?.user_id === getCurrentUserId();
    });
  }

  /** Cards keep quantities, duty names, dates and confirmed history readable on a phone. */
  card(lot) {
    return `<li class="card camp-lots__card" id="camp-lot-${Number(lot.id)}">
      <h2>${escapeHTML(lot.name)}</h2><p>${escapeHTML(lot.camp_name || '')}</p>
      <p class="camp-lots__state">${translate(CAMP_LOTS.STATUS_KEYS[lot.status])}${lot.pending ? ` — ${translate('camp_lot_pending')}` : ''}</p>
      ${lot.camp_cancelled ? `<p>${translate('camp_lot_cancelled')}</p>` : ''}
      <ul class="camp-lots__items">${lot.items.map((item) => `<li>${escapeHTML(item.name)} · ${escapeHTML(formatEquipmentQuantity(item.quantity, item.unit_of_measure, this.app.lang))}</li>`).join('')}</ul>
      <dl class="camp-lots__duties">${lot.roles.map((duty) => `<div><dt>${translate(CAMP_LOTS.ROLE_KEYS[duty.role])}</dt>
        <dd>${escapeHTML(duty.name || translate('tasks_member'))} · ${escapeHTML(formatDate(duty.due_date, this.app.lang))}</dd></div>`).join('')}</dl>
      <div class="camp-lots__actions">${this.transitions(lot).map((status) => `<button type="button" class="button button--${status === 'to_prepare' ? 'secondary' : 'primary'}" data-lot-state="${status}" data-lot-id="${Number(lot.id)}" ${this.saving ? 'disabled' : ''}>
        ${translate(`camp_lot_mark_${status}`)}</button>`).join('')}
      ${this.canManage && lot.status === 'to_prepare' && !lot.pending && !lot.camp_cancelled
    ? `<button type="button" class="button button--secondary" data-lot-edit="${Number(lot.id)}" ${navigator.onLine === false || this.saving ? 'disabled' : ''}>${translate('edit')}</button>` : ''}</div>
      <details><summary>${translate('camp_lot_history')}</summary><ul>${lot.history.map((entry) => `<li>${translate(CAMP_LOTS.STATUS_KEYS[entry.status])} ·
        ${escapeHTML(entry.changed_by_name || translate('tasks_member'))} · ${escapeHTML(formatTimestamp(entry.changed_at, this.app.lang))}</li>`).join('')}</ul></details>
    </li>`;
  }

  render() {
    if (this.isDestroyed) { return; }
    setContent(this.root(), `<section class="page camp-lots">
      ${renderBackLink(this.backHref)}<h1>${this.title()}</h1>${this.noticeMarkup()}
      <p>${translate(this.ownOnly ? 'camp_lots_mine_intro' : 'camp_lots_intro')}</p>
      <aside class="camp-lots__device" aria-label="${escapeAttribute(translate('camp_lots_device'))}">
        <p role="status">${translate(this.ready ? 'camp_lots_ready' : 'camp_lots_not_ready')}</p>
        <button type="button" id="camp-lots-check" class="button button--secondary">${translate('camp_lots_check')}</button>
      </aside>
      ${this.canManage ? `<div class="camp-lots__toolbar"><button type="button" class="button button--primary" id="camp-lots-create" ${navigator.onLine === false ? 'disabled' : ''}>${translate('camp_lot_create')}</button>
        <p>${translate('camp_lots_edit_online')}</p></div>` : ''}
      ${this.lots.length ? `<ul class="camp-lots__list">${this.lots.map((lot) => this.card(lot)).join('')}</ul>`
    : `<p class="empty-state">${translate(this.ownOnly ? 'camp_lots_mine_empty' : 'camp_lots_empty')}</p>`}
    </section>`);
    document.getElementById('camp-lots-check')?.addEventListener('click', () => this.load());
    document.getElementById('camp-lots-create')?.addEventListener('click', () => this.edit());
    this.root().querySelectorAll('[data-lot-edit]').forEach((button) => button.addEventListener('click', () =>
      this.edit(this.lots.find((lot) => lot.id === Number(button.dataset.lotEdit)))));
    this.root().querySelectorAll('[data-lot-state]').forEach((button) => button.addEventListener('click', () =>
      this.changeState(this.lots.find((lot) => lot.id === Number(button.dataset.lotId)), button.dataset.lotState)));
  }

  /** The queued result says pending; only a server confirmation says saved. */
  async changeState(lot, status) {
    if (this.saving) { return; }
    this.saving = true;
    this.render();
    try {
      const result = await changeCampLotStatus(lot, status, this.ownOnly);
      if (this.isDestroyed) { return; }
      this.notice = { key: result.queued ? 'camp_lot_queued' : 'camp_lot_saved', type: result.queued ? 'info' : 'success' };
      this.app.showMessage(translate(this.notice.key), this.notice.type);
    } catch (err) {
      if (this.isDestroyed) { return; }
      this.notice = { key: null, type: 'error' };
      this.app.showMessage(apiErrorMessage(err, 'camp_lot_save_failed'), 'error');
      this.notice = null;
    } finally {
      this.saving = false;
    }
    if (!this.isDestroyed) {
      await this.load();
      (document.querySelector(`#camp-lot-${lot.id} button`) || document.getElementById('camp-lots-retry') || document.getElementById('camp-lots-check'))?.focus();
    }
  }

  /** One form combines lot contents and preparation, with optional transport and return people. */
  async edit(lot = null) {
    let options;
    try { options = (await getCampLotOptions(this.meetingId)).data; }
    catch (err) { if (!this.isDestroyed) { this.app.showMessage(apiErrorMessage(err, 'camp_lots_load_failed'), 'error'); } return; }
    if (this.isDestroyed) { return; }
    const creationKey = crypto.randomUUID();
    const quantities = new Map((lot?.items || []).map((item) => [item.key, item.quantity]));
    const choices = options.items.filter((item) => !item.archived);
    const memberSelect = (role) => {
      const selected = lot?.roles.find((entry) => entry.role === role);
      const available = options.members;
      return `<label for="camp-lot-${role}">${translate(CAMP_LOTS.ROLE_KEYS[role])}</label>
        <select id="camp-lot-${role}" name="${role}" ${role === 'prepare' ? 'required' : ''}>
          <option value="">${translate(role === 'prepare' ? 'tasks_choose_member' : 'camp_lot_same_preparer')}</option>
          ${selected && !available.some((member) => member.id === selected.user_id)
    ? `<option value="" selected disabled>${escapeHTML(selected.name)} — ${translate('camp_lot_member_inactive')}</option>` : ''}
          ${available.map((member) => `<option value="${escapeAttribute(member.id)}" ${selected?.user_id === member.id ? 'selected' : ''}>${escapeHTML(member.full_name || translate('tasks_member'))}</option>`).join('')}
        </select>`;
    };
    const modal = openModal({
      id: 'camp-lot-editor', title: escapeHTML(translate(lot ? 'camp_lot_edit' : 'camp_lot_create')), closeOnBackdrop: false,
      canClose: () => document.getElementById('camp-lot-form')?.getAttribute('aria-busy') !== 'true',
      body: `<form id="camp-lot-form" class="camp-lot-editor">
        <label for="camp-lot-name">${translate('camp_lot_name')}</label>
        <input id="camp-lot-name" name="lot_name" required maxlength="${CAMP_LOTS.LOT_NAME_MAX}" value="${escapeAttribute(lot?.name || '')}">
        <fieldset><legend>${translate('camp_lot_items')}</legend><p>${translate('camp_lot_items_help')}</p>
          ${choices.length ? choices.map((item, index) => {
    const quantity = quantities.get(item.key);
    const remaining = Math.max(0, Number((item.quantity - item.allocated + (quantity || 0)).toFixed(CAMP_LOTS.QUANTITY_DECIMALS)));
    return `<div class="camp-lot-editor__item"><label for="camp-lot-pick-${index}"><input type="checkbox" id="camp-lot-pick-${index}" name="pick_${index}" ${quantity ? 'checked' : ''}> ${escapeHTML(item.name)}</label>
            <label for="camp-lot-quantity-${index}">${translate('camp_lot_quantity')} · ${escapeHTML(formatEquipmentQuantity(remaining, item.unit_of_measure, this.app.lang))} ${translate('camp_lot_available')}</label>
            <input type="number" id="camp-lot-quantity-${index}" name="quantity_${index}" min="${CAMP_LOTS.QUANTITY_STEP}" max="${remaining}" step="${CAMP_LOTS.QUANTITY_STEP}" value="${quantity || Math.min(1, remaining)}" ${quantity ? 'required' : 'disabled'}>
          </div>`;
  }).join('') : `<p>${translate('camp_lot_no_items')}</p>`}
        </fieldset>
        ${memberSelect('prepare')}
        <details ${lot?.roles.length > 1 ? 'open' : ''}><summary>${translate('camp_lot_other_duties')}</summary>
          ${memberSelect('transport')}${memberSelect('return')}</details>
        <p id="camp-lot-form-error" role="alert" tabindex="-1" hidden></p>
      </form>`,
      footer: `<button type="button" class="button button--secondary" data-modal-close>${translate('cancel')}</button>
        <button type="submit" class="button button--primary" form="camp-lot-form" ${choices.length ? '' : 'disabled'}>${translate('save')}</button>`,
    });
    const form = document.getElementById('camp-lot-form');
    form.addEventListener('input', () => {
      document.getElementById('camp-lot-form-error').hidden = true;
      form.querySelectorAll('[aria-invalid]').forEach((control) => { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-describedby'); });
      choices.forEach((_item, index) => {
        const quantity = form.elements.namedItem(`quantity_${index}`);
        quantity.disabled = !form.elements.namedItem(`pick_${index}`).checked;
        quantity.required = !quantity.disabled;
      });
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, async () => {
        const items = choices.flatMap((item, index) => form.elements.namedItem(`pick_${index}`).checked ? [{
          ...(item.catalog_item_id ? { catalog_item_id: item.catalog_item_id } : { equipment_item_id: item.equipment_item_id }),
          quantity: Number(form.elements.namedItem(`quantity_${index}`).value),
        }] : []);
        try {
          if (!items.length || !form.checkValidity()) { throw Object.assign(new Error('camp_lot_invalid'), { code: 'camp_lot_invalid' }); }
          await saveCampLot(this.meetingId, { name: form.elements.lot_name.value.trim(), items,
            roles: CAMP_LOTS.LOT_ROLES.flatMap((role) => form.elements.namedItem(role).value ? [{ role, user_id: form.elements.namedItem(role).value }] : []),
            ...(lot ? { expected_version: lot.version } : { creation_key: creationKey }),
          }, lot?.id || null);
        } catch (err) {
          if (this.isDestroyed) { return; }
          const problem = document.getElementById('camp-lot-form-error');
          problem.textContent = apiErrorMessage(err, 'camp_lot_save_failed');
          for (const field of err.errors || []) {
            const control = field.path === 'name' ? form.elements.lot_name : field.path === 'roles' ? form.elements.prepare : null;
            control?.setAttribute('aria-invalid', 'true');
            control?.setAttribute('aria-describedby', 'camp-lot-form-error');
          }
          problem.hidden = false;
          problem.focus();
          return;
        }
        form.removeAttribute('aria-busy');
        modal.close();
        if (!this.isDestroyed) {
          this.notice = { key: 'camp_lot_saved', type: 'success' };
          this.app.showMessage(translate('camp_lot_saved'), 'success');
          await this.load();
          document.getElementById('camp-lots-create')?.focus();
        }
      });
    });
  }
}
