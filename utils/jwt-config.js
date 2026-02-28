const jwt = require('jsonwebtoken');

/**
 * Resolve JWT secret from environment variables.
 * Supports both legacy JWT_SECRET and preferred JWT_SECRET_KEY.
 *
 * @returns {string|null} JWT secret value if configured
 */
function getJWTSecret() {
  return process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || null;
}

/**
 * Resolve and validate JWT secret.
 *
 * @returns {string} JWT secret
 * @throws {Error} When JWT secret is missing
 */
function requireJWTSecret() {
  const secret = getJWTSecret();
  if (!secret) {
    throw new Error('JWT_SECRET_KEY or JWT_SECRET environment variable is required');
  }
  return secret;
}

/**
 * Verify a JWT using the shared secret resolution strategy.
 *
 * @param {string} token - JWT token to verify
 * @returns {Object} Decoded JWT payload
 */
function verifyJWTToken(token) {
  return jwt.verify(token, requireJWTSecret());
}

/**
 * Sign a JWT using the shared secret resolution strategy.
 *
 * @param {Object|string|Buffer} payload - JWT payload
 * @param {Object} options - jsonwebtoken sign options
 * @returns {string} Signed JWT
 */
function signJWTToken(payload, options = {}) {
  return jwt.sign(payload, requireJWTSecret(), options);
}

module.exports = {
  getJWTSecret,
  requireJWTSecret,
  verifyJWTToken,
  signJWTToken,
};
