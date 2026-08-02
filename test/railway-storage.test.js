const {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  OUTPUT_MIME_TYPE,
  extractPathFromUrl,
  generateFilePath,
  getStorageConfig,
  isStorageConfigured,
  validateFile,
} = require("../utils/railway-storage");

const STORAGE_ENV_KEYS = [
  "AWS_ENDPOINT_URL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_S3_BUCKET_NAME",
  "AWS_DEFAULT_REGION",
  "AWS_S3_URL_STYLE",
  "ENDPOINT",
  "ACCESS_KEY_ID",
  "SECRET_ACCESS_KEY",
  "BUCKET",
  "REGION",
];

describe("railway-storage utilities", () => {
  const originalEnvironment = {};

  beforeAll(() => {
    STORAGE_ENV_KEYS.forEach((key) => {
      originalEnvironment[key] = process.env[key];
    });
  });

  beforeEach(() => {
    STORAGE_ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    STORAGE_ENV_KEYS.forEach((key) => {
      if (originalEnvironment[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnvironment[key];
      }
    });
  });

  test("generateFilePath uses the processed upload extension", () => {
    const filePath = generateFilePath(3, 9, "test-photo.png", "webp");
    expect(filePath).toMatch(/^org_3\/equipment_9_\d+\.webp$/);
  });

  test("generateFilePath falls back to the original extension", () => {
    const filePath = generateFilePath(5, null, "Sample.JPG");
    expect(filePath).toMatch(/^org_5\/equipment_new_\d+\.jpg$/);
  });

  test("extractPathFromUrl accepts stable object keys", () => {
    expect(extractPathFromUrl("org_3/equipment_9_123.webp")).toBe(
      "org_3/equipment_9_123.webp",
    );
  });

  test("extractPathFromUrl migrates legacy Supabase public URLs", () => {
    expect(
      extractPathFromUrl(
        "https://old.supabase.co/storage/v1/object/public/inventory/org_3/equipment_9_123.webp",
      ),
    ).toBe("org_3/equipment_9_123.webp");
  });

  test("extractPathFromUrl recognizes Railway virtual-hosted URLs", () => {
    process.env.AWS_ENDPOINT_URL = "https://storage.railway.app";
    process.env.AWS_S3_BUCKET_NAME = "wampums-files-abc123";

    expect(
      extractPathFromUrl(
        "https://wampums-files-abc123.storage.railway.app/org_3/equipment.webp?X-Amz-Signature=test",
      ),
    ).toBe("org_3/equipment.webp");
  });

  test("getStorageConfig supports Railway direct variable references", () => {
    process.env.ENDPOINT = "https://storage.railway.app";
    process.env.ACCESS_KEY_ID = "access";
    process.env.SECRET_ACCESS_KEY = "secret";
    process.env.BUCKET = "wampums-files-abc123";
    process.env.REGION = "auto";

    const config = getStorageConfig();
    expect(config).toMatchObject({
      endpoint: "https://storage.railway.app",
      accessKeyId: "access",
      secretAccessKey: "secret",
      bucket: "wampums-files-abc123",
      region: "auto",
      forcePathStyle: false,
    });
    expect(isStorageConfigured(config)).toBe(true);
  });

  test("validateFile rejects files that exceed the maximum size", () => {
    const oversizedFile = {
      size: MAX_FILE_SIZE + 1,
      mimetype: OUTPUT_MIME_TYPE,
    };
    const validation = validateFile(oversizedFile);
    expect(validation.isValid).toBe(false);
    expect(validation.error).toMatch(/File size exceeds/);
  });

  test("validateFile accepts allowed MIME types within size limits", () => {
    const validFile = { size: 1024, mimetype: ALLOWED_MIME_TYPES[0] };
    expect(validateFile(validFile).isValid).toBe(true);
  });

  test("validateFile accepts HEIC input", () => {
    const heicFile = { size: 1024, mimetype: "image/heic" };
    expect(validateFile(heicFile).isValid).toBe(true);
  });
});
