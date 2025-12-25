/**
 * Security Utilities for Wampums React Native App
 *
 * Mirrors spa/SecurityUtils.js (if it exists) or provides RN-specific security helpers
 * Provides:
 * - Input sanitization
 * - XSS prevention
 * - Safe text rendering
 */

/**
 * Sanitize HTML/text input to prevent XSS
 * In React Native, we don't render HTML directly, but we still need to
 * sanitize text that might be displayed or sent to the backend
 */
export const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove HTML tags
  let sanitized = input.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  sanitized = sanitized
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  return sanitized.trim();
};

/**
 * Escape special characters for safe display
 */
export const escapeHtml = (text) => {
  if (!text || typeof text !== 'string') {
    return '';
  }

  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };

  return text.replace(/[&<>"'/]/g, (char) => map[char]);
};

/**
 * Validate and sanitize email
 */
export const sanitizeEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return '';
  }

  // Remove whitespace and convert to lowercase
  const cleaned = email.trim().toLowerCase();

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleaned)) {
    return '';
  }

  return cleaned;
};

/**
 * Validate and sanitize phone number
 */
export const sanitizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') {
    return '';
  }

  // Remove all non-digit characters except + at the start
  let cleaned = phone.trim();
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.substring(1).replace(/\D/g, '');
  } else {
    cleaned = cleaned.replace(/\D/g, '');
  }

  return cleaned;
};

/**
 * Validate URL
 */
export const isValidUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Sanitize URL (ensure it's safe)
 */
export const sanitizeUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return '';
  }

  const trimmed = url.trim();

  // Check for javascript: protocol and other dangerous protocols
  const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
  const lowerUrl = trimmed.toLowerCase();

  for (const protocol of dangerousProtocols) {
    if (lowerUrl.startsWith(protocol)) {
      return '';
    }
  }

  // If it's a valid URL, return it
  if (isValidUrl(trimmed)) {
    return trimmed;
  }

  // If it doesn't start with http/https, add https://
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `https://${trimmed}`;
  }

  return trimmed;
};

/**
 * Validate and sanitize participant name
 */
export const sanitizeName = (name) => {
  if (!name || typeof name !== 'string') {
    return '';
  }

  // Remove any HTML tags
  let cleaned = name.replace(/<[^>]*>/g, '');

  // Remove special characters except common name characters
  // Allow: letters (including accented), spaces, hyphens, apostrophes
  cleaned = cleaned.replace(/[^a-zA-ZÀ-ÿ\s'-]/g, '');

  // Remove excessive whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
};

/**
 * Sanitize numeric input
 */
export const sanitizeNumber = (input, allowDecimals = true) => {
  if (input === null || input === undefined) {
    return '';
  }

  const str = String(input);

  if (allowDecimals) {
    // Allow digits, decimal point, and minus sign
    return str.replace(/[^\d.-]/g, '');
  } else {
    // Allow only digits and minus sign
    return str.replace(/[^\d-]/g, '');
  }
};

/**
 * Validate password strength
 * Returns: { valid: boolean, message: string, score: number }
 */
export const validatePasswordStrength = (password) => {
  if (!password) {
    return { valid: false, message: 'Password is required', score: 0 };
  }

  const length = password.length;
  let score = 0;
  const feedback = [];

  // Length check
  if (length < 8) {
    feedback.push('at least 8 characters');
  } else {
    score += 1;
  }

  // Uppercase check
  if (!/[A-Z]/.test(password)) {
    feedback.push('one uppercase letter');
  } else {
    score += 1;
  }

  // Lowercase check
  if (!/[a-z]/.test(password)) {
    feedback.push('one lowercase letter');
  } else {
    score += 1;
  }

  // Number check
  if (!/[0-9]/.test(password)) {
    feedback.push('one number');
  } else {
    score += 1;
  }

  // Special character check
  if (!/[^A-Za-z0-9]/.test(password)) {
    feedback.push('one special character');
  } else {
    score += 1;
  }

  const valid = score >= 4;
  const message = valid
    ? 'Password is strong'
    : `Password must contain ${feedback.join(', ')}`;

  return { valid, message, score };
};

/**
 * Remove null bytes and control characters
 */
export const removeControlCharacters = (input) => {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove null bytes and control characters (except newline and tab)
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

/**
 * Truncate text safely
 */
export const truncateText = (text, maxLength, suffix = '...') => {
  if (!text || typeof text !== 'string') {
    return '';
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * Deep sanitize object (recursively sanitize all string values)
 */
export const deepSanitize = (obj) => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeInput(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(deepSanitize);
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = deepSanitize(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

export default {
  sanitizeInput,
  escapeHtml,
  sanitizeEmail,
  sanitizePhone,
  isValidUrl,
  sanitizeUrl,
  sanitizeName,
  sanitizeNumber,
  validatePasswordStrength,
  removeControlCharacters,
  truncateText,
  deepSanitize,
};
