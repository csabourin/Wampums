<?php
// get-organization-jwt.php

require_once 'config.php';
require_once 'functions.php';
require_once 'jwt_auth.php';

header('Content-Type: application/json');

// Get the organization ID from the request or use the current one
$organizationId = isset($_GET['organization_id']) ? intval($_GET['organization_id']) : getCurrentOrganizationId();

if (!$organizationId) {
		echo json_encode([
				'success' => false,
				'message' => 'Organization ID is required'
		]);
		exit;
}

// Generate JWT with organization ID only (no user information)
$token = generateJWT(null, null, $organizationId);

if ($token) {
		// Store in session for future use
		$_SESSION['orgJwtToken'] = $token;

		echo json_encode([
				'success' => true,
				'token' => $token,
				'organizationId' => $organizationId
		]);
} else {
		echo json_encode([
				'success' => false,
				'message' => 'Failed to generate JWT token'
		]);
}