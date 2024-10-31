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

function sendAdminVerificationEmail($organizationId, $animatorName, $animatorEmail) {
    global $pdo;

    // Fetch admin emails for the organization
    $stmt = $pdo->prepare("
        SELECT u.email
        FROM users u
        JOIN user_organizations uo ON u.id = uo.user_id
        WHERE uo.organization_id = ? AND uo.role = 'admin'
    ");
    $stmt->execute([$organizationId]);
    $adminEmails = $stmt->fetchAll(PDO::FETCH_COLUMN);

    if (empty($adminEmails)) {
        error_log("No admin emails found for organization ID: $organizationId");
        return;
    }

    // Fetch organization name
    $stmt = $pdo->prepare("
        SELECT setting_value->>'name' as org_name
        FROM organization_settings
        WHERE organization_id = ? AND setting_key = 'organization_info'
    ");
    $stmt->execute([$organizationId]);
    $orgName = $stmt->fetchColumn() ?: 'Wampums.app';

        $subject = str_replace('{orgName}', $orgName, translate('new_animator_registration_subject'));
        $message = str_replace(
            ['{orgName}', '{animatorName}', '{animatorEmail}'],
            [$orgName, $animatorName, $animatorEmail],
            translate('new_animator_registration_body')
        );

        foreach ($adminEmails as $adminEmail) {
            $result = sendEmail($adminEmail, $subject, $message);
            if (!$result) {
                error_log("Failed to send admin verification email to: $adminEmail");
            }
        }
    }

function sendEmail($to, $subject, $message) {
    require 'vendor/autoload.php'; // Make sure you have the SendGrid PHP library installed
    $email = new \SendGrid\Mail\Mail();
    $email->setFrom("noreply@wampums.app", "Wampums.app");
    $email->setSubject($subject);
    $email->addTo($to);
    $email->addContent("text/plain", $message);

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


// Add this function to send emails using SendGrid
    function sendResetEmail($to, $subject, $message) {
            require 'vendor/autoload.php'; // Make sure you have the SendGrid PHP library installed
            $email = new \SendGrid\Mail\Mail();
            $email->setFrom("noreply@wampums.app", "Wampums App");
            $email->setSubject($subject);
            $email->addTo($to);
            $email->addContent("text/plain", $message);

            // Read the API key from the environment variable
            $sendgridApiKey = getenv('WAMPUMS_SENDGRID');

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
    $stmt = $pdo->prepare("
        SELECT organization_id 
        FROM organization_domains 
        WHERE domain = :domain
        OR :current_host LIKE REPLACE(domain, '*', '%')
        LIMIT 1
    ");
    $stmt->execute([
        ':domain' => $currentHost,
        ':current_host' => $currentHost
    ]);
    return $stmt->fetchColumn();
}


function getCurrentOrganizationId() {
if (isset($_SESSION['current_organization_id'])) {
    return $_SESSION['current_organization_id'];
}

$currentHost = $_SERVER['HTTP_HOST'];
$pdo = getDbConnection();
$organizationId = determineOrganizationId($pdo, $currentHost);

if ($organizationId) {
    $_SESSION['current_organization_id'] = $organizationId;
    return $organizationId;
}
    // If no organization is found, you might want to throw an error or handle this case
    throw new Exception("No organization found for the current host");
}




// Add more helper functions as needed


// Call this function at the beginning of each PHP file
function initializeApp() {
    ensureSessionStarted();
    setLanguage();
    loadTranslations();
    header("Cache-Control: max-age=3600, public");
}

function toBool($value) {
    if (is_bool($value)) {
        return $value ? 't' : 'f';
    }
    if (is_string($value)) {
        $lower = strtolower($value);
        if ($lower === 'true' || $lower === '1' || $lower === 'yes' || $lower === 'on') {
            return 't';
        }
    }
    if (is_numeric($value)) {
        return $value ? 't' : 'f';
    }
    return 'f'; // Default to false for any other input
}