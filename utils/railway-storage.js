/**
 * Railway S3-compatible storage utilities for equipment inventory photos.
 *
 * Railway buckets are private, so database rows keep a stable object key while
 * API responses expose short-lived signed URLs for direct browser downloads.
 */
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const sharp = require("sharp");

// Lazy-loaded to avoid adding HEIC conversion overhead when not needed.
let heicConvert = null;

const MAX_FILE_SIZE = 30 * 1024 * 1024;
const OUTPUT_MIME_TYPE = "image/webp";
const PHOTO_MAX_WIDTH = 640;
const PHOTO_MAX_HEIGHT = 480;
const PHOTO_WEBP_QUALITY = 82;
const WEBP_EXTENSION = OUTPUT_MIME_TYPE.split("/")[1];
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
  OUTPUT_MIME_TYPE,
];
const HEIC_MIME_TYPES = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
];
const HEIC_EXTENSIONS = ["heic", "heif"];
const ALLOWED_IMAGE_EXTENSIONS = [
  "jpeg",
  "jpg",
  "png",
  "gif",
  "webp",
  "heic",
  "heif",
];
const GENERIC_MIME_TYPES = [
  "",
  "application/octet-stream",
  "binary/octet-stream",
];

let s3Client = null;
let s3ClientFingerprint = null;

/**
 * Return the first non-empty environment variable from a list of names.
 * Railway supports both direct bucket variables and AWS-compatible aliases.
 * @param {...string} names
 * @returns {string}
 */
function getFirstEnvironmentValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Resolve Railway bucket configuration without exposing credentials.
 * @returns {{endpoint: string, accessKeyId: string, secretAccessKey: string, bucket: string, region: string, forcePathStyle: boolean}}
 */
function getStorageConfig() {
  const urlStyle = getFirstEnvironmentValue(
    "AWS_S3_URL_STYLE",
    "RAILWAY_S3_URL_STYLE",
  ).toLowerCase();

  return {
    endpoint: getFirstEnvironmentValue(
      "AWS_ENDPOINT_URL",
      "ENDPOINT",
      "BUCKET_ENDPOINT",
    ),
    accessKeyId: getFirstEnvironmentValue(
      "AWS_ACCESS_KEY_ID",
      "ACCESS_KEY_ID",
      "BUCKET_ACCESS_KEY_ID",
    ),
    secretAccessKey: getFirstEnvironmentValue(
      "AWS_SECRET_ACCESS_KEY",
      "SECRET_ACCESS_KEY",
      "BUCKET_SECRET_ACCESS_KEY",
    ),
    bucket: getFirstEnvironmentValue(
      "AWS_S3_BUCKET_NAME",
      "BUCKET",
      "BUCKET_NAME",
    ),
    region: getFirstEnvironmentValue(
      "AWS_DEFAULT_REGION",
      "AWS_REGION",
      "REGION",
      "BUCKET_REGION",
    ) || "auto",
    forcePathStyle: urlStyle === "path",
  };
}

/**
 * Build or reuse an S3 client for the current Railway configuration.
 * @returns {S3Client}
 */
function getS3Client() {
  const config = getStorageConfig();
  if (!isStorageConfigured(config)) {
    throw new Error(
      "Railway bucket configuration missing. Connect the bucket to this service and inject its S3 credentials.",
    );
  }

  const fingerprint = JSON.stringify(config);
  if (!s3Client || s3ClientFingerprint !== fingerprint) {
    s3Client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    s3ClientFingerprint = fingerprint;
  }

  return s3Client;
}

/**
 * Validate file before upload.
 * @param {Object} file - Multer file object
 * @returns {{isValid: boolean, error?: string}}
 */
function validateFile(file) {
  if (!file) {
    return { isValid: false, error: "No file provided" };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: `File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`,
    };
  }

  if (!isAllowedImageType(file)) {
    return {
      isValid: false,
      error: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
    };
  }

  return { isValid: true };
}

/**
 * Determine whether an uploaded image file is of an allowed type.
 * @param {Object} file - Multer file object
 * @returns {boolean}
 */
function isAllowedImageType(file) {
  if (!file) return false;

  const mimeType = (file.mimetype || "").toLowerCase().split(";")[0];
  if (ALLOWED_MIME_TYPES.includes(mimeType)) return true;

  const extension = (file.originalname || "").split(".").pop();
  if (!extension) return false;

  return (
    ALLOWED_IMAGE_EXTENSIONS.includes(extension.toLowerCase()) &&
    GENERIC_MIME_TYPES.includes(mimeType)
  );
}

/**
 * Convert an uploaded image buffer to a resized WebP buffer.
 * @param {Buffer} fileBuffer - Raw file buffer from multer
 * @param {Object} options
 * @param {string} [options.mimeType]
 * @param {string} [options.originalFilename]
 * @returns {Promise<Buffer>}
 */
async function convertImageToWebP(fileBuffer, { mimeType, originalFilename }) {
  const normalizedMime = (mimeType || "").toLowerCase().split(";")[0];
  const extension = (originalFilename || "").split(".").pop()?.toLowerCase() || "";
  const shouldTreatAsHeic =
    HEIC_MIME_TYPES.includes(normalizedMime) || HEIC_EXTENSIONS.includes(extension);

  let workingBuffer = fileBuffer;
  if (shouldTreatAsHeic) {
    if (!heicConvert) heicConvert = require("heic-convert");
    workingBuffer = await heicConvert({
      buffer: fileBuffer,
      format: "JPEG",
      quality: 1,
    });
  }

  return sharp(workingBuffer)
    .resize({
      width: PHOTO_MAX_WIDTH,
      height: PHOTO_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: PHOTO_WEBP_QUALITY })
    .toBuffer();
}

/**
 * Generate a unique object key for an equipment photo.
 * @param {number} organizationId
 * @param {number} equipmentId
 * @param {string} originalFilename
 * @param {string} [targetExtension]
 * @returns {string}
 */
function generateFilePath(
  organizationId,
  equipmentId,
  originalFilename,
  targetExtension,
) {
  const timestamp = Date.now();
  const normalizedExtension = (
    targetExtension ||
    (originalFilename?.split(".").pop() ?? "")
  )
    .replace(/^\./, "")
    .toLowerCase();
  const extension = normalizedExtension || WEBP_EXTENSION;
  return `org_${organizationId}/equipment_${equipmentId || "new"}_${timestamp}.${extension}`;
}

/**
 * Upload a file to the Railway bucket.
 * @param {Buffer} fileBuffer
 * @param {string} filePath
 * @param {string} contentType
 * @returns {Promise<{success: boolean, path?: string, error?: string}>}
 */
async function uploadFile(fileBuffer, filePath, contentType) {
  try {
    const config = getStorageConfig();
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: filePath,
        Body: fileBuffer,
        ContentType: contentType,
        CacheControl: `private, max-age=${DEFAULT_SIGNED_URL_TTL_SECONDS}`,
      }),
    );
    return { success: true, path: filePath };
  } catch (err) {
    console.error("Railway storage upload error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete a file from the Railway bucket.
 * @param {string} filePath
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteFile(filePath) {
  try {
    const config = getStorageConfig();
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: filePath }),
    );
    return { success: true };
  } catch (err) {
    console.error("Railway storage delete error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Decode an object key safely after extracting it from a URL.
 * @param {string} value
 * @returns {string|null}
 */
function normalizeObjectKey(value) {
  if (!value) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  const key = decoded.replace(/^\/+/, "");
  if (
    !key ||
    key.split("/").includes("..") ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    return null;
  }
  return key;
}

/**
 * Extract a stable object key from a canonical key, a legacy Supabase public
 * URL, or a Railway S3 URL. This lets migrated objects retain their old paths.
 * @param {string} photoReference
 * @returns {string|null}
 */
function extractPathFromUrl(photoReference) {
  if (typeof photoReference !== "string" || !photoReference.trim()) return null;

  const reference = photoReference.trim();
  if (!reference.includes("://")) return normalizeObjectKey(reference);

  try {
    const parsedUrl = new URL(reference);
    const legacyStorageMarkers = [
      "/storage/v1/object/public/",
      "/storage/v1/object/sign/",
    ];
    for (const marker of legacyStorageMarkers) {
      const markerIndex = parsedUrl.pathname.indexOf(marker);
      if (markerIndex !== -1) {
        const bucketAndKey = parsedUrl.pathname.slice(markerIndex + marker.length);
        const separatorIndex = bucketAndKey.indexOf("/");
        return separatorIndex === -1
          ? null
          : normalizeObjectKey(bucketAndKey.slice(separatorIndex + 1));
      }
    }

    const config = getStorageConfig();
    if (!config.endpoint || !config.bucket) return null;
    const endpointUrl = new URL(config.endpoint);
    const isVirtualHostedUrl =
      parsedUrl.hostname === `${config.bucket}.${endpointUrl.hostname}`;
    if (isVirtualHostedUrl) return normalizeObjectKey(parsedUrl.pathname);

    if (parsedUrl.hostname === endpointUrl.hostname) {
      const path = parsedUrl.pathname.replace(/^\/+/, "");
      const bucketPrefix = `${config.bucket}/`;
      return normalizeObjectKey(
        path.startsWith(bucketPrefix) ? path.slice(bucketPrefix.length) : path,
      );
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Read the organization identifier embedded in an equipment photo key.
 * References that are not managed equipment photos deliberately return null.
 * @param {string} photoReference
 * @returns {number|null}
 */
function getPhotoOrganizationId(photoReference) {
  const filePath = extractPathFromUrl(photoReference);
  if (!filePath) return null;

  const pathParts = filePath.split("/");
  const organizationMatch = /^org_(\d+)$/.exec(pathParts[0]);
  if (
    pathParts.length !== 2 ||
    !organizationMatch ||
    !pathParts[1].startsWith("equipment_")
  ) {
    return null;
  }

  const organizationId = Number.parseInt(organizationMatch[1], 10);
  return Number.isSafeInteger(organizationId) ? organizationId : null;
}

/**
 * Confirm that a managed equipment photo belongs to the expected tenant.
 * @param {string} photoReference
 * @param {number|string} organizationId
 * @returns {boolean}
 */
function isPhotoReferenceOwnedByOrganization(photoReference, organizationId) {
  const photoOrganizationId = getPhotoOrganizationId(photoReference);
  const expectedOrganizationId = Number(organizationId);
  return (
    photoOrganizationId !== null &&
    Number.isSafeInteger(expectedOrganizationId) &&
    photoOrganizationId === expectedOrganizationId
  );
}

/**
 * Generate a temporary browser-readable URL for a stored photo reference.
 * @param {string} photoReference
 * @param {number|string} organizationId - Organization that owns the equipment.
 * @returns {Promise<string|null>}
 */
async function getSignedPhotoUrl(photoReference, organizationId) {
  const filePath = extractPathFromUrl(photoReference);
  if (!filePath) return photoReference || null;

  const pathParts = filePath.split("/");
  const isEquipmentPhotoKey =
    pathParts.length === 2 &&
    /^org_\d+$/.test(pathParts[0]) &&
    pathParts[1].startsWith("equipment_");

  if (!isEquipmentPhotoKey) {
    const isUrlReference =
      typeof photoReference === "string" && photoReference.trim().includes("://");
    return isUrlReference ? photoReference : null;
  }

  // Never use bucket-wide credentials for a key outside the equipment owner's
  // tenant prefix. A missing owner is treated as unauthorized as well.
  if (!isPhotoReferenceOwnedByOrganization(filePath, organizationId)) {
    return null;
  }

  if (!isStorageConfigured()) return photoReference || null;

  const rawTtl = Number.parseInt(
    process.env.RAILWAY_S3_SIGNED_URL_TTL_SECONDS,
    10,
  );
  const expiresIn = Number.isInteger(rawTtl)
    ? Math.min(Math.max(rawTtl, 60), MAX_SIGNED_URL_TTL_SECONDS)
    : DEFAULT_SIGNED_URL_TTL_SECONDS;
  const config = getStorageConfig();

  try {
    return await getSignedUrl(
      getS3Client(),
      new GetObjectCommand({ Bucket: config.bucket, Key: filePath }),
      { expiresIn },
    );
  } catch (err) {
    console.error("Railway storage URL signing error:", err.message);
    return photoReference || null;
  }
}

/**
 * Check whether all required Railway S3 settings are present.
 * @param {ReturnType<typeof getStorageConfig>} [config]
 * @returns {boolean}
 */
function isStorageConfigured(config = getStorageConfig()) {
  return Boolean(
    config.endpoint &&
      config.accessKeyId &&
      config.secretAccessKey &&
      config.bucket &&
      config.region,
  );
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  OUTPUT_MIME_TYPE,
  PHOTO_MAX_HEIGHT,
  PHOTO_MAX_WIDTH,
  PHOTO_WEBP_QUALITY,
  WEBP_EXTENSION,
  convertImageToWebP,
  deleteFile,
  extractPathFromUrl,
  generateFilePath,
  getPhotoOrganizationId,
  getSignedPhotoUrl,
  getStorageConfig,
  isAllowedImageType,
  isPhotoReferenceOwnedByOrganization,
  isStorageConfigured,
  uploadFile,
  validateFile,
};
