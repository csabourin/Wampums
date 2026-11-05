'use strict';

/**
 * HTTP status codes the API answers with, by name, so a route reads
 * `error(res, message, HTTP_STATUS.NOT_FOUND)` rather than a bare 404.
 * CLAUDE.md §2 lists when each one is used.
 */
const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
});

module.exports = { HTTP_STATUS };
