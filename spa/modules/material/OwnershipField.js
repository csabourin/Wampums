/** One explicit owner: an actual unit or Scout group, separate from sharing. */
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { getCurrentOrganizationId } from '../../api/api-helpers.js';

export function equipmentOwnerLabel(item) {
  if (item.owner_type === 'group') { return item.owner_local_group_name || translate('material_owner_group'); }
  if (item.owner_type === 'unit') {
    return String(item.organization_id) === String(getCurrentOrganizationId()) ? translate('material_owner_self')
      : item.owner_organization_name || translate('material_owner_other');
  }
  return translate('material_owner_unknown');
}

/** Every control belongs to its form, allowing the same field in the stock and article editors. */
export function renderOwnershipFields(prefix, groups, item = null, editable = true) {
  const type = item ? item.owner_type || '' : 'unit';
  const groupId = item?.owner_local_group_id || (groups.length === 1 ? groups[0].id : '');
  return `<fieldset class="material-ownership"><legend>${translate('material_owner')}</legend>
    <label for="${prefix}-owner-type">${translate('material_owner_choice')}</label>
    <select id="${prefix}-owner-type" name="material_owner_type" ${editable ? '' : 'disabled'}>
      ${item && !type ? `<option value="">${translate('material_owner_unknown')}</option>` : ''}
      <option value="unit" ${type === 'unit' ? 'selected' : ''}>${translate('material_owner_self')}</option>
      <option value="group" ${type === 'group' ? 'selected' : ''} ${groups.length ? '' : 'disabled'}>${translate('material_owner_group')}</option>
    </select>
    <div data-owner-group ${type === 'group' ? '' : 'hidden'}>
      <label for="${prefix}-owner-group">${translate('material_owner_group_name')}</label>
      <select id="${prefix}-owner-group" name="material_owner_group" ${type === 'group' && editable ? 'required' : 'disabled'}>
        <option value="">${translate('material_owner_choose_group')}</option>
        ${groups.map((group) => `<option value="${Number(group.id)}" ${Number(groupId) === Number(group.id) ? 'selected' : ''}>${escapeHTML(group.name)}</option>`).join('')}
      </select>
    </div>
    ${!type ? `<p>${translate('material_owner_legacy_help')}</p>` : ''}
    ${groups.length ? '' : `<p>${translate('material_owner_no_group')}</p>`}
    <p data-owner-group-help ${type === 'group' ? '' : 'hidden'}>${translate('material_owner_group_help')}</p>
    ${!editable ? `<p>${escapeHTML(equipmentOwnerLabel(item))}</p>` : ''}
  </fieldset>`;
}

export function bindOwnershipFields(form) {
  const type = form.elements.namedItem('material_owner_type');
  if (!type) { return; }
  const update = () => {
    const group = form.elements.namedItem('material_owner_group');
    const isGroup = type.value === 'group';
    const sharing = form.querySelector('.equipment-visibility');
    if (sharing) {
      sharing.hidden = isGroup;
      sharing.querySelectorAll('input').forEach((input) => { input.disabled = isGroup; });
    }
    group.disabled = !isGroup || type.disabled;
    group.required = isGroup && !type.disabled;
    form.querySelector('[data-owner-group]').hidden = !isGroup;
    form.querySelector('[data-owner-group-help]').hidden = !isGroup;
  };
  type.addEventListener('change', update); update();
}

export function readOwnershipFields(form) {
  const type = form.elements.namedItem('material_owner_type');
  if (!type || type.disabled) { return {}; }
  return { owner_type: type.value || null,
    owner_local_group_id: type.value === 'group' ? Number(form.elements.namedItem('material_owner_group').value) : null };
}
