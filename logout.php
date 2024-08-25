<?php
// Start output buffering
ob_start();

require_once 'config.php';
require_once 'functions.php';
initializeApp();

// Unset all of the session variables
$_SESSION = array();

// If it's desired to kill the session, also delete the session cookie
if (ini_get("session.use_cookies")) {
    $params = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000,
        $params["path"], $params["domain"],
        $params["secure"], $params["httponly"]
    );
}

// Destroy the session
session_destroy();

// Clear the output buffer and disable output buffering
ob_end_clean();

// Ensure no output has been sent before this point
if (!headers_sent()) {
    // Redirect to login page
    header('Location: login.php');
    exit;
} else {
    // If headers have already been sent, use JavaScript to redirect
    echo '<script type="text/javascript">';
    echo 'window.location.href="login.php";';
    echo '</script>';
    echo '<noscript>';
    echo '<meta http-equiv="refresh" content="0;url=login.php">';
    echo '</noscript>';
    exit;
}