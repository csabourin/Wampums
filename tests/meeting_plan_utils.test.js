import { mergeTimelineWithTemplates } from '../spa/utils/MeetingPlanUtils.js';

describe('mergeTimelineWithTemplates', () => {
  const translate = (key) => key === 'activity.welcome' ? 'Accueil' : key;
  const templates = [
    { time: '18:45', duration: '00:05', activityKey: 'activity.welcome' },
    { time: '18:50', duration: '00:10', activityKey: "Présence / Loup d'honneur / Prière / Mot de bienvenue / Actualités" },
    { time: '19:00', duration: '00:20', activityKey: 'Jeu' }
  ];
  const allowedResponsables = ['Alice Scout', 'Bob Leader'];

  test('falls back to templates when timeline missing', () => {
    const result = mergeTimelineWithTemplates(null, templates, allowedResponsables, translate);
    expect(result).toHaveLength(3);
    expect(result[0].activity).toBe('Accueil');
    expect(result[1].activity).toBe("Présence / Loup d'honneur / Prière / Mot de bienvenue / Actualités");
    expect(result[2].responsable).toBe('');
  });

  test('merges AI fields and validates responsable names', () => {
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
});
