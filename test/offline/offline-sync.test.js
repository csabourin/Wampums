/**
 * Offline Sync System Tests
 *
 * Tests for:
 * - Offline CRUD via Repository (real module)
 * - Outbox ordering via OutboxManager (real module)
 * - ID mapping and FK repair via IdMapper (real module)
 * - Conflict detection
 * - Interruption/resume safety
 * - Integration scenario with 3-5 related entities
 *
 * Uses fake-indexeddb to simulate IndexedDB in Node.js.
 * Imports real production modules (babel-jest transforms ESM → CJS).
 */

'use strict';

// Setup fake-indexeddb before importing Dexie
const { indexedDB, IDBKeyRange } = require('fake-indexeddb');

// Patch globals so Dexie finds IndexedDB
global.indexedDB = indexedDB;
global.IDBKeyRange = IDBKeyRange;

// Minimal window/navigator stubs for modules that reference them
if (typeof global.window === 'undefined') {
  global.window = {
    location: { origin: 'http://localhost:3000', hostname: 'localhost' },
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
}
if (typeof global.self === 'undefined') {
  global.self = global.window;
}
if (typeof global.navigator === 'undefined') {
  global.navigator = { onLine: true };
}
if (typeof global.localStorage === 'undefined') {
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}
if (typeof global.document === 'undefined') {
  global.document = {
    hidden: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({
      id: '', className: '', textContent: '', style: {},
      setAttribute: () => {}, appendChild: () => {},
      querySelector: () => null, querySelectorAll: () => [],
      remove: () => {},
    }),
    head: { appendChild: () => {} },
    body: { appendChild: () => {} },
    getElementById: () => null,
  };
}
if (typeof global.CustomEvent === 'undefined') {
  global.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail || null;
    }
  };
}
if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(body, init = {}) {
      this._body = body;
      this.status = init.status || 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = new Map(Object.entries(init.headers || {}));
    }
    async json() { return JSON.parse(this._body); }
    async text() { return this._body; }
    clone() { return new Response(this._body, { status: this.status, headers: Object.fromEntries(this.headers) }); }
  };
}
if (typeof global.URL === 'undefined') {
  global.URL = require('url').URL;
}
if (typeof global.URLSearchParams === 'undefined') {
  global.URLSearchParams = require('url').URLSearchParams;
}
// Stub fetch globally
global.fetch = jest.fn();
// Stub crypto
global.crypto = {
  randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 10),
};
// Stub performance
global.performance = { now: () => Date.now() };

// Mock browser-dependent utility modules before importing real production code
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn(),
}));

// ========================================================================
// Import REAL production modules (babel-jest transforms ESM → CJS)
// ========================================================================

const {
  db,
  generateTempId,
  isTempId,
  generateCorrelationId,
} = require('../../spa/data/OfflineDatabase.js');

const {
  participantRepo,
  groupRepo,
  attendanceRepo,
  honorRepo,
} = require('../../spa/data/Repository.js');

const { OutboxManager } = require('../../spa/sync/OutboxManager.js');
const outboxManager = new OutboxManager();

const { IdMapper } = require('../../spa/sync/IdMapper.js');
const idMapper = new IdMapper();

// ========================================================================
// Tests
// ========================================================================

beforeEach(async () => {
  // Clear all tables in the real production DB between tests
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
});

// --------------------------------------------------
// 1. Offline CRUD via Repository (real module)
// --------------------------------------------------
describe('Offline CRUD via Repository', () => {
  test('should create entity with temp ID and outbox entry', async () => {
    const entity = await participantRepo.create({
      first_name: 'Alice',
      last_name: 'Smith',
      organization_id: 1,
    });

    // Entity has a temp ID
    expect(isTempId(entity.id)).toBe(true);
    expect(entity._dirty).toBe(true);
    expect(entity._syncVersion).toBe(0);

    // Verify stored in DB
    const stored = await participantRepo.getById(entity.id);
    expect(stored).toBeDefined();
    expect(stored.first_name).toBe('Alice');

    // Verify outbox entry was automatically created
    const outbox = await outboxManager.getPendingOrdered();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].operation).toBe('create');
    expect(outbox[0].entityType).toBe('participants');
    expect(outbox[0].status).toBe('pending');
    expect(outbox[0].tempId).toBe(entity.id);
  });

  test('should update entity and create outbox entry', async () => {
    // Pre-populate with server data
    await participantRepo.create(
      { id: 42, first_name: 'Bob', last_name: 'Jones', organization_id: 1 },
      { isServerData: true }
    );

    // Update locally
    const updated = await participantRepo.update(42, { first_name: 'Robert' });

    expect(updated.first_name).toBe('Robert');
    expect(updated._dirty).toBe(true);

    const outbox = await outboxManager.getPendingOrdered();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].operation).toBe('update');
    expect(outbox[0].entityId).toBe(42);
  });

  test('should delete entity and create outbox entry', async () => {
    await participantRepo.create(
      { id: 99, first_name: 'Del', organization_id: 1 },
      { isServerData: true }
    );

    await participantRepo.remove(99);

    const deleted = await participantRepo.getById(99);
    expect(deleted).toBeUndefined();

    const outbox = await outboxManager.getPendingOrdered();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].operation).toBe('delete');
    expect(outbox[0].entityId).toBe(99);
  });

  test('should delete temp entity and remove its outbox entries', async () => {
    const entity = await participantRepo.create({
      first_name: 'Temp',
      organization_id: 1,
    });

    const tempId = entity.id;
    expect(isTempId(tempId)).toBe(true);

    // Outbox entry exists after create
    let outbox = await outboxManager.getPendingOrdered();
    expect(outbox).toHaveLength(1);

    // Delete temp entity - should also remove outbox entries
    await participantRepo.remove(tempId);

    const stored = await participantRepo.getById(tempId);
    expect(stored).toBeUndefined();

    outbox = await outboxManager.getPendingOrdered();
    expect(outbox).toHaveLength(0);
  });
});

// --------------------------------------------------
// 2. Outbox Ordering via OutboxManager (real module)
// --------------------------------------------------
describe('Outbox ordering via OutboxManager', () => {
  test('should order entries by sync dependency: groups before participants before attendance', async () => {
    const now = Date.now();

    // Create entities in reverse dependency order via direct outbox adds
    await db._outbox.bulkAdd([
      {
        correlationId: 'c1', entityType: 'attendance', entityId: 'att1',
        operation: 'create', timestamp: now - 100, payload: {}, dependencies: [],
        status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
      },
      {
        correlationId: 'c2', entityType: 'participants', entityId: 'p1',
        operation: 'create', timestamp: now - 200, payload: {}, dependencies: [],
        status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
      },
      {
        correlationId: 'c3', entityType: 'groups', entityId: 'g1',
        operation: 'create', timestamp: now - 300, payload: {}, dependencies: [],
        status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
      },
    ]);

    // Use real OutboxManager to get ordered entries
    const entries = await outboxManager.getPendingOrdered();

    expect(entries[0].entityType).toBe('groups');
    expect(entries[1].entityType).toBe('participants');
    expect(entries[2].entityType).toBe('attendance');
  });

  test('should order by timestamp within same entity type', async () => {
    const now = Date.now();

    await db._outbox.bulkAdd([
      {
        correlationId: 'c1', entityType: 'participants', entityId: 'p2',
        operation: 'update', timestamp: now + 100, payload: {}, dependencies: [],
        status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
      },
      {
        correlationId: 'c2', entityType: 'participants', entityId: 'p1',
        operation: 'create', timestamp: now, payload: {}, dependencies: [],
        status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
      },
    ]);

    const entries = await outboxManager.getPendingOrdered();

    expect(entries[0].entityId).toBe('p1');
    expect(entries[1].entityId).toBe('p2');
  });
});

// --------------------------------------------------
// 3. ID Mapping and FK Repair via IdMapper (real module)
// --------------------------------------------------
describe('ID mapping and FK repair via IdMapper', () => {
  test('should store and retrieve temp-to-server ID mapping', async () => {
    const tempId = 'temp_123_abc';
    const serverId = 42;

    await idMapper.addMapping('participants', tempId, serverId);

    const retrieved = await idMapper.getServerId('participants', tempId);
    expect(retrieved).toBe(42);

    // Reverse lookup
    const retrievedTemp = await idMapper.getTempId('participants', 42);
    expect(retrievedTemp).toBe(tempId);
  });

  test('should prevent duplicate mappings', async () => {
    await idMapper.addMapping('participants', 'temp_dup', 10);
    await idMapper.addMapping('participants', 'temp_dup', 10); // duplicate

    const allMappings = await idMapper.getAllMappings();
    const matches = allMappings.filter(
      (m) => m.entityType === 'participants' && m.tempId === 'temp_dup'
    );
    expect(matches).toHaveLength(1);
  });

  test('should repair FK references in dependent entities', async () => {
    const tempParticipantId = generateTempId();

    // Create participant with temp ID
    await participantRepo.create({
      id: tempParticipantId,
      first_name: 'Alice',
      organization_id: 1,
    }, { isServerData: true });

    // Create attendance records referencing the temp participant
    await attendanceRepo.create({
      id: 'att1', participant_id: tempParticipantId,
      date: '2026-01-15', status: 'present', organization_id: 1,
    }, { isServerData: true });

    await attendanceRepo.create({
      id: 'att2', participant_id: tempParticipantId,
      date: '2026-01-16', status: 'absent', organization_id: 1,
    }, { isServerData: true });

    // Create honor referencing the temp participant
    await honorRepo.create({
      id: 'hon1', participant_id: tempParticipantId,
      reason: 'Good work', organization_id: 1,
    }, { isServerData: true });

    // Simulate sync: server assigned ID 42
    const serverId = 42;
    await idMapper.addMapping('participants', tempParticipantId, serverId);

    // Use real IdMapper to repair all references
    const result = await idMapper.repairReferences('participants', tempParticipantId, serverId);
    expect(result.repairedCount).toBeGreaterThan(0);

    // Verify participant PK was updated
    const repairedParticipant = await participantRepo.getById(serverId);
    expect(repairedParticipant).toBeDefined();
    expect(repairedParticipant.first_name).toBe('Alice');

    // Old temp ID is gone
    const oldParticipant = await participantRepo.getById(tempParticipantId);
    expect(oldParticipant).toBeUndefined();

    // Verify attendance FK was repaired
    const repairedAttendance = await db.attendance
      .where('participant_id')
      .equals(serverId)
      .toArray();
    expect(repairedAttendance).toHaveLength(2);

    // Verify honor FK was repaired
    const repairedHonors = await db.honors
      .where('participant_id')
      .equals(serverId)
      .toArray();
    expect(repairedHonors).toHaveLength(1);

    // No dangling references
    const danglingAttendance = await db.attendance
      .where('participant_id')
      .equals(tempParticipantId)
      .toArray();
    expect(danglingAttendance).toHaveLength(0);
  });

  test('should handle chained dependencies: group -> participant -> attendance', async () => {
    const tempGroupId = generateTempId();
    const tempParticipantId = generateTempId();

    // Create group
    await groupRepo.create({
      id: tempGroupId, name: 'Hawks', organization_id: 1,
    }, { isServerData: true });

    // Create participant in that group
    await participantRepo.create({
      id: tempParticipantId, first_name: 'Bob',
      group_id: tempGroupId, organization_id: 1,
    }, { isServerData: true });

    // Create attendance for that participant
    await attendanceRepo.create({
      id: 'att1', participant_id: tempParticipantId,
      date: '2026-02-01', status: 'present', organization_id: 1,
    }, { isServerData: true });

    // Sync group first: temp -> server 10
    const serverGroupId = 10;
    await idMapper.addMapping('groups', tempGroupId, serverGroupId);
    await idMapper.repairReferences('groups', tempGroupId, serverGroupId);

    // Verify participant's group_id was repaired
    const participant = await participantRepo.getById(tempParticipantId);
    expect(participant.group_id).toBe(serverGroupId);

    // Sync participant: temp -> server 20
    const serverParticipantId = 20;
    await idMapper.addMapping('participants', tempParticipantId, serverParticipantId);
    await idMapper.repairReferences('participants', tempParticipantId, serverParticipantId);

    // Verify full chain repaired
    const finalGroup = await groupRepo.getById(serverGroupId);
    expect(finalGroup.name).toBe('Hawks');

    const finalParticipant = await participantRepo.getById(serverParticipantId);
    expect(finalParticipant.first_name).toBe('Bob');
    expect(finalParticipant.group_id).toBe(serverGroupId);

    const finalAttendance = await db.attendance
      .where('participant_id')
      .equals(serverParticipantId)
      .toArray();
    expect(finalAttendance).toHaveLength(1);
    expect(finalAttendance[0].status).toBe('present');
  });

  test('should resolve IDs (temp to server or passthrough)', async () => {
    await idMapper.addMapping('participants', 'temp_res', 55);

    const resolved = await idMapper.resolveId('participants', 'temp_res');
    expect(resolved).toBe(55);

    // Non-temp IDs pass through
    const passthrough = await idMapper.resolveId('participants', 42);
    expect(passthrough).toBe(42);
  });
});

// --------------------------------------------------
// 4. Conflict Detection
// --------------------------------------------------
describe('Conflict detection via OutboxManager', () => {
  test('should detect conflict when server version is newer', async () => {
    // Local dirty record
    await db.participants.put({
      id: 42,
      first_name: 'LocalEdit',
      updated_at: '2026-02-10T10:00:00Z',
      _dirty: true,
      _localUpdatedAt: new Date('2026-02-10T10:00:00Z').getTime(),
      _serverUpdatedAt: new Date('2026-02-10T12:00:00Z').getTime(),
      organization_id: 1,
      _syncVersion: 1,
    });

    // Detect conflicts: dirty records where server > local timestamp
    const dirtyRecords = await db.participants.filter((e) => e._dirty === true).toArray();
    const conflicts = dirtyRecords.filter((e) => {
      return e._serverUpdatedAt && e._localUpdatedAt && e._serverUpdatedAt > e._localUpdatedAt;
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].id).toBe(42);
  });

  test('should store conflict record for user resolution via OutboxManager', async () => {
    const outboxEntry = await db._outbox.add({
      correlationId: 'conf1', entityType: 'participants', entityId: 42,
      operation: 'update', timestamp: Date.now(), payload: { first_name: 'Local' },
      dependencies: [], status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
    });

    // Use real OutboxManager to mark conflict
    await outboxManager.markConflict(outboxEntry, { first_name: 'Server' });

    // Verify outbox entry marked as conflict
    const entry = await db._outbox.get(outboxEntry);
    expect(entry.status).toBe('conflict');

    // Verify conflict record created
    const unresolved = await db._conflicts.where('resolvedAt').equals(0).toArray();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].entityType).toBe('participants');
    expect(unresolved[0].localVersion.first_name).toBe('Local');
    expect(unresolved[0].serverVersion.first_name).toBe('Server');
  });
});

// --------------------------------------------------
// 5. Interruption / Resume Safety
// --------------------------------------------------
describe('Interruption and resume safety', () => {
  test('should reset in-progress entries to pending on recovery', async () => {
    await db._outbox.bulkAdd([
      {
        correlationId: 'r1', entityType: 'participants', entityId: 1,
        operation: 'update', timestamp: Date.now() - 5000, payload: {},
        dependencies: [], status: 'in_progress', retryCount: 0, lastError: null, serverResponse: null,
      },
      {
        correlationId: 'r2', entityType: 'attendance', entityId: 2,
        operation: 'create', timestamp: Date.now() - 4000, payload: {},
        dependencies: [], status: 'in_progress', retryCount: 0, lastError: null, serverResponse: null,
      },
      {
        correlationId: 'r3', entityType: 'groups', entityId: 3,
        operation: 'update', timestamp: Date.now() - 3000, payload: {},
        dependencies: [], status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
      },
    ]);

    // Use real OutboxManager to reset
    const resetCount = await outboxManager.resetInProgress();
    expect(resetCount).toBe(2);

    const inProgress = await db._outbox.where('status').equals('in_progress').toArray();
    expect(inProgress).toHaveLength(0);

    const pending = await db._outbox.where('status').equals('pending').toArray();
    expect(pending).toHaveLength(3);
  });

  test('should preserve outbox entries across simulated DB close/reopen', async () => {
    await db._outbox.add({
      correlationId: 'persist1', entityType: 'participants', entityId: 'p1',
      operation: 'create', timestamp: Date.now(), payload: { first_name: 'Persistent' },
      dependencies: [], status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
    });

    // Close and reopen (simulating app restart)
    db.close();
    await db.open();

    const entries = await db._outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload.first_name).toBe('Persistent');
  });

  test('should handle retry count exhaustion via OutboxManager', async () => {
    const entryId = await db._outbox.add({
      correlationId: 'retry1', entityType: 'participants', entityId: 1,
      operation: 'update', timestamp: Date.now(), payload: {},
      dependencies: [], status: 'pending', retryCount: 4, lastError: 'Network error', serverResponse: null,
    });

    // Use real OutboxManager to mark as failed (5th attempt, MAX_RETRIES = 5)
    await outboxManager.markFailed(entryId, 'Network error');

    const updated = await db._outbox.get(entryId);
    expect(updated.status).toBe('failed');
    expect(updated.retryCount).toBe(5);
  });
});

// --------------------------------------------------
// 6. Integration: Multi-entity Relationship Scenario
// --------------------------------------------------
describe('Integration: multi-entity relationship scenario', () => {
  test('should handle full offline CRUD cycle: create group, participant, attendance, honor, then sync', async () => {
    const orgId = 1;

    // Step 1: Create group offline (via real Repository)
    const group = await groupRepo.create({ name: 'Eagles', organization_id: orgId });
    expect(isTempId(group.id)).toBe(true);

    // Step 2: Create participant in that group
    const participant = await participantRepo.create({
      first_name: 'Charlie', last_name: 'Brown',
      group_id: group.id, organization_id: orgId,
    });
    expect(isTempId(participant.id)).toBe(true);

    // Step 3: Mark attendance
    const attendance = await attendanceRepo.create({
      participant_id: participant.id, date: '2026-02-11',
      status: 'present', organization_id: orgId,
    });

    // Step 4: Award an honor
    const honor = await honorRepo.create({
      participant_id: participant.id, reason: 'Leadership',
      organization_id: orgId, created_at: new Date().toISOString(),
    });

    // Verify all entities exist locally
    expect(await groupRepo.getAll()).toHaveLength(1);
    expect(await participantRepo.getAll()).toHaveLength(1);
    expect(await attendanceRepo.getAll()).toHaveLength(1);
    expect(await honorRepo.getAll()).toHaveLength(1);

    // Verify outbox has 4 pending entries in correct order
    const outbox = await outboxManager.getPendingOrdered();
    expect(outbox).toHaveLength(4);
    expect(outbox[0].entityType).toBe('groups');
    expect(outbox[1].entityType).toBe('participants');
    expect(outbox[2].entityType).toBe('attendance');
    expect(outbox[3].entityType).toBe('honors');

    // Verify dependency chain was auto-detected by Repository
    const participantEntry = outbox.find((e) => e.entityType === 'participants');
    expect(participantEntry.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'groups', tempId: group.id }),
      ])
    );

    const attendanceEntry = outbox.find((e) => e.entityType === 'attendance');
    expect(attendanceEntry.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'participants', tempId: participant.id }),
      ])
    );

    // ---- Simulate sync with real IdMapper ----

    // Sync group: server assigns ID 100
    await idMapper.addMapping('groups', group.id, 100);
    await idMapper.repairReferences('groups', group.id, 100);

    // Sync participant: server assigns ID 200
    await idMapper.addMapping('participants', participant.id, 200);
    await idMapper.repairReferences('participants', participant.id, 200);

    // Sync attendance and honor: server assigns IDs
    await idMapper.addMapping('attendance', attendance.id, 300);
    await idMapper.repairReferences('attendance', attendance.id, 300);

    await idMapper.addMapping('honors', honor.id, 400);
    await idMapper.repairReferences('honors', honor.id, 400);

    // Final state verification
    const finalGroup = await groupRepo.getById(100);
    expect(finalGroup.name).toBe('Eagles');

    const finalParticipant = await participantRepo.getById(200);
    expect(finalParticipant.first_name).toBe('Charlie');
    expect(finalParticipant.group_id).toBe(100);

    const finalAttendance = await db.attendance
      .where('participant_id')
      .equals(200)
      .toArray();
    expect(finalAttendance).toHaveLength(1);
    expect(finalAttendance[0].status).toBe('present');

    const finalHonors = await db.honors
      .where('participant_id')
      .equals(200)
      .toArray();
    expect(finalHonors).toHaveLength(1);
    expect(finalHonors[0].reason).toBe('Leadership');

    // No dangling temp references
    const danglingParticipants = await db.participants
      .where('group_id')
      .equals(group.id)
      .toArray();
    expect(danglingParticipants).toHaveLength(0);

    // ID mappings recorded
    const allMappings = await idMapper.getAllMappings();
    expect(allMappings).toHaveLength(4);
  });
});

// --------------------------------------------------
// 7. Bulk Upsert & replaceAllForOrganization (real Repository)
// --------------------------------------------------
describe('Bulk upsert from server pull', () => {
  test('should upsert server data without creating outbox entries', async () => {
    const serverData = [
      { id: 1, first_name: 'Alice', organization_id: 1 },
      { id: 2, first_name: 'Bob', organization_id: 1 },
      { id: 3, first_name: 'Charlie', organization_id: 1 },
    ];

    await participantRepo.bulkUpsert(serverData);

    const stored = await participantRepo.getAll();
    expect(stored).toHaveLength(3);

    // No outbox entries (server data)
    const outbox = await outboxManager.getPendingOrdered();
    expect(outbox).toHaveLength(0);

    // Entries are marked clean
    expect(stored[0]._dirty).toBe(false);
  });

  test('should not overwrite dirty local records during replaceAllForOrganization', async () => {
    // Create local dirty record via Repository
    await participantRepo.create({
      id: 1, first_name: 'LocalEdit', organization_id: 1,
    });

    // Server data tries to overwrite
    const serverData = [
      { id: 1, first_name: 'ServerVersion', organization_id: 1 },
      { id: 2, first_name: 'NewFromServer', organization_id: 1 },
    ];

    await participantRepo.replaceAllForOrganization(1, serverData);

    // Local edit preserved (dirty record not overwritten)
    const local = await participantRepo.getById(1);
    expect(local.first_name).toBe('LocalEdit');
    expect(local._dirty).toBe(true);

    // New server record added
    const server = await participantRepo.getById(2);
    expect(server.first_name).toBe('NewFromServer');
  });
});

// --------------------------------------------------
// 8. Sync Metadata & Outbox Purge
// --------------------------------------------------
describe('Sync metadata', () => {
  test('should store and retrieve last sync timestamp', async () => {
    const syncTime = Date.now();
    await db._syncMeta.put({ key: 'lastSync', value: syncTime });

    const meta = await db._syncMeta.get('lastSync');
    expect(meta.value).toBe(syncTime);
  });

  test('should purge old synced outbox entries via OutboxManager', async () => {
    const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
    const recentTimestamp = Date.now() - 1000; // 1 second ago

    await db._outbox.bulkAdd([
      {
        correlationId: 'old1', entityType: 'participants', entityId: 1,
        operation: 'update', timestamp: oldTimestamp, payload: {},
        dependencies: [], status: 'synced', retryCount: 0, lastError: null, serverResponse: null,
      },
      {
        correlationId: 'recent1', entityType: 'participants', entityId: 2,
        operation: 'update', timestamp: recentTimestamp, payload: {},
        dependencies: [], status: 'synced', retryCount: 0, lastError: null, serverResponse: null,
      },
      {
        correlationId: 'pending1', entityType: 'groups', entityId: 3,
        operation: 'create', timestamp: oldTimestamp, payload: {},
        dependencies: [], status: 'pending', retryCount: 0, lastError: null, serverResponse: null,
      },
    ]);

    // Use real OutboxManager to purge
    const purgedCount = await outboxManager.purgeSynced();
    expect(purgedCount).toBe(1);

    const remaining = await db._outbox.toArray();
    expect(remaining).toHaveLength(2); // recent synced + pending kept

    // Pending entry preserved even though old
    const pendingEntries = await db._outbox.where('status').equals('pending').toArray();
    expect(pendingEntries).toHaveLength(1);
  });
});

// --------------------------------------------------
// 9. Utility Functions (real OfflineDatabase module)
// --------------------------------------------------
describe('Utility functions from OfflineDatabase', () => {
  test('generateTempId produces valid temp IDs', () => {
    const id = generateTempId();
    expect(id).toMatch(/^temp_\d+_[a-z0-9]{6}$/);
    expect(isTempId(id)).toBe(true);
  });

  test('isTempId rejects non-temp IDs', () => {
    expect(isTempId(42)).toBe(false);
    expect(isTempId('regular-string')).toBe(false);
    expect(isTempId(null)).toBe(false);
    expect(isTempId(undefined)).toBe(false);
  });

  test('generateCorrelationId produces valid UUIDs', () => {
    const id = generateCorrelationId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  test('generateTempId produces unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateTempId());
    }
    expect(ids.size).toBe(100);
  });
});

// --------------------------------------------------
// 10. OutboxManager Dependency Check (real module)
// --------------------------------------------------
describe('OutboxManager dependency resolution', () => {
  test('areDependenciesSatisfied returns true when no dependencies', async () => {
    const entry = { dependencies: [] };
    const satisfied = await outboxManager.areDependenciesSatisfied(entry);
    expect(satisfied).toBe(true);
  });

  test('areDependenciesSatisfied returns false when temp ID not mapped', async () => {
    const entry = {
      dependencies: [{ entityType: 'groups', tempId: 'temp_unmapped' }],
    };
    const satisfied = await outboxManager.areDependenciesSatisfied(entry);
    expect(satisfied).toBe(false);
  });

  test('areDependenciesSatisfied returns true when temp ID is mapped', async () => {
    await idMapper.addMapping('groups', 'temp_mapped', 10);

    const entry = {
      dependencies: [{ entityType: 'groups', tempId: 'temp_mapped' }],
    };
    const satisfied = await outboxManager.areDependenciesSatisfied(entry);
    expect(satisfied).toBe(true);
  });

  test('resolvePayloadIds replaces temp IDs in payload', async () => {
    await idMapper.addMapping('participants', 'temp_p1', 42);

    const entry = {
      entityType: 'attendance',
      entityId: 'att1',
      payload: { participant_id: 'temp_p1', date: '2026-02-11' },
    };

    const resolved = await outboxManager.resolvePayloadIds(entry);
    expect(resolved.payload.participant_id).toBe(42);
    expect(resolved.payload.date).toBe('2026-02-11');
  });
});
