/**
 * Application Constants
 * 
 * Centralized configuration for application-wide constants to avoid magic numbers.
 * These values can be overridden via environment variables where appropriate.
 * 
 * @module config/constants
 */

/**
 * Rate Limiting Configuration
 */
const RATE_LIMITS = {
  // General API rate limiting
  GENERAL_WINDOW_MS: parseInt(process.env.RATE_LIMIT_GENERAL_WINDOW_MS) || 15 * 60 * 1000,  // 15 minutes
  GENERAL_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_GENERAL_MAX_REQUESTS) || 1000,          // Max requests per window
  
  // Authentication rate limiting
  AUTH_WINDOW_MS: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS) || 15 * 60 * 1000,      // 15 minutes
  AUTH_MAX_ATTEMPTS: parseInt(process.env.RATE_LIMIT_AUTH_MAX_ATTEMPTS) || 20,                // Max login attempts per window
  
  // Password reset rate limiting
  PASSWORD_RESET_WINDOW_MS: parseInt(process.env.RATE_LIMIT_PASSWORD_RESET_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
  PASSWORD_RESET_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_PASSWORD_RESET_MAX_REQUESTS) || 5,            // Max reset requests per hour
  
  // User profile updates
  PROFILE_UPDATE_WINDOW_MS: parseInt(process.env.RATE_LIMIT_PROFILE_UPDATE_WINDOW_MS) || 15 * 60 * 1000,  // 15 minutes
  PROFILE_UPDATE_MAX_PROD: parseInt(process.env.RATE_LIMIT_PROFILE_UPDATE_MAX_PROD) || 5,                 // Production limit
  PROFILE_UPDATE_MAX_DEV: parseInt(process.env.RATE_LIMIT_PROFILE_UPDATE_MAX_DEV) || 100,                // Development limit
  
  // Email changes
  EMAIL_CHANGE_WINDOW_MS: parseInt(process.env.RATE_LIMIT_EMAIL_CHANGE_WINDOW_MS) || 15 * 60 * 1000,    // 15 minutes
  EMAIL_CHANGE_MAX_PROD: parseInt(process.env.RATE_LIMIT_EMAIL_CHANGE_MAX_PROD) || 10,                  // Production limit
  EMAIL_CHANGE_MAX_DEV: parseInt(process.env.RATE_LIMIT_EMAIL_CHANGE_MAX_DEV) || 100,                  // Development limit
};

/**
 * File Upload Limits
 */
const FILE_LIMITS = {
  // AI service file upload limit
  AI_MAX_FILE_SIZE: parseInt(process.env.FILE_LIMIT_AI_MAX_FILE_SIZE) || 10 * 1024 * 1024,  // 10MB in bytes
  
  // General file upload limit (can be added when needed)
  // MAX_FILE_SIZE: 50 * 1024 * 1024,  // 50MB
};

/**
 * Date Range Limits
 */
const DATE_LIMITS = {
  // Offline sync date range limit
  OFFLINE_MAX_DAYS: parseInt(process.env.DATE_LIMIT_OFFLINE_MAX_DAYS) || 14,  // Maximum days for offline data sync
};

/**
 * Pagination Defaults
 */
const PAGINATION = {
  DEFAULT_PAGE: parseInt(process.env.PAGINATION_DEFAULT_PAGE) || 1,
  DEFAULT_LIMIT: parseInt(process.env.PAGINATION_DEFAULT_LIMIT) || 30,
  MAX_LIMIT: parseInt(process.env.PAGINATION_MAX_LIMIT) || 100,
};

/**
 * Session and Token Configuration
 */
const SESSION = {
  // JWT token expiration
  JWT_EXPIRATION: process.env.SESSION_JWT_EXPIRATION || '24h',
  
  // Refresh token expiration
  REFRESH_TOKEN_EXPIRATION: process.env.SESSION_REFRESH_TOKEN_EXPIRATION || '7d',
};

/**
 * Cache Configuration
 */
const CACHE = {
  // Default cache TTL in seconds
  DEFAULT_TTL: parseInt(process.env.CACHE_DEFAULT_TTL) || 300,  // 5 minutes
  
  // Cache cleanup interval
  CLEANUP_INTERVAL_MS: parseInt(process.env.CACHE_CLEANUP_INTERVAL_MS) || 5 * 60 * 1000,  // 5 minutes
};

module.exports = {
  RATE_LIMITS,
  FILE_LIMITS,
  DATE_LIMITS,
  PAGINATION,
  SESSION,
  CACHE,
};
