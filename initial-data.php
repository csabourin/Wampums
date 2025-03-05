<?php
require_once 'config.php';
require_once 'functions.php';
require_once 'jwt_auth.php'; // Make sure to include the JWT auth file
initializeApp();

header('Content-Type: application/javascript');

// First get the organization ID
$organizationId = getCurrentOrganizationId();

// Check if user is logged in
$isLoggedIn = isLoggedIn();
$userRole = $_SESSION['user_role'] ?? null;
$userId = $_SESSION['user_id'] ?? null;

// Generate tokens based on authentication status
if ($isLoggedIn && $userId && $userRole) {
    // User is logged in, generate user JWT with user info and organization context
    $jwtToken = generateJWT($userId, $userRole, $organizationId);
    
    // Store in session for future use
    $_SESSION['jwtToken'] = $jwtToken;
} else {
    // User is not logged in, generate organization-only JWT
    // First check if we already have an organization token
    if (isset($_SESSION['orgJwtToken'])) {
        $jwtToken = $_SESSION['orgJwtToken'];
    } else {
        // Generate new organization token
        $jwtToken = generateJWT(null, null, $organizationId);
        $_SESSION['orgJwtToken'] = $jwtToken;
    }
}

// Prepare initial data for the frontend
$initialData = [
    'isLoggedIn' => $isLoggedIn,
    'userRole' => $userRole,
    'organizationId' => $organizationId,
    'lang' => $lang
];

// Output the initial data as a JavaScript object
echo 'window.initialData = ' . json_encode($initialData) . ';';
?>

// Store the JWT in localStorage for use by the frontend
const jwtToken = "<?php echo $jwtToken; ?>";
localStorage.setItem("jwtToken", jwtToken);

// Store organization ID as well
const organizationId = <?php echo $organizationId; ?>;
localStorage.setItem("organizationId", organizationId);

document.addEventListener("DOMContentLoaded", function() {
    let newsWidget = document.getElementById("news-widget");

    // Lazy load the news widget
    fetch(newsWidget.dataset.lazyLoad)
        .then(response => response.text())
        .then(data => {
            newsWidget.innerHTML = data;

            // Now that the content is loaded, find the accordion
            const accordion = document.querySelector('.news-accordion');
            if (!accordion) {
                return; // Stop execution if the accordion is not found
            }

            const accordionHeader = accordion.querySelector('.news-accordion-header');
            const accordionContent = accordion.querySelector('.news-accordion-content');

            // Function to toggle accordion
            function toggleAccordion() {
                accordion.classList.toggle('open');
                saveAccordionState();
            }

            // Function to save accordion state
            function saveAccordionState() {
                localStorage.setItem('newsAccordionOpen', accordion.classList.contains('open'));
                localStorage.setItem('lastNewsTimestamp', accordion.dataset.latestTimestamp);
            }

            // Function to load accordion state
            function loadAccordionState() {
                const isOpen = localStorage.getItem('newsAccordionOpen');
                const lastTimestamp = localStorage.getItem('lastNewsTimestamp');
                const latestNewsTimestamp = accordion.dataset.latestTimestamp;

                // Open accordion if no localStorage key exists or if there's new news
                if (isOpen === null || (lastTimestamp && latestNewsTimestamp > lastTimestamp)) {
                    accordion.classList.add('open');
                } else if (isOpen === 'true') {
                    accordion.classList.add('open');
                }
            }

            // Add click event listener to header
            accordionHeader.addEventListener('click', toggleAccordion);

            // Load initial state
            loadAccordionState();
        })
        .catch(error => {
            console.error('Error loading news widget:', error);
        });
});