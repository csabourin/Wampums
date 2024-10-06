<?php
// jwt_auth.php
require_once 'vendor/autoload.php';
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

// Use Replit's environment variables for secrets
define('JWT_SECRET', getenv('JWT_SECRET')); // Set this in Replit's Secrets tab
define('JWT_ALGORITHM', 'HS256');

// Supabase connection (you'll need to set these environment variables in Replit)
$supabase_url = getenv('SUPABASE_URL');
$supabase_key = getenv('SUPABASE_KEY');

function getSecretKey() {
    $secret = getenv('JWT_SECRET');
    if (!$secret) {
        error_log('JWT_SECRET not set in environment variables');
        return null;
    }
    return $secret;
}

function generateJWT($userId, $userRole) {
    try {
        $issuedAt = time();
        $expirationTime = $issuedAt + (365 * 24 * 60 * 60); // 1 year in seconds
        $payload = [
            'iss' => 'wampum_app',
            'aud' => 'wampum_app_users',
            'iat' => $issuedAt,
            'exp' => $expirationTime,
            'user_id' => $userId,
            'user_role' => $userRole
        ];
        error_log("JWT Payload: " . json_encode($payload));
        $token = JWT::encode($payload, getSecretKey(), JWT_ALGORITHM);
        error_log("Generated JWT: " . $token);
        return $token;
    } catch (Exception $e) {
        error_log("Error generating JWT: " . $e->getMessage());
        return null;
    }
}

function verifyJWT($token) {
    // error_log("Verifying JWT: " . $token);
    if ($token === null) {
        error_log('Null token provided to verifyJWT');
        return false;
    }
    try {
        $decoded = JWT::decode($token, new Key(getSecretKey(), JWT_ALGORITHM));
        error_log("Decoded JWT: " . json_encode($decoded));
        return true;
    } catch (Exception $e) {
        error_log('JWT verification failed: ' . $e->getMessage());
        return false;
    }
}


function getUserIdFromToken($token) {
    if (!$token) {
        error_log('No token provided to getUserIdFromToken');
        return null;
    }
    try {
        $decoded = JWT::decode($token, new Key(getSecretKey(), JWT_ALGORITHM));
        return $decoded->user_id;
    } catch (Exception $e) {
        error_log('Error decoding token: ' . $e->getMessage());
        return null;
    }
}

function validateJWT($token) {
    try {
        return (array) JWT::decode($token, new Key(getSecretKey(), JWT_ALGORITHM));
    } catch (Exception $e) {
        error_log('JWT validation failed: ' . $e->getMessage());
        return false;
    }
}

function getJWTFromHeader() {
    $headers = getallheaders();
    if (isset($headers['Authorization'])) {
        if (preg_match('/Bearer\s(\S+)/', $headers['Authorization'], $matches)) {
            return $matches[1];
        }
    }
    return null;
}

function requireAuth($allowedRoles = ['parent', 'animation', 'admin']) {
    $token = getJWTFromHeader();
    if (!$token) {
        http_response_code(401);
        echo json_encode(['error' => 'No token provided']);
        exit;
    }
    $payload = validateJWT($token);
    if (!$payload) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid token']);
        exit;
    }
    if (!in_array($payload['user_role'], $allowedRoles)) {
        http_response_code(403);
        echo json_encode(['error' => 'Insufficient permissions']);
        exit;
    }
    return $payload;
}

function hasAccessToParticipant($userId, $participantId) {
    global $supabase_url, $supabase_key;
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $supabase_url . '/rest/v1/user_participants?user_id=eq.' . $userId . '&participant_id=eq.' . $participantId);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'apikey: ' . $supabase_key,
        'Authorization: Bearer ' . $supabase_key
    ]);
    $response = curl_exec($ch);
    curl_close($ch);
    $result = json_decode($response, true);
    return !empty($result);
}
