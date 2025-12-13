// Resource and permission slip routes
// Provides RESTful endpoints for equipment inventory, reservations, and guardian approvals
const express = require('express');
const { check, param, query } = require('express-validator');
const router = express.Router();
const multer = require('multer');

const { authenticate, requireOrganizationRole, getOrganizationId } = require('../middleware/auth');
const { success, error, asyncHandler } = require('../middleware/response');
const { checkValidation } = require('../middleware/validation');
const { handleOrganizationResolutionError } = require('../utils/api-helpers');
const { sendEmail } = require('../utils/index');
const {
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  validateFile,
  generateFilePath,
  uploadFile,
  deleteFile,
  extractPathFromUrl,
  isStorageConfigured
} = require('../utils/supabase-storage');

// Configure multer for memory storage (3MB limit)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
    }
  }
});

function parseDate(dateString) {
  const parsed = new Date(dateString);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

module.exports = (pool) => {
  const leaderRoles = ['admin', 'leader', 'animation'];
  const leaderAndParents = ['admin', 'leader', 'animation', 'parent'];

  async function verifyMeeting(meetingId, organizationId) {
    if (!meetingId) {
      return null;
    }

    const meetingResult = await pool.query(
      'SELECT id, date::text AS date FROM reunion_preparations WHERE id = $1 AND organization_id = $2',
      [meetingId, organizationId]
    );

    if (meetingResult.rows.length === 0) {
      throw new Error('Meeting not found for organization');
    }

    return meetingResult.rows[0];
  }

  async function verifyParticipant(participantId, organizationId) {
    const membership = await pool.query(
      'SELECT 1 FROM participant_organizations WHERE participant_id = $1 AND organization_id = $2',
      [participantId, organizationId]
    );

    if (membership.rows.length === 0) {
      throw new Error('Participant not linked to organization');
    }
  }

  async function getParentParticipantIds(userId, organizationId) {
    const result = await pool.query(
      `SELECT up.participant_id
         FROM user_participants up
         JOIN participant_organizations po ON po.participant_id = up.participant_id
        WHERE up.user_id = $1 AND po.organization_id = $2`,
      [userId, organizationId]
    );

    return result.rows.map((row) => row.participant_id);
  }

  async function verifyEquipmentAccess(equipmentId, organizationId) {
    const accessResult = await pool.query(
      `SELECT 1
       FROM equipment_item_organizations eio
       JOIN equipment_items ei ON ei.id = eio.equipment_id
       WHERE eio.equipment_id = $1
         AND eio.organization_id = $2
         AND ei.is_active IS DISTINCT FROM false`,
      [equipmentId, organizationId]
    );

    if (accessResult.rows.length === 0) {
      throw new Error('Equipment not accessible for organization');
    }
  }

  // ============================
  // Equipment inventory
  // ============================
  router.get(
    '/equipment',
    authenticate,
    requireOrganizationRole(leaderRoles),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const result = await pool.query(
          `SELECT e.*, 
                  COALESCE((
                    SELECT SUM(CASE WHEN er.status IN ('reserved','confirmed') THEN er.reserved_quantity ELSE 0 END)
                    FROM equipment_reservations er
                    WHERE er.equipment_id = e.id
                  ), 0) AS reserved_quantity,
                  COALESCE((
                    SELECT ARRAY_AGG(o.name ORDER BY o.name)
                    FROM equipment_item_organizations eio
                    JOIN organizations o ON o.id = eio.organization_id
                    WHERE eio.equipment_id = e.id
                  ), '{}') AS shared_organizations
           FROM equipment_items e
           JOIN equipment_item_organizations access ON access.equipment_id = e.id AND access.organization_id = $1
           WHERE e.is_active IS DISTINCT FROM false
           GROUP BY e.id
           ORDER BY e.category NULLS LAST, e.name`,
          [organizationId]
        );

        return success(res, { equipment: result.rows });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error fetching equipment', 500);
      }
    })
  );

  router.post(
    '/equipment',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      check('name').isString().trim().isLength({ min: 2, max: 150 }),
      check('category').optional().isString().trim().isLength({ max: 100 }),
      check('description').optional().isString().trim().isLength({ max: 2000 }),
      check('quantity_total').optional().isInt({ min: 0 }),
      check('quantity_available').optional().isInt({ min: 0 }),
      check('condition_note').optional().isString().trim().isLength({ max: 500 }),
      check('attributes').optional().isObject(),
      check('shared_organization_ids').optional().isArray({ max: 50 }),
      check('shared_organization_ids.*').optional().isInt({ min: 0 }),
      check('item_value').optional().isNumeric(),
      check('photo_url').optional().isString().trim().isLength({ max: 500 }),
      check('acquisition_date').optional().isISO8601()
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const {
          name,
          category,
          description,
          quantity_total = 1,
          quantity_available,
          condition_note,
          attributes = {},
          shared_organization_ids = [],
          item_value,
          photo_url,
          acquisition_date
        } = req.body;

        const available = quantity_available ?? quantity_total;
        const normalizedAcquisitionDate = acquisition_date ? parseDate(acquisition_date) : null;

        const insertResult = await pool.query(
          `INSERT INTO equipment_items
           (organization_id, name, category, description, quantity_total, quantity_available, condition_note, attributes, item_value, photo_url, acquisition_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (organization_id, name)
           DO UPDATE SET
             category = EXCLUDED.category,
             description = EXCLUDED.description,
             quantity_total = EXCLUDED.quantity_total,
             quantity_available = EXCLUDED.quantity_available,
             condition_note = EXCLUDED.condition_note,
             attributes = EXCLUDED.attributes,
             item_value = EXCLUDED.item_value,
             photo_url = EXCLUDED.photo_url,
             acquisition_date = EXCLUDED.acquisition_date,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [organizationId, name, category, description, quantity_total, available, condition_note, attributes, item_value || null, photo_url || null, normalizedAcquisitionDate]
        );

        const uniqueOrgIds = new Set(
          [organizationId].concat(Array.isArray(shared_organization_ids) ? shared_organization_ids : [])
        );
        for (const orgId of uniqueOrgIds) {
          if (!Number.isInteger(orgId)) {
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          await pool.query(
            `INSERT INTO equipment_item_organizations (equipment_id, organization_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [insertResult.rows[0].id, orgId]
          );
        }

        return success(res, { equipment: insertResult.rows[0] }, 'Equipment saved', 201);
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error saving equipment', 500);
      }
    })
  );

  router.put(
    '/equipment/:id',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      param('id').isInt({ min: 1 }),
      check('name').optional().isString().trim().isLength({ min: 2, max: 150 }),
      check('category').optional().isString().trim().isLength({ max: 100 }),
      check('description').optional().isString().trim().isLength({ max: 2000 }),
      check('quantity_total').optional().isInt({ min: 0 }),
      check('quantity_available').optional().isInt({ min: 0 }),
      check('condition_note').optional().isString().trim().isLength({ max: 500 }),
      check('is_active').optional().isBoolean(),
      check('attributes').optional().isObject(),
      check('item_value').optional().isNumeric(),
      check('photo_url').optional().isString().trim().isLength({ max: 500 }),
      check('acquisition_date').optional().isISO8601()
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const equipmentId = parseInt(req.params.id, 10);

        // Handle acquisition_date normalization
        if (req.body.acquisition_date) {
          req.body.acquisition_date = parseDate(req.body.acquisition_date);
        }

        const fields = ['name', 'category', 'description', 'quantity_total', 'quantity_available', 'condition_note', 'is_active', 'attributes', 'item_value', 'photo_url', 'acquisition_date'];
        const updates = [];
        const values = [];
        fields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updates.push(`${field} = $${updates.length + 2}`);
            values.push(req.body[field]);
          }
        });

        if (updates.length === 0) {
          return success(res, null, 'No changes detected');
        }

        // Verify organization has access to this equipment (owner or shared)
        await verifyEquipmentAccess(equipmentId, organizationId);

        // Update equipment (any organization with access can update)
        const queryText = `UPDATE equipment_items
          SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *`;
        const result = await pool.query(queryText, [equipmentId, ...values]);

        if (result.rows.length === 0) {
          return error(res, 'Equipment not found', 404);
        }

        return success(res, { equipment: result.rows[0] }, 'Equipment updated');
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error updating equipment', 500);
      }
    })
  );

  // Delete equipment (soft delete by setting is_active = false)
  router.delete(
    '/equipment/:id',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [param('id').isInt({ min: 1 })],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const equipmentId = parseInt(req.params.id, 10);

        // Verify organization has access to this equipment (owner or shared)
        await verifyEquipmentAccess(equipmentId, organizationId);

        // Check if equipment has active reservations
        const reservationCheck = await pool.query(
          `SELECT COUNT(*) as count FROM equipment_reservations
           WHERE equipment_id = $1 AND status IN ('reserved', 'confirmed')`,
          [equipmentId]
        );

        if (parseInt(reservationCheck.rows[0].count, 10) > 0) {
          return error(res, 'Cannot delete equipment with active reservations', 400);
        }

        // Soft delete: set is_active = false (any organization with access can delete)
        const result = await pool.query(
          `UPDATE equipment_items
           SET is_active = false, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [equipmentId]
        );

        if (result.rows.length === 0) {
          return error(res, 'Equipment not found', 404);
        }

        // Delete photo from storage if exists
        const photoUrl = result.rows[0].photo_url;
        if (photoUrl && isStorageConfigured()) {
          const filePath = extractPathFromUrl(photoUrl);
          if (filePath) {
            await deleteFile(filePath);
          }
        }

        return success(res, { equipment: result.rows[0] }, 'Equipment deleted successfully');
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error deleting equipment', 500);
      }
    })
  );

  // ============================
  // Equipment photo upload
  // ============================
  router.post(
    '/equipment/:id/photo',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [param('id').isInt({ min: 1 })],
    checkValidation,
    upload.single('photo'),
    asyncHandler(async (req, res) => {
      try {
        // Check if storage is configured
        if (!isStorageConfigured()) {
          return error(
            res,
            'Photo storage is not configured. Please set SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_STORAGE_BUCKET.',
            503
          );
        }

        const organizationId = await getOrganizationId(req, pool);
        const equipmentId = parseInt(req.params.id, 10);

        // Verify equipment belongs to organization
        const equipmentCheck = await pool.query(
          'SELECT id, photo_url FROM equipment_items WHERE id = $1 AND organization_id = $2',
          [equipmentId, organizationId]
        );

        if (equipmentCheck.rows.length === 0) {
          return error(res, 'Equipment not found', 404);
        }

        // Validate file
        const validation = validateFile(req.file);
        if (!validation.isValid) {
          return error(res, validation.error, 400);
        }

        // Delete old photo if exists
        const oldPhotoUrl = equipmentCheck.rows[0].photo_url;
        if (oldPhotoUrl) {
          const oldPath = extractPathFromUrl(oldPhotoUrl);
          if (oldPath) {
            await deleteFile(oldPath);
          }
        }

        // Generate file path and upload
        const filePath = generateFilePath(organizationId, equipmentId, req.file.originalname);
        const uploadResult = await uploadFile(req.file.buffer, filePath, req.file.mimetype);

        if (!uploadResult.success) {
          return error(res, uploadResult.error || 'Failed to upload photo', 500);
        }

        // Update equipment with new photo URL
        const updateResult = await pool.query(
          `UPDATE equipment_items
           SET photo_url = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND organization_id = $3
           RETURNING *`,
          [uploadResult.url, equipmentId, organizationId]
        );

        return success(res, { equipment: updateResult.rows[0], photo_url: uploadResult.url }, 'Photo uploaded successfully');
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        // Handle multer errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return error(res, `File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`, 400);
        }
        return error(res, err.message || 'Error uploading photo', 500);
      }
    })
  );

  // Delete equipment photo
  router.delete(
    '/equipment/:id/photo',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [param('id').isInt({ min: 1 })],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const equipmentId = parseInt(req.params.id, 10);

        // Get current photo URL
        const equipmentCheck = await pool.query(
          'SELECT id, photo_url FROM equipment_items WHERE id = $1 AND organization_id = $2',
          [equipmentId, organizationId]
        );

        if (equipmentCheck.rows.length === 0) {
          return error(res, 'Equipment not found', 404);
        }

        const photoUrl = equipmentCheck.rows[0].photo_url;
        if (!photoUrl) {
          return success(res, { equipment: equipmentCheck.rows[0] }, 'No photo to delete');
        }

        // Delete from storage if configured
        if (isStorageConfigured()) {
          const filePath = extractPathFromUrl(photoUrl);
          if (filePath) {
            await deleteFile(filePath);
          }
        }

        // Update equipment to remove photo URL
        const updateResult = await pool.query(
          `UPDATE equipment_items
           SET photo_url = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $2
           RETURNING *`,
          [equipmentId, organizationId]
        );

        return success(res, { equipment: updateResult.rows[0] }, 'Photo deleted successfully');
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error deleting photo', 500);
      }
    })
  );

  // ============================
  // Equipment reservations
  // ============================
  router.get(
    '/equipment/reservations',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      query('meeting_date').optional().isISO8601(),
      query('date_from').optional().isISO8601(),
      query('date_to').optional().isISO8601()
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const meetingDate = req.query.meeting_date ? parseDate(req.query.meeting_date) : null;
        const dateFrom = req.query.date_from ? parseDate(req.query.date_from) : null;
        const dateTo = req.query.date_to ? parseDate(req.query.date_to) : null;
        const params = [organizationId];
        let filter = '';

        if (meetingDate) {
          filter = 'AND er.meeting_date = $2';
          params.push(meetingDate);
        } else if (dateFrom && dateTo) {
          // Filter reservations that overlap with the requested date range
          // A reservation overlaps if: reservation.date_from <= requested.date_to AND reservation.date_to >= requested.date_from
          filter = 'AND er.date_from <= $3 AND er.date_to >= $2';
          params.push(dateFrom, dateTo);
        } else if (dateFrom) {
          filter = 'AND er.date_from >= $2';
          params.push(dateFrom);
        }

        const result = await pool.query(
          `SELECT er.*, e.name AS equipment_name, e.category, er.organization_id AS reservation_organization_id
           FROM equipment_reservations er
           JOIN equipment_items e ON e.id = er.equipment_id
           JOIN equipment_item_organizations access ON access.equipment_id = er.equipment_id AND access.organization_id = $1
           WHERE 1=1 ${filter}
           ORDER BY COALESCE(er.date_from, er.meeting_date) DESC, e.name`,
          params
        );

        return success(res, { reservations: result.rows });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error fetching reservations', 500);
      }
    })
  );

  router.post(
    '/equipment/reservations',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      check('equipment_id').isInt({ min: 1 }),
      check('meeting_date').optional().isISO8601(),
      check('date_from').optional().isISO8601(),
      check('date_to').optional().isISO8601(),
      check('meeting_id').optional().isInt({ min: 1 }),
      check('reserved_quantity').optional().isInt({ min: 1 }),
      check('reserved_for').optional().isString().trim().isLength({ max: 200 }),
      check('status').optional().isIn(['reserved', 'confirmed', 'returned', 'cancelled']),
      check('notes').optional().isString().trim().isLength({ max: 2000 })
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const {
          equipment_id,
          meeting_date,
          date_from,
          date_to,
          meeting_id,
          reserved_quantity = 1,
          reserved_for,
          status = 'reserved',
          notes
        } = req.body;

        if (meeting_id) {
          await verifyMeeting(meeting_id, organizationId);
        }

        // Support both old (meeting_date) and new (date_from/date_to) formats
        let normalizedDate, normalizedDateFrom, normalizedDateTo;
        
        if (date_from && date_to) {
          normalizedDateFrom = parseDate(date_from);
          normalizedDateTo = parseDate(date_to);
          normalizedDate = normalizedDateFrom; // Use date_from as meeting_date for backward compatibility
          
          if (!normalizedDateFrom || !normalizedDateTo) {
            return error(res, 'Invalid date range', 400);
          }
          
          if (normalizedDateFrom > normalizedDateTo) {
            return error(res, 'date_from must be before or equal to date_to', 400);
          }
        } else if (meeting_date) {
          normalizedDate = parseDate(meeting_date);
          normalizedDateFrom = normalizedDate;
          normalizedDateTo = normalizedDate;
          
          if (!normalizedDate) {
            return error(res, 'Invalid meeting date', 400);
          }
        } else {
          return error(res, 'Either meeting_date or date_from/date_to is required', 400);
        }

        await verifyEquipmentAccess(equipment_id, organizationId);

        // Get equipment total quantity
        const equipmentResult = await pool.query(
          `SELECT quantity_total FROM equipment_items WHERE id = $1`,
          [equipment_id]
        );

        if (equipmentResult.rows.length === 0) {
          return error(res, 'Equipment not found', 404);
        }

        const quantityTotal = equipmentResult.rows[0].quantity_total;

        // Check for overlapping reservations to prevent double-booking
        // Exclude the current reservation if this is an update (same organization, equipment, meeting_date, reserved_for)
        const overlapResult = await pool.query(
          `SELECT COALESCE(SUM(reserved_quantity), 0) as total_reserved
           FROM equipment_reservations
           WHERE equipment_id = $1
             AND status IN ('reserved', 'confirmed')
             AND (
               (date_from <= $3 AND date_to >= $2) OR  -- overlaps with our date range
               (date_from >= $2 AND date_to <= $3)     -- completely contained within our date range
             )
             AND NOT (
               organization_id = $4
               AND meeting_date = $5
               AND reserved_for = $6
             )`,
          [equipment_id, normalizedDateFrom, normalizedDateTo, organizationId, normalizedDate, reserved_for ?? '']
        );

        const totalReserved = parseInt(overlapResult.rows[0].total_reserved, 10);

        // Check if adding this reservation would exceed available quantity
        if (totalReserved + reserved_quantity > quantityTotal) {
          const available = quantityTotal - totalReserved;
          return error(res, `Insufficient quantity available. Total: ${quantityTotal}, Already reserved: ${totalReserved}, Available: ${available}, Requested: ${reserved_quantity}`, 400);
        }

        const insertResult = await pool.query(
          `INSERT INTO equipment_reservations
           (organization_id, equipment_id, meeting_id, meeting_date, date_from, date_to, reserved_quantity, reserved_for, status, notes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT ON CONSTRAINT equipment_reservations_unique_reservation
           DO UPDATE SET reserved_quantity = EXCLUDED.reserved_quantity,
                         status = EXCLUDED.status,
                         notes = EXCLUDED.notes,
                         meeting_id = EXCLUDED.meeting_id,
                         date_from = EXCLUDED.date_from,
                         date_to = EXCLUDED.date_to,
                         updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [
            organizationId,
            equipment_id,
            meeting_id || null,
            normalizedDate,
            normalizedDateFrom,
            normalizedDateTo,
            reserved_quantity,
            reserved_for ?? '',
            status,
            notes,
            req.user?.id || null
          ]
        );

        return success(res, { reservation: insertResult.rows[0] }, 'Reservation saved', 201);
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error saving reservation', 500);
      }
    })
  );

  router.patch(
    '/equipment/reservations/:id',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      param('id').isInt({ min: 1 }),
      check('reserved_quantity').optional().isInt({ min: 1 }),
      check('reserved_for').optional().isString().trim().isLength({ max: 200 }),
      check('status').optional().isIn(['reserved', 'confirmed', 'returned', 'cancelled']),
      check('notes').optional().isString().trim().isLength({ max: 2000 })
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const reservationId = parseInt(req.params.id, 10);
        const fields = ['reserved_quantity', 'reserved_for', 'status', 'notes'];
        const updates = [];
        const values = [];
        fields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updates.push(`${field} = $${updates.length + 2}`);
            values.push(req.body[field]);
          }
        });

        if (updates.length === 0) {
          return success(res, null, 'No changes detected');
        }

        // If updating reserved_quantity, check for double-booking
        if (req.body.reserved_quantity !== undefined) {
          // Get current reservation details
          const currentReservation = await pool.query(
            `SELECT equipment_id, date_from, date_to, reserved_quantity, status
             FROM equipment_reservations
             WHERE id = $1 AND organization_id = $2`,
            [reservationId, organizationId]
          );

          if (currentReservation.rows.length === 0) {
            return error(res, 'Reservation not found', 404);
          }

          const reservation = currentReservation.rows[0];

          // Only check if reservation is active (not returned or cancelled)
          if (reservation.status === 'reserved' || reservation.status === 'confirmed') {
            // Get equipment total quantity
            const equipmentResult = await pool.query(
              `SELECT quantity_total FROM equipment_items WHERE id = $1`,
              [reservation.equipment_id]
            );

            if (equipmentResult.rows.length === 0) {
              return error(res, 'Equipment not found', 404);
            }

            const quantityTotal = equipmentResult.rows[0].quantity_total;

            // Check for overlapping reservations (excluding this reservation)
            const overlapResult = await pool.query(
              `SELECT COALESCE(SUM(reserved_quantity), 0) as total_reserved
               FROM equipment_reservations
               WHERE equipment_id = $1
                 AND id != $2
                 AND status IN ('reserved', 'confirmed')
                 AND (
                   (date_from <= $4 AND date_to >= $3) OR  -- overlaps with our date range
                   (date_from >= $3 AND date_to <= $4)     -- completely contained within our date range
                 )`,
              [reservation.equipment_id, reservationId, reservation.date_from, reservation.date_to]
            );

            const totalReserved = parseInt(overlapResult.rows[0].total_reserved, 10);

            // Check if the new quantity would exceed available
            if (totalReserved + req.body.reserved_quantity > quantityTotal) {
              const available = quantityTotal - totalReserved;
              return error(res, `Insufficient quantity available. Total: ${quantityTotal}, Already reserved: ${totalReserved}, Available: ${available}, Requested: ${req.body.reserved_quantity}`, 400);
            }
          }
        }

        const queryText = `UPDATE equipment_reservations
          SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND organization_id = $${updates.length + 2}
          RETURNING *`;
        const result = await pool.query(queryText, [reservationId, ...values, organizationId]);

        if (result.rows.length === 0) {
          return error(res, 'Reservation not found', 404);
        }

        return success(res, { reservation: result.rows[0] }, 'Reservation updated');
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error updating reservation', 500);
      }
    })
  );

  // Bulk equipment reservations
  router.post(
    '/equipment/reservations/bulk',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      check('date_from').isISO8601(),
      check('date_to').isISO8601(),
      check('reserved_for').isString().trim().isLength({ min: 1, max: 200 }),
      check('notes').optional().isString().trim().isLength({ max: 2000 }),
      check('items').isArray({ min: 1, max: 50 }),
      check('items.*.equipment_id').isInt({ min: 1 }),
      check('items.*.quantity').isInt({ min: 1 })
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const {
          date_from,
          date_to,
          reserved_for,
          notes,
          items
        } = req.body;

        const normalizedDateFrom = parseDate(date_from);
        const normalizedDateTo = parseDate(date_to);

        if (!normalizedDateFrom || !normalizedDateTo) {
          return error(res, 'Invalid date range', 400);
        }

        if (normalizedDateFrom > normalizedDateTo) {
          return error(res, 'date_from must be before or equal to date_to', 400);
        }

        // Verify all equipment items are accessible
        for (const item of items) {
          await verifyEquipmentAccess(item.equipment_id, organizationId);
        }

        const createdReservations = [];

        // Create a reservation for each equipment item
        for (const item of items) {
          // Get equipment total quantity
          const equipmentResult = await pool.query(
            `SELECT quantity_total FROM equipment_items WHERE id = $1`,
            [item.equipment_id]
          );

          if (equipmentResult.rows.length === 0) {
            return error(res, `Equipment with ID ${item.equipment_id} not found`, 404);
          }

          const quantityTotal = equipmentResult.rows[0].quantity_total;

          // Check for overlapping reservations to prevent double-booking
          const overlapResult = await pool.query(
            `SELECT COALESCE(SUM(reserved_quantity), 0) as total_reserved
             FROM equipment_reservations
             WHERE equipment_id = $1
               AND status IN ('reserved', 'confirmed')
               AND (
                 (date_from <= $3 AND date_to >= $2) OR  -- overlaps with our date range
                 (date_from >= $2 AND date_to <= $3)     -- completely contained within our date range
               )`,
            [item.equipment_id, normalizedDateFrom, normalizedDateTo]
          );

          const totalReserved = parseInt(overlapResult.rows[0].total_reserved, 10);

          // Check if adding this reservation would exceed available quantity
          if (totalReserved + item.quantity > quantityTotal) {
            const available = quantityTotal - totalReserved;
            return error(res, `Insufficient quantity available for equipment ID ${item.equipment_id}. Total: ${quantityTotal}, Already reserved: ${totalReserved}, Available: ${available}, Requested: ${item.quantity}`, 400);
          }

          const insertResult = await pool.query(
            `INSERT INTO equipment_reservations
             (organization_id, equipment_id, meeting_date, date_from, date_to, reserved_quantity, reserved_for, status, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
              organizationId,
              item.equipment_id,
              normalizedDateFrom, // Use date_from as meeting_date for backward compatibility
              normalizedDateFrom,
              normalizedDateTo,
              item.quantity,
              reserved_for,
              'reserved',
              notes || null,
              req.user?.id || null
            ]
          );

          createdReservations.push(insertResult.rows[0]);
        }

        return success(res, {
          reservations: createdReservations,
          count: createdReservations.length
        }, 'Bulk reservations saved', 201);
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error saving bulk reservations', 500);
      }
    })
  );

  // ============================
  // Permission slips
  // ============================
  router.get(
    '/permission-slips',
    authenticate,
    requireOrganizationRole(leaderAndParents),
    [
      query('meeting_date').optional().isISO8601(),
      query('participant_id').optional().isInt({ min: 1 })
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const meetingDate = req.query.meeting_date ? parseDate(req.query.meeting_date) : null;
        const participantId = req.query.participant_id ? parseInt(req.query.participant_id, 10) : null;
        const params = [organizationId];
        let filter = '';

        if (req.userRole === 'parent') {
          const allowedParticipantIds = await getParentParticipantIds(req.user.id, organizationId);
          if (participantId && !allowedParticipantIds.includes(participantId)) {
            return error(res, 'Permission denied for participant', 403);
          }

          if (!participantId) {
            if (allowedParticipantIds.length === 0) {
              return success(res, { permission_slips: [] });
            }
            params.push(allowedParticipantIds);
            filter += ` AND ps.participant_id = ANY($${params.length})`;
          }
        }

        if (meetingDate) {
          params.push(meetingDate);
          filter += ` AND ps.meeting_date = $${params.length}`;
        }

        if (participantId) {
          params.push(participantId);
          filter += ` AND ps.participant_id = $${params.length}`;
        }

        const result = await pool.query(
          `SELECT ps.*, p.first_name, p.last_name, g.prenom AS guardian_first_name, g.nom AS guardian_last_name
           FROM permission_slips ps
           JOIN participants p ON p.id = ps.participant_id
           LEFT JOIN parents_guardians g ON g.id = ps.guardian_id
           WHERE ps.organization_id = $1 ${filter}
           ORDER BY ps.meeting_date DESC, p.first_name`,
          params
        );

        return success(res, { permission_slips: result.rows });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error fetching permission slips', 500);
      }
    })
  );
  router.post(
    '/permission-slips/send-emails',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      check('meeting_date').isISO8601(),
      check('activity_title').optional().isString().trim().isLength({ max: 200 }),
      check('participant_ids').optional().isArray({ max: 200 }),
      check('participant_ids.*').optional().isInt({ min: 1 })
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const { meeting_date, activity_title, participant_ids } = req.body;

        const normalizedDate = parseDate(meeting_date);
        if (!normalizedDate) {
          return error(res, 'Invalid meeting date', 400);
        }

        // Build query to find permission slips
        let query = `
          SELECT ps.*, p.first_name, p.last_name,
                 g.prenom AS guardian_first_name, g.nom AS guardian_last_name, g.courriel AS guardian_email,
                 u.email AS parent_email
          FROM permission_slips ps
          JOIN participants p ON p.id = ps.participant_id
          LEFT JOIN parents_guardians g ON g.id = ps.guardian_id
          LEFT JOIN user_participants up ON up.participant_id = p.id
          LEFT JOIN users u ON u.id = up.user_id
          WHERE ps.organization_id = $1
            AND ps.meeting_date = $2
            AND ps.status = 'pending'
            AND ps.email_sent = false`;

        const params = [organizationId, normalizedDate];

        if (activity_title) {
          params.push(activity_title);
          query += ` AND ps.activity_title = $${params.length}`;
        }

        if (participant_ids && participant_ids.length > 0) {
          params.push(participant_ids);
          query += ` AND ps.participant_id = ANY($${params.length})`;
        }

        const slipsResult = await pool.query(query, params);

        if (slipsResult.rows.length === 0) {
          return success(res, { sent: 0 }, 'No permission slips to send');
        }

        let sentCount = 0;
        const failedEmails = [];

        for (const slip of slipsResult.rows) {
          const recipientEmail = slip.guardian_email || slip.parent_email;

          if (!recipientEmail) {
            failedEmails.push({ participant_id: slip.participant_id, reason: 'No email address' });
            continue;
          }

          // Prepare email content
          const activityTitle = slip.activity_title || 'Activité';
          const activityDate = new Date(slip.meeting_date).toLocaleDateString('fr-CA');
          const activityDescription = slip.activity_description || '';
          const deadlineText = slip.deadline_date
            ? `Date limite de signature : ${new Date(slip.deadline_date).toLocaleDateString('fr-CA')}`
            : '';

          // Generate link using request domain
          const protocol = req.protocol;
          const host = req.get('host');
          const baseUrl = `${protocol}://${host}`;
          const signLink = `${baseUrl}/permission-slip/${slip.id}`;

          const subject = `Autorisation parentale requise - ${activityTitle}`;
          const textBody = `Bonjour,\n\nNous organisons l'activité suivante : ${activityTitle}\n\nDate de l'activité : ${activityDate}\n\n${activityDescription}\n\nVeuillez signer l'autorisation parentale en cliquant sur le lien ci-dessous :\n${signLink}\n\n${deadlineText}\n\nMerci !`;

          const htmlBody = `
            <h2>Autorisation parentale requise</h2>
            <p>Bonjour,</p>
            <p>Nous organisons l'activité suivante : <strong>${activityTitle}</strong></p>
            <p><strong>Date de l'activité :</strong> ${activityDate}</p>
            ${activityDescription ? `<div>${activityDescription}</div>` : ''}
            <p><a href="${signLink}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: white; text-decoration: none; border-radius: 4px;">Signer l'autorisation</a></p>
            ${deadlineText ? `<p><em>${deadlineText}</em></p>` : ''}
            <p>Merci !</p>
          `;

          const emailSent = await sendEmail(recipientEmail, subject, textBody, htmlBody);

          if (emailSent) {
            // Mark email as sent
            await pool.query(
              `UPDATE permission_slips
               SET email_sent = true, email_sent_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [slip.id]
            );
            sentCount++;
          } else {
            failedEmails.push({ participant_id: slip.participant_id, email: recipientEmail, reason: 'Email send failed' });
          }
        }

        return success(res, {
          sent: sentCount,
          total: slipsResult.rows.length,
          failed: failedEmails
        }, `${sentCount} email(s) sent successfully`);
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error sending emails', 500);
      }
    })
  );

  // Send reminder emails for unsigned permission slips
  router.post(
    '/permission-slips/send-reminders',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      check('meeting_date').isISO8601(),
      check('activity_title').optional().isString().trim().isLength({ max: 200 }),
      check('participant_ids').optional().isArray({ max: 200 }),
      check('participant_ids.*').optional().isInt({ min: 1 })
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const { meeting_date, activity_title, participant_ids } = req.body;

        const normalizedDate = parseDate(meeting_date);
        if (!normalizedDate) {
          return error(res, 'Invalid meeting date', 400);
        }

        // Build query to find unsigned permission slips
        let query = `
          SELECT ps.*, p.first_name, p.last_name,
                 g.prenom AS guardian_first_name, g.nom AS guardian_last_name, g.courriel AS guardian_email,
                 u.email AS parent_email
          FROM permission_slips ps
          JOIN participants p ON p.id = ps.participant_id
          LEFT JOIN parents_guardians g ON g.id = ps.guardian_id
          LEFT JOIN user_participants up ON up.participant_id = p.id
          LEFT JOIN users u ON u.id = up.user_id
          WHERE ps.organization_id = $1
            AND ps.meeting_date = $2
            AND ps.status = 'pending'
            AND ps.email_sent = true`;

        const params = [organizationId, normalizedDate];

        if (activity_title) {
          params.push(activity_title);
          query += ` AND ps.activity_title = $${params.length}`;
        }

        if (participant_ids && participant_ids.length > 0) {
          params.push(participant_ids);
          query += ` AND ps.participant_id = ANY($${params.length})`;
        }

        const slipsResult = await pool.query(query, params);

        if (slipsResult.rows.length === 0) {
          return success(res, { sent: 0 }, 'No reminders to send');
        }

        let sentCount = 0;
        const failedEmails = [];

        for (const slip of slipsResult.rows) {
          const recipientEmail = slip.guardian_email || slip.parent_email;

          if (!recipientEmail) {
            failedEmails.push({ participant_id: slip.participant_id, reason: 'No email address' });
            continue;
          }

          // Prepare reminder email content
          const activityTitle = slip.activity_title || 'Activité';
          const activityDate = new Date(slip.meeting_date).toLocaleDateString('fr-CA');
          const deadlineText = slip.deadline_date
            ? `Date limite de signature : ${new Date(slip.deadline_date).toLocaleDateString('fr-CA')}`
            : '';

          // Generate link using request domain
          const protocol = req.protocol;
          const host = req.get('host');
          const baseUrl = `${protocol}://${host}`;
          const signLink = `${baseUrl}/permission-slip/${slip.id}`;

          const subject = `Rappel : Autorisation parentale requise - ${activityTitle}`;
          const textBody = `Bonjour,\n\nCeci est un rappel concernant l'autorisation parentale pour l'activité : ${activityTitle}\n\nDate de l'activité : ${activityDate}\n\nNous n'avons pas encore reçu votre signature. Veuillez signer l'autorisation en cliquant sur le lien ci-dessous :\n${signLink}\n\n${deadlineText}\n\nMerci !`;

          const htmlBody = `
            <h2>Rappel : Autorisation parentale requise</h2>
            <p>Bonjour,</p>
            <p>Ceci est un rappel concernant l'autorisation parentale pour l'activité : <strong>${activityTitle}</strong></p>
            <p><strong>Date de l'activité :</strong> ${activityDate}</p>
            <p>Nous n'avons pas encore reçu votre signature.</p>
            <p><a href="${signLink}" style="display: inline-block; padding: 12px 24px; background-color: #cc6600; color: white; text-decoration: none; border-radius: 4px;">Signer l'autorisation maintenant</a></p>
            ${deadlineText ? `<p><em>${deadlineText}</em></p>` : ''}
            <p>Merci !</p>
          `;

          const emailSent = await sendEmail(recipientEmail, subject, textBody, htmlBody);

          if (emailSent) {
            // Mark reminder as sent
            await pool.query(
              `UPDATE permission_slips
               SET reminder_sent = true, reminder_sent_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [slip.id]
            );
            sentCount++;
          } else {
            failedEmails.push({ participant_id: slip.participant_id, email: recipientEmail, reason: 'Email send failed' });
          }
        }

        return success(res, {
          sent: sentCount,
          total: slipsResult.rows.length,
          failed: failedEmails
        }, `${sentCount} reminder(s) sent successfully`);
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error sending reminders', 500);
      }
    })
  );

  router.post(
    '/permission-slips',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [
      check('participant_ids').optional({ nullable: true }).isArray({ max: 200 }),
      check('participant_ids.*').optional({ nullable: true }).isInt({ min: 1 }),
      check('participant_id').optional({ nullable: true }).isInt({ min: 1 }),
      check('guardian_id').optional({ nullable: true }).isInt({ min: 1 }),
      check('meeting_date').notEmpty().isISO8601(),
      check('meeting_id').optional({ nullable: true }).isInt({ min: 1 }),
      check('activity_title').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
      check('activity_description').optional({ nullable: true }).isString().trim(),
      check('deadline_date').optional({ nullable: true }).isISO8601(),
      check('consent_payload').optional({ nullable: true }).isObject(),
      check('status').optional({ nullable: true }).isIn(['pending', 'signed', 'revoked', 'expired', 'archived'])
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);

        // Debug logging
        console.log('[Permission Slip Creation] Request body:', JSON.stringify(req.body, null, 2));

        const {
          participant_ids,
          participant_id,
          guardian_id,
          meeting_date,
          meeting_id,
          activity_title,
          activity_description,
          deadline_date,
          consent_payload = {},
          status = 'pending'
        } = req.body;

        // Support both single participant and bulk creation
        const participantIdsList = participant_ids || (participant_id ? [participant_id] : []);

        if (participantIdsList.length === 0) {
          return error(res, 'At least one participant_id or participant_ids array is required', 400);
        }

        if (meeting_id) {
          await verifyMeeting(meeting_id, organizationId);
        }

        const normalizedDate = parseDate(meeting_date);
        if (!normalizedDate) {
          return error(res, 'Invalid meeting date', 400);
        }

        const normalizedDeadline = deadline_date ? parseDate(deadline_date) : null;

        const createdSlips = [];

        // Create permission slips for each participant
        for (const pid of participantIdsList) {
          await verifyParticipant(pid, organizationId);

          const insertResult = await pool.query(
            `INSERT INTO permission_slips
             (organization_id, participant_id, guardian_id, meeting_id, meeting_date,
              activity_title, activity_description, deadline_date, consent_payload, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (organization_id, participant_id, meeting_date)
             DO UPDATE SET consent_payload = EXCLUDED.consent_payload,
                           guardian_id = EXCLUDED.guardian_id,
                           meeting_id = EXCLUDED.meeting_id,
                           activity_title = EXCLUDED.activity_title,
                           activity_description = EXCLUDED.activity_description,
                           deadline_date = EXCLUDED.deadline_date,
                           status = EXCLUDED.status,
                           updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [organizationId, pid, guardian_id || null, meeting_id || null, normalizedDate,
             activity_title || null, activity_description || null, normalizedDeadline,
             consent_payload, status]
          );

          createdSlips.push(insertResult.rows[0]);
        }

        return success(res, {
          permission_slips: createdSlips,
          count: createdSlips.length
        }, 'Permission slip(s) saved', 201);
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error saving permission slip', 500);
      }
    })
  );

  // Public route to view a permission slip (no authentication required)
  router.get(
    '/permission-slips/:id/view',
    [param('id').isInt({ min: 1 })],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const slipId = parseInt(req.params.id, 10);

        const slipResult = await pool.query(
          `SELECT ps.*, p.first_name, p.last_name,
                  (p.first_name || ' ' || p.last_name) AS participant_name
           FROM permission_slips ps
           JOIN participants p ON p.id = ps.participant_id
           WHERE ps.id = $1`,
          [slipId]
        );

        if (slipResult.rows.length === 0) {
          return error(res, 'Permission slip not found', 404);
        }

        return success(res, slipResult.rows[0]);
      } catch (err) {
        return error(res, err.message || 'Error fetching permission slip', 500);
      }
    })
  );

  // Public route to sign a permission slip (no authentication required)
  router.patch(
    '/permission-slips/:id/sign',
    [
      param('id').isInt({ min: 1 }),
      check('signed_by').isString().trim().isLength({ min: 2, max: 200 }),
      check('signed_at').optional().isISO8601()
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const slipId = parseInt(req.params.id, 10);
        const { signed_by, signed_at } = req.body;

        const slipResult = await pool.query(
          'SELECT organization_id, participant_id, status FROM permission_slips WHERE id = $1',
          [slipId]
        );

        if (slipResult.rows.length === 0) {
          return error(res, 'Permission slip not found', 404);
        }

        if (slipResult.rows[0].status === 'signed') {
          return error(res, 'Permission slip already signed', 400);
        }

        const updateResult = await pool.query(
          `UPDATE permission_slips
           SET signed_by = $2,
               signed_at = COALESCE($3, CURRENT_TIMESTAMP),
               status = 'signed',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [slipId, signed_by, signed_at || null]
        );

        if (updateResult.rows.length === 0) {
          return error(res, 'Permission slip not found', 404);
        }

        return success(res, { permission_slip: updateResult.rows[0] }, 'Permission slip signed');
      } catch (err) {
        return error(res, err.message || 'Error signing permission slip', 500);
      }
    })
  );

  router.patch(
    '/permission-slips/:id/archive',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [param('id').isInt({ min: 1 })],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const slipId = parseInt(req.params.id, 10);
        const organizationId = await getOrganizationId(req, pool);

        const slipResult = await pool.query(
          'SELECT organization_id FROM permission_slips WHERE id = $1',
          [slipId]
        );

        if (slipResult.rows.length === 0) {
          return error(res, 'Permission slip not found', 404);
        }

        if (slipResult.rows[0].organization_id !== organizationId) {
          return error(res, 'Permission denied', 403);
        }

        const updateResult = await pool.query(
          `UPDATE permission_slips
           SET status = 'archived',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [slipId]
        );

        return success(res, { permission_slip: updateResult.rows[0] }, 'Permission slip archived');
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error archiving permission slip', 500);
      }
    })
  );


  router.get(
    '/status/dashboard',
    authenticate,
    requireOrganizationRole(leaderRoles),
    [query('meeting_date').optional().isISO8601()],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const meetingDate = req.query.meeting_date ? parseDate(req.query.meeting_date) : null;
        const dateFilter = meetingDate || parseDate(new Date().toISOString());

        const permissionSummary = await pool.query(
          `SELECT status, COUNT(*) AS count
           FROM permission_slips
           WHERE organization_id = $1 AND meeting_date = $2
           GROUP BY status`,
          [organizationId, dateFilter]
        );

        const reservationSummary = await pool.query(
          `SELECT e.name, er.meeting_date, er.status, er.reserved_quantity, er.organization_id AS reservation_organization_id
           FROM equipment_reservations er
           JOIN equipment_items e ON e.id = er.equipment_id
           JOIN equipment_item_organizations access ON access.equipment_id = er.equipment_id AND access.organization_id = $1
           WHERE er.meeting_date = $2
           ORDER BY e.name`,
          [organizationId, dateFilter]
        );

        return success(res, {
          meeting_date: dateFilter,
          permission_summary: permissionSummary.rows,
          reservations: reservationSummary.rows
        });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || 'Error loading resource dashboard', 500);
      }
    })
  );

  return router;
};
