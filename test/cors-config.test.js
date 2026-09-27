/**
 * Origins allowed to call the API and to open a Socket.IO connection.
 */
const { isAllowedOrigin, allowSocketRequest } = require("../config/cors");

/**
 * @param {Object} headers - Handshake headers
 * @returns {boolean} What allowSocketRequest decided
 */
function socketAllows(headers) {
    let allowed = null;
    allowSocketRequest({ headers }, (err, ok) => {
        expect(err).toBeNull();
        allowed = ok;
    });
    return allowed;
}

describe("isAllowedOrigin", () => {
    test.each([
        "https://wampums.app",
        "https://demo.wampums.app",
        "http://localhost:5173",
        "http://127.0.0.1:5000",
    ])("allows %s", (origin) => {
        expect(isAllowedOrigin(origin)).toBe(true);
    });

    test.each([
        "https://evil.example",
        "https://wampums.app.evil.example",
        "https://evilwampums.app",
        "http://wampums.app",
    ])("refuses %s", (origin) => {
        expect(isAllowedOrigin(origin)).toBe(false);
    });
});

describe("allowSocketRequest", () => {
    test("refuses a handshake from another site", () => {
        expect(socketAllows({ origin: "https://evil.example", host: "demo.wampums.app" })).toBe(false);
    });

    test("allows a unit served on its own domain by this host", () => {
        expect(socketAllows({ origin: "https://scouts-example.ca", host: "scouts-example.ca" })).toBe(true);
    });

    test("allows wampums subdomains and clients that send no Origin", () => {
        expect(socketAllows({ origin: "https://demo.wampums.app", host: "api.wampums.app" })).toBe(true);
        expect(socketAllows({ host: "demo.wampums.app" })).toBe(true);
    });

    test("does not treat a malformed Origin as same-host", () => {
        expect(socketAllows({ origin: "not a url", host: "not a url" })).toBe(false);
    });
});
