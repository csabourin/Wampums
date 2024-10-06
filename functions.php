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
    // loadTranslations() will be called in initializeApp()
}

function userHasAccessToParticipant($pdo, $userId, $participantId) {
    // First, check if the user is a guardian of the participant
    $stmt = $pdo->prepare("
        SELECT 1 
        FROM user_participants 
        WHERE user_id = ? AND participant_id = ?
    ");
    $stmt->execute([$userId, $participantId]);
    if ($stmt->fetchColumn() !== false) {
        return true;
    }

    // If not a guardian, check if the user has the 'animation' or 'admin' role in the same organization as the participant
    $stmt = $pdo->prepare("
      SELECT 1 
FROM user_organizations uo
JOIN participant_organizations po ON uo.organization_id = po.organization_id
WHERE uo.user_id = ? 
  AND po.participant_id = ?
  AND uo.role IN ('animation', 'admin')

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

function getJWTPayload() {
    $headers = getallheaders();
    $token = null;

    if (isset($headers['Authorization'])) {
        $authHeader = $headers['Authorization'];
        $token = str_replace('Bearer ', '', $authHeader);
    }

    if ($token) {
        $tokenParts = explode('.', $token);
        if (count($tokenParts) === 3) {
            $payload = json_decode(base64_decode($tokenParts[1]), true);
            return $payload;
        }
    }

    return null;
}

function determineOrganizationId($pdo, $currentHost) {
    // Prepare the query to match exact and wildcard domains
    $stmt = $pdo->prepare("
        SELECT organization_id 
        FROM organization_domains 
        WHERE domain = :domain
        OR :current_host LIKE REPLACE(domain, '*', '%')
        LIMIT 1
    ");

    // Execute the query
    $stmt->execute([
        ':domain' => $currentHost,
        ':current_host' => $currentHost
    ]);

    $organization = $stmt->fetch(PDO::FETCH_ASSOC);

    // Log the query result for debugging
    error_log("Query result: " . print_r($organization, true));

    // Return the organization_id if found, otherwise null
    return $organization ? $organization['organization_id'] : null;
}

function setCurrentOrganizationId() {
    global $pdo; // Ensure you have access to your PDO instance

    // Retrieve the current domain
    $currentHost = $_SERVER['HTTP_HOST'];

    // Log the current host for debugging
    error_log("Current host: " . $currentHost);

    // Call the pure function to determine the organization ID
    $organizationId = determineOrganizationId($pdo, $currentHost);

    if ($organizationId !== null) {
        // Store in session for future requests
        $_SESSION['current_organization_id'] = $organizationId;
        return $organizationId;
    }

    // If no valid organization ID is found, return the default (1)
    error_log("No matching organization found for domain: " . $currentHost);
    return 1;
}


function getCurrentOrganizationId() {
    // Ensure session is started
    if (session_status() == PHP_SESSION_NONE) {
        session_start();
    }

    // Check if the organization ID is already stored in the session
    if (isset($_SESSION['current_organization_id'])) {
        return $_SESSION['current_organization_id'];
    }

    // If not found in session, use side-effect function to determine and set it
    return setCurrentOrganizationId();
}




// Add more helper functions as needed


// Call this function at the beginning of each PHP file
function initializeApp() {
    ensureSessionStarted();
    setLanguage();
    loadTranslations();
    header("Cache-Control: max-age=3600, public");
}