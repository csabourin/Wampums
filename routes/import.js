const express = require('express');
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership } = require('../utils/api-helpers');

module.exports = function(pool, logger) {
  const router = express.Router();

  const RELATIONSHIP_MAP = {
    'Mre': 'Mère',
    'Pre': 'Père',
    'Grd': 'Grand-parent',
    'Tut': 'Tuteur',
    'Aut': 'Autre'
  };

  function parseDate(dateStr) {
    if (!dateStr || dateStr.length !== 8) return null;
    const year = dateStr.substring(0, 4);
    const month = dateStr.substring(4, 6);
    const day = dateStr.substring(6, 8);
    return `${year}-${month}-${day}`;
  }

  function cleanPhone(phone) {
    if (!phone) return null;
    return phone.replace(/[^0-9]/g, '');
  }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ';' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  router.post('/import-sisc', async (req, res) => {
    const client = await pool.connect();
    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, ['admin']);
      if (!authCheck.authorized) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }

      const { csvContent } = req.body;
      if (!csvContent) {
        return res.status(400).json({ success: false, message: 'CSV content is required' });
      }

      const lines = csvContent.split('\n').filter(line => line.trim());
      if (lines.length < 2) {
        return res.status(400).json({ success: false, message: 'CSV must have header and at least one data row' });
      }

      const headers = parseCSVLine(lines[0]);
      const headerMap = {};
      headers.forEach((h, i) => { headerMap[h.replace(/"/g, '')] = i; });

      await client.query('BEGIN');

      const stats = {
        participantsCreated: 0,
        participantsUpdated: 0,
        guardiansCreated: 0,
        guardiansUpdated: 0,
        usersCreated: 0,
        userParticipantLinksCreated: 0,
        formSubmissionsCreated: 0,
        errors: []
      };

      for (let i = 1; i < lines.length; i++) {
        try {
          const values = parseCSVLine(lines[i]);
          const get = (field) => {
            const idx = headerMap[field];
            return idx !== undefined ? values[idx]?.replace(/"/g, '') : null;
          };

          const lastName = get('nom');
          const firstName = get('prenom');
          const birthDate = parseDate(get('naissance'));
          const sex = get('sexe')?.toUpperCase() === 'H' ? 'M' : get('sexe')?.toUpperCase() === 'F' ? 'F' : null;

          if (!lastName || !firstName) {
            stats.errors.push(`Row ${i + 1}: Missing name`);
            continue;
          }

          let participantId;
          const existingParticipant = await client.query(
            `SELECT p.id FROM participants p
             JOIN participant_organizations po ON p.id = po.participant_id
             WHERE LOWER(p.first_name) = LOWER($1) 
             AND LOWER(p.last_name) = LOWER($2) 
             AND (p.date_naissance IS NOT DISTINCT FROM $3)
             AND po.organization_id = $4`,
            [firstName, lastName, birthDate, organizationId]
          );

          if (existingParticipant.rows.length > 0) {
            participantId = existingParticipant.rows[0].id;
            stats.participantsUpdated++;
          } else {
            const newParticipant = await client.query(
              `INSERT INTO participants (first_name, last_name, date_naissance)
               VALUES ($1, $2, $3) RETURNING id`,
              [firstName, lastName, birthDate]
            );
            participantId = newParticipant.rows[0].id;

            await client.query(
              `INSERT INTO participant_organizations (participant_id, organization_id)
               VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [participantId, organizationId]
            );
            stats.participantsCreated++;
          }

          const submissionData = {
            first_name: firstName,
            last_name: lastName,
            date_naissance: birthDate,
            sexe: sex,
            adresse: get('adresse'),
            ville: get('ville'),
            province: get('province'),
            code_postal: get('code_postal'),
            telephone: cleanPhone(get('tel_res')),
            courriel: get('courriel'),
            totem: get('totem'),
            ecole: get('ecole'),
            annees_scoutes: get('annees_scoutes')
          };

          const existingSubmission = await client.query(
            `SELECT id FROM form_submissions 
             WHERE participant_id = $1 AND organization_id = $2 AND form_type = 'participant_registration'`,
            [participantId, organizationId]
          );

          if (existingSubmission.rows.length > 0) {
            await client.query(
              `UPDATE form_submissions SET submission_data = $1, updated_at = NOW()
               WHERE id = $2`,
              [JSON.stringify(submissionData), existingSubmission.rows[0].id]
            );
          } else {
            await client.query(
              `INSERT INTO form_submissions (organization_id, participant_id, form_type, submission_data)
               VALUES ($1, $2, 'participant_registration', $3)`,
              [organizationId, participantId, JSON.stringify(submissionData)]
            );
            stats.formSubmissionsCreated++;
          }

          for (const prefix of ['r1_', 'r2_']) {
            const gNom = get(`${prefix}nom`);
            const gPrenom = get(`${prefix}prenom`);
            const gEmail = get(`${prefix}courriel`)?.toLowerCase();
            const gLienRaw = get(`${prefix}lien`);
            const gLien = RELATIONSHIP_MAP[gLienRaw] || gLienRaw || 'Autre';

            if (!gNom && !gPrenom) continue;

            let guardianId;
            let existingGuardian = null;

            if (gEmail) {
              existingGuardian = await client.query(
                `SELECT id FROM parents_guardians WHERE LOWER(courriel) = LOWER($1)`,
                [gEmail]
              );
            }

            if (!existingGuardian?.rows?.length && gNom && gPrenom) {
              existingGuardian = await client.query(
                `SELECT id FROM parents_guardians 
                 WHERE LOWER(nom) = LOWER($1) AND LOWER(prenom) = LOWER($2)`,
                [gNom, gPrenom]
              );
            }

            if (existingGuardian?.rows?.length > 0) {
              guardianId = existingGuardian.rows[0].id;
              await client.query(
                `UPDATE parents_guardians SET
                 telephone_residence = COALESCE($1, telephone_residence),
                 telephone_travail = COALESCE($2, telephone_travail),
                 telephone_cellulaire = COALESCE($3, telephone_cellulaire),
                 courriel = COALESCE($4, courriel)
                 WHERE id = $5`,
                [
                  cleanPhone(get(`${prefix}tel_res`)),
                  cleanPhone(get(`${prefix}tel_tra`)),
                  cleanPhone(get(`${prefix}tel_autre`)),
                  gEmail,
                  guardianId
                ]
              );
              stats.guardiansUpdated++;
            } else {
              const newGuardian = await client.query(
                `INSERT INTO parents_guardians (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [
                  gNom,
                  gPrenom,
                  gEmail,
                  cleanPhone(get(`${prefix}tel_res`)),
                  cleanPhone(get(`${prefix}tel_tra`)),
                  cleanPhone(get(`${prefix}tel_autre`))
                ]
              );
              guardianId = newGuardian.rows[0].id;
              stats.guardiansCreated++;
            }

            await client.query(
              `INSERT INTO participant_guardians (guardian_id, participant_id, lien)
               VALUES ($1, $2, $3)
               ON CONFLICT (guardian_id, participant_id) DO UPDATE SET lien = $3`,
              [guardianId, participantId, gLien]
            );

            if (gEmail) {
              const existingUser = await client.query(
                `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
                [gEmail]
              );

              let userId;
              if (existingUser.rows.length === 0) {
                const fullName = `${gPrenom} ${gNom}`.trim();
                const newUser = await client.query(
                  `INSERT INTO users (email, password, full_name, is_verified)
                   VALUES ($1, '', $2, FALSE) RETURNING id`,
                  [gEmail, fullName]
                );
                userId = newUser.rows[0].id;
                stats.usersCreated++;

                await client.query(
                  `INSERT INTO user_organizations (user_id, organization_id, role)
                   VALUES ($1, $2, 'parent') ON CONFLICT DO NOTHING`,
                  [userId, organizationId]
                );
              } else {
                userId = existingUser.rows[0].id;
                await client.query(
                  `INSERT INTO user_organizations (user_id, organization_id, role)
                   VALUES ($1, $2, 'parent') ON CONFLICT DO NOTHING`,
                  [userId, organizationId]
                );
              }

              await client.query(
                `INSERT INTO guardian_users (guardian_id, user_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [guardianId, userId]
              );

              await client.query(
                `UPDATE parents_guardians SET user_uuid = $1 WHERE id = $2`,
                [userId, guardianId]
              );

              // Link user to participant so parent can see child in dashboard
              const linkResult = await client.query(
                `INSERT INTO user_participants (user_id, participant_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING
                 RETURNING user_id`,
                [userId, participantId]
              );
              if (linkResult.rows.length > 0) {
                stats.userParticipantLinksCreated++;
              }
            }
          }

        } catch (rowError) {
          stats.errors.push(`Row ${i + 1}: ${rowError.message}`);
          logger.error(`Import error at row ${i + 1}:`, rowError);
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Import completed',
        stats
      });

    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('SISC import error:', error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      client.release();
    }
  });

  return router;
};
