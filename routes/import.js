const express = require('express');
const { verifyJWT, getCurrentOrganizationId, verifyOrganizationMembership, handleOrganizationResolutionError } = require('../utils/api-helpers');

module.exports = function (pool, logger) {
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

  router.post('/sisc', async (req, res) => {
    logger.info('Starting SISC import...');
    logger.info('Database pool config:', {
      host: pool.options?.host || 'default',
      database: pool.options?.database || 'default',
      hasConnectionString: !!pool.options?.connectionString
    });

    const client = await pool.connect();
    logger.info('Database client connected successfully');

    try {
      const token = req.headers.authorization?.split(' ')[1];
      const decoded = verifyJWT(token);

      if (!decoded || !decoded.user_id) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const organizationId = await getCurrentOrganizationId(req, pool, logger);

      const authCheck = await verifyOrganizationMembership(pool, decoded.user_id, organizationId, {
        requiredPermissions: ['org.edit'],
      });
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

      // Fetch organization's form formats to know which form types to create
      const formFormatsResult = await client.query(
        `SELECT form_type, form_structure FROM organization_form_formats WHERE organization_id = $1`,
        [organizationId]
      );
      const orgFormTypes = formFormatsResult.rows.map(r => r.form_type);
      logger.info(`Organization ${organizationId} has form types: ${orgFormTypes.join(', ')}`);

      // Mapping of SISC CSV fields to form submission data by form type
      // SISC columns: nom, prenom, naissance, sexe, adresse, ville, province, code_postal, 
      // courriel, tel_res, tel_tra, tel_autre, totem, ecole, annees_scoutes, photos, quitter
      const buildFormData = (get, formType) => {
        const firstName = get('prenom');
        const lastName = get('nom');
        const birthDate = parseDate(get('naissance'));
        const sex = get('sexe')?.toUpperCase() === 'H' ? 'M' : get('sexe')?.toUpperCase() === 'F' ? 'F' : null;

        // Helper to check SISC boolean values (O/N or Oui/Non)
        const isYes = (val) => val === 'O' || val === 'Oui' || val === 'oui' || val === '1' || val === 'true';

        if (formType === 'fiche_sante') {
          // SISC doesn't contain health data - create empty form for parent to fill
          return {
            first_name: firstName,
            last_name: lastName,
            date_naissance: birthDate,
            notes: get('notes') || ''
          };
        } else if (formType === 'participant_registration' || formType === 'inscription') {
          return {
            first_name: firstName,
            last_name: lastName,
            date_naissance: birthDate,
            sexe: sex,
            adresse: get('adresse'),
            ville: get('ville'),
            province: get('province'),
            code_postal: get('code_postal'),
            telephone: cleanPhone(get('tel_res')),
            telephone_travail: cleanPhone(get('tel_tra')),
            telephone_cellulaire: cleanPhone(get('tel_autre')),
            courriel: get('courriel'),
            totem: get('totem'),
            ecole: get('ecole'),
            ecole_niveau: get('ecole_niveau'),
            annees_scoutes: get('annees_scoutes'),
            annees_jeunes: get('annees_jeunes')
          };
        } else if (formType === 'autorisation' || formType === 'autorisations') {
          return {
            first_name: firstName,
            last_name: lastName,
            autorisation_photo: isYes(get('photos')) ? 'yes' : 'no',
            peut_quitter_seul: isYes(get('quitter')) ? 'yes' : 'no'
          };
        }
        // Default: return basic participant info for any unknown form type
        return {
          first_name: firstName,
          last_name: lastName,
          date_naissance: birthDate,
          sexe: sex,
          adresse: get('adresse'),
          ville: get('ville'),
          province: get('province'),
          code_postal: get('code_postal'),
          telephone: cleanPhone(get('tel_res')),
          courriel: get('courriel')
        };
      };

      const stats = {
        participantsCreated: 0,
        participantsUpdated: 0,
        guardiansCreated: 0,
        guardiansUpdated: 0,
        animationUsersCreated: 0,
        animationUsersUpdated: 0,
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
          const situation = get('situation')?.toLowerCase();

          if (!lastName || !firstName) {
            stats.errors.push(`Row ${i + 1}: Missing name`);
            continue;
          }

          if (situation === 'a') {
            const email = get('courriel')?.toLowerCase();
            const fullName = `${firstName} ${lastName}`.trim();

            if (!email) {
              stats.errors.push(`Row ${i + 1}: Missing email for animation user`);
              logger.warn(`Row ${i + 1}: Animation user missing email`, { row: i + 1 });
              continue;
            }

            const userResult = await client.query(
              `INSERT INTO users (email, password, full_name, is_verified)
               VALUES (LOWER($1), '', $2, TRUE)
               ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, is_verified = TRUE
               RETURNING id, (xmax = 0) AS inserted`,
              [email, fullName]
            );

            const userId = userResult.rows[0].id;
            const wasInserted = userResult.rows[0].inserted;

            if (wasInserted) {
              stats.animationUsersCreated++;
            } else {
              stats.animationUsersUpdated++;
            }

            // Get animation role ID
            const animationRoleResult = await client.query(
              `SELECT id FROM roles WHERE role_name = 'animation'`
            );
            if (animationRoleResult.rows.length === 0) {
              throw new Error("Animation role not found in roles table");
            }
            const animationRoleId = animationRoleResult.rows[0].id;

            await client.query(
              `INSERT INTO user_organizations (user_id, organization_id, role_ids)
               VALUES ($1, $2, $3)
               ON CONFLICT (user_id, organization_id) DO UPDATE SET role_ids = $3`,
              [userId, organizationId, JSON.stringify([animationRoleId])]
            );

            continue;
          }

          if (situation && situation !== 'j') {
            const errorMessage = `Row ${i + 1}: Invalid situation '${situation}'`;
            stats.errors.push(errorMessage);
            logger.error(errorMessage);
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

          // Create form submissions for each form type the organization has
          for (const formType of orgFormTypes) {
            const formData = buildFormData(get, formType);

            // Check if submission already exists for this participant/form type
            const existingSubmission = await client.query(
              `SELECT id FROM form_submissions 
               WHERE participant_id = $1 AND organization_id = $2 AND form_type = $3`,
              [participantId, organizationId, formType]
            );

            if (existingSubmission.rows.length > 0) {
              // Update existing submission
              await client.query(
                `UPDATE form_submissions SET submission_data = $1, updated_at = NOW()
                 WHERE id = $2`,
                [JSON.stringify(formData), existingSubmission.rows[0].id]
              );
            } else {
              // Create new submission
              await client.query(
                `INSERT INTO form_submissions (organization_id, participant_id, form_type, submission_data)
                 VALUES ($1, $2, $3, $4)`,
                [organizationId, participantId, formType, JSON.stringify(formData)]
              );
              stats.formSubmissionsCreated++;
            }
          }

          // Also create participant_registration if not in org form types (for backward compatibility)
          if (!orgFormTypes.includes('participant_registration') && !orgFormTypes.includes('inscription')) {
            const regData = buildFormData(get, 'participant_registration');
            const existingReg = await client.query(
              `SELECT id FROM form_submissions 
               WHERE participant_id = $1 AND organization_id = $2 AND form_type = 'participant_registration'`,
              [participantId, organizationId]
            );

            if (existingReg.rows.length === 0) {
              await client.query(
                `INSERT INTO form_submissions (organization_id, participant_id, form_type, submission_data)
                 VALUES ($1, $2, 'participant_registration', $3)`,
                [organizationId, participantId, JSON.stringify(regData)]
              );
              stats.formSubmissionsCreated++;
            }
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
              // Use ON CONFLICT to handle race conditions where guardian was just created
              const newGuardian = await client.query(
                `INSERT INTO parents_guardians (nom, prenom, courriel, telephone_residence, telephone_travail, telephone_cellulaire)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (courriel) DO UPDATE SET
                   telephone_residence = COALESCE(EXCLUDED.telephone_residence, parents_guardians.telephone_residence),
                   telephone_travail = COALESCE(EXCLUDED.telephone_travail, parents_guardians.telephone_travail),
                   telephone_cellulaire = COALESCE(EXCLUDED.telephone_cellulaire, parents_guardians.telephone_cellulaire)
                 RETURNING id`,
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
              // Use upsert to handle duplicate emails gracefully
              const fullName = `${gPrenom} ${gNom}`.trim();
              const userResult = await client.query(
                `INSERT INTO users (email, password, full_name, is_verified)
                 VALUES (LOWER($1), '', $2, FALSE)
                 ON CONFLICT (email) DO UPDATE SET email = users.email
                 RETURNING id, (xmax = 0) AS inserted`,
                [gEmail, fullName]
              );

              const userId = userResult.rows[0].id;
              const wasInserted = userResult.rows[0].inserted;

              if (wasInserted) {
                stats.usersCreated++;
              }

              // Get parent role ID
              const parentRoleResult = await client.query(
                `SELECT id FROM roles WHERE role_name = 'parent'`
              );
              if (parentRoleResult.rows.length === 0) {
                throw new Error("Parent role not found in roles table");
              }
              const parentRoleId = parentRoleResult.rows[0].id;

              // Always ensure user is linked to organization
              await client.query(
                `INSERT INTO user_organizations (user_id, organization_id, role_ids)
                 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                [userId, organizationId, JSON.stringify([parentRoleId])]
              );

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
      logger.info('Transaction COMMIT executed successfully');

      // Verify data was actually saved
      const verification = {};
      try {
        const participantCount = await pool.query(
          `SELECT COUNT(*) as count FROM participants p 
           JOIN participant_organizations po ON p.id = po.participant_id 
           WHERE po.organization_id = $1`,
          [organizationId]
        );
        verification.totalParticipants = parseInt(participantCount.rows[0].count);

        const guardianCount = await pool.query(
          `SELECT COUNT(DISTINCT pg.id) as count FROM parents_guardians pg
           JOIN participant_guardians pgl ON pg.id = pgl.guardian_id
           JOIN participants p ON pgl.participant_id = p.id
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE po.organization_id = $1`,
          [organizationId]
        );
        verification.totalGuardians = parseInt(guardianCount.rows[0].count);

        const userParticipantCount = await pool.query(
          `SELECT COUNT(*) as count FROM user_participants up
           JOIN participants p ON up.participant_id = p.id
           JOIN participant_organizations po ON p.id = po.participant_id
           WHERE po.organization_id = $1`,
          [organizationId]
        );
        verification.totalUserParticipantLinks = parseInt(userParticipantCount.rows[0].count);

        logger.info('Import verification:', verification);
      } catch (verifyError) {
        logger.error('Verification query failed:', verifyError);
      }

      res.json({
        success: true,
        message: 'Import completed (participants, guardians, and animation users processed)',
        stats,
        verification
      });

    } catch (error) {
      await client.query('ROLLBACK');
      if (handleOrganizationResolutionError(res, error, logger)) {
        return;
      }
      logger.error('SISC import error:', error);
      res.status(500).json({ success: false, message: error.message });
    } finally {
      client.release();
    }
  });

  return router;
};
