const {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  OUTPUT_MIME_TYPE,
  generateFilePath,
  validateFile
} = require('../utils/supabase-storage');

describe('supabase-storage utilities', () => {
  test('generateFilePath uses provided target extension for processed uploads', () => {
    const filePath = generateFilePath(3, 9, 'test-photo.png', 'webp');
    expect(filePath).toMatch(/^org_3\/equipment_9_\d+\.webp$/);
  });

  test('generateFilePath falls back to original extension when not provided', () => {
    const filePath = generateFilePath(5, null, 'Sample.JPG');
    expect(filePath).toMatch(/^org_5\/equipment_new_\d+\.jpg$/);
  });

  test('validateFile rejects files that exceed the maximum size', () => {
    const oversizedFile = { size: MAX_FILE_SIZE + 1, mimetype: OUTPUT_MIME_TYPE };
    const validation = validateFile(oversizedFile);
    expect(validation.isValid).toBe(false);
    expect(validation.error).toMatch(/File size exceeds/);
  });

  test('validateFile accepts allowed mime types within size limits', () => {
    const validFile = { size: 1024, mimetype: ALLOWED_MIME_TYPES[0] };
    const validation = validateFile(validFile);
    expect(validation.isValid).toBe(true);
  });

  test('validateFile accepts HEIC input', () => {
    const heicFile = { size: 1024, mimetype: 'image/heic' };
    const validation = validateFile(heicFile);
    expect(validation.isValid).toBe(true);
  });
});
