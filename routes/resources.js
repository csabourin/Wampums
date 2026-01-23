// Resource and permission slip routes
// Provides RESTful endpoints for equipment inventory, reservations, and guardian approvals
const express = require("express");
const { check, param, query } = require("express-validator");
const router = express.Router();
const multer = require("multer");

const {
  authenticate,
  getOrganizationId,
  requirePermission,
  blockDemoRoles,
  hasAnyRole,
} = require("../middleware/auth");
const { success, error, asyncHandler } = require("../middleware/response");
const { checkValidation } = require("../middleware/validation");
const { handleOrganizationResolutionError } = require("../utils/api-helpers");
const { sendEmail, getUserEmailLanguage } = require("../utils/index");
const { buildPermissionSlipEmailContent } = require("../utils/permission-slip-email");
const {
  MAX_FILE_SIZE,
  OUTPUT_MIME_TYPE,
  validateFile,
  isAllowedImageType,
  convertImageToWebP,
  generateFilePath,
  uploadFile,
  deleteFile,
  extractPathFromUrl,
  isStorageConfigured,
  WEBP_EXTENSION,
} = require("../utils/supabase-storage");

// Configure multer for memory storage (30MB limit; client-side resize should reduce payloads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter: (req, file, cb) => {
    if (isAllowedImageType(file)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only JPEG, PNG, GIF, HEIC, HEIF, and WebP images are allowed.",
        ),
        false,
      );
    }
  },
});

const LOCATION_TYPES = [
  "local_scout_hall",
  "warehouse",
  "leader_home",
  "other",
];

function parseDate(dateString) {
  const parsed = new Date(dateString);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

module.exports = (pool) => {
  const parentRoles = ["parent", "demoparent"];
  const staffRoles = [
    "district",
    "unitadmin",
    "leader",
    "finance",
    "administration",
    "demoadmin",
    "equipment",
  ];

  /**
   * Determine whether equipment should be shared with the owner's local group.
   * Defaults to true to maintain backward compatibility for legacy records.
   * @param {object} attributes - Attributes JSON stored on the equipment row.
   * @param {boolean|undefined} override - Optional override provided by the caller.
   * @returns {boolean}
   */
  function resolveShareWithLocalGroup(attributes, override) {
    if (override !== undefined) {
      return Boolean(override);
    }

    const attributeFlag =
      attributes && typeof attributes === "object"
        ? attributes.share_with_local_group
        : undefined;
    if (attributeFlag === undefined || attributeFlag === null) {
      return true;
    }
    return Boolean(attributeFlag);
  }

  /**
   * Retrieve all organizations that share a local group with the owner organization.
   * @param {number} ownerOrganizationId
   * @returns {Promise<number[]>}
   */
  async function getOrganizationsInSameLocalGroup(ownerOrganizationId) {
    const localGroupOrgs = await pool.query(
      `SELECT DISTINCT peers.organization_id
         FROM organization_local_groups owner_groups
         JOIN organization_local_groups peers
           ON peers.local_group_id = owner_groups.local_group_id
        WHERE owner_groups.organization_id = $1`,
      [ownerOrganizationId],
    );

    return localGroupOrgs.rows.map((row) => row.organization_id);
  }

  /**
   * Synchronize equipment visibility records to reflect sharing rules.
   * @param {Object} params
   * @param {number} params.equipmentId
   * @param {number} params.ownerOrganizationId
   * @param {boolean} params.shareWithLocalGroup
   * @param {number[]} [params.sharedOrganizationIds]
   * @param {boolean} [params.overrideExisting]
   * @returns {Promise<number[]>} - The final list of organization IDs with explicit visibility entries.
   */
  async function syncEquipmentOrganizations({
    equipmentId,
    ownerOrganizationId,
    shareWithLocalGroup,
    sharedOrganizationIds = [],
    overrideExisting = false,
  }) {
    const targetOrgIds = new Set([ownerOrganizationId]);
    (Array.isArray(sharedOrganizationIds) ? sharedOrganizationIds : []).forEach(
      (orgId) => {
        if (Number.isInteger(orgId)) {
          targetOrgIds.add(orgId);
        }
      },
    );

    if (shareWithLocalGroup) {
      const localGroupOrgIds = await getOrganizationsInSameLocalGroup(
        ownerOrganizationId,
      );
      localGroupOrgIds.forEach((orgId) => targetOrgIds.add(orgId));
    }

    const normalizedOrgIds = Array.from(targetOrgIds);

    if (overrideExisting && normalizedOrgIds.length > 0) {
      await pool.query(
        `DELETE FROM equipment_item_organizations
         WHERE equipment_id = $1
           AND organization_id <> ALL($2::int[])`,
        [equipmentId, normalizedOrgIds],
      );
    }

    for (const orgId of normalizedOrgIds) {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO equipment_item_organizations (equipment_id, organization_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [equipmentId, orgId],
      );
    }

    return normalizedOrgIds;
  }

  async function verifyMeeting(meetingId, organizationId) {
    if (!meetingId) {
      return null;
    }

    const meetingResult = await pool.query(
      "SELECT id, date::text AS date FROM reunion_preparations WHERE id = $1 AND organization_id = $2",
      [meetingId, organizationId],
    );

    if (meetingResult.rows.length === 0) {
      throw new Error("Meeting not found for organization");
    }

    return meetingResult.rows[0];
  }

  async function verifyParticipant(participantId, organizationId) {
    const membership = await pool.query(
      "SELECT 1 FROM participant_organizations WHERE participant_id = $1 AND organization_id = $2",
      [participantId, organizationId],
    );

    if (membership.rows.length === 0) {
      throw new Error("Participant not linked to organization");
    }
  }

  async function getParentParticipantIds(userId, organizationId) {
    const result = await pool.query(
      `SELECT up.participant_id
         FROM user_participants up
         JOIN participant_organizations po ON po.participant_id = up.participant_id
        WHERE up.user_id = $1 AND po.organization_id = $2`,
      [userId, organizationId],
    );

    return result.rows.map((row) => row.participant_id);
  }

  async function verifyEquipmentAccess(equipmentId, organizationId) {
    const accessResult = await pool.query(
      `SELECT 1
         FROM equipment_items ei
         LEFT JOIN equipment_item_organizations eio
           ON eio.equipment_id = ei.id
          AND eio.organization_id = $2
         LEFT JOIN organization_local_groups owner_olg
           ON owner_olg.organization_id = ei.organization_id
         LEFT JOIN organization_local_groups requester_olg
           ON requester_olg.organization_id = $2
          AND requester_olg.local_group_id = owner_olg.local_group_id
        WHERE ei.id = $1
          AND ei.is_active IS DISTINCT FROM false
          AND (
            eio.organization_id IS NOT NULL
            OR ei.organization_id = $2
            OR (
              COALESCE((ei.attributes->>'share_with_local_group')::boolean, true)
              AND requester_olg.local_group_id IS NOT NULL
            )
          )
        LIMIT 1`,
      [equipmentId, organizationId],
    );

    if (accessResult.rows.length === 0) {
      const accessError = new Error("Equipment not accessible for organization");
      accessError.statusCode = 403;
      throw accessError;
    }
  }

  // ============================
  // Equipment inventory
  // ============================
  router.get(
    "/equipment",
    authenticate,
    requirePermission("inventory.view"),
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const result = await pool.query(
          `WITH requester_groups AS (
             SELECT local_group_id FROM organization_local_groups WHERE organization_id = $1
           ),
           accessible_equipment AS (
             SELECT e.*
             FROM equipment_items e
             LEFT JOIN equipment_item_organizations eio
               ON eio.equipment_id = e.id
              AND eio.organization_id = $1
             LEFT JOIN organization_local_groups owner_olg
               ON owner_olg.organization_id = e.organization_id
             LEFT JOIN requester_groups rg
               ON rg.local_group_id = owner_olg.local_group_id
             WHERE e.is_active IS DISTINCT FROM false
               AND (
                 eio.organization_id IS NOT NULL
                 OR e.organization_id = $1
                 OR (
                   COALESCE((e.attributes->>'share_with_local_group')::boolean, true)
                   AND rg.local_group_id IS NOT NULL
                 )
               )
           ),
           shared_visibility AS (
             SELECT e.id AS equipment_id,
                    ARRAY_AGG(DISTINCT org.name ORDER BY org.name) FILTER (WHERE org.name IS NOT NULL) AS shared_organizations
               FROM accessible_equipment e
               LEFT JOIN equipment_item_organizations eio ON eio.equipment_id = e.id
               LEFT JOIN organization_local_groups owner_olg ON owner_olg.organization_id = e.organization_id
               LEFT JOIN organization_local_groups olg ON olg.local_group_id = owner_olg.local_group_id
               LEFT JOIN organizations org ON org.id = COALESCE(eio.organization_id, olg.organization_id)
              WHERE COALESCE((e.attributes->>'share_with_local_group')::boolean, true) OR eio.organization_id IS NOT NULL
              GROUP BY e.id
           )
           SELECT e.*,
                  COALESCE((
                    SELECT SUM(CASE WHEN er.status IN ('reserved','confirmed') THEN er.reserved_quantity ELSE 0 END)
                    FROM equipment_reservations er
                    WHERE er.equipment_id = e.id
                  ), 0) AS reserved_quantity,
                  COALESCE(shared_visibility.shared_organizations, '{}'::text[]) AS shared_organizations
             FROM accessible_equipment e
             LEFT JOIN shared_visibility ON shared_visibility.equipment_id = e.id
             ORDER BY e.category NULLS LAST, e.name`,
          [organizationId],
        );

        return success(res, { equipment: result.rows });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error fetching equipment", err.statusCode || 500);
      }
    }),
  );

  router.post(
    "/equipment",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.manage"),
    [
      check("name").isString().trim().isLength({ min: 2, max: 150 }),
      check("category").optional().isString().trim().isLength({ max: 100 }),
      check("description").optional().isString().trim().isLength({ max: 2000 }),
      check("quantity_total").optional().isInt({ min: 0 }),
      check("quantity_available").optional().isInt({ min: 0 }),
      check("condition_note")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 500 }),
      check("attributes").optional().isObject(),
      check("shared_organization_ids").optional().isArray({ max: 50 }),
      check("shared_organization_ids.*").optional().isInt({ min: 0 }),
      check("item_value").optional().isNumeric(),
      check("photo_url").optional().isString().trim().isLength({ max: 500 }),
      check("acquisition_date").optional().isISO8601(),
      check("location_type")
        .optional()
        .isString()
        .trim()
        .isIn(LOCATION_TYPES),
      check("location_details")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 500 }),
      check("share_with_local_group").optional().isBoolean(),
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
          acquisition_date,
          location_type,
          location_details,
        } = req.body;

        const attributesPayload =
          attributes && typeof attributes === "object" ? attributes : {};
        const shareWithLocalGroup = resolveShareWithLocalGroup(
          attributesPayload,
          req.body.share_with_local_group,
        );
        const mergedAttributes = {
          ...attributesPayload,
          share_with_local_group: shareWithLocalGroup,
        };

        const sharedIdsProvided = Array.isArray(shared_organization_ids);
        const sanitizedSharedIds = sharedIdsProvided
          ? shared_organization_ids.filter((id) => Number.isInteger(id))
          : [];

        const available = quantity_available ?? quantity_total;
        const normalizedAcquisitionDate = acquisition_date
          ? parseDate(acquisition_date)
          : null;

        const insertResult = await pool.query(
          `INSERT INTO equipment_items
           (organization_id, name, category, description, quantity_total, quantity_available, condition_note, attributes, item_value, photo_url, acquisition_date, location_type, location_details)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
             location_type = EXCLUDED.location_type,
             location_details = EXCLUDED.location_details,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [
            organizationId,
            name,
            category,
            description,
            quantity_total,
            available,
            condition_note,
            mergedAttributes,
            item_value || null,
            photo_url || null,
            normalizedAcquisitionDate,
            location_type || LOCATION_TYPES[0],
            location_details ?? "",
          ],
        );

        await syncEquipmentOrganizations({
          equipmentId: insertResult.rows[0].id,
          ownerOrganizationId: organizationId,
          shareWithLocalGroup,
          sharedOrganizationIds: sanitizedSharedIds,
          overrideExisting:
            req.body.share_with_local_group === false || sharedIdsProvided,
        });

        return success(
          res,
          { equipment: insertResult.rows[0] },
          "Equipment saved",
          201,
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error saving equipment", err.statusCode || 500);
      }
    }),
  );

  router.put(
    "/equipment/:id",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.manage"),
    [
      param("id").isInt({ min: 1 }),
      check("name").optional().isString().trim().isLength({ min: 2, max: 150 }),
      check("category").optional().isString().trim().isLength({ max: 100 }),
      check("description").optional().isString().trim().isLength({ max: 2000 }),
      check("quantity_total").optional().isInt({ min: 0 }),
      check("quantity_available").optional().isInt({ min: 0 }),
      check("condition_note")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 500 }),
      check("is_active").optional().isBoolean(),
      check("attributes").optional().isObject(),
      check("item_value").optional().isNumeric(),
      check("photo_url").optional().isString().trim().isLength({ max: 500 }),
      check("acquisition_date").optional().isISO8601(),
      check("location_type")
        .optional()
        .isString()
        .trim()
        .isIn(LOCATION_TYPES),
      check("location_details")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 500 }),
      check("shared_organization_ids").optional().isArray({ max: 50 }),
      check("shared_organization_ids.*").optional().isInt({ min: 0 }),
      check("share_with_local_group").optional().isBoolean(),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const equipmentId = parseInt(req.params.id, 10);
        const sharedIdsProvided = Array.isArray(req.body.shared_organization_ids);
        const sanitizedSharedIds = sharedIdsProvided
          ? req.body.shared_organization_ids.filter((id) => Number.isInteger(id))
          : [];
        const shareWithLocalGroupOverride = req.body.share_with_local_group;

        // Handle acquisition_date normalization
        if (req.body.acquisition_date) {
          req.body.acquisition_date = parseDate(req.body.acquisition_date);
        }

        const fields = [
          "name",
          "category",
          "description",
          "quantity_total",
          "quantity_available",
          "condition_note",
          "is_active",
          "item_value",
          "photo_url",
          "acquisition_date",
          "location_type",
          "location_details",
        ];
        const updates = [];
        const values = [];
        fields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updates.push(`${field} = $${updates.length + 2}`);
            values.push(req.body[field]);
          }
        });

        // Verify organization has access to this equipment (owner or shared)
        await verifyEquipmentAccess(equipmentId, organizationId);

        const existingEquipment = await pool.query(
          `SELECT * FROM equipment_items WHERE id = $1`,
          [equipmentId],
        );

        if (existingEquipment.rows.length === 0) {
          return error(res, "Equipment not found", 404);
        }

        const currentAttributes =
          existingEquipment.rows[0].attributes && typeof existingEquipment.rows[0].attributes === "object"
            ? existingEquipment.rows[0].attributes
            : {};

        const attributesUpdateRequired =
          req.body.attributes !== undefined || shareWithLocalGroupOverride !== undefined;
        if (attributesUpdateRequired) {
          const incomingAttributes =
            req.body.attributes && typeof req.body.attributes === "object"
              ? req.body.attributes
              : {};
          const mergedAttributes = {
            ...currentAttributes,
            ...incomingAttributes,
          };
          mergedAttributes.share_with_local_group = resolveShareWithLocalGroup(
            mergedAttributes,
            shareWithLocalGroupOverride,
          );

          updates.push(`attributes = $${updates.length + 2}`);
          values.push(mergedAttributes);
        }

        const hasShareChanges =
          attributesUpdateRequired ||
          sharedIdsProvided ||
          shareWithLocalGroupOverride !== undefined;

        if (updates.length === 0 && !hasShareChanges) {
          return success(res, null, "No changes detected");
        }

        if (updates.length === 0) {
          const shareWithLocalGroup = resolveShareWithLocalGroup(
            existingEquipment.rows[0].attributes,
            shareWithLocalGroupOverride,
          );

          await syncEquipmentOrganizations({
            equipmentId,
            ownerOrganizationId: existingEquipment.rows[0].organization_id,
            shareWithLocalGroup,
            sharedOrganizationIds: sanitizedSharedIds,
            overrideExisting:
              shareWithLocalGroupOverride === false || sharedIdsProvided,
          });

          return success(
            res,
            { equipment: existingEquipment.rows[0] },
            "Equipment updated",
          );
        }

        // Update equipment (any organization with access can update)
        const queryText = `UPDATE equipment_items
          SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
          RETURNING *`;
        const result = await pool.query(queryText, [equipmentId, ...values]);

        if (result.rows.length === 0) {
          return error(res, "Equipment not found", 404);
        }

        const shareWithLocalGroup = resolveShareWithLocalGroup(
          result.rows[0].attributes ?? currentAttributes,
          shareWithLocalGroupOverride,
        );

        await syncEquipmentOrganizations({
          equipmentId,
          ownerOrganizationId: result.rows[0].organization_id,
          shareWithLocalGroup,
          sharedOrganizationIds: sanitizedSharedIds,
          overrideExisting:
            shareWithLocalGroupOverride === false || sharedIdsProvided,
        });

        return success(res, { equipment: result.rows[0] }, "Equipment updated");
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error updating equipment", err.statusCode || 500);
      }
    }),
  );

  // Delete equipment (soft delete by setting is_active = false)
  router.delete(
    "/equipment/:id",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.manage"),
    [param("id").isInt({ min: 1 })],
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
          [equipmentId],
        );

        if (parseInt(reservationCheck.rows[0].count, 10) > 0) {
          return error(
            res,
            "Cannot delete equipment with active reservations",
            400,
          );
        }

        // Soft delete: set is_active = false (any organization with access can delete)
        const result = await pool.query(
          `UPDATE equipment_items
           SET is_active = false, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [equipmentId],
        );

        if (result.rows.length === 0) {
          return error(res, "Equipment not found", 404);
        }

        // Delete photo from storage if exists
        const photoUrl = result.rows[0].photo_url;
        if (photoUrl && isStorageConfigured()) {
          const filePath = extractPathFromUrl(photoUrl);
          if (filePath) {
            await deleteFile(filePath);
          }
        }

        return success(
          res,
          { equipment: result.rows[0] },
          "Equipment deleted successfully",
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error deleting equipment", err.statusCode || 500);
      }
    }),
  );

  // ============================
  // Equipment photo upload
  // ============================
  router.post(
    "/equipment/:id/photo",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.manage"),
    [param("id").isInt({ min: 1 })],
    checkValidation,
    upload.single("photo"),
    asyncHandler(async (req, res) => {
      try {
        // Check if storage is configured
        if (!isStorageConfigured()) {
          return error(
            res,
            "Photo storage is not configured. Please set SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_STORAGE_BUCKET.",
            503,
          );
        }

        const organizationId = await getOrganizationId(req, pool);
        const equipmentId = parseInt(req.params.id, 10);

        // Verify organization has access to this equipment (owner or shared)
        await verifyEquipmentAccess(equipmentId, organizationId);

        // Get current photo URL
        const equipmentCheck = await pool.query(
          "SELECT id, photo_url FROM equipment_items WHERE id = $1",
          [equipmentId],
        );

        if (equipmentCheck.rows.length === 0) {
          return error(res, "Equipment not found", 404);
        }

        // Validate file
        const validation = validateFile(req.file);
        if (!validation.isValid) {
          return error(res, validation.error, 400);
        }

        // Resize and convert to WebP before upload
        let processedBuffer;
        try {
          processedBuffer = await convertImageToWebP(req.file.buffer, {
            mimeType: req.file.mimetype,
            originalFilename: req.file.originalname,
          });
        } catch (processingError) {
          return error(res, "Unable to process image upload", 400);
        }

        const oldPhotoUrl = equipmentCheck.rows[0].photo_url;

        // Generate file path and upload
        const filePath = generateFilePath(
          organizationId,
          equipmentId,
          req.file.originalname,
          WEBP_EXTENSION,
        );
        const uploadResult = await uploadFile(
          processedBuffer,
          filePath,
          OUTPUT_MIME_TYPE,
        );

        if (!uploadResult.success) {
          return error(
            res,
            uploadResult.error || "Failed to upload photo",
            500,
          );
        }

        // Update equipment with new photo URL (any organization with access can update)
        const updateResult = await pool.query(
          `UPDATE equipment_items
           SET photo_url = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2
           RETURNING *`,
          [uploadResult.url, equipmentId],
        );

        if (oldPhotoUrl) {
          const oldPath = extractPathFromUrl(oldPhotoUrl);
          if (oldPath) {
            await deleteFile(oldPath);
          }
        }

        return success(
          res,
          { equipment: updateResult.rows[0], photo_url: uploadResult.url },
          "Photo uploaded successfully",
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        // Handle multer errors
        if (err.code === "LIMIT_FILE_SIZE") {
          return error(
            res,
            `File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
            400,
          );
        }
        return error(res, err.message || "Error uploading photo", err.statusCode || 500);
      }
    }),
  );

  // Delete equipment photo
  router.delete(
    "/equipment/:id/photo",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.manage"),
    [param("id").isInt({ min: 1 })],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const equipmentId = parseInt(req.params.id, 10);

        // Verify organization has access to this equipment (owner or shared)
        await verifyEquipmentAccess(equipmentId, organizationId);

        // Get current photo URL
        const equipmentCheck = await pool.query(
          "SELECT id, photo_url FROM equipment_items WHERE id = $1",
          [equipmentId],
        );

        if (equipmentCheck.rows.length === 0) {
          return error(res, "Equipment not found", 404);
        }

        const photoUrl = equipmentCheck.rows[0].photo_url;
        if (!photoUrl) {
          return success(
            res,
            { equipment: equipmentCheck.rows[0] },
            "No photo to delete",
          );
        }

        // Delete from storage if configured
        if (isStorageConfigured()) {
          const filePath = extractPathFromUrl(photoUrl);
          if (filePath) {
            await deleteFile(filePath);
          }
        }

        // Update equipment to remove photo URL (any organization with access can delete)
        const updateResult = await pool.query(
          `UPDATE equipment_items
           SET photo_url = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [equipmentId],
        );

        return success(
          res,
          { equipment: updateResult.rows[0] },
          "Photo deleted successfully",
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error deleting photo", err.statusCode || 500);
      }
    }),
  );

  // ============================
  // Equipment reservations
  // ============================
  router.get(
    "/equipment/reservations",
    authenticate,
    requirePermission("inventory.view"),
    [
      query("activity_id").optional().isInt({ min: 1 }),
      query("meeting_date").optional().isISO8601(),
      query("date_from").optional().isISO8601(),
      query("date_to").optional().isISO8601(),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const activityId = req.query.activity_id ? parseInt(req.query.activity_id, 10) : null;
        const meetingDate = req.query.meeting_date
          ? parseDate(req.query.meeting_date)
          : null;
        const dateFrom = req.query.date_from
          ? parseDate(req.query.date_from)
          : null;
        const dateTo = req.query.date_to ? parseDate(req.query.date_to) : null;
        const params = [organizationId];
        let filter = "";

        if (activityId) {
          filter = "AND er.activity_id = $2";
          params.push(activityId);
        } else if (meetingDate) {
          filter = "AND er.meeting_date = $2";
          params.push(meetingDate);
        } else if (dateFrom && dateTo) {
          // Filter reservations that overlap with the requested date range
          // A reservation overlaps if: reservation.date_from <= requested.date_to AND reservation.date_to >= requested.date_from
          filter = "AND er.date_from <= $3 AND er.date_to >= $2";
          params.push(dateFrom, dateTo);
        } else if (dateFrom) {
          filter = "AND er.date_from >= $2";
          params.push(dateFrom);
        }

        const result = await pool.query(
          `WITH requester_groups AS (
             SELECT local_group_id FROM organization_local_groups WHERE organization_id = $1
           ),
           accessible_reservations AS (
             SELECT er.*,
                    e.name AS equipment_name,
                    e.category,
                    e.location_type,
                    e.location_details,
                    e.organization_id AS owner_organization_id,
                    owner_org.name AS owner_organization_name,
                    er.organization_id AS reservation_organization_id,
                    reservation_org.name AS organization_name,
                    a.id AS activity_id,
                    a.name AS activity_name,
                    a.activity_date
               FROM equipment_reservations er
               JOIN equipment_items e ON e.id = er.equipment_id
               LEFT JOIN organizations reservation_org ON reservation_org.id = er.organization_id
               LEFT JOIN organizations owner_org ON owner_org.id = e.organization_id
               LEFT JOIN activities a ON a.id = er.activity_id
               LEFT JOIN equipment_item_organizations eio
                 ON eio.equipment_id = er.equipment_id
                AND eio.organization_id = $1
               LEFT JOIN organization_local_groups owner_olg
                 ON owner_olg.organization_id = e.organization_id
               LEFT JOIN requester_groups rg
                 ON rg.local_group_id = owner_olg.local_group_id
              WHERE 1=1 ${filter}
                AND e.is_active IS DISTINCT FROM false
                AND (
                  eio.organization_id IS NOT NULL
                  OR e.organization_id = $1
                  OR (
                    COALESCE((e.attributes->>'share_with_local_group')::boolean, true)
                    AND rg.local_group_id IS NOT NULL
                  )
                )
           ),
           owner_local_groups AS (
             SELECT ar.equipment_id,
                    ARRAY_AGG(DISTINCT lg.id ORDER BY lg.id) FILTER (WHERE lg.id IS NOT NULL) AS owner_local_group_ids,
                    ARRAY_AGG(DISTINCT lg.name ORDER BY lg.name) FILTER (WHERE lg.name IS NOT NULL) AS owner_local_group_names
               FROM accessible_reservations ar
               LEFT JOIN organization_local_groups olg ON olg.organization_id = ar.owner_organization_id
               LEFT JOIN local_groups lg ON lg.id = olg.local_group_id
              GROUP BY ar.equipment_id
           ),
           reservation_local_groups AS (
             SELECT ar.id AS reservation_id,
                    ARRAY_AGG(DISTINCT lg.id ORDER BY lg.id) FILTER (WHERE lg.id IS NOT NULL) AS reservation_local_group_ids,
                    ARRAY_AGG(DISTINCT lg.name ORDER BY lg.name) FILTER (WHERE lg.name IS NOT NULL) AS reservation_local_group_names
               FROM accessible_reservations ar
               LEFT JOIN organization_local_groups olg ON olg.organization_id = ar.reservation_organization_id
               LEFT JOIN local_groups lg ON lg.id = olg.local_group_id
              GROUP BY ar.id
           )
           SELECT ar.*,
                  COALESCE(olg.owner_local_group_ids, '{}'::int[]) AS owner_local_group_ids,
                  COALESCE(olg.owner_local_group_names, '{}'::text[]) AS owner_local_group_names,
                  COALESCE(rlg.reservation_local_group_ids, '{}'::int[]) AS reservation_local_group_ids,
                  COALESCE(rlg.reservation_local_group_names, '{}'::text[]) AS reservation_local_group_names
             FROM accessible_reservations ar
             LEFT JOIN owner_local_groups olg ON olg.equipment_id = ar.equipment_id
             LEFT JOIN reservation_local_groups rlg ON rlg.reservation_id = ar.id
             ORDER BY COALESCE(ar.date_from, ar.meeting_date) DESC, ar.equipment_name`,
          params,
        );

        return success(res, { reservations: result.rows });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error fetching reservations", err.statusCode || 500);
      }
    }),
  );

  router.post(
    "/equipment/reservations",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.reserve"),
    [
      check("equipment_id").isInt({ min: 1 }),
      check("meeting_date").optional().isISO8601(),
      check("date_from").optional().isISO8601(),
      check("date_to").optional().isISO8601(),
      check("meeting_id").optional().isInt({ min: 1 }),
      check("reserved_quantity").optional().isInt({ min: 1 }),
      check("reserved_for").optional().isString().trim().isLength({ max: 200 }),
      check("status")
        .optional()
        .isIn(["reserved", "confirmed", "returned", "cancelled"]),
      check("notes").optional().isString().trim().isLength({ max: 2000 }),
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
          status = "reserved",
          notes,
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
            return error(res, "Invalid date range", 400);
          }

          if (normalizedDateFrom > normalizedDateTo) {
            return error(
              res,
              "date_from must be before or equal to date_to",
              400,
            );
          }
        } else if (meeting_date) {
          normalizedDate = parseDate(meeting_date);
          normalizedDateFrom = normalizedDate;
          normalizedDateTo = normalizedDate;

          if (!normalizedDate) {
            return error(res, "Invalid meeting date", 400);
          }
        } else {
          return error(
            res,
            "Either meeting_date or date_from/date_to is required",
            400,
          );
        }

        await verifyEquipmentAccess(equipment_id, organizationId);

        // Get equipment details
        const equipmentResult = await pool.query(
          `SELECT name, quantity_total FROM equipment_items WHERE id = $1`,
          [equipment_id],
        );

        if (equipmentResult.rows.length === 0) {
          return error(res, "Equipment not found", 404);
        }

        const { name: equipmentName, quantity_total: quantityTotal } =
          equipmentResult.rows[0];

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
          [
            equipment_id,
            normalizedDateFrom,
            normalizedDateTo,
            organizationId,
            normalizedDate,
            reserved_for ?? "",
          ],
        );

        const totalReserved = parseInt(
          overlapResult.rows[0].total_reserved,
          10,
        );
        const available = Math.max(0, quantityTotal - totalReserved);

        // Check if adding this reservation would exceed available quantity
        if (totalReserved + reserved_quantity > quantityTotal) {
          return error(
            res,
            `Not enough "${equipmentName}" available for these dates. ${available} of ${quantityTotal} remaining (you requested ${reserved_quantity}).`,
            400,
          );
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
            reserved_for ?? "",
            status,
            notes,
            req.user?.id || null,
          ],
        );

        return success(
          res,
          { reservation: insertResult.rows[0] },
          "Reservation saved",
          201,
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error saving reservation", err.statusCode || 500);
      }
    }),
  );

  router.patch(
    "/equipment/reservations/:id",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.reserve"),
    [
      param("id").isInt({ min: 1 }),
      check("reserved_quantity").optional().isInt({ min: 1 }),
      check("reserved_for").optional().isString().trim().isLength({ max: 200 }),
      check("status")
        .optional()
        .isIn(["reserved", "confirmed", "returned", "cancelled"]),
      check("notes").optional().isString().trim().isLength({ max: 2000 }),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const reservationId = parseInt(req.params.id, 10);
        const fields = ["reserved_quantity", "reserved_for", "status", "notes"];
        const updates = [];
        const values = [];
        fields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updates.push(`${field} = $${updates.length + 2}`);
            values.push(req.body[field]);
          }
        });

        if (updates.length === 0) {
          return success(res, null, "No changes detected");
        }

        // If updating reserved_quantity, check for double-booking
        if (req.body.reserved_quantity !== undefined) {
          // Get current reservation details
          const currentReservation = await pool.query(
            `SELECT equipment_id, date_from, date_to, reserved_quantity, status
             FROM equipment_reservations
             WHERE id = $1 AND organization_id = $2`,
            [reservationId, organizationId],
          );

          if (currentReservation.rows.length === 0) {
            return error(res, "Reservation not found", 404);
          }

          const reservation = currentReservation.rows[0];

          // Only check if reservation is active (not returned or cancelled)
          if (
            reservation.status === "reserved" ||
            reservation.status === "confirmed"
          ) {
            // Get equipment details
            const equipmentResult = await pool.query(
              `SELECT name, quantity_total FROM equipment_items WHERE id = $1`,
              [reservation.equipment_id],
            );

            if (equipmentResult.rows.length === 0) {
              return error(res, "Equipment not found", 404);
            }

            const { name: equipmentName, quantity_total: quantityTotal } =
              equipmentResult.rows[0];

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
              [
                reservation.equipment_id,
                reservationId,
                reservation.date_from,
                reservation.date_to,
              ],
            );

            const totalReserved = parseInt(
              overlapResult.rows[0].total_reserved,
              10,
            );
            const available = Math.max(0, quantityTotal - totalReserved);

            // Check if the new quantity would exceed available
            if (totalReserved + req.body.reserved_quantity > quantityTotal) {
              return error(
                res,
                `Not enough "${equipmentName}" available for these dates. ${available} of ${quantityTotal} remaining (you requested ${req.body.reserved_quantity}).`,
                400,
              );
            }
          }
        }

        const queryText = `UPDATE equipment_reservations
          SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND organization_id = $${updates.length + 2}
          RETURNING *`;
        const result = await pool.query(queryText, [
          reservationId,
          ...values,
          organizationId,
        ]);

        if (result.rows.length === 0) {
          return error(res, "Reservation not found", 404);
        }

        return success(
          res,
          { reservation: result.rows[0] },
          "Reservation updated",
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error updating reservation", err.statusCode || 500);
      }
    }),
  );

  // Bulk equipment reservations
  router.post(
    "/equipment/reservations/bulk",
    authenticate,
    blockDemoRoles,
    requirePermission("inventory.reserve"),
    [
      check("activity_id").optional().isInt({ min: 1 }),
      check("date_from").optional().isISO8601(),
      check("date_to").optional().isISO8601(),
      check("reserved_for").isString().trim().isLength({ min: 1, max: 200 }),
      check("notes").optional().isString().trim().isLength({ max: 2000 }),
      check("items").isArray({ min: 1, max: 50 }),
      check("items.*.equipment_id").isInt({ min: 1 }),
      check("items.*.quantity").isInt({ min: 1 }),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const { activity_id, date_from, date_to, reserved_for, notes, items } = req.body;

        let normalizedDateFrom;
        let normalizedDateTo;
        let activityName;

        // If activity_id is provided, fetch activity details and use its date
        if (activity_id) {
          const activityResult = await pool.query(
            `SELECT id, name, activity_date FROM activities
             WHERE id = $1 AND organization_id = $2 AND is_active = TRUE`,
            [activity_id, organizationId]
          );

          if (activityResult.rows.length === 0) {
            return error(res, "Activity not found or not accessible", 404);
          }

          const activity = activityResult.rows[0];
          activityName = activity.name;
          normalizedDateFrom = parseDate(activity.activity_date);
          normalizedDateTo = parseDate(activity.activity_date);
        } else {
          // If no activity_id, dates are required
          if (!date_from || !date_to) {
            return error(res, "Either activity_id or both date_from and date_to must be provided", 400);
          }

          normalizedDateFrom = parseDate(date_from);
          normalizedDateTo = parseDate(date_to);
        }

        if (!normalizedDateFrom || !normalizedDateTo) {
          return error(res, "Invalid date range", 400);
        }

        if (normalizedDateFrom > normalizedDateTo) {
          return error(
            res,
            "date_from must be before or equal to date_to",
            400,
          );
        }

        // Verify all equipment items are accessible
        for (const item of items) {
          await verifyEquipmentAccess(item.equipment_id, organizationId);
        }

        const createdReservations = [];

        // Create a reservation for each equipment item
        for (const item of items) {
          // Get equipment details
          const equipmentResult = await pool.query(
            `SELECT name, quantity_total FROM equipment_items WHERE id = $1`,
            [item.equipment_id],
          );

          if (equipmentResult.rows.length === 0) {
            return error(res, `Equipment not found`, 404);
          }

          const { name: equipmentName, quantity_total: quantityTotal } =
            equipmentResult.rows[0];

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
            [item.equipment_id, normalizedDateFrom, normalizedDateTo],
          );

          const totalReserved = parseInt(
            overlapResult.rows[0].total_reserved,
            10,
          );
          const available = Math.max(0, quantityTotal - totalReserved);

          // Check if adding this reservation would exceed available quantity
          if (totalReserved + item.quantity > quantityTotal) {
            return error(
              res,
              `Not enough "${equipmentName}" available for these dates. ${available} of ${quantityTotal} remaining (you requested ${item.quantity}).`,
              400,
            );
          }

          const insertResult = await pool.query(
            `INSERT INTO equipment_reservations
             (organization_id, equipment_id, activity_id, meeting_date, date_from, date_to, reserved_quantity, reserved_for, status, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *, (SELECT name FROM equipment_items WHERE id = $2) as equipment_name`,
            [
              organizationId,
              item.equipment_id,
              activity_id || null,
              normalizedDateFrom, // Use date_from as meeting_date for backward compatibility
              normalizedDateFrom,
              normalizedDateTo,
              item.quantity,
              reserved_for,
              "reserved",
              notes || null,
              req.user?.id || null,
            ],
          );

          createdReservations.push(insertResult.rows[0]);
        }

        return success(
          res,
          {
            reservations: createdReservations,
            count: createdReservations.length,
          },
          "Bulk reservations saved",
          201,
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error saving bulk reservations", err.statusCode || 500);
      }
    }),
  );

  // ============================
  // Permission slips
  // ============================
  router.get(
    "/permission-slips",
    authenticate,
    requirePermission("participants.view"),
    [
      query("meeting_date").optional().isISO8601(),
      query("participant_id").optional().isInt({ min: 1 }),
      query("activity_id").optional().isInt({ min: 1 }),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const meetingDate = req.query.meeting_date
          ? parseDate(req.query.meeting_date)
          : null;
        const participantId = req.query.participant_id
          ? parseInt(req.query.participant_id, 10)
          : null;
        const activityId = req.query.activity_id
          ? parseInt(req.query.activity_id, 10)
          : null;
        const params = [organizationId];
        let filter = "";

        const isParentOnly =
          hasAnyRole(req, ...parentRoles) && !hasAnyRole(req, ...staffRoles);
        if (isParentOnly) {
          const allowedParticipantIds = await getParentParticipantIds(
            req.user.id,
            organizationId,
          );
          if (participantId && !allowedParticipantIds.includes(participantId)) {
            return error(res, "Permission denied for participant", 403);
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

        if (activityId) {
          params.push(activityId);
          filter += ` AND ps.activity_id = $${params.length}`;
        }

        const result = await pool.query(
          `SELECT ps.*,
                  p.first_name, p.last_name,
                  g.prenom AS guardian_first_name, g.nom AS guardian_last_name,
                  a.name AS activity_name, a.description AS activity_description, a.activity_date
           FROM permission_slips ps
           JOIN participants p ON p.id = ps.participant_id
           LEFT JOIN parents_guardians g ON g.id = ps.guardian_id
           LEFT JOIN activities a ON a.id = ps.activity_id
           WHERE ps.organization_id = $1 ${filter}
           ORDER BY ps.meeting_date DESC, p.first_name`,
          params,
        );

        return success(res, { permission_slips: result.rows });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(
          res,
          err.message || "Error fetching permission slips",
          err.statusCode || 500,
        );
      }
    }),
  );
  router.post(
    "/permission-slips/send-emails",
    authenticate,
    blockDemoRoles,
    requirePermission("communications.send"),
    [
      check("meeting_date").optional().isISO8601(),
      check("activity_id").optional().isInt({ min: 1 }),
      check("activity_title")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 200 }),
      check("participant_ids").optional().isArray({ max: 200 }),
      check("participant_ids.*").optional().isInt({ min: 1 }),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const { meeting_date, activity_id, activity_title, participant_ids } = req.body;

        // Require either activity_id or meeting_date
        if (!activity_id && !meeting_date) {
          return error(res, "Either activity_id or meeting_date must be provided", 400);
        }

        const normalizedDate = meeting_date ? parseDate(meeting_date) : null;
        if (meeting_date && !normalizedDate) {
          return error(res, "Invalid meeting date", 400);
        }

        // First, check if there are any pending permission slips at all (regardless of email status)
        let pendingCheckQuery = `
          SELECT
            COUNT(*) FILTER (WHERE ps.email_sent = false) as unsent_count,
            COUNT(*) FILTER (WHERE ps.email_sent = true) as sent_count
          FROM permission_slips ps
          WHERE ps.organization_id = $1
            AND ps.status = 'pending'`;

        const pendingCheckParams = [organizationId];

        if (activity_id) {
          pendingCheckParams.push(activity_id);
          pendingCheckQuery += ` AND ps.activity_id = $${pendingCheckParams.length}`;
        } else if (normalizedDate) {
          pendingCheckParams.push(normalizedDate);
          pendingCheckQuery += ` AND ps.meeting_date = $${pendingCheckParams.length}`;
        }

        if (activity_title) {
          pendingCheckParams.push(activity_title);
          pendingCheckQuery += ` AND ps.activity_title = $${pendingCheckParams.length}`;
        }

        if (participant_ids && participant_ids.length > 0) {
          pendingCheckParams.push(participant_ids);
          pendingCheckQuery += ` AND ps.participant_id = ANY($${pendingCheckParams.length})`;
        }

        const pendingCheckResult = await pool.query(pendingCheckQuery, pendingCheckParams);
        const unsentCount = parseInt(pendingCheckResult.rows[0].unsent_count);
        const sentCount = parseInt(pendingCheckResult.rows[0].sent_count);

        // If no pending slips exist at all
        if (unsentCount === 0 && sentCount === 0) {
          return success(res, { sent: 0, total: 0 }, "No pending permission slips found");
        }

        // If pending slips exist but all have been sent already
        if (unsentCount === 0) {
          return success(res, { sent: 0, total: sentCount }, "All pending permission slips have already been emailed");
        }

        // Build query to find permission slips (without guardian join - we'll get all guardians separately)
        let query = `
          SELECT ps.*, p.first_name, p.last_name,
                 COALESCE(ps.guardians_emailed, '[]'::jsonb) AS guardians_emailed
          FROM permission_slips ps
          JOIN participants p ON p.id = ps.participant_id
          WHERE ps.organization_id = $1
            AND ps.status = 'pending'
            AND ps.email_sent = false`;

        const params = [organizationId];

        // Filter by activity_id (preferred) or meeting_date (legacy)
        if (activity_id) {
          params.push(activity_id);
          query += ` AND ps.activity_id = $${params.length}`;
        } else if (normalizedDate) {
          params.push(normalizedDate);
          query += ` AND ps.meeting_date = $${params.length}`;
        }

        if (activity_title) {
          params.push(activity_title);
          query += ` AND ps.activity_title = $${params.length}`;
        }

        if (participant_ids && participant_ids.length > 0) {
          params.push(participant_ids);
          query += ` AND ps.participant_id = ANY($${params.length})`;
        }

        const slipsResult = await pool.query(query, params);

        let sentCount = 0;
        const failedEmails = [];
        const emailDetails = [];

        for (const slip of slipsResult.rows) {
          // Get ALL guardians linked to this participant
          const guardiansResult = await pool.query(
            `SELECT DISTINCT g.id, g.prenom, g.nom, g.courriel
             FROM participant_guardians pg
             JOIN parents_guardians g ON pg.guardian_id = g.id
             WHERE pg.participant_id = $1
               AND g.courriel IS NOT NULL
               AND g.courriel != ''`,
            [slip.participant_id]
          );

          // Also get parent user emails as fallback
          const parentUsersResult = await pool.query(
            `SELECT DISTINCT u.id, u.email, u.full_name
             FROM user_participants up
             JOIN users u ON u.id = up.user_id
             WHERE up.participant_id = $1
               AND u.email IS NOT NULL
               AND u.email != ''`,
            [slip.participant_id]
          );

          // Collect all unique email addresses
          const emailRecipients = [];
          const guardiansEmailed = slip.guardians_emailed || [];

          // Add guardian emails
          for (const guardian of guardiansResult.rows) {
            if (guardian.courriel && !emailRecipients.some(r => r.email === guardian.courriel)) {
              emailRecipients.push({
                email: guardian.courriel,
                name: `${guardian.prenom || ''} ${guardian.nom || ''}`.trim(),
                type: 'guardian',
                id: guardian.id
              });
            }
          }

          // Add parent user emails (if not already included)
          for (const parent of parentUsersResult.rows) {
            if (parent.email && !emailRecipients.some(r => r.email === parent.email)) {
              emailRecipients.push({
                email: parent.email,
                name: parent.full_name || '',
                type: 'parent_user',
                id: parent.id
              });
            }
          }

          if (emailRecipients.length === 0) {
            failedEmails.push({
              participant_id: slip.participant_id,
              participant_name: `${slip.first_name} ${slip.last_name}`,
              reason: "No guardian or parent email addresses found",
            });
            continue;
          }

          // Generate link using request domain
          const protocol = req.protocol;
          const host = req.get("host");
          const baseUrl = `${protocol}://${host}`;
          const signLink = `${baseUrl}/permission-slip/${slip.access_token}`;

          // Send to ALL recipients
          let slipSentCount = 0;
          const newGuardiansEmailed = [...guardiansEmailed];

          for (const recipient of emailRecipients) {
            const recipientLanguage = await getUserEmailLanguage(
              pool,
              recipient.email,
              organizationId,
            );
            const { subject, textBody, htmlBody } =
              buildPermissionSlipEmailContent({
                activityTitle: slip.activity_title,
                activityDescription: slip.activity_description,
                meetingDate: slip.meeting_date,
                deadlineDate: slip.deadline_date,
                participantFirstName: slip.first_name,
                participantLastName: slip.last_name,
                signLink,
                languageCode: recipientLanguage,
                isReminder: false,
              });
            const emailSent = await sendEmail(
              recipient.email,
              subject,
              textBody,
              htmlBody,
            );

            if (emailSent) {
              slipSentCount++;
              sentCount++;
              // Track guardian IDs that were emailed
              if (recipient.type === 'guardian' && !newGuardiansEmailed.includes(recipient.id)) {
                newGuardiansEmailed.push(recipient.id);
              }
              emailDetails.push({
                participant_id: slip.participant_id,
                participant_name: `${slip.first_name} ${slip.last_name}`,
                email: recipient.email,
                recipient_type: recipient.type
              });
            } else {
              failedEmails.push({
                participant_id: slip.participant_id,
                participant_name: `${slip.first_name} ${slip.last_name}`,
                email: recipient.email,
                reason: "Email send failed",
              });
            }
          }

          // Mark email as sent if at least one email was successfully sent
          if (slipSentCount > 0) {
            await pool.query(
              `UPDATE permission_slips
               SET email_sent = true, email_sent_at = CURRENT_TIMESTAMP, guardians_emailed = $2
               WHERE id = $1`,
              [slip.id, JSON.stringify(newGuardiansEmailed)],
            );
          }
        }

        return success(
          res,
          {
            sent: sentCount,
            total: slipsResult.rows.length,
            emails_sent: emailDetails,
            failed: failedEmails,
          },
          `${sentCount} email(s) sent successfully to guardians/parents`,
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error sending emails", err.statusCode || 500);
      }
    }),
  );

  // Send reminder emails for unsigned permission slips
  router.post(
    "/permission-slips/send-reminders",
    authenticate,
    blockDemoRoles,
    requirePermission("communications.send"),
    [
      check("meeting_date").optional().isISO8601(),
      check("activity_id").optional().isInt({ min: 1 }),
      check("activity_title")
        .optional()
        .isString()
        .trim()
        .isLength({ max: 200 }),
      check("participant_ids").optional().isArray({ max: 200 }),
      check("participant_ids.*").optional().isInt({ min: 1 }),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const { meeting_date, activity_id, activity_title, participant_ids } = req.body;

        // Require either activity_id or meeting_date
        if (!activity_id && !meeting_date) {
          return error(res, "Either activity_id or meeting_date must be provided", 400);
        }

        const normalizedDate = meeting_date ? parseDate(meeting_date) : null;
        if (meeting_date && !normalizedDate) {
          return error(res, "Invalid meeting date", 400);
        }

        // First, check if there are any pending (unsigned) permission slips at all
        let pendingCheckQuery = `
          SELECT COUNT(*) as pending_count
          FROM permission_slips ps
          WHERE ps.organization_id = $1
            AND ps.status = 'pending'
            AND ps.email_sent = true`;

        const pendingCheckParams = [organizationId];

        if (activity_id) {
          pendingCheckParams.push(activity_id);
          pendingCheckQuery += ` AND ps.activity_id = $${pendingCheckParams.length}`;
        } else if (normalizedDate) {
          pendingCheckParams.push(normalizedDate);
          pendingCheckQuery += ` AND ps.meeting_date = $${pendingCheckParams.length}`;
        }

        if (activity_title) {
          pendingCheckParams.push(activity_title);
          pendingCheckQuery += ` AND ps.activity_title = $${pendingCheckParams.length}`;
        }

        if (participant_ids && participant_ids.length > 0) {
          pendingCheckParams.push(participant_ids);
          pendingCheckQuery += ` AND ps.participant_id = ANY($${pendingCheckParams.length})`;
        }

        const pendingCheckResult = await pool.query(pendingCheckQuery, pendingCheckParams);
        const pendingCount = parseInt(pendingCheckResult.rows[0].pending_count);

        // If no pending slips exist (among those that received the initial email), all sent slips have been signed
        if (pendingCount === 0) {
          return success(res, { sent: 0, total: 0 }, "All permission slips that were sent have been signed");
        }

        // Build query to find unsigned permission slips that can receive reminders
        // (24-hour cooldown between reminders to prevent spamming)
        let query = `
          SELECT ps.*, p.first_name, p.last_name,
                 COALESCE(ps.guardians_emailed, '[]'::jsonb) AS guardians_emailed
          FROM permission_slips ps
          JOIN participants p ON p.id = ps.participant_id
          WHERE ps.organization_id = $1
            AND ps.status = 'pending'
            AND ps.email_sent = true
            AND (ps.reminder_sent_at IS NULL OR ps.reminder_sent_at < NOW() - INTERVAL '1 day')`;

        const params = [organizationId];

        // Filter by activity_id (preferred) or meeting_date (legacy)
        if (activity_id) {
          params.push(activity_id);
          query += ` AND ps.activity_id = $${params.length}`;
        } else if (normalizedDate) {
          params.push(normalizedDate);
          query += ` AND ps.meeting_date = $${params.length}`;
        }

        if (activity_title) {
          params.push(activity_title);
          query += ` AND ps.activity_title = $${params.length}`;
        }

        if (participant_ids && participant_ids.length > 0) {
          params.push(participant_ids);
          query += ` AND ps.participant_id = ANY($${params.length})`;
        }

        const slipsResult = await pool.query(query, params);

        // If pending slips exist but none are eligible (all reminded within 24 hours)
        if (slipsResult.rows.length === 0) {
          return success(res, { sent: 0, total: pendingCount }, "Reminders were sent recently. Please wait 24 hours between reminders.");
        }

        let sentCount = 0;
        const failedEmails = [];
        const emailDetails = [];

        for (const slip of slipsResult.rows) {
          // Get ALL guardians linked to this participant
          const guardiansResult = await pool.query(
            `SELECT DISTINCT g.id, g.prenom, g.nom, g.courriel
             FROM participant_guardians pg
             JOIN parents_guardians g ON pg.guardian_id = g.id
             WHERE pg.participant_id = $1
               AND g.courriel IS NOT NULL
               AND g.courriel != ''`,
            [slip.participant_id]
          );

          // Also get parent user emails as fallback
          const parentUsersResult = await pool.query(
            `SELECT DISTINCT u.id, u.email, u.full_name
             FROM user_participants up
             JOIN users u ON u.id = up.user_id
             WHERE up.participant_id = $1
               AND u.email IS NOT NULL
               AND u.email != ''`,
            [slip.participant_id]
          );

          // Collect all unique email addresses
          const emailRecipients = [];

          // Add guardian emails
          for (const guardian of guardiansResult.rows) {
            if (guardian.courriel && !emailRecipients.some(r => r.email === guardian.courriel)) {
              emailRecipients.push({
                email: guardian.courriel,
                name: `${guardian.prenom || ''} ${guardian.nom || ''}`.trim(),
                type: 'guardian',
                id: guardian.id
              });
            }
          }

          // Add parent user emails (if not already included)
          for (const parent of parentUsersResult.rows) {
            if (parent.email && !emailRecipients.some(r => r.email === parent.email)) {
              emailRecipients.push({
                email: parent.email,
                name: parent.full_name || '',
                type: 'parent_user',
                id: parent.id
              });
            }
          }

          if (emailRecipients.length === 0) {
            failedEmails.push({
              participant_id: slip.participant_id,
              participant_name: `${slip.first_name} ${slip.last_name}`,
              reason: "No guardian or parent email addresses found",
            });
            continue;
          }

          // Generate link using request domain
          const protocol = req.protocol;
          const host = req.get("host");
          const baseUrl = `${protocol}://${host}`;
          const signLink = `${baseUrl}/permission-slip/${slip.access_token}`;

          // Send to ALL recipients
          let slipSentCount = 0;

          for (const recipient of emailRecipients) {
            const recipientLanguage = await getUserEmailLanguage(
              pool,
              recipient.email,
              organizationId,
            );
            const { subject, textBody, htmlBody } =
              buildPermissionSlipEmailContent({
                activityTitle: slip.activity_title,
                activityDescription: slip.activity_description,
                meetingDate: slip.meeting_date,
                deadlineDate: slip.deadline_date,
                participantFirstName: slip.first_name,
                participantLastName: slip.last_name,
                signLink,
                languageCode: recipientLanguage,
                isReminder: true,
              });
            const emailSent = await sendEmail(
              recipient.email,
              subject,
              textBody,
              htmlBody,
            );

            if (emailSent) {
              slipSentCount++;
              sentCount++;
              emailDetails.push({
                participant_id: slip.participant_id,
                participant_name: `${slip.first_name} ${slip.last_name}`,
                email: recipient.email,
                recipient_type: recipient.type
              });
            } else {
              failedEmails.push({
                participant_id: slip.participant_id,
                participant_name: `${slip.first_name} ${slip.last_name}`,
                email: recipient.email,
                reason: "Email send failed",
              });
            }
          }

          // Mark reminder as sent if at least one email was successfully sent
          if (slipSentCount > 0) {
            await pool.query(
              `UPDATE permission_slips
               SET reminder_sent = true, reminder_sent_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [slip.id],
            );
          }
        }

        return success(
          res,
          {
            sent: sentCount,
            total: slipsResult.rows.length,
            emails_sent: emailDetails,
            failed: failedEmails,
          },
          `${sentCount} reminder(s) sent successfully to guardians/parents`,
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error sending reminders", err.statusCode || 500);
      }
    }),
  );

  router.post(
    "/permission-slips",
    authenticate,
    blockDemoRoles,
    requirePermission("activities.edit"),
    [
      check("participant_ids")
        .optional({ nullable: true })
        .isArray({ max: 200 }),
      check("participant_ids.*").optional({ nullable: true }).isInt({ min: 1 }),
      check("participant_id").optional({ nullable: true }).isInt({ min: 1 }),
      check("guardian_id").optional({ nullable: true }).isInt({ min: 1 }),
      check("activity_id").optional({ nullable: true }).isInt({ min: 1 }),
      check("meeting_date").optional({ nullable: true }).isISO8601(),
      check("meeting_id").optional({ nullable: true }).isInt({ min: 1 }),
      check("activity_title")
        .optional({ nullable: true })
        .isString()
        .trim()
        .isLength({ max: 200 }),
      check("activity_description")
        .optional({ nullable: true })
        .isString()
        .trim(),
      check("deadline_date").optional({ nullable: true }).isISO8601(),
      check("consent_payload").optional({ nullable: true }).isObject(),
      check("status")
        .optional({ nullable: true })
        .isIn(["pending", "signed", "revoked", "expired", "archived"]),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);

        const {
          participant_ids,
          participant_id,
          guardian_id,
          activity_id,
          meeting_date,
          meeting_id,
          activity_title,
          activity_description,
          deadline_date,
          consent_payload = {},
          status = "pending",
        } = req.body;

        // Support both single participant and bulk creation
        const participantIdsList =
          participant_ids || (participant_id ? [participant_id] : []);

        if (participantIdsList.length === 0) {
          return error(
            res,
            "At least one participant_id or participant_ids array is required",
            400,
          );
        }

        // Determine meeting_date, activity_title, and activity_description
        let finalMeetingDate = meeting_date;
        let finalActivityTitle = activity_title;
        let finalActivityDescription = activity_description;

        // If activity_id provided, fetch activity details and use them
        if (activity_id) {
          const activityResult = await pool.query(
            'SELECT name, description, activity_date FROM activities WHERE id = $1 AND organization_id = $2',
            [activity_id, organizationId]
          );

          if (activityResult.rows.length === 0) {
            return error(res, 'Activity not found', 404);
          }

          const activity = activityResult.rows[0];
          finalMeetingDate = activity.activity_date;
          finalActivityTitle = activity.name;
          finalActivityDescription = activity.description;
        } else {
          // Legacy mode: require meeting_date if no activity_id
          if (!meeting_date) {
            return error(
              res,
              "Either activity_id or meeting_date must be provided",
              400
            );
          }
        }

        if (meeting_id) {
          await verifyMeeting(meeting_id, organizationId);
        }

        const normalizedDate = parseDate(finalMeetingDate);
        if (!normalizedDate) {
          return error(res, "Invalid meeting date", 400);
        }

        const normalizedDeadline = deadline_date
          ? parseDate(deadline_date)
          : null;

        const createdSlips = [];

        // Create permission slips for each participant
        for (const pid of participantIdsList) {
          await verifyParticipant(pid, organizationId);

          const insertResult = await pool.query(
            `INSERT INTO permission_slips
             (organization_id, participant_id, guardian_id, meeting_id, meeting_date,
              activity_id, activity_title, activity_description, deadline_date, consent_payload, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (organization_id, participant_id, meeting_date)
             DO UPDATE SET consent_payload = EXCLUDED.consent_payload,
                           guardian_id = EXCLUDED.guardian_id,
                           meeting_id = EXCLUDED.meeting_id,
                           activity_id = EXCLUDED.activity_id,
                           activity_title = EXCLUDED.activity_title,
                           activity_description = EXCLUDED.activity_description,
                           deadline_date = EXCLUDED.deadline_date,
                           status = EXCLUDED.status,
                           updated_at = CURRENT_TIMESTAMP
             RETURNING *, (SELECT first_name FROM participants WHERE id = $2) as first_name, (SELECT last_name FROM participants WHERE id = $2) as last_name`,
            [
              organizationId,
              pid,
              guardian_id || null,
              meeting_id || null,
              normalizedDate,
              activity_id || null,
              finalActivityTitle || null,
              finalActivityDescription || null,
              normalizedDeadline,
              consent_payload,
              status,
            ],
          );

          createdSlips.push(insertResult.rows[0]);
        }

        return success(
          res,
          {
            permission_slips: createdSlips,
            count: createdSlips.length,
          },
          "Permission slip(s) saved",
          201,
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(res, err.message || "Error saving permission slip", err.statusCode || 500);
      }
    }),
  );

  // Secure route to view a permission slip (authentication required)
  router.get(
    "/permission-slips/:id/view",
    authenticate,
    requirePermission("activities.view"),
    [param("id").isInt({ min: 1 })],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const slipId = parseInt(req.params.id, 10);
        const organizationId = await getOrganizationId(req, pool);

        const slipResult = await pool.query(
          `SELECT ps.*, p.first_name, p.last_name,
                  (p.first_name || ' ' || p.last_name) AS participant_name
           FROM permission_slips ps
           JOIN participants p ON p.id = ps.participant_id
           WHERE ps.id = $1 AND ps.organization_id = $2`,
          [slipId, organizationId],
        );

        if (slipResult.rows.length === 0) {
          return error(res, "Permission slip not found", 404);
        }

        return success(res, slipResult.rows[0]);
      } catch (err) {
        return error(res, err.message || "Error fetching permission slip", err.statusCode || 500);
      }
    }),
  );

  // Secure route to sign a permission slip (authentication required)
  router.patch(
    "/permission-slips/:id/sign",
    authenticate,
    requirePermission("permission_slips.sign"),
    [
      param("id").isInt({ min: 1 }),
      check("signed_by").isString().trim().isLength({ min: 2, max: 200 }),
      check("signed_at").optional().isISO8601(),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const slipId = parseInt(req.params.id, 10);
        const organizationId = await getOrganizationId(req, pool);
        const { signed_by, signed_at } = req.body;

        const slipResult = await pool.query(
          "SELECT organization_id, participant_id, status FROM permission_slips WHERE id = $1 AND organization_id = $2",
          [slipId, organizationId],
        );

        if (slipResult.rows.length === 0) {
          return error(res, "Permission slip not found", 404);
        }

        if (slipResult.rows[0].status === "signed") {
          return error(res, "Permission slip already signed", 400);
        }

        const participantId = slipResult.rows[0].participant_id;

        // Check if user has parent-only access (no staff roles)
        // If so, verify they're linked to this participant
        const rolesQuery = `
          SELECT DISTINCT r.role_name
          FROM user_organizations uo
          CROSS JOIN LATERAL jsonb_array_elements_text(uo.role_ids) AS role_id_text
          JOIN roles r ON r.id = role_id_text::integer
          WHERE uo.user_id = $1 AND uo.organization_id = $2
        `;
        const rolesResult = await pool.query(rolesQuery, [req.user.id, organizationId]);
        const userRoles = rolesResult.rows.map(row => row.role_name);

        // Define staff roles that have organization-wide access
        const staffRoles = ['district', 'unitadmin', 'leader', 'admin', 'animation', 'demoadmin'];
        const isStaff = userRoles.some(role => staffRoles.includes(role));

        // If user is parent-only, verify they're linked to this participant
        if (!isStaff) {
          const linkCheck = await pool.query(
            "SELECT 1 FROM user_participants WHERE user_id = $1 AND participant_id = $2",
            [req.user.id, participantId],
          );

          if (linkCheck.rows.length === 0) {
            return error(res, "You can only sign permission slips for your own children", 403);
          }
        }

        const updateResult = await pool.query(
          `UPDATE permission_slips
           SET signed_by = $2,
               signed_at = COALESCE($3, CURRENT_TIMESTAMP),
               status = 'signed',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND organization_id = $4
           RETURNING *`,
          [slipId, signed_by, signed_at || null, organizationId],
        );

        return success(
          res,
          { permission_slip: updateResult.rows[0] },
          "Permission slip signed",
        );
      } catch (err) {
        return error(res, err.message || "Error signing permission slip", err.statusCode || 500);
      }
    }),
  );

  // New Public route to view a permission slip by access_token
  router.get(
    "/permission-slips/v/:token",
    [param("token").isUUID()],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const { token } = req.params;

        const slipResult = await pool.query(
          `SELECT ps.*, p.first_name, p.last_name,
                  (p.first_name || ' ' || p.last_name) AS participant_name
           FROM permission_slips ps
           JOIN participants p ON p.id = ps.participant_id
           WHERE ps.access_token = $1`,
          [token],
        );

        if (slipResult.rows.length === 0) {
          return error(res, "Permission slip not found", 404);
        }

        return success(res, slipResult.rows[0]);
      } catch (err) {
        return error(res, err.message || "Error fetching permission slip", err.statusCode || 500);
      }
    }),
  );

  // New Public route to sign a permission slip by access_token
  router.patch(
    "/permission-slips/s/:token",
    [
      param("token").isUUID(),
      check("signed_by").isString().trim().isLength({ min: 2, max: 200 }),
      check("signed_at").optional().isISO8601(),
    ],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const { token } = req.params;
        const { signed_by, signed_at } = req.body;

        const slipResult = await pool.query(
          "SELECT id, status FROM permission_slips WHERE access_token = $1",
          [token],
        );

        if (slipResult.rows.length === 0) {
          return error(res, "Permission slip not found", 404);
        }

        if (slipResult.rows[0].status === "signed") {
          return error(res, "Permission slip already signed", 400);
        }

        const updateResult = await pool.query(
          `UPDATE permission_slips
           SET signed_by = $2,
               signed_at = COALESCE($3, CURRENT_TIMESTAMP),
               status = 'signed',
               updated_at = CURRENT_TIMESTAMP
           WHERE access_token = $1
           RETURNING *`,
          [token, signed_by, signed_at || null],
        );

        return success(
          res,
          { permission_slip: updateResult.rows[0] },
          "Permission slip signed",
        );
      } catch (err) {
        return error(res, err.message || "Error signing permission slip", err.statusCode || 500);
      }
    }),
  );

  router.patch(
    "/permission-slips/:id/archive",
    authenticate,
    blockDemoRoles,
    requirePermission("activities.edit"),
    [param("id").isInt({ min: 1 })],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const slipId = parseInt(req.params.id, 10);
        const organizationId = await getOrganizationId(req, pool);

        const slipResult = await pool.query(
          "SELECT organization_id FROM permission_slips WHERE id = $1",
          [slipId],
        );

        if (slipResult.rows.length === 0) {
          return error(res, "Permission slip not found", 404);
        }

        if (slipResult.rows[0].organization_id !== organizationId) {
          return error(res, "Permission denied", 403);
        }

        const updateResult = await pool.query(
          `UPDATE permission_slips
           SET status = 'archived',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [slipId],
        );

        return success(
          res,
          { permission_slip: updateResult.rows[0] },
          "Permission slip archived",
        );
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(
          res,
          err.message || "Error archiving permission slip",
          err.statusCode || 500,
        );
      }
    }),
  );

  router.get(
    "/status/dashboard",
    authenticate,
    requirePermission("activities.view"),
    [query("meeting_date").optional().isISO8601()],
    checkValidation,
    asyncHandler(async (req, res) => {
      try {
        const organizationId = await getOrganizationId(req, pool);
        const meetingDate = req.query.meeting_date
          ? parseDate(req.query.meeting_date)
          : null;
        const dateFilter = meetingDate || parseDate(new Date().toISOString());

        const permissionSummary = await pool.query(
          `SELECT status, COUNT(*) AS count
           FROM permission_slips
           WHERE organization_id = $1 AND meeting_date = $2
           GROUP BY status`,
          [organizationId, dateFilter],
        );

        const reservationSummary = await pool.query(
          `WITH requester_groups AS (
             SELECT local_group_id FROM organization_local_groups WHERE organization_id = $1
           ),
           accessible_reservations AS (
             SELECT er.*,
                    e.name,
                    er.organization_id AS reservation_organization_id,
                    o.name AS organization_name,
                    e.organization_id AS owner_organization_id,
                    owner_org.name AS owner_organization_name
               FROM equipment_reservations er
               JOIN equipment_items e ON e.id = er.equipment_id
               LEFT JOIN organizations o ON o.id = er.organization_id
               LEFT JOIN organizations owner_org ON owner_org.id = e.organization_id
               LEFT JOIN equipment_item_organizations eio
                 ON eio.equipment_id = er.equipment_id
                AND eio.organization_id = $1
               LEFT JOIN organization_local_groups owner_olg
                 ON owner_olg.organization_id = e.organization_id
               LEFT JOIN requester_groups rg
                 ON rg.local_group_id = owner_olg.local_group_id
              WHERE er.meeting_date = $2
                AND e.is_active IS DISTINCT FROM false
                AND (
                  eio.organization_id IS NOT NULL
                  OR e.organization_id = $1
                  OR (
                    COALESCE((e.attributes->>'share_with_local_group')::boolean, true)
                    AND rg.local_group_id IS NOT NULL
                  )
                )
           ),
           owner_local_groups AS (
             SELECT ar.equipment_id,
                    ARRAY_AGG(DISTINCT lg.id ORDER BY lg.id) FILTER (WHERE lg.id IS NOT NULL) AS owner_local_group_ids,
                    ARRAY_AGG(DISTINCT lg.name ORDER BY lg.name) FILTER (WHERE lg.name IS NOT NULL) AS owner_local_group_names
               FROM accessible_reservations ar
               LEFT JOIN organization_local_groups olg ON olg.organization_id = ar.owner_organization_id
               LEFT JOIN local_groups lg ON lg.id = olg.local_group_id
              GROUP BY ar.equipment_id
           ),
           reservation_local_groups AS (
             SELECT ar.id AS reservation_id,
                    ARRAY_AGG(DISTINCT lg.id ORDER BY lg.id) FILTER (WHERE lg.id IS NOT NULL) AS reservation_local_group_ids,
                    ARRAY_AGG(DISTINCT lg.name ORDER BY lg.name) FILTER (WHERE lg.name IS NOT NULL) AS reservation_local_group_names
               FROM accessible_reservations ar
               LEFT JOIN organization_local_groups olg ON olg.organization_id = ar.reservation_organization_id
               LEFT JOIN local_groups lg ON lg.id = olg.local_group_id
              GROUP BY ar.id
           )
           SELECT ar.name,
                  ar.meeting_date,
                  ar.status,
                  ar.reserved_quantity,
                  ar.reservation_organization_id,
                  ar.organization_name,
                  ar.owner_organization_id,
                  ar.owner_organization_name,
                  COALESCE(olg.owner_local_group_ids, '{}'::int[]) AS owner_local_group_ids,
                  COALESCE(olg.owner_local_group_names, '{}'::text[]) AS owner_local_group_names,
                  COALESCE(rlg.reservation_local_group_ids, '{}'::int[]) AS reservation_local_group_ids,
                  COALESCE(rlg.reservation_local_group_names, '{}'::text[]) AS reservation_local_group_names
             FROM accessible_reservations ar
             LEFT JOIN owner_local_groups olg ON olg.equipment_id = ar.equipment_id
             LEFT JOIN reservation_local_groups rlg ON rlg.reservation_id = ar.id
             ORDER BY ar.name`,
          [organizationId, dateFilter],
        );

        return success(res, {
          meeting_date: dateFilter,
          permission_summary: permissionSummary.rows,
          reservations: reservationSummary.rows,
        });
      } catch (err) {
        if (handleOrganizationResolutionError(res, err)) {
          return;
        }
        return error(
          res,
          err.message || "Error loading resource dashboard",
          err.statusCode || 500,
        );
      }
    }),
  );

  return router;
};
