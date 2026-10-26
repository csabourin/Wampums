import { mergeTimelineWithTemplates, normalizeMeetingDurationMinutes } from '../../spa/utils/MeetingPlanUtils.js';

describe('normalizeMeetingDurationMinutes', () => {
  test.each([
    [90, 90],
    ['105', 105],
    ['90.5', 90],
  ])('normalizes %p to %p minutes', (value, expected) => {
    expect(normalizeMeetingDurationMinutes(value, 90)).toBe(expected);
  });

  test.each([undefined, null, '', 'not-a-number', Number.NaN, 0, -30])(
    'falls back for invalid value %p',
    (value) => {
      expect(normalizeMeetingDurationMinutes(value, 90)).toBe(90);
    }
  );
});

describe('mergeTimelineWithTemplates', () => {
  const translate = (key) => key === 'activity.welcome' ? 'Accueil' : key;
  const templates = [
    { time: '18:45', duration: '00:05', activityKey: 'activity.welcome' },
    { time: '18:50', duration: '00:10', activityKey: "Présence / Loup d'honneur / Prière / Mot de bienvenue / Actualités" },
    { time: '19:00', duration: '00:20', activityKey: 'Jeu' }
  ];
  const allowedResponsables = ['Alice Scout', 'Bob Leader'];

  test('a meeting without a timeline is planned from the templates', () => {
    const result = mergeTimelineWithTemplates(null, templates, allowedResponsables, translate);
    expect(result).toHaveLength(3);
    expect(result[0].activity).toBe('Accueil');
    expect(result[1].activity).toBe("Présence / Loup d'honneur / Prière / Mot de bienvenue / Actualités");
    expect(result[2].responsable).toBe('');
  });

  test('a suggested plan keeps the template times and only names leaders of the unit', () => {
    const planTimeline = [
      { time: '18:45', duration: '00:05', activity: 'Accueil', responsable: 'Alice Scout' },
      { activity: "Présence / Loup d'honneur / Prière / Mot de bienvenue / Actualités", responsable: 'Random Name' },
      { duration: '00:30', activity: 'Grand jeu', materials: ['Ballon', 'Sifflet'], responsable: 'Bob Leader' }
    ];

    const result = mergeTimelineWithTemplates(planTimeline, templates, allowedResponsables, translate);

    // First item keeps allowed responsable
    expect(result[0].responsable).toBe('Alice Scout');
    expect(result[0].activity).toBe('Accueil');

    // Second item invalid responsable -> empty
    expect(result[1].responsable).toBe('');

    // Third item overlays duration and materials while preserving time
    expect(result[2].time).toBe('19:00');
    expect(result[2].duration).toBe('00:30');
    expect(result[2].activity).toBe('Grand jeu');
    expect(result[2].materiel).toBe('Ballon, Sifflet');
  });

  test('an activity keeps the unit material the plan chose for it, and has none otherwise', () => {
    const chosen = [{ catalog_item_id: 3, equipment_item_id: null, quantity: 6, name: 'Cônes', unit_of_measure: 'each' }];
    const result = mergeTimelineWithTemplates(
      [{ activity: 'Accueil', material_items: chosen }, { activity: 'Présence', material_items: 'Cordes' }],
      templates, allowedResponsables, translate
    );

    expect(result[0].material_items).toEqual(chosen);
    expect(result[1].material_items).toEqual([]);
    expect(result[2].material_items).toEqual([]);
  });
});
