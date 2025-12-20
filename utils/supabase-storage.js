/**
 * Supabase Storage utility for equipment inventory photos
 * Handles file uploads to Supabase Storage with size validation
 */
const { createClient } = require("@supabase/supabase-js");

// Maximum file size: 3MB
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const OUTPUT_MIME_TYPE = "image/webp";

// Allowed MIME types for images
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/heic",
  "image/heif",
  OUTPUT_MIME_TYPE,
];

// Initialize Supabase client (lazy initialization)
let supabaseClient = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    let supabaseUrl = process.env.SUPABASE_URL;
    // Prioritize SUPABASE_SERVICE_KEY (more likely to be a JWT) over SUPABASE_STORAGE_SECRET_KEY
    // SUPABASE_STORAGE_SECRET_KEY might be an S3 secret access key, not a JWT
    let supabaseSecretKey =
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_STORAGE_SECRET_KEY;

    if (!supabaseUrl || !supabaseSecretKey) {
      throw new Error(
        "Supabase configuration missing. Set SUPABASE_URL and SUPABASE_STORAGE_SECRET_KEY (or SUPABASE_SERVICE_KEY) environment variables.",
      );
    }

    // Trim whitespace from the key (common issue)
    supabaseSecretKey = supabaseSecretKey.trim();

    // Convert S3 endpoint URL to base Supabase URL if needed
    // e.g., https://xxx.storage.supabase.co/storage/v1/s3 -> https://xxx.supabase.co
    if (supabaseUrl.includes(".storage.supabase.co")) {
      const match = supabaseUrl.match(
        /https:\/\/([^.]+)\.storage\.supabase\.co/,
      );
      if (match) {
        supabaseUrl = `https://${match[1]}.supabase.co`;
        console.log(
          `[Supabase Storage] Converted S3 endpoint to base URL: ${supabaseUrl}`,
        );
      }
    }

    // Validate that the secret key looks like a JWT (should have 3 parts separated by dots)
    const keyParts = supabaseSecretKey.split(".");
    if (keyParts.length !== 3) {
      console.error(
        `[Supabase Storage] Invalid service key format. Expected JWT with 3 parts, got ${keyParts.length} parts.`,
      );
      console.error(
        `[Supabase Storage] Key preview: ${supabaseSecretKey.substring(0, 50)}...`,
      );
      throw new Error(
        "SUPABASE_STORAGE_SECRET_KEY or SUPABASE_SERVICE_KEY must be a valid JWT (service_role key). " +
          "It should look like: eyJhbGciOiJ... (3 parts separated by dots)",
      );
    }

    // Decode the JWT payload to check the role
    try {
      const payload = JSON.parse(Buffer.from(keyParts[1], "base64").toString());
      const role = payload.role;

      console.log(
        `[Supabase Storage] Initializing client with URL: ${supabaseUrl}`,
      );
      console.log(
        `[Supabase Storage] Service key preview: ${supabaseSecretKey.substring(0, 50)}... (${keyParts.length} parts)`,
      );
      console.log(`[Supabase Storage] Detected JWT role: ${role}`);

      if (role === "anon") {
        console.error(
          `[Supabase Storage] ERROR: Using 'anon' key instead of 'service_role' key!`,
        );
        throw new Error(
          "SUPABASE_SERVICE_KEY must be the 'service_role' key, not the 'anon' key. " +
            "The anon key is public and cannot upload files. " +
            "Find the service_role key in Supabase: Project Settings > API > service_role key (secret)",
        );
      }

      if (role !== "service_role") {
        console.warn(
          `[Supabase Storage] WARNING: Expected role 'service_role' but got '${role}'. This may cause permission issues.`,
        );
      }
    } catch (decodeError) {
      console.warn(
        `[Supabase Storage] Could not decode JWT to verify role:`,
        decodeError.message,
      );
    }

    // Use the storage-specific secret key to authenticate S3-compatible storage operations
    supabaseClient = createClient(supabaseUrl, supabaseSecretKey);
  }
  return supabaseClient;
}

/**
 * Get the storage bucket name from environment or default
 */
function getBucketName() {
  return process.env.SUPABASE_STORAGE_BUCKET || null;
}

/**
 * Validate file before upload
 * @param {Object} file - Multer file object
 * @returns {Object} Validation result with isValid and error message
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

  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return {
      isValid: false,
      error: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
    };
  }

  return { isValid: true };
}

/**
 * Generate unique file path for equipment photo
 * @param {number} organizationId - Organization ID
 * @param {number} equipmentId - Equipment ID (optional for new items)
 * @param {string} originalFilename - Original filename
 * @param {string} [targetExtension] - Optional extension (without dot) for the stored file
 * @returns {string} File path in storage
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
  const extension = normalizedExtension || "webp";
  const sanitizedFilename = `equipment_${equipmentId || "new"}_${timestamp}.${extension}`;
  return `org_${organizationId}/${sanitizedFilename}`;
}

/**
 * Upload file to Supabase Storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} filePath - Path in storage bucket
 * @param {string} contentType - MIME type
 * @returns {Object} Upload result with url or error
 */
async function uploadFile(fileBuffer, filePath, contentType) {
  try {
    const supabase = getSupabaseClient();
    const bucket = getBucketName();

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        contentType,
        cacheControl: "3600",
        upsert: true,
      });

    if (error) {
      console.error("Supabase upload error:", error);
      return { success: false, error: error.message };
    }

    // Get public URL for the uploaded file
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return {
      success: true,
      path: data.path,
      url: urlData.publicUrl,
    };
  } catch (err) {
    console.error("Upload error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete file from Supabase Storage
 * @param {string} filePath - Path in storage bucket
 * @returns {Object} Delete result
 */
async function deleteFile(filePath) {
  try {
    const supabase = getSupabaseClient();
    const bucket = getBucketName();

    const { error } = await supabase.storage.from(bucket).remove([filePath]);

    if (error) {
      console.error("Supabase delete error:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Delete error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Extract file path from public URL
 * @param {string} publicUrl - Public URL of the file
 * @returns {string|null} File path or null if not parseable
 */
function extractPathFromUrl(publicUrl) {
  if (!publicUrl) return null;

  try {
    const bucket = getBucketName();
    // URL format: https://xxx.supabase.co/storage/v1/object/public/bucket/path
    const regex = new RegExp(`/storage/v1/object/public/${bucket}/(.+)$`);
    const match = publicUrl.match(regex);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if Supabase Storage is configured
 * @returns {boolean}
 */
function isStorageConfigured() {
  return !!(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_STORAGE_SECRET_KEY) &&
    process.env.SUPABASE_STORAGE_BUCKET
  );
}

module.exports = {
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
  OUTPUT_MIME_TYPE,
  validateFile,
  generateFilePath,
  uploadFile,
  deleteFile,
  extractPathFromUrl,
  isStorageConfigured,
};
