/**
 * Merge AI timeline with template activities, enforcing allowed responsibles.
 * @param {Array<Object>} planTimeline - AI-generated timeline items
 * @param {Array<Object>} templates - Section config activity templates
 * @param {Array<string>} allowedResponsables - Allowed leader full names
 * @param {Function} translate - Translation function for activity keys
 * @returns {Array<Object>} merged activities for the UI
 */
export function mergeTimelineWithTemplates(planTimeline, templates, allowedResponsables, translate) {
  const baseActivities = (templates || []).map((t, index) => ({
    id: `template-${index}`,
    position: index,
    time: t.time || '',
    duration: t.duration || '00:00',
    activity: (translate?.(t.activityKey) || t.activityKey || ''),
    activityKey: null,
    typeKey: null,
    responsable: '',
    materiel: '',
    isDefault: false
  }));

  const allowedRespSet = new Set(allowedResponsables || []);

  if (!Array.isArray(planTimeline) || planTimeline.length === 0) {
    return baseActivities;
  }

  return baseActivities.map((base, index) => {
    const item = planTimeline[index] || {};

    let materiel = '';
    if (item.materiel) {
      materiel = Array.isArray(item.materiel) ? item.materiel.join(', ') : item.materiel;
    } else if (item.materials) {
      materiel = Array.isArray(item.materials) ? item.materials.join(', ') : item.materials;
    }

    const responsable = (item.responsable && allowedRespSet.has(item.responsable)) ? item.responsable : '';

    return {
      id: `ai-generated-${index}`,
      position: index,
      time: item.time || base.time,
      duration: item.duration || base.duration,
      activity: item.activity || base.activity,
      activityKey: null,
      typeKey: null,
      responsable,
      materiel,
      isDefault: false
    };
  });
}
