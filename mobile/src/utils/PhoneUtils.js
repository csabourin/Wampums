/**
 * Phone Number Utilities
 *
 * Utilities for formatting and handling phone numbers in React Native
 */

/**
 * Format a phone number to xxx-xxx-xxxx format
 * Strips non-numeric characters and formats as xxx-xxx-xxxx
 *
 * @param {string} phoneNumber - Raw phone number string
 * @returns {string} Formatted phone number or original if invalid
 */
export const formatPhoneNumber = (phoneNumber) => {
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
};

/**
 * Get the cleaned phone number (digits only) for tel: protocol
 *
 * @param {string} phoneNumber - Phone number to clean
 * @returns {string} Digits only
 */
export const getCleanedPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) {
    return '';
  }

  return phoneNumber.toString().replace(/\D/g, '');
};

/**
 * Create a tel: URI for use with Linking.openURL
 *
 * @param {string} phoneNumber - Phone number to link
 * @returns {string} tel: URI
 */
export const createTelUri = (phoneNumber) => {
  if (!phoneNumber) {
    return '';
  }

  const cleaned = getCleanedPhoneNumber(phoneNumber);
  return `tel:${cleaned}`;
};

export default {
  formatPhoneNumber,
  getCleanedPhoneNumber,
  createTelUri,
};
