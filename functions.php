<?php

$translations = [];

function ensureSessionStarted() {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

function translate($key) {
    global $translations;
    return $translations[$key] ?? $key;
}

function setLanguage() {
    $lang = $_COOKIE['lang'] ?? 'fr';
    // We don't need to call loadLanguage() here anymore
    // as loadTranslations() will be called in initializeApp()
}

function userHasAccessToParticipant($pdo, $userId, $participantId) {
    $stmt = $pdo->prepare("
        SELECT 1 
        FROM user_participants 
        WHERE user_id = ? AND participant_id = ?
    ");
    $stmt->execute([$userId, $participantId]);
    return $stmt->fetchColumn() !== false;
}

function calculateAge($dateOfBirth) {
    // Convert the date of birth to a DateTime object
    $dob = new DateTime($dateOfBirth);
    // Get the current date
    $today = new DateTime('today');
    // Calculate the difference between the current date and the date of birth
    $age = $dob->diff($today)->y;
    return $age;
}


function sanitizeInput($input) {
    return htmlspecialchars(strip_tags(trim($input)));
}

function isLoggedIn() {
    return isset($_SESSION['user_id']);
}

// Add this function to send emails using SendGrid
    function sendResetEmail($to, $subject, $message) {
            require 'vendor/autoload.php'; // Make sure you have the SendGrid PHP library installed
            $email = new \SendGrid\Mail\Mail();
            $email->setFrom("noreply@meute6a.app", "Meute 6A");
            $email->setSubject($subject);
            $email->addTo($to);
            $email->addContent("text/plain", $message);

            // Read the API key from the environment variable
            $sendgridApiKey = getenv('SENDGRID_API_KEY');

            if (!$sendgridApiKey) {
                    error_log('SendGrid API key not found in environment variables');
                    return false;
            }

            $sendgrid = new \SendGrid($sendgridApiKey);
            try {
                    $response = $sendgrid->send($email);
                    return $response->statusCode() == 202;
            } catch (Exception $e) {
                    error_log('Caught exception: '. $e->getMessage() ."\n");
                    return false;
            }
    }

function requireLogin() {
    if (session_status() == PHP_SESSION_NONE) {
        session_start();
    }

    if (!isset($_SESSION['user_id'])) {
        if (isset($_SERVER['HTTP_X_REQUESTED_WITH']) && $_SERVER['HTTP_X_REQUESTED_WITH'] === 'XMLHttpRequest') {
            // Respond with a JSON error message instead of redirecting
            header('Content-Type: application/json');
            echo json_encode(['success' => false, 'message' => 'User not logged in']);
            exit();
        } else {
            header('Location: login.php');
            exit();
        }
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

function loadTranslations() {
    global $translations;
    $lang = $_COOKIE['lang'] ?? 'fr';
    $langFile = __DIR__ . "/lang/{$lang}.php";
    if (file_exists($langFile)) {
        $translations = include $langFile;
    } else {
        // Fallback to French if the requested language file doesn't exist
        $translations = include __DIR__ . "/lang/fr.php";
    }
}


// Add more helper functions as needed


// Call this function at the beginning of each PHP file
function initializeApp() {
    ensureSessionStarted();
    setLanguage();
    loadTranslations();
    header("Cache-Control: max-age=3600, public");
}