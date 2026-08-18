/**
 * Equipment reservations — lapsed reservations must release their stock.
 *
 * A reservation is a claim on equipment for a period. `reserved` means the gear
 * was spoken for; only `confirmed` means it actually left the shelf. So a
 * `reserved` row whose last day has passed was never collected, and the units it
 * named have been free ever since.
 *
 * Two queries disagreed. The availability sum and the delete guard both filtered
 * on status alone, with no date predicate at all, so every reservation ever made
 * went on holding stock forever. In production one item reached six units held
 * by December reservations against a total stock of two, which made it
 * permanently unbookable and permanently undeletable.
 *
 * These tests read the SQL the router actually emits, because that is where the
 * bug lived: the handlers, the responses and the status values were all fine.
 *
 * @module test/resources.reservation-expiry
 */

const express = require("express");
const request = require("supertest");

jest.mock("../middleware/auth", () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organizationId: 1 };
    return next();
  },
  requirePermission: () => (_req, _res, next) => next(),
  blockDemoRoles: (_req, _res, next) => next(),
  hasAnyRole: () => (_req, _res, next) => next(),
  getOrganizationId: jest.fn(async () => 1),
}));

jest.mock("../utils/railway-storage", () => ({
  MAX_FILE_SIZE: 1_000_000,
  OUTPUT_MIME_TYPE: "image/webp",
  validateFile: () => ({ isValid: true }),
  isAllowedImageType: () => true,
  convertImageToWebP: async (buffer) => buffer,
  generateFilePath: () => "path",
  getPhotoOrganizationId: () => null,
  getSignedPhotoUrl: async (reference) => `https://signed.example/${reference}`,
  uploadFile: async () => ({ success: true, path: "path" }),
  deleteFile: async () => true,
  extractPathFromUrl: (reference) => reference,
  isStorageConfigured: () => false,
  WEBP_EXTENSION: ".webp",
}));

/**
 * Mount the router on a fresh app, backed by `poolImpl`.
 *
 * `routes/resources.js` builds its router at module scope, so the factory hands
 * back the same router object every time it is called and each call registers
 * its handlers again. Two mounts in one process therefore share one router, and
 * the pool passed to the *first* call is the one that answers every request --
 * which silently routed this suite's requests at another test's database.
 * Resetting the module registry gives each mount its own router and its own pool.
 *
 * @param {Function} poolImpl - Implementation for pool.query
 * @returns {Object} Express app
 */
function mountRouter(poolImpl) {
  let router;
  jest.isolateModules(() => {
    router = require("../routes/resources")({ query: jest.fn(poolImpl) });
  });

  const app = express();
  app.use(express.json());
  app.use("/api/v1/resources", router);
  return app;
}

const ORG_ID = 1;

let app;
let queries;

/** Every statement whose text matches, normalised to single spaces. */
const matching = (fragment) =>
  queries
    .map((entry) => ({ ...entry, text: entry.text.replace(/\s+/g, " ") }))
    .filter((entry) => entry.text.includes(fragment));

beforeEach(() => {
  queries = [];

  const pool = {
    query: (async (text, params = []) => {
      queries.push({ text, params });
      if (/^\s*UPDATE equipment_reservations/i.test(text)) {
        return { rows: [{ id: 7 }] };
      }
      // Grant access to the equipment under test, so the delete handler reaches
      // its reservation guard instead of stopping at a 404.
      if (/SELECT 1\s+FROM equipment_items/i.test(text)) {
        return { rows: [{ ok: 1 }] };
      }
      if (/COUNT\(\*\) as count/i.test(text)) {
        return { rows: [{ count: "0" }] };
      }
      return { rows: [] };
    }),
  };

  app = mountRouter(pool.query);
});

describe("the expiry sweep", () => {
  test("runs before equipment is listed, so availability reflects it", async () => {
    await request(app).get("/api/v1/resources/equipment");

    const sweeps = matching("SET status = 'expired'");
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].params).toEqual([ORG_ID]);
  });

  test("runs before reservations are listed", async () => {
    await request(app).get("/api/v1/resources/equipment/reservations");

    expect(matching("SET status = 'expired'")).toHaveLength(1);
  });

  test("only lapses reservations that were never picked up", async () => {
    await request(app).get("/api/v1/resources/equipment");

    const [sweep] = matching("SET status = 'expired'");
    // 'confirmed' means the equipment went out. Whether it came back is a fact
    // for whoever checks it in, never one this sweep may invent.
    expect(sweep.text).toContain("AND status = 'reserved'");
    expect(sweep.text).not.toContain("confirmed");
  });

  test("only lapses reservations whose last day has passed", async () => {
    await request(app).get("/api/v1/resources/equipment");

    const [sweep] = matching("SET status = 'expired'");
    expect(sweep.text).toContain(
      "COALESCE(date_to, meeting_date) < CURRENT_DATE",
    );
  });

  test("is scoped to one organisation", async () => {
    await request(app).get("/api/v1/resources/equipment");

    const [sweep] = matching("SET status = 'expired'");
    expect(sweep.text).toContain("WHERE organization_id = $1");
  });
});

describe("queries that decide whether equipment is spoken for", () => {
  test("availability counts only reservations that have not ended", async () => {
    await request(app).get("/api/v1/resources/equipment");

    const [listing] = matching("AS reserved_quantity");
    expect(listing).toBeDefined();
    expect(listing.text).toContain(
      "COALESCE(er.date_to, er.meeting_date) >= CURRENT_DATE",
    );
  });

  test("the delete guard counts only reservations that have not ended", async () => {
    await request(app).delete("/api/v1/resources/equipment/5");

    const [guard] = matching("COUNT(*) as count FROM equipment_reservations");
    expect(guard).toBeDefined();
    expect(guard.text).toContain(
      "COALESCE(date_to, meeting_date) >= CURRENT_DATE",
    );
  });

  test("neither query decides on status alone", async () => {
    await request(app).get("/api/v1/resources/equipment");
    await request(app).delete("/api/v1/resources/equipment/5");

    // The original bug in one line: a status filter with no date beside it.
    for (const entry of matching("status IN ('reserved', 'confirmed')")) {
      expect(entry.text).toContain("CURRENT_DATE");
    }
  });
});

describe("re-acquiring stock through a status change", () => {
  /** Mount a router whose reservation row and equipment are fixed. */
  const mountWith = ({ status, reservedQuantity, quantityTotal, alreadyReserved }) => {
    const seen = [];
    const pool = {
      query: (async (text, params = []) => {
        seen.push({ text: text.replace(/\s+/g, " "), params });
        if (/^\s*UPDATE equipment_reservations/i.test(text)) {
          return { rows: [{ id: 9, status }] };
        }
        if (/FROM equipment_reservations\s+WHERE id = \$1/i.test(text)) {
          return {
            rows: [
              {
                equipment_id: 3,
                date_from: "2026-09-01",
                date_to: "2026-09-02",
                reserved_quantity: reservedQuantity,
                status,
              },
            ],
          };
        }
        if (/SELECT name, quantity_total FROM equipment_items/i.test(text)) {
          return { rows: [{ name: "Camp Stove", quantity_total: quantityTotal }] };
        }
        if (/total_reserved/i.test(text)) {
          return { rows: [{ total_reserved: String(alreadyReserved) }] };
        }
        return { rows: [] };
      }),
    };
    return { app: mountRouter(pool.query), seen };
  };

  test("a returned reservation cannot be re-confirmed beyond what the unit owns", async () => {
    // Two stoves exist, both already spoken for by other reservations. Putting
    // this one back on the books would make three.
    const { app: local } = mountWith({
      status: "returned",
      reservedQuantity: 1,
      quantityTotal: 2,
      alreadyReserved: 2,
    });

    const res = await request(local)
      .patch("/api/v1/resources/equipment/reservations/9")
      .send({ status: "confirmed" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not enough/i);
  });

  test("the check uses the quantity already on the row, not one from the body", async () => {
    const { app: local, seen } = mountWith({
      status: "cancelled",
      reservedQuantity: 1,
      quantityTotal: 5,
      alreadyReserved: 0,
    });

    const res = await request(local)
      .patch("/api/v1/resources/equipment/reservations/9")
      .send({ status: "reserved" });

    expect(res.status).toBe(200);
    // It looked the row up rather than trusting a quantity that was never sent.
    expect(seen.some((q) => /total_reserved/i.test(q.text))).toBe(true);
  });

  test("releasing stock needs no availability check at all", async () => {
    const { app: local, seen } = mountWith({
      status: "confirmed",
      reservedQuantity: 1,
      quantityTotal: 2,
      alreadyReserved: 2,
    });

    const res = await request(local)
      .patch("/api/v1/resources/equipment/reservations/9")
      .send({ status: "returned" });

    // Bringing equipment back can never overbook anything.
    expect(res.status).toBe(200);
    expect(seen.some((q) => /total_reserved/i.test(q.text))).toBe(false);
  });
});
