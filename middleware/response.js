// Standardized API response middleware

const INTERNAL_SERVER_ERROR_MESSAGE = 'internal_server_error';

/**
 * Success response wrapper
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {String} message - Optional success message
 * @param {Number} statusCode - HTTP status code (default 200)
 */
exports.success = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

/**
 * Error response wrapper
 * @param {Object} res - Express response object
 * @param {String} message - Error message
 * @param {Number} statusCode - HTTP status code (default 400)
 * @param {*} errors - Optional validation errors
 */
exports.error = (res, message = 'An error occurred', statusCode = 400, errors = null) => {
  const response = {
    success: false,
    message: statusCode === 500 ? INTERNAL_SERVER_ERROR_MESSAGE : message,
    timestamp: new Date().toISOString()
  };

  if (errors) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Prevent route-local HTTP 500 responses from exposing database, SDK, filesystem, or
 * stack details. This provides a final safety boundary while older handlers are
 * migrated to the standardized response helpers.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Continue middleware chain
 * @returns {*} Result of the next middleware
 */
exports.sanitizeServerErrorResponses = (req, res, next) => {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    if (res.statusCode === 500) {
      return sendJson({
        success: false,
        message: INTERNAL_SERVER_ERROR_MESSAGE,
        timestamp: new Date().toISOString()
      });
    }

    return sendJson(body);
  };

  return next();
};

/**
 * Paginated response wrapper
 * @param {Object} res - Express response object
 * @param {Array} data - Array of items
 * @param {Number} page - Current page
 * @param {Number} limit - Items per page
 * @param {Number} total - Total number of items
 */
exports.paginated = (res, data, page, limit, total) => {
  const totalPages = Math.ceil(total / limit);

  return res.status(200).json({
    success: true,
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    },
    timestamp: new Date().toISOString()
  });
};

/**
 * Middleware to catch async errors
 * @param {Function} fn - Async function
 */
exports.asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
