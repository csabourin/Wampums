<?php
require __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();
require 'functions.php';
date_default_timezone_set('America/Toronto');
// Account creation password

// Database connection function
function getDbConnection() {
    if (!isset($_ENV['SB_URL'])) {
        die("Error: SB_URL environment variable not set.");
    }

    $dbUrl = parse_url($_ENV['SB_URL']);

    if (!$dbUrl) {
        die("Error: Unable to parse DATABASE_URL.");
    }

    $dbName = ltrim($dbUrl['path'], '/');
    $host = $dbUrl['host'] ?? 'localhost';
    $port = $dbUrl['port'] ?? '5432';
    $user = $dbUrl['user'] ?? 'user';
    $pass = $dbUrl['pass'] ?? '';

    try {
        $pdo = new PDO("pgsql:host=$host;port=$port;dbname=$dbName;user=$user;password=$pass");
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        return $pdo;
    } catch (PDOException $e) {
        die("Database connection failed: " . $e->getMessage());
    }
}


// Initialize database
try {
    $pdo = getDbConnection();
} catch (PDOException $e) {
    die("Database error: " . $e->getMessage());
}

// Get the current organization ID
$organizationId = getCurrentOrganizationId();

// Fetch organization settings
$stmt = $pdo->prepare("
    SELECT setting_value
    FROM organization_settings
    WHERE organization_id = ? AND setting_key = 'organization_info'
");
$stmt->execute([$organizationId]);
$settingsJson = $stmt->fetchColumn();

if ($settingsJson) {
    $settings = json_decode($settingsJson, true);
    // Get the default language from settings, fallback to 'fr' if not set
    $defaultLang = $settings['default_language'] ?? 'fr';
} else {
    // Fallback to 'fr' if no settings found
    $defaultLang = 'fr';
}

// Define the DEFAULT_LANG constant
define('DEFAULT_LANG', $defaultLang);

// Set language
$lang = $_SESSION['lang'] ?? DEFAULT_LANG;
require_once "lang/{$lang}.php";