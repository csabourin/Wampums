/**
 * Announcing successful writes to a unit's other open sessions.
 */
const { EventEmitter } = require("events");

const mockEmit = jest.fn();
const mockExcept = jest.fn();
const mockTo = jest.fn();

jest.mock("../services/socket", () => ({
    getIO: () => ({ to: mockTo }),
}));

const { liveSyncBroadcaster, announcedPath } = require("../middleware/live-sync");

/**
 * Run a request through the middleware and finish it with a status.
 * @param {Object} options
 * @returns {void}
 */
function runRequest({ method = "POST", url, status = 200, user = { organizationId: 12 }, headers = {} }) {
    const req = {
        method,
        originalUrl: url,
        user,
        get: (name) => headers[name.toLowerCase()],
    };
    const res = new EventEmitter();
    res.statusCode = status;
    const next = jest.fn();

    liveSyncBroadcaster(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    res.emit("finish");
}

beforeEach(() => {
    mockEmit.mockReset();
    mockExcept.mockReset();
    mockTo.mockReset();
    const room = { emit: mockEmit, except: mockExcept };
    mockExcept.mockReturnValue(room);
    mockTo.mockReturnValue(room);
});

describe("liveSyncBroadcaster", () => {
    test("announces a successful write to the writer's unit, with the path only", () => {
        runRequest({ method: "DELETE", url: "/api/v1/participants/42?organization_id=12", status: 204 });

        expect(mockTo).toHaveBeenCalledWith("org-12");
        expect(mockEmit).toHaveBeenCalledWith("data-changed", { path: "/api/v1/participants/42" });
    });

    test("leaves out the session that made the write", () => {
        runRequest({ url: "/api/v1/points", headers: { "x-live-sync-client": "AbC123_-xyz" } });

        expect(mockExcept).toHaveBeenCalledWith("AbC123_-xyz");
        expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    test("ignores a malformed connection id rather than passing it to Socket.IO", () => {
        runRequest({ url: "/api/v1/points", headers: { "x-live-sync-client": "not a socket id!" } });

        expect(mockExcept).not.toHaveBeenCalled();
        expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    test.each([
        ["a failed write", { url: "/api/v1/points", status: 400 }],
        ["a refused write", { url: "/api/v1/points", status: 403 }],
        ["a read", { method: "GET", url: "/api/v1/points" }],
        ["an unauthenticated write", { url: "/api/v1/points", user: null }],
        ["a legacy path", { url: "/api/points" }],
        ["a read made with POST", { url: "/api/v1/users/permissions/check" }],
        ["an AI query", { url: "/api/v1/ai/ask" }],
    ])("says nothing about %s", (_label, request) => {
        runRequest(request);

        expect(mockEmit).not.toHaveBeenCalled();
    });

    test("a failed announcement never throws into the finished request", () => {
        mockTo.mockImplementation(() => {
            throw new Error("Socket.IO not initialized!");
        });

        expect(() => runRequest({ url: "/api/v1/points" })).not.toThrow();
    });
});

describe("announcedPath", () => {
    test("drops the query string and a trailing slash", () => {
        expect(announcedPath({ originalUrl: "/api/v1/groups/3/?x=1" })).toBe("/api/v1/groups/3");
    });
});
