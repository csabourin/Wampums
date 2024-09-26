<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

header('Content-Type: application/json');

// Load language files
$frTranslationsFile = "lang/fr.php";
$enTranslationsFile = "lang/en.php";

if (!file_exists($frTranslationsFile) || !file_exists($enTranslationsFile)) {
		http_response_code(500);
		echo json_encode(['error' => 'Translation files not found']);
		exit;
}

$frTranslations = include $frTranslationsFile;
$enTranslations = include $enTranslationsFile;

if (!is_array($frTranslations) || !is_array($enTranslations)) {
		http_response_code(500);
		echo json_encode(['error' => 'Invalid translation data']);
		exit;
}

// Combine translations
$translations = [
		'fr' => $frTranslations,
		'en' => $enTranslations
];

// Send JSON-encoded translations
echo json_encode($translations);