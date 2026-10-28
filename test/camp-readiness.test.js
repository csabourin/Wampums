jest.mock('../services/campMaterialList', () => ({ buildCampMaterialList: jest.fn() }));
jest.mock('../services/campEquipmentLots', () => ({ listLots: jest.fn() }));
const { buildCampMaterialList } = require('../services/campMaterialList');
const { listLots } = require('../services/campEquipmentLots');
const { campReadiness } = require('../services/campReadiness');
let db;
beforeEach(() => {
  jest.clearAllMocks();
  db = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  db.query.mockResolvedValueOnce({ rows: [{ id: 3, theme: 'Fictional camp', activity_id: 8 }] });
  buildCampMaterialList.mockResolvedValue({ items: [], free_text: [], inventory_compared: false });
  listLots.mockResolvedValue([]);
});
test('a minimal team member gets material without inventory quantities, duties or consent details', async () => {
  const result = await campReadiness(db, 7, 3, {});
  expect(Object.keys(result.sections)).toEqual(['material']);
  expect(buildCampMaterialList).toHaveBeenCalledWith(db, 7, 3, { withInventory: undefined });
  expect(listLots).not.toHaveBeenCalled(); expect(db.query).toHaveBeenCalledTimes(1);
});
test('a foreign camp or a regular meeting has no preparation overview', async () => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  expect(await campReadiness(db, 7, 3, {})).toBeNull();
  expect(db.query.mock.calls[0]).toEqual([expect.stringContaining("meeting_kind = 'camp'"), [7, 3]]);
  expect(buildCampMaterialList).not.toHaveBeenCalled();
});
test('authorized sections use only this unit and this camp or its linked outing', async () => {
  const result = await campReadiness(db, 7, 3, { inventory: true, lots: true, tasks: true, permissions: true });
  expect(Object.keys(result.sections).sort()).toEqual(['lots', 'material', 'permissions', 'tasks']);
  expect(listLots).toHaveBeenCalledWith(db, 7, 3);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('t.organization_id = $1'), [7, 3, 8]);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM permission_slips'), [7, 8]);
  expect(result.sections.payments).toBeUndefined(); expect(result.sections.volunteers).toBeUndefined();
});
test('an unlinked camp omits the consent section rather than showing zero requests', async () => {
  db.query.mockReset().mockResolvedValueOnce({ rows: [{ id: 3, activity_id: null }] });
  expect((await campReadiness(db, 7, 3, { permissions: true })).sections.permissions).toBeUndefined();
  expect(db.query).toHaveBeenCalledTimes(1);
});
test('a failed preparation read is an error rather than an empty successful section', async () => {
  buildCampMaterialList.mockRejectedValue(new Error('fictional database failure'));
  await expect(campReadiness(db, 7, 3, {})).rejects.toThrow('fictional database failure');
});
