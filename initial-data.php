<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

header('Content-Type: application/javascript');

$initialData = [
    'isLoggedIn' => isLoggedIn(),
    'userRole' => $_SESSION['user_role'] ?? null,
    'lang' => $lang
];

echo 'window.initialData = ' . json_encode($initialData) . ';';