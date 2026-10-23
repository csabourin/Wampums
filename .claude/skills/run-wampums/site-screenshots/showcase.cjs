/*
 * Fill the run-wampums seeded unit with a realistic, fictional cub pack so the
 * app's screens can be photographed for wampums.app. Run by take.sh; by hand,
 * after seed.mjs, from the repo root: node showcase.cjs <seed.json>
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require(path.join(process.cwd(), 'node_modules/pg'));

const seed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ORG = seed.organizationId;
const pool = new Pool({ connectionString: seed.database });
const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return localDate(d);
};

/** Tuesdays going back from the most recent one. */
function pastTuesdays(count) {
  const d = new Date();
  while (d.getDay() !== 2) {
    d.setDate(d.getDate() - 1);
  }
  const dates = [];
  for (let i = 0; i < count; i += 1) {
    dates.push(localDate(d));
    d.setDate(d.getDate() - 7);
  }
  return dates;
}

const GROUPS = ['Renards', 'Loups', 'Hiboux', 'Ours'];
const YOUTH = [
  ['Léa', 'Tremblay', 0], ['Noah', 'Bouchard', 1], ['Amira', 'Mansour', 2], ['Jacob', 'Roy', 0],
  ['Éloïse', 'Gagnon', 1], ['Liam', 'Côté', 3], ['Chloé', 'Lavoie', 2], ['William', 'Fortin', 3],
  ['Maya', 'Pelletier', 0], ['Thomas', 'Morin', 1], ['Zoé', 'Ouellet', 2], ['Arthur', 'Bélanger', 3],
  ['Florence', 'Lévesque', 0], ['Nathan', 'Girard', 1], ['Rosalie', 'Simard', 2], ['Samuel', 'Caron', 3],
  ['Alice', 'Boucher', 0], ['Elliot', 'Nguyen', 1], ['Olivia', 'Singh', 2], ['Félix', 'Paquette', 3],
  ['Mila', 'Dubois', 0], ['Louis', 'Martel', 1],
];

async function main() {
  const year = await one('SELECT id FROM scout_years WHERE organization_id = $1 AND status = $2', [ORG, 'active']);
  const adminId = (await one("SELECT id FROM users WHERE email = 'admin@run.test'")).id;

  await q(
    `INSERT INTO organization_settings (organization_id, setting_key, setting_value)
     VALUES ($1, 'organization_info', $2::jsonb)
     ON CONFLICT (organization_id, setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
    [ORG, JSON.stringify({ name: 'Meute des Érables', unit: 'Meute des Érables', endroit: 'Sous-sol de l’église Saint-Jean', meeting_day: 'Tuesday', district: 'District des Deux-Rives' })]
  );
  await q('UPDATE organizations SET name = $2 WHERE id = $1', [ORG, 'Meute des Érables']);

  // The seed's child becomes one of the pack, with her parent account.
  const lea = seed.participantId;
  await q("UPDATE participants SET first_name = 'Léa', last_name = 'Tremblay' WHERE id = $1", [lea]);
  await q("UPDATE users SET full_name = 'Marie Tremblay' WHERE email = 'parent@run.test'");
  await q("UPDATE parents_guardians SET nom = 'Tremblay', prenom = 'Marie', telephone_cellulaire = '514-555-0142' WHERE courriel = 'parent@run.test'");
  await q("UPDATE users SET full_name = 'Akéla (Sophie Roy)' WHERE email = 'admin@run.test'");
  await q("UPDATE users SET full_name = 'Baloo (Marc Dion)' WHERE email = 'leader@run.test'");
  // Screens that name roles show the pack's titles, not the seed's test role names.
  await q("UPDATE roles SET display_name = 'Akéla' WHERE role_name = 'run_admin'");
  await q("UPDATE roles SET display_name = 'Baloo' WHERE role_name = 'run_leader'");
  await q("UPDATE roles SET organization_id = $1 WHERE role_name IN ('run_admin', 'run_leader', 'parent') AND organization_id IS NULL", [ORG]);
  await q("UPDATE roles SET display_name = 'Parent' WHERE role_name = 'parent'");

  const groupIds = [];
  for (const name of GROUPS) {
    groupIds.push((await one('INSERT INTO groups (name, organization_id) VALUES ($1, $2) RETURNING id', [name, ORG])).id);
  }

  const youth = [];
  for (const [index, [first, last, group]] of YOUTH.entries()) {
    let id = lea;
    if (index > 0) {
      const birth = `${2016 + (index % 3)}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`;
      id = (await one('INSERT INTO participants (first_name, last_name, date_naissance) VALUES ($1, $2, $3) RETURNING id', [first, last, birth])).id;
      await q(
        'INSERT INTO participant_enrollments (participant_id, organization_id, scout_year_id, inscription_date) VALUES ($1, $2, $3, $4)',
        [id, ORG, year.id, '2026-09-08']
      );
      const guardian = await one(
        `INSERT INTO parents_guardians (nom, prenom, courriel, telephone_cellulaire)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [last, index % 2 ? 'Julie' : 'David', `${first.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${last.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@exemple.ca`, `514-555-${String(1000 + index * 37).slice(-4)}`]
      );
      await q('INSERT INTO participant_guardians (participant_id, guardian_id) VALUES ($1, $2)', [id, guardian.id]);
    }
    await q(
      `INSERT INTO participant_group_assignments (participant_id, group_id, organization_id, scout_year_id, first_leader, second_leader)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (participant_id, organization_id, scout_year_id) DO UPDATE SET group_id = EXCLUDED.group_id`,
      [id, groupIds[group], ORG, year.id, index < 4, index >= 4 && index < 8]
    );
    youth.push({ id, first, last, group });
  }

  // Seven weeks of meetings: most present, a few late or excused.
  const tuesdays = pastTuesdays(7);
  for (const [w, date] of tuesdays.entries()) {
    for (const [i, kid] of youth.entries()) {
      const r = (i * 7 + w * 3) % 20;
      const status = r === 0 ? 'absent' : r === 1 ? 'excused' : r === 2 ? 'late' : 'present';
      await q('INSERT INTO attendance (participant_id, date, status, organization_id) VALUES ($1, $2, $3, $4)', [kid.id, date, status, ORG]);
    }
  }

  // Points through the season, for youth and for their groups.
  for (const [i, kid] of youth.entries()) {
    for (let k = 0; k < 4; k += 1) {
      await q('INSERT INTO points (participant_id, group_id, value, organization_id, scout_year_id, created_at) VALUES ($1, NULL, $2, $3, $4, $5)',
        [kid.id, 1 + ((i + k) % 5), ORG, year.id, `${tuesdays[k]} 19:30`]);
    }
  }
  for (const [g, groupId] of groupIds.entries()) {
    for (let k = 0; k < 5; k += 1) {
      await q('INSERT INTO points (participant_id, group_id, value, organization_id, scout_year_id, created_at) VALUES (NULL, $1, $2, $3, $4, $5)',
        [groupId, 5 + ((g * 3 + k) % 6) * 2, ORG, year.id, `${tuesdays[k]} 20:00`]);
    }
  }

  // Tonight's meeting, in progress: most youth marked, a few still to come.
  const today = day(0);
  for (const [i, kid] of youth.entries()) {
    if (i % 6 === 5) {
      continue;
    }
    await q('INSERT INTO attendance (participant_id, date, status, organization_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [kid.id, today, i === 2 ? 'late' : i === 9 ? 'excused' : 'present', ORG]);
  }

  // Badges: the six cub badges, earned through the year.
  const BADGES = ['Vrai comme Baloo', 'Débrouillard comme Kaa', 'Dynamique comme Bagheera', 'Respectueux comme Rikki Tikki Tavi', 'Heureux comme Ferao', 'Solidaire comme Frère Gris'];
  const templates = [];
  for (const name of BADGES) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    templates.push((await one(
      `INSERT INTO badge_templates (organization_id, template_key, name, translation_key, section, level_count, levels)
       VALUES ($1, $2, $3, $4, 'general', 3, $5) RETURNING id, name`,
      [ORG, key, name, `badge_template_${key}`, JSON.stringify([{ level: 1, label_key: 'badge_level_1' }, { level: 2, label_key: 'badge_level_2' }, { level: 3, label_key: 'badge_level_3' }])]
    )));
  }
  const OBJECTIVES = ['Aider à la maison sans qu’on me le demande', 'Faire un nœud plat et un nœud de chaise', 'Courir le parcours du parc', 'Écouter sans couper la parole', 'Apprendre un chant de camp', 'Accueillir un nouveau louveteau'];
  for (const [i, kid] of youth.entries()) {
    const earned = 1 + (i % 3);
    for (let b = 0; b < earned; b += 1) {
      const template = templates[(i + b) % templates.length];
      const pending = b === earned - 1 && i % 4 === 0;
      await q(
        `INSERT INTO badge_progress (participant_id, territoire_chasse, objectif, description, date_obtention, etoiles, status,
                                     approval_date, organization_id, badge_template_id, section, star_type, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'general', $11, $12)`,
        [kid.id, template.name, OBJECTIVES[(i + b) % OBJECTIVES.length], 'Raconté à la tanière et confirmé par sa famille.',
          tuesdays[(b + 1) % tuesdays.length], 1 + (b % 2), pending ? 'pending' : 'approved',
          pending ? null : `${tuesdays[b % tuesdays.length]} 20:15`, ORG, template.id, b % 2 ? 'battue' : 'proie',
          !pending && b === 0 ? `${tuesdays[0]} 20:30` : null]
      );
    }
  }
  for (const kid of youth.slice(0, 5)) {
    await q('INSERT INTO honors (participant_id, date, organization_id, reason, created_by) VALUES ($1, $2, $3, $4, $5)',
      [kid.id, tuesdays[1], ORG, 'Entraide pendant le grand jeu', adminId]);
  }

  // Finances: fees for the year, paid in full or in instalments.
  const categories = {};
  for (const [name, type, order] of [['Inscriptions', 'registration', 1], ['Collectes de fonds', 'fundraising', 2], ['Activités et camps', 'activity', 3], ['Fonctionnement', 'operations', 4]]) {
    categories[type] = (await one(
      'INSERT INTO budget_categories (organization_id, name, category_type, display_order, active) VALUES ($1, $2, $3, $4, true) RETURNING id',
      [ORG, name, type, order]
    )).id;
  }
  const fee = await one(
    `INSERT INTO fee_definitions (organization_id, registration_fee, membership_fee, year_start, year_end, budget_category_id)
     VALUES ($1, 40, 160, '2026-09-01', '2027-08-31', $2) RETURNING id`,
    [ORG, categories.registration]
  );
  for (const [i, kid] of youth.entries()) {
    const pf = await one(
      `INSERT INTO participant_fees (participant_id, organization_id, fee_definition_id, total_registration_fee, total_membership_fee, status)
       VALUES ($1, $2, $3, 40, 160, 'unpaid') RETURNING id`,
      [kid.id, ORG, fee.id]
    );
    const paid = i % 5 === 4 ? 0 : i % 3 === 2 ? 100 : 200;
    await q('UPDATE participant_fees SET status = $2 WHERE id = $1', [pf.id, paid === 200 ? 'paid' : paid ? 'partial' : 'unpaid']);
    if (paid) {
      await q(`INSERT INTO payments (participant_fee_id, amount, payment_date, method) VALUES ($1, $2, $3, $4)`,
        [pf.id, paid, '2026-09-15', i % 2 ? 'etransfer' : 'cash']);
    }
  }
  const items = {};
  for (const [key, cat, name, price, qty] of [
    ['camp', 'activity', 'Camp d’automne', 85, 22], ['canot', 'activity', 'Sortie canot', 25, 22],
    ['materiel', 'operations', 'Matériel d’animation', 300, 1], ['local', 'operations', 'Location du local', 600, 1],
    ['calendriers', 'fundraising', 'Vente de calendriers', 15, 200],
  ]) {
    items[key] = (await one(
      `INSERT INTO budget_items (organization_id, budget_category_id, name, item_type, unit_price, estimated_quantity, active)
       VALUES ($1, $2, $3, 'both', $4, $5, true) RETURNING id`,
      [ORG, categories[cat], name, price, qty]
    )).id;
  }
  for (const [key, revenue, expense] of [['camp', 1870, 1650], ['canot', 550, 480], ['materiel', 0, 300], ['local', 0, 600], ['calendriers', 3000, 900]]) {
    await q(`INSERT INTO budget_plans (organization_id, budget_item_id, fiscal_year_start, fiscal_year_end, budgeted_revenue, budgeted_expense)
             VALUES ($1, $2, '2026-09-01', '2027-08-31', $3, $4)`, [ORG, items[key], revenue, expense]);
  }
  for (const [key, cat, amount, date, description] of [
    ['camp', 'activity', 1240.5, '2026-10-03', 'Réservation du site de camp'],
    ['camp', 'activity', 312.75, '2026-10-04', 'Épicerie du camp d’automne'],
    ['materiel', 'operations', 86.4, '2026-09-20', 'Ballons, foulards et cônes'],
    ['local', 'operations', 300, '2026-09-01', 'Location du local — automne'],
    ['calendriers', 'fundraising', 900, '2026-10-10', 'Impression de 200 calendriers'],
    ['canot', 'activity', 120, '2026-10-15', 'Dépôt pour la location des canots'],
  ]) {
    await q(`INSERT INTO budget_expenses (organization_id, budget_category_id, budget_item_id, amount, expense_date, description, payment_method, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'card', $7)`, [ORG, categories[cat], items[key], amount, date, description, adminId]);
  }
  for (const [cat, amount, date, description, type] of [
    ['activity', 1650, '2026-09-30', 'Contributions des familles — camp d’automne', 'activity'],
    ['other', 500, '2026-10-05', 'Subvention de la caisse populaire', 'donation'],
  ]) {
    await q(`INSERT INTO budget_revenues (organization_id, budget_category_id, revenue_type, amount, revenue_date, description, payment_method, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'etransfer', $7)`, [ORG, categories[cat] || null, type, amount, date, description, adminId]);
  }

  // The calendar sale, under way.
  await q('UPDATE fundraisers SET objective = 3000, budget_category_id = $2, start_date = $3, end_date = $4 WHERE id = $1',
    [seed.fundraiserId, categories.fundraising, day(-20), day(25)]);
  for (const [i, kid] of youth.entries()) {
    const quantity = [12, 8, 15, 4, 10, 6, 20, 9, 3, 11, 7, 14, 5, 16, 8, 2, 10, 13, 6, 9, 4, 7][i];
    await q(`INSERT INTO fundraiser_entries (participant_id, fundraiser, quantity, amount, amount_raised, amount_paid, paid, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [kid.id, seed.fundraiserId, quantity, quantity * 15, quantity * 15, i % 4 === 3 ? 0 : quantity * 15, i % 4 !== 3]);
  }

  // Carpools for the canoe outing: parents offer seats, leaders place the youth.
  const parentRole = (await one("SELECT id FROM roles WHERE role_name = 'parent'")).id;
  const drivers = [];
  for (const [email, name, make, color, seats, direction] of [
    ['julie.bouchard@exemple.ca', 'Julie Bouchard', 'Toyota Sienna', 'Gris', 6, 'both'],
    ['david.roy@exemple.ca', 'David Roy', 'Honda CR-V', 'Bleu', 4, 'both'],
    ['julie.gagnon@exemple.ca', 'Julie Gagnon', 'Kia Carnival', 'Blanc', 7, 'to_activity'],
    ['david.cote@exemple.ca', 'David Côté', 'Subaru Outback', 'Vert', 4, 'from_activity'],
  ]) {
    const user = await one(
      `INSERT INTO users (email, password, full_name, is_verified) VALUES ($1, (SELECT password FROM users WHERE email = 'parent@run.test'), $2, true) RETURNING id`,
      [email, name]
    );
    await q(`INSERT INTO user_organizations (user_id, organization_id, role_ids, status) VALUES ($1, $2, $3, 'active')`, [user.id, ORG, JSON.stringify([parentRole])]);
    const offer = await one(
      `INSERT INTO carpool_offers (activity_id, user_id, organization_id, vehicle_make, vehicle_color, total_seats_available, trip_direction, notes, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING id`,
      [seed.activityId, user.id, ORG, make, color, seats, direction, direction === 'both' ? 'Départ du local à 8 h 30' : null]
    );
    drivers.push({ offer: offer.id, seats, direction });
  }
  let seat = 0;
  for (const driver of drivers) {
    for (let s = 0; s < driver.seats - 1 && seat < youth.length - 3; s += 1) {
      await q(`INSERT INTO carpool_assignments (carpool_offer_id, participant_id, assigned_by, organization_id, trip_direction)
               VALUES ($1, $2, $3, $4, $5)`, [driver.offer, youth[seat].id, adminId, ORG, driver.direction]);
      seat += 1;
    }
  }

  // Medications for three youth, with tonight's doses.
  for (const [kidIndex, name, dose, unit, times, notes] of [
    [2, 'Ventolin (salbutamol)', 2, 'inhalations', ['18:45'], 'Avant le grand jeu, au besoin pour l’asthme'],
    [6, 'Méthylphénidate', 10, 'mg', ['18:30'], 'Au début de la réunion, avec de l’eau'],
    [11, 'EpiPen Jr', 0.15, 'mg', [], 'Allergie sévère aux arachides — toujours dans le sac des animateurs'],
  ]) {
    const kid = youth[kidIndex];
    const requirement = await one(
      `INSERT INTO medication_requirements (organization_id, medication_name, dosage_instructions, frequency_text, route,
                                            default_dose_amount, default_dose_unit, general_notes, start_date, end_date,
                                            created_by, frequency_preset_type, frequency_times, participant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [ORG, name, notes, times.length ? 'Chaque réunion' : 'En cas d’urgence', unit === 'mg' && times.length === 0 ? 'injection' : 'oral',
        dose, unit, notes, '2026-09-01', '2027-06-30', adminId, times.length ? 'time_of_day' : 'prn', JSON.stringify(times), kid.id]
    );
    const pm = await one(
      'INSERT INTO participant_medications (organization_id, medication_requirement_id, participant_id) VALUES ($1, $2, $3) RETURNING id',
      [ORG, requirement.id, kid.id]
    );
    for (const [w, date] of [today, ...tuesdays.slice(0, 3)].entries()) {
      if (!times.length) {
        break;
      }
      await q(`INSERT INTO medication_distributions (organization_id, medication_requirement_id, participant_id, participant_medication_id,
                                                     scheduled_for, activity_name, dose_amount, dose_unit, status, administered_at, administered_by, witness_name)
               VALUES ($1, $2, $3, $4, $5, 'Réunion du mardi', $6, $7, $8, $9, $10, $11)`,
        [ORG, requirement.id, kid.id, pm.id, `${date} ${times[0]}`, dose, unit, w === 0 ? 'scheduled' : 'given',
          w === 0 ? null : `${date} ${times[0]}`, w === 0 ? null : adminId, w === 0 ? null : 'Baloo']);
    }
  }

  // Each family handed in the medication at the start of the meeting.
  await q(`INSERT INTO medication_receptions (organization_id, medication_requirement_id, participant_id, participant_medication_id, status, quantity_received, received_by, received_at)
           SELECT organization_id, medication_requirement_id, participant_id, id, 'received', 'Boîte complète', $2, NOW() - interval '1 hour'
           FROM participant_medications WHERE organization_id = $1`, [ORG, adminId]);

  // Around now: one dose due shortly, one given at the start of the meeting.
  await q(`UPDATE medication_distributions SET scheduled_for = NOW() + interval '25 minutes'
           WHERE organization_id = $1 AND participant_id = $2 AND status = 'scheduled'`, [ORG, youth[2].id]);
  await q(`UPDATE medication_distributions SET scheduled_for = NOW() - interval '45 minutes', status = 'given',
                  administered_at = NOW() - interval '40 minutes', administered_by = $3, witness_name = 'Baloo'
           WHERE organization_id = $1 AND participant_id = $2 AND status = 'scheduled'`, [ORG, youth[6].id, adminId]);

  // Equipment, with where each thing is and its state.
  for (const [name, category, total, available, condition, location] of [
    ['Tente 4 places Eureka', 'Camping', 6, 4, 'Bon état — une sardine manquante', 'warehouse'],
    ['Réchaud Coleman', 'Cuisine', 3, 3, 'Excellent', 'local_scout_hall'],
    ['Trousse de premiers soins', 'Sécurité', 4, 2, 'Vérifiée en septembre', 'local_scout_hall'],
    ['Foulards de jeu (lot de 30)', 'Animation', 1, 1, 'Bon état', 'local_scout_hall'],
    ['Gilets de sauvetage enfant', 'Nautique', 24, 22, 'Bon état', 'warehouse'],
    ['Canot Old Town 16 pi', 'Nautique', 4, 4, 'Coque réparée en 2025', 'leader_home'],
    ['Lanternes à DEL', 'Camping', 10, 8, 'Excellent', 'local_scout_hall'],
  ]) {
    const item = await one(
      `INSERT INTO equipment_items (organization_id, name, category, quantity_total, quantity_available, condition_note, is_active, location_type)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
      [ORG, name, category, total, available, condition, location]
    );
    await q('INSERT INTO equipment_item_organizations (equipment_id, organization_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [item.id, ORG]);
    if (total !== available) {
      await q(`INSERT INTO equipment_reservations (organization_id, equipment_id, meeting_date, reserved_quantity, reserved_for, status, created_by, date_from, date_to, activity_id)
               VALUES ($1, $2, $3, $4, 'Sortie canot', 'reserved', $5, $3, $3, $6)`,
        [ORG, item.id, (await one('SELECT activity_date::text AS d FROM activities WHERE id = $1', [seed.activityId])).d, total - available, adminId, seed.activityId]);
    }
  }

  fs.writeFileSync(path.join(path.dirname(process.argv[2]), 'showcase.json'), JSON.stringify({ youth, groupIds, tuesdays, adminId, yearId: year.id }, null, 2));
  console.log(`showcase: ${youth.length} youth in ${groupIds.length} groups`);
}

main().then(() => pool.end(), (error) => { console.error(error); pool.end(); process.exit(1); });
