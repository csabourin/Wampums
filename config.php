<?php
require 'functions.php';
date_default_timezone_set('America/Toronto');
// Account creation password
define('ACCOUNT_CREATION_PASSWORD', $_ENV['ACCOUNT_CREATION_PASSWORD']);


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

// Create tables
function createTables($pdo) {
    $queries = [
        // Users table
        "CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            is_verified BOOLEAN DEFAULT FALSE,
            verification_token VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )"
    ];

    foreach ($queries as $query) {
        $pdo->exec($query);
    }
}

// Initialize database
try {
    $pdo = getDbConnection();
    createTables($pdo);
} catch (PDOException $e) {
    die("Database error: " . $e->getMessage());
}

// Other configuration constants
define('SITE_URL', 'https://meute6a.app'); // Change this to your actual site URL
define('DEFAULT_LANG', 'fr');

// Set language
$lang = $_SESSION['lang'] ?? DEFAULT_LANG;
require_once "lang/{$lang}.php";