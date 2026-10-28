/** Physical ownership is distinct from the unit maintaining a record and from sharing. */
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const POSTGRES_INT_MAX = 2147483647;
class OwnershipError extends Error {
  constructor(message, status = HTTP_BAD_REQUEST) { super(message); this.status = status; }
}

/** Trusted SQL aliases/parameters only. Every route and loan applies this same access rule. */
function equipmentAccessSql(alias, organizationParam) {
  return `(
    (${alias}.owner_type = 'group' AND EXISTS (
      SELECT 1 FROM organization_local_groups member_group
      WHERE member_group.organization_id = ${organizationParam} AND member_group.local_group_id = ${alias}.owner_local_group_id
    )) OR (${alias}.owner_type IS DISTINCT FROM 'group' AND (
      ${alias}.organization_id = ${organizationParam}
      OR EXISTS (SELECT 1 FROM equipment_item_organizations explicit_share
        WHERE explicit_share.equipment_id = ${alias}.id AND explicit_share.organization_id = ${organizationParam})
      OR (COALESCE((${alias}.attributes->>'share_with_local_group')::boolean, true) AND EXISTS (
        SELECT 1 FROM organization_local_groups owner_group JOIN organization_local_groups requester_group
          ON requester_group.local_group_id = owner_group.local_group_id
        WHERE owner_group.organization_id = ${alias}.organization_id AND requester_group.organization_id = ${organizationParam}
      ))
    ))
  )`;
}

/**
 * Identify an owner explicitly. A historic unit association is never inferred
 * to be ownership. Changing ownership is confined to the record's managing unit.
 */
async function readEquipmentOwner(db, organizationId, fields, current = null) {
  const has = (name) => Object.prototype.hasOwnProperty.call(fields, name);
  const type = has('owner_type') ? fields.owner_type : current ? current.owner_type ?? null : 'unit';
  const groupId = type === 'group' ? Number(has('owner_local_group_id') ? fields.owner_local_group_id : current?.owner_local_group_id) : null;
  if ((type !== 'group' && fields.owner_local_group_id !== null && fields.owner_local_group_id !== undefined) || ![null, 'unit', 'group'].includes(type) || (type === 'group' && (!['string', 'number'].includes(typeof (has('owner_local_group_id') ? fields.owner_local_group_id : current?.owner_local_group_id)) || !Number.isSafeInteger(groupId) || groupId <= 0 || groupId > POSTGRES_INT_MAX))) {
    throw new OwnershipError('material_owner_invalid');
  }
  const changed = !current || type !== (current.owner_type ?? null) || groupId !== (current.owner_local_group_id ?? null);
  if (changed && current && Number(current.organization_id) !== Number(organizationId)) {
    throw new OwnershipError('material_owner_change_unavailable', HTTP_NOT_FOUND);
  }
  if (type === 'group' && changed) {
    const membership = await db.query(`SELECT local_group_id FROM organization_local_groups
      WHERE organization_id = $1 AND local_group_id = $2`, [organizationId, groupId]);
    if (!membership.rows.length) { throw new OwnershipError('material_owner_invalid'); }
  }
  return { owner_type: type, owner_local_group_id: groupId };
}
module.exports = { OwnershipError, equipmentAccessSql, readEquipmentOwner };
