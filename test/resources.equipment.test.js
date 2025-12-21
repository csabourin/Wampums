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

describe("Equipment location metadata", () => {
  let app;
  let mockPool;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = {
      query: jest.fn((text, params) => {
        if (text.includes("INSERT INTO equipment_items")) {
          return Promise.resolve({
            rows: [
              {
                id: 1,
                name: params[1],
                location_type: params[11],
                location_details: params[12],
              },
            ],
          });
        }

        if (text.includes("INSERT INTO equipment_item_organizations")) {
          return Promise.resolve({ rows: [] });
        }

        if (text.includes("SELECT 1") && text.includes("equipment_item_organizations")) {
          return Promise.resolve({ rows: [{ exists: 1 }] });
        }

        if (text.startsWith("UPDATE equipment_items")) {
          return Promise.resolve({
            rows: [
              {
                id: params[0],
                location_type: params[1],
                location_details: params[2],
              },
            ],
          });
        }

        if (text.includes("SELECT er.*, e.name AS equipment_name")) {
          return Promise.resolve({
            rows: [
              {
                id: 5,
                equipment_id: 2,
                equipment_name: "Tent",
                location_type: "leader_home",
                location_details: "Garage",
                date_from: "2024-05-01",
                date_to: "2024-05-03",
                reserved_quantity: 1,
                reserved_for: "Spring Camp",
                organization_name: "Pack 1",
                status: "reserved",
                meeting_date: "2024-05-01",
              },
            ],
          });
        }

        return Promise.resolve({ rows: [] });
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
    expect(response.body.data.equipment.location_details).toBe("Call ahead for garage code");
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO equipment_items"),
      expect.arrayContaining(["leader_home", "Call ahead for garage code"]),
    );
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

  test("returns reservation locations for pickup context", async () => {
    const response = await request(app).get("/api/v1/resources/equipment/reservations");

    expect(response.status).toBe(200);
    expect(response.body.data.reservations[0].location_type).toBe("leader_home");
    expect(response.body.data.reservations[0].location_details).toBe("Garage");
  });
});
