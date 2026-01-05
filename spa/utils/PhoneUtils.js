/**
 * Phone Number Utilities
 *
 * Utilities for formatting and handling phone numbers
 */

/**
 * Format a phone number to xxx-xxx-xxxx format
 * Strips non-numeric characters and formats as xxx-xxx-xxxx
 *
 * @param {string} phoneNumber - Raw phone number string
 * @returns {string} Formatted phone number or original if invalid
 */
export function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return '';
  }

  // Remove all non-numeric characters
  const cleaned = phoneNumber.toString().replace(/\D/g, '');

  // Format as xxx-xxx-xxxx for 10-digit numbers
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }

  // Format as x-xxx-xxx-xxxx for 11-digit numbers (with country code)
  if (cleaned.length === 11) {
    return `${cleaned.slice(0, 1)}-${cleaned.slice(1, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }

  // If not a standard format, return original
  return phoneNumber;
}

/**
 * Create a clickable phone number link with tel: protocol
 *
 * @param {string} phoneNumber - Phone number to link
 * @param {string} label - Optional label for the link (defaults to formatted number)
 * @returns {string} HTML string with clickable tel: link
 */
export function createPhoneLink(phoneNumber, label = null) {
  if (!phoneNumber) {
    return '';
  }

  const formatted = formatPhoneNumber(phoneNumber);
  const displayText = label || formatted;

  // Remove all non-numeric characters for the tel: link
  const cleaned = phoneNumber.toString().replace(/\D/g, '');

  return `<a href="tel:${cleaned}" class="phone-link">${displayText}</a>`;
}

/**
 * Get the cleaned phone number (digits only) for tel: protocol
 *
 * @param {string} phoneNumber - Phone number to clean
 * @returns {string} Digits only
 */
export function getCleanedPhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return '';
  }

  return phoneNumber.toString().replace(/\D/g, '');
}
