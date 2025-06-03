<?php
require __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();
require_once 'config.php';
require_once 'functions.php';
initializeApp();
// Security headers
header("Strict-Transport-Security: max-age=31536000; includeSubDomains; preload");
// header("Content-Security-Policy:   default-src 'self';   script-src 'self' https://*.facebook.net https://*.clarity.ms https://*.cloudflareinsights.com;   style-src 'self' 'unsafe-inline';   img-src 'self' data: https://*.bing.com https://*.clarity.ms https://*.cloudflareinsights.com;  connect-src 'self' https://*.clarity.ms https://wampums-api.replit.app;   worker-src 'self' blob:;");
header("Access-Control-Allow-Origin: *"); // Changed to allow all origins for testing
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");
header("X-XSS-Protection: 1; mode=block");
header("Referrer-Policy: no-referrer");
header("Set-Cookie: cookieName=PHPSESSID; Secure; HttpOnly");
// write the organization id in the x-orgID header
header("X-OrgID: " . $organizationId);
$organizationName = $settings['name'] ?? 'Scouts';
$title = ($lang == 'en') ? "Scouts at your fingertips" : "Scouts au bout des doigts";
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://<?php echo $_SERVER['HTTP_HOST']; ?>">
      <meta property="og:title" content="<?php echo htmlspecialchars($title); ?> - <?php echo htmlspecialchars($organizationName); ?>">
    <meta property="og:description" content="<?php echo translate('app_description'); ?>">
    <meta property="og:image" content="<?php echo $_SERVER['HTTP_HOST']; ?>/images/android-chrome-512x512.png">
    <meta property="fb:app_id" content="2012826655814548">
    <title><?php echo htmlspecialchars($title); ?> - <?php echo htmlspecialchars($organizationName); ?></title>
    <link rel="stylesheet" href="/css/styles.css?v=<?php echo filemtime('css/styles.css'); ?>">
    <link rel="manifest" href="/manifest.json">
     <link rel="alternate" type="application/rss+xml" href="/rss.xml" title="<?php echo htmlspecialchars($organizationName); ?>">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
      <script type="module" defer src="/spa/activity-widget.js"></script>
</head>
<body>

    <div id="app">
    </div>

    <div id="language-toggle" class="language-toggle">
        <button id="lang-fr" class="lang-btn<?php echo $lang == 'fr' ? ' active' : ''; ?>" data-lang="fr">FR</button>
        <button id="lang-en" class="lang-btn<?php echo $lang == 'en' ? ' active' : ''; ?>" data-lang="en">EN</button>
    </div>
   
    <div id="news-widget" data-lazy-load="/get-news.php">
        <div class="news-accordion-header">
                <h2> </h2>
        </div>
    </div>

    
    <div id="offline-indicator">
        <?php echo translate('you_are_offline'); ?>
    </div>
    <script type="module" src="/initial-data.php"></script>
    <script type="module" defer src="/spa/app.js"></script>
    <script type="module" defer src="/spa/init-activity-widget.js"></script>
    <!-- Clarity tracking code for https://meute6a.app/ -->
    <script async src="/spa/clarity-init.js"></script>
    <a href="/politique-de-confidentialite.html" target="_blank" class="privacy-policy-link">Politique de confidentialit&eacute;</a>
    <div id="loading-indicator" class="hidden">
        <?php echo translate('loading'); ?>...
    </div>
</body>
</html>