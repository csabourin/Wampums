<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

header('Content-Type: application/javascript');

// Use the current language, defaulting to French
$lang = $_SESSION['lang'] ?? 'fr';

// Load the appropriate language file
$translations = include "lang/{$lang}.php";

// Create a JavaScript object with our translations
echo "const translations = " . json_encode($translations) . ";";