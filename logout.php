<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

// Check if a session is active before trying to destroy it
if (session_status() === PHP_SESSION_ACTIVE) {
    // Unset all of the session variables
    $_SESSION = array();

    // If it's desired to kill the session, also delete the session cookie.
    if (ini_get("session.use_cookies")) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params["path"], $params["domain"],
            $params["secure"], $params["httponly"]
        );
    }

    // Finally, destroy the session.
    session_destroy();
}

// Clear any output buffering to prevent headers already sent error
if (ob_get_length()) {
    ob_end_clean();
}

// Redirect to login page
header('Location: login.php');
exit;