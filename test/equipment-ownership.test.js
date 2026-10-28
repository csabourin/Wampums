/** Invalid group IDs must be rejected before reaching PostgreSQL's integer coercion. */
const { readEquipmentOwner, OwnershipError } = require('../services/equipmentOwnership');
test.each([true, [1], 'not an id', 1.5, 2147483648])('a malformed group identifier %j is a client error, not a database failure', async (owner_local_group_id) => {
  const db = { query: jest.fn() };
  await expect(readEquipmentOwner(db, 8, { owner_type: 'group', owner_local_group_id })).rejects.toMatchObject({ status: 400, message: 'material_owner_invalid' });
  expect(db.query).not.toHaveBeenCalled();
});
test('an unchanged historic owner stays unspecified without inventing a unit owner', async () => {
  expect(await readEquipmentOwner({}, 8, {}, { organization_id: 8, owner_type: null, owner_local_group_id: null })).toEqual({ owner_type: null, owner_local_group_id: null });
});
test('an unknown group cannot become owner even when its identifier is valid', async () => {
  await expect(readEquipmentOwner({ query: () => Promise.resolve({ rows: [] }) }, 8, { owner_type: 'group', owner_local_group_id: 42 })).rejects.toBeInstanceOf(OwnershipError);
});
