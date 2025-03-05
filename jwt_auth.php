<?php
// jwt_auth.php - Update your existing file with these modifications

require_once 'vendor/autoload.php';
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

// JWT configuration - use your existing API key or secret
$jwtKey = getenv('JWT_SECRET_KEY') ?: $apiKey; // Use your existing API key as fallback
$jwtAlg = 'HS256';
$jwtIssuer = 'wampums-app';
$jwtAudience = 'wampums-api';
$jwtExpiryDefault = 3600; // 1 hour default expiry

/**
 * Generate a JWT token with organization ID and optional user information
 * 
 * @param string|int|null $userId User ID (optional)
 * @param string|null $userRole User role (optional)
 * @param string|int|null $organizationId Organization ID (optional, defaults to current)
 * @param int|null $expiry Token expiry in seconds (default: 1 hour)
 * @return string|null Generated JWT token or null on failure
 */
function generateJWT($userId = null, $userRole = null, $organizationId = null, $expiry = null) {
    global $jwtKey, $jwtAlg, $jwtIssuer, $jwtAudience, $jwtExpiryDefault;

    // Get organization ID if not provided
    if ($organizationId === null) {
        $organizationId = getCurrentOrganizationId();
    }

    // Set up payload
    $issuedAt = time();
    $expiry = $expiry ?: ($jwtExpiryDefault + $issuedAt);

    $payload = [
        'iss' => $jwtIssuer,
        'aud' => $jwtAudience,
        'iat' => $issuedAt,
        'exp' => $expiry,
        'organizationId' => $organizationId
    ];

    // Add user information if provided
    if ($userId !== null) {
        $payload['user_id'] = $userId;
    }

    if ($userRole !== null) {
        $payload['user_role'] = $userRole;
    }

    try {
        // Generate the JWT token
        return JWT::encode($payload, $jwtKey, $jwtAlg);
    } catch (Exception $e) {
        error_log('Error generating JWT: ' . $e->getMessage());
        return null;
    }
}

/**
 * Verify a JWT token
 * 
 * @param string $token JWT token to verify
 * @return array|false Decoded payload on success, false on failure
 */
function verifyJWT($token) {
    global $jwtKey, $jwtAlg;

    if (empty($token)) {
        return false;
    }

    try {
        $decoded = JWT::decode($token, new Key($jwtKey, $jwtAlg));
        return (array) $decoded;
    } catch (Exception $e) {
        error_log('JWT verification failed: ' . $e->getMessage());
        return false;
    }
}

/**
 * Get user ID from JWT token
 * 
 * @param string $token JWT token
 * @return string|int|null User ID or null if not found
 */
function getUserIdFromToken($token) {
    $payload = verifyJWT($token);
    return $payload ? ($payload['user_id'] ?? null) : null;
}

/**
 * Get user role from JWT token
 * 
 * @param string $token JWT token
 * @return string|null User role or null if not found
 */
function getUserRoleFromToken($token) {
    $payload = verifyJWT($token);
    return $payload ? ($payload['user_role'] ?? null) : null;
}

/**
 * Get organization ID from JWT token
 * 
 * @param string $token JWT token
 * @return string|int|null Organization ID or null if not found
 */
function getOrganizationIdFromToken($token) {
    $payload = verifyJWT($token);
    return $payload ? ($payload['organizationId'] ?? null) : null;
}

/**
 * Extract JWT token from request headers
 * 
 * @return string|null JWT token or null if not found
 */
function getJWTFromHeader() {
    $headers = getallheaders();

    if (isset($headers['Authorization'])) {
        $authHeader = $headers['Authorization'];
        return str_replace('Bearer ', '', $authHeader);
    }

    return null;
}

/**
 * Get token from various sources
 * 
 * @return string|null JWT token or null if not found
 */
function getBearerToken() {
    // Check header first
    $token = getJWTFromHeader();
    if ($token) {
        return $token;
    }

    // Check for token in GET parameters
    if (isset($_GET['token'])) {
        return $_GET['token'];
    }

    // Check for token in POST parameters
    if (isset($_POST['token'])) {
        return $_POST['token'];
    }

    return null;
}

/**
 * Require authentication for an endpoint
 * 
 * @return array User data if authenticated, exits otherwise
 */
function requireAuth() {
    $token = getBearerToken();

    if (!$token || !verifyJWT($token)) {
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Authentication required']);
        exit;
    }

    $userId = getUserIdFromToken($token);

    if (!$userId) {
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'User authentication required']);
        exit;
    }

    return [
        'user_id' => $userId,
        'user_role' => getUserRoleFromToken($token),
        'organization_id' => getOrganizationIdFromToken($token)
    ];
}