/** One display row for a linked article; stock-only articles need no catalogue duplicate. */
export function mergeMaterialArticles(articles, equipment) {
  const linkedIds = new Set(articles.filter((item) => !item.archived).map((item) => Number(item.equipment_item_id)).filter(Boolean));
  return [
    ...articles.map((item) => ({ ...item, stock: equipment.find((entry) => Number(entry.id) === Number(item.equipment_item_id)) })),
    ...equipment.filter((item) => !linkedIds.has(Number(item.id)) && item.is_active !== false).map((item) => ({
      id: item.id, inventory_only: true, equipment_item_id: item.id, equipment_name: item.name,
      name: item.name, category: item.category, unit_of_measure: item.attributes?.unit_of_measure || 'each', stock: item,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
