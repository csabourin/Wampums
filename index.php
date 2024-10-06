<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
// Security headers
header("Strict-Transport-Security: max-age=31536000; includeSubDomains; preload");
header("Content-Security-Policy: default-src 'self'; script-src 'self' https://*.facebook.net https://*.clarity.ms https://*.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.bing.com https://*.clarity.ms https://*.cloudflareinsights.com; connect-src 'self' https://*.clarity.ms; worker-src 'self' blob:;");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");
header("X-XSS-Protection: 1; mode=block");
header("Referrer-Policy: no-referrer");
header("Set-Cookie: cookieName=PHPSESSID; Secure; HttpOnly");
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://meute6a.app">
    <meta property="og:title" content="Meute 6a d'Aylmer">
    <meta property="og:description" content="Application pour la gestion des informations d'un groupe Scout">
    <meta property="og:image" content="https://meute6a.app/images/android-chrome-512x512.png">
    <meta property="fb:app_id" content="2012826655814548">
    <title>Scouts au bout des doigts</title>
    <link rel="stylesheet" href="/css/styles.css?v=<?php echo filemtime('css/styles.css'); ?>">
    <link rel="manifest" href="/manifest.json">
    <link rel="alternate" type="application/rss+xml" href="/rss.xml" title="Meute 6e A St-Paul">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
      <script type="module" defer src="/spa/activity-widget.js"></script>
</head>
<body>
    <div id="language-toggle" class="language-toggle">
        <button id="lang-fr" class="lang-btn active" data-lang="fr">FR</button>
        <button id="lang-en" class="lang-btn" data-lang="en">EN</button>
    </div>

    <div id="app">
                <h1></h1>
        <form id="login-form">
            <input disabled type="email" name="email" placeholder="Adresse e-mail" required="">
            <input disabled type="password" name="password" placeholder="Mot de passe" required="">
            <button disabled type="submit"> </button>
        </form>
        <p><a href="#"> </a></p>
         <p><a href="#"> </a></p>
    </div>
    
    <div id="news-widget" data-lazy-load="/get-news.php">
        <div class="news-accordion-header">
                <h2> </h2>
        </div>
    </div>

    
    <div id="offline-indicator">
        <?php echo translate('you_are_offline'); ?>
    </div>
    
    <script type="module" defer src="/spa/app.js"></script>
    <script type="module" defer src="/initial-data.php"></script>
    <script type="module" defer src="/spa/init-activity-widget.js"></script>
    <!-- Clarity tracking code for https://meute6a.app/ -->
    <script async src="/spa/clarity-init.js"></script>
    <a href="/politique-de-confidentialite.html" target="_blank" class="privacy-policy-link">Politique de confidentialit&eacute;</a>
    <div id="loading-indicator" class="hidden">
        <?php echo translate('loading'); ?>...
    </div>
</body>
</html>