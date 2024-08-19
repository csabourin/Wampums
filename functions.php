<?php

function ensureSessionStarted() {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}



function sanitizeInput($input) {
    return htmlspecialchars(strip_tags(trim($input)));
}

function isLoggedIn() {
    return isset($_SESSION['user_id']);
}

function requireLogin() {
    if (!isLoggedIn()) {
        header('Location: login.php');
        exit();
    }
}

function loadLanguage($lang) {
    global $translations;
    $langFile = __DIR__ . "/lang/{$lang}.php";
    if (file_exists($langFile)) {
        $translations = include $langFile;
    } else {
        // Fallback to English if the requested language file doesn't exist
        $translations = include __DIR__ . "/lang/en.php";
    }
}

function translate($key) {
    global $translations;
    return $translations[$key] ?? $key;
}

// Add more helper functions as needed

function setLanguage() {
    $lang = $_COOKIE['lang'] ?? 'fr';
    loadLanguage($lang);
}

// Call this function at the beginning of each PHP file
function initializeApp() {
    ensureSessionStarted();
    setLanguage();
}