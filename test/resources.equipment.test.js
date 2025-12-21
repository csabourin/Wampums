const express = require("express");
const request = require("supertest");

jest.mock("../middleware/auth", () => {
  const getOrganizationId = jest.fn(async () => 1);
  return {
    authenticate: (req, _res, next) => {
      req.user = { id: 1, organizationId: 1 };
      return next();
    },
    requirePermission: () => (req, _res, next) => next(),
    blockDemoRoles: (req, _res, next) => next(),
    hasAnyRole: () => (req, _res, next) => next(),
    getOrganizationId,
  };
});

jest.mock("../utils/supabase-storage", () => ({
  MAX_FILE_SIZE: 1_000_000,
  OUTPUT_MIME_TYPE: "image/webp",
  validateFile: () => ({ isValid: true }),
  isAllowedImageType: () => true,
  convertImageToWebP: async (buffer) => buffer,
  generateFilePath: () => "path",
  uploadFile: async () => ({ success: true, url: "http://example.com/photo.webp" }),
  deleteFile: async () => true,
  extractPathFromUrl: () => "path",
  isStorageConfigured: () => false,
  WEBP_EXTENSION: ".webp",
}));

const { getOrganizationId } = require("../middleware/auth");

describe("Equipment sharing and metadata", () => {
  let app;
  let mockPool;
  let equipmentItems;
  let equipmentItemOrganizations;
  let localGroups;
  let organizations;
  let reservations;

  const getLocalGroupIds = (organizationId) =>
    (localGroups[organizationId] || []).map((group) => group.id);

  const sharesLocalGroup = (ownerOrganizationId, requesterOrganizationId) => {
    const ownerGroups = getLocalGroupIds(ownerOrganizationId);
    const requesterGroups = getLocalGroupIds(requesterOrganizationId);
    return ownerGroups.some((id) => requesterGroups.includes(id));
  };

  const resolveShareFlag = (equipment) =>
    equipment?.attributes?.share_with_local_group !== undefined
      ? Boolean(equipment.attributes.share_with_local_group)
      : true;

  const collectSharedOrgIds = (equipment) => {
    const orgIds = new Set([equipment.organization_id]);
    const explicit = equipmentItemOrganizations[equipment.id];
    if (explicit) {
      explicit.forEach((id) => orgIds.add(id));
    }
    if (resolveShareFlag(equipment)) {
      const ownerGroups = getLocalGroupIds(equipment.organization_id);
      Object.entries(localGroups).forEach(([orgId, groups]) => {
        const groupIds = groups.map((group) => group.id);
        if (ownerGroups.some((id) => groupIds.includes(id))) {
          orgIds.add(Number(orgId));
        }
      });
    }
    return Array.from(orgIds);
  };

  const buildEquipmentResponse = (organizationId) =>
    Object.values(equipmentItems)
      .filter((equipment) => {
        if (equipment.is_active === false) {
          return false;
        }
        const explicitShare =
          equipmentItemOrganizations[equipment.id]?.has(organizationId) || false;
        const localGroupShare =
          resolveShareFlag(equipment) &&
          sharesLocalGroup(equipment.organization_id, organizationId);
        return (
          explicitShare ||
          equipment.organization_id === organizationId ||
          localGroupShare
        );
      })
      .map((equipment) => ({
        ...equipment,
        reserved_quantity: 0,
        shared_organizations: collectSharedOrgIds(equipment).map(
          (orgId) => organizations[orgId] || `Org ${orgId}`,
        ),
      }));

  const buildReservationResponse = (organizationId) =>
    reservations
      .filter((reservation) => {
        const equipment = equipmentItems[reservation.equipment_id];
        if (!equipment || equipment.is_active === false) {
          return false;
        }
        const explicitShare =
          equipmentItemOrganizations[reservation.equipment_id]?.has(
            organizationId,
          ) || false;
        const localGroupShare =
          resolveShareFlag(equipment) &&
          sharesLocalGroup(equipment.organization_id, organizationId);
        return (
          explicitShare ||
          equipment.organization_id === organizationId ||
          localGroupShare
        );
      })
      .map((reservation) => {
        const equipment = equipmentItems[reservation.equipment_id];
        const ownerGroups = localGroups[equipment.organization_id] || [];
        const reservationGroups = localGroups[reservation.organization_id] || [];
        return {
          ...reservation,
          equipment_name: equipment.name,
          category: equipment.category,
          location_type: equipment.location_type,
          location_details: equipment.location_details,
          owner_organization_id: equipment.organization_id,
          owner_organization_name: organizations[equipment.organization_id],
          reservation_organization_id: reservation.organization_id,
          organization_name: organizations[reservation.organization_id],
          owner_local_group_ids: ownerGroups.map((group) => group.id),
          owner_local_group_names: ownerGroups.map((group) => group.name),
          reservation_local_group_ids: reservationGroups.map((group) => group.id),
          reservation_local_group_names: reservationGroups.map(
            (group) => group.name,
          ),
        };
      });

  beforeEach(() => {
    jest.clearAllMocks();

    organizations = {
      1: "Pack 1",
      2: "Pack 2",
      3: "Outside Org",
    };

    localGroups = {
      1: [{ id: 10, name: "North" }],
      2: [{ id: 10, name: "North" }],
      3: [{ id: 20, name: "South" }],
    };

    equipmentItems = {
      1: {
        id: 1,
        organization_id: 1,
        name: "Camp stove",
        category: null,
        description: null,
        quantity_total: 2,
        quantity_available: 2,
        condition_note: null,
        attributes: { share_with_local_group: true },
        item_value: null,
        photo_url: null,
        acquisition_date: null,
        location_type: "leader_home",
        location_details: "Call ahead for garage code",
        is_active: true,
      },
      2: {
        id: 2,
        organization_id: 2,
        name: "Tent",
        category: "camping",
        description: "Large tent",
        quantity_total: 3,
        quantity_available: 3,
        condition_note: null,
        attributes: { share_with_local_group: true },
        item_value: null,
        photo_url: null,
        acquisition_date: null,
        location_type: "leader_home",
        location_details: "Garage",
        is_active: true,
      },
    };

    equipmentItemOrganizations = {
      1: new Set([1]),
      2: new Set([2]),
    };

    reservations = [
      {
        id: 5,
        equipment_id: 2,
        meeting_date: "2024-05-01",
        date_from: "2024-05-01",
        date_to: "2024-05-03",
        reserved_quantity: 1,
        reserved_for: "Spring Camp",
        organization_id: 1,
        status: "reserved",
        notes: null,
      },
    ];

    mockPool = {
      query: jest.fn(async (text, params) => {
        if (text.startsWith("INSERT INTO equipment_items")) {
          const newId = Math.max(...Object.keys(equipmentItems).map(Number)) + 1;
          const newEquipment = {
            id: newId,
            organization_id: params[0],
            name: params[1],
            category: params[2],
            description: params[3],
            quantity_total: params[4],
            quantity_available: params[5],
            condition_note: params[6],
            attributes: params[7] || {},
            item_value: params[8],
            photo_url: params[9],
            acquisition_date: params[10],
            location_type: params[11],
            location_details: params[12],
            is_active: true,
          };
          equipmentItems[newId] = newEquipment;
          equipmentItemOrganizations[newId] = new Set([params[0]]);
          return { rows: [newEquipment] };
        }

        if (text.startsWith("SELECT DISTINCT peers.organization_id")) {
          const ownerId = params[0];
          const ownerGroupIds = getLocalGroupIds(ownerId);
          const peers = Object.entries(localGroups)
            .filter(([, groups]) =>
              groups.some((group) => ownerGroupIds.includes(group.id)),
            )
            .map(([organization_id]) => ({ organization_id: Number(organization_id) }));
          return { rows: peers };
        }

        if (text.startsWith("DELETE FROM equipment_item_organizations")) {
          const [equipmentId, allowedOrgIds] = params;
          equipmentItemOrganizations[equipmentId] = new Set(
            (equipmentItemOrganizations[equipmentId]
              ? Array.from(equipmentItemOrganizations[equipmentId])
              : []
            ).filter((id) => (allowedOrgIds || []).includes(id)),
          );
          return { rows: [] };
        }

        if (text.startsWith("INSERT INTO equipment_item_organizations")) {
          const [equipmentId, orgId] = params;
          if (!equipmentItemOrganizations[equipmentId]) {
            equipmentItemOrganizations[equipmentId] = new Set();
          }
          equipmentItemOrganizations[equipmentId].add(orgId);
          return { rows: [] };
        }

        if (
          text.startsWith("SELECT 1") &&
          text.includes("equipment_items ei") &&
          text.includes("share_with_local_group")
        ) {
          const [equipmentId, orgId] = params;
          const equipment = equipmentItems[equipmentId];
          if (!equipment || equipment.is_active === false) {
            return { rows: [] };
          }
          const explicitShare =
            equipmentItemOrganizations[equipmentId]?.has(orgId) || false;
          const localGroupShare =
            resolveShareFlag(equipment) &&
            sharesLocalGroup(equipment.organization_id, orgId);
          const isOwner = equipment.organization_id === orgId;
          return explicitShare || localGroupShare || isOwner
            ? { rows: [{ access: 1 }] }
            : { rows: [] };
        }

        if (text.startsWith("SELECT name, quantity_total FROM equipment_items")) {
          const equipment = equipmentItems[params[0]];
          return equipment
            ? { rows: [{ name: equipment.name, quantity_total: equipment.quantity_total }] }
            : { rows: [] };
        }

        if (text.startsWith("SELECT * FROM equipment_items WHERE id =")) {
          const equipment = equipmentItems[params[0]];
          return equipment ? { rows: [equipment] } : { rows: [] };
        }

        if (text.startsWith("SELECT COALESCE(SUM(reserved_quantity)")) {
          return { rows: [{ total_reserved: 0 }] };
        }

        if (text.startsWith("INSERT INTO equipment_reservations")) {
          const [
            reservationOrgId,
            equipmentId,
            meetingId,
            meetingDate,
            dateFrom,
            dateTo,
            reservedQuantity,
            reservedFor,
            status,
            notes,
            createdBy,
          ] = params;
          const newReservation = {
            id: reservations.length + 10,
            equipment_id: equipmentId,
            organization_id: reservationOrgId,
            meeting_id: meetingId,
            meeting_date: meetingDate,
            date_from: dateFrom,
            date_to: dateTo,
            reserved_quantity: reservedQuantity,
            reserved_for: reservedFor,
            status,
            notes,
            created_by: createdBy,
          };
          reservations.push(newReservation);
          return { rows: [newReservation] };
        }

        if (
          text.includes("WITH requester_groups") &&
          text.includes("reservation_local_group_names") &&
          text.includes("equipment_reservations er")
        ) {
          const orgId = params[0];
          const meetingDateFilter = params[1];
          const data = buildReservationResponse(orgId).filter((reservation) =>
            meetingDateFilter ? reservation.meeting_date === meetingDateFilter : true,
          );
          return { rows: data };
        }

        if (
          text.includes("WITH requester_groups") &&
          text.includes("shared_visibility") &&
          text.includes("accessible_equipment")
        ) {
          const orgId = params[0];
          return { rows: buildEquipmentResponse(orgId) };
        }

        if (text.startsWith("UPDATE equipment_items")) {
          const equipmentId = params[0];
          const equipment = equipmentItems[equipmentId];
          if (!equipment) {
            return { rows: [] };
          }
          const setClause = text.split("SET")[1].split("WHERE")[0];
          const assignments = setClause
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry && !entry.startsWith("updated_at"));
          assignments.forEach((assignment, index) => {
            const field = assignment.split("=")[0].trim();
            const value = params[index + 1];
            equipment[field] = value;
          });
          return { rows: [equipment] };
        }

        return { rows: [] };
      }),
    };

    const resourcesRouter = require("../routes/resources")(mockPool);
    app = express();
    app.use(express.json());
    app.locals.pool = mockPool;
    app.use("/api/v1/resources", resourcesRouter);
  });

  test("creates equipment with location metadata", async () => {
    const response = await request(app)
      .post("/api/v1/resources/equipment")
      .send({
        name: "Camp stove",
        quantity_total: 2,
        location_type: "leader_home",
        location_details: "Call ahead for garage code",
      });

    expect(response.status).toBe(201);
    expect(response.body.data.equipment.location_type).toBe("leader_home");
    expect(response.body.data.equipment.location_details).toBe(
      "Call ahead for garage code",
    );
    const newEquipmentId = response.body.data.equipment.id;
    expect(equipmentItemOrganizations[newEquipmentId].has(2)).toBe(true);
  });

  test("updates equipment location fields", async () => {
    const response = await request(app)
      .put("/api/v1/resources/equipment/1")
      .send({
        location_type: "warehouse",
        location_details: "Locker 12",
      });

    expect(response.status).toBe(200);
    expect(response.body.data.equipment.location_type).toBe("warehouse");
    expect(response.body.data.equipment.location_details).toBe("Locker 12");
  });

  test("returns reservation locations with audit context", async () => {
    const response = await request(app).get("/api/v1/resources/equipment/reservations");

    expect(response.status).toBe(200);
    const reservation = response.body.data.reservations[0];
    expect(reservation.location_type).toBe("leader_home");
    expect(reservation.location_details).toBe("Garage");
    expect(reservation.owner_organization_name).toBe("Pack 2");
    expect(reservation.owner_local_group_names).toContain("North");
  });

  test("allows same local group to read shared equipment without explicit share rows", async () => {
    getOrganizationId.mockResolvedValueOnce(1);

    const response = await request(app).get("/api/v1/resources/equipment");

    expect(response.status).toBe(200);
    const ids = response.body.data.equipment.map((item) => item.id);
    expect(ids).toContain(2);
  });

  test("blocks reservation when requester is outside the local group", async () => {
    getOrganizationId.mockResolvedValueOnce(3);

    const response = await request(app)
      .post("/api/v1/resources/equipment/reservations")
      .send({
        equipment_id: 2,
        meeting_date: "2024-05-10",
        reserved_quantity: 1,
        reserved_for: "Outside booking",
      });

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
  });
});
