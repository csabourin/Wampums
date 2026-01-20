import { mergeTimelineWithTemplates } from '../spa/utils/MeetingPlanUtils.js';

const translate = (key) => (key === 'activity.welcome' ? 'Accueil' : key);
const templates = [
  { time: '18:45', duration: '00:05', activityKey: 'activity.welcome' },
  { time: '18:50', duration: '00:10', activityKey: "Présence / Loup d'honneur / Prière / Mot de bienvenue / Actualités" },
  { time: '19:00', duration: '00:20', activityKey: 'Jeu' }
];
const allowedResponsables = ['Alice Scout', 'Bob Leader'];

function assert(condition, message) {
  if (!condition) {
    console.error('Assertion failed:', message);
    process.exit(1);
  }
}

// Case 1: fallback to templates when timeline missing
{
  const result = mergeTimelineWithTemplates(null, templates, allowedResponsables, translate);
  assert(result.length === 3, 'Expected 3 activities');
  assert(result[0].activity === 'Accueil', 'Translate applied to welcome');
  assert(result[1].activity.includes('Présence'), 'Mandatory block preserved');
  assert(result[2].responsable === '', 'Responsable empty by default');
}

// Case 2: merge and validate responsibles
{
  const planTimeline = [
    { time: '18:45', duration: '00:05', activity: 'Accueil', responsable: 'Alice Scout' },
    { activity: "Présence / Loup d'honneur / Prière / Mot de bienvenue / Actualités", responsable: 'Random Name' },
    { duration: '00:30', activity: 'Grand jeu', materials: ['Ballon', 'Sifflet'], responsable: 'Bob Leader' }
  ];

  const result = mergeTimelineWithTemplates(planTimeline, templates, allowedResponsables, translate);

  assert(result[0].responsable === 'Alice Scout', 'Allowed responsable kept');
  assert(result[1].responsable === '', 'Invalid responsable removed');
  assert(result[2].time === '19:00', 'Template time preserved');
  assert(result[2].duration === '00:30', 'AI duration overlay accepted');
  assert(result[2].activity === 'Grand jeu', 'AI activity overlay accepted');
  assert(result[2].materiel === 'Ballon, Sifflet', 'Materials normalized to materiel');
}

console.log('mergeTimelineWithTemplates tests passed ✅');
