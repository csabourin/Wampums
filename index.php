<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
// Security headers
header("Strict-Transport-Security: max-age=31536000; includeSubDomains; preload");
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-GENERATED_HASH' https://www.clarity.ms; style-src 'self'; img-src 'self' data:; connect-src 'self';");
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meute 6e A St-Paul</title>
    <link rel="stylesheet" href="/css/styles.css">
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
</head>
<body>
    <div id="app">
        <?php echo translate('loading'); ?>...
    </div>
    <div id="loading-indicator" style="display: none;">
        <?php echo translate('loading'); ?>...
    </div>
    <div id="offline-indicator" style="display: none;">
        <?php echo translate('you_are_offline'); ?>
    </div>
    <script>
        // Pass some initial data to the JavaScript
        window.initialData = {
            isLoggedIn: <?php echo isLoggedIn() ? 'true' : 'false'; ?>,
            userRole: <?php echo json_encode($_SESSION['user_role'] ?? null); ?>,
            lang: <?php echo json_encode($lang); ?>
        };
    </script>
    <script type="module" src="/spa/app.js"></script>
    <!-- Clarity tracking code for https://meute6a.app/ --><script>    (function(c,l,a,r,i,t,y){        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i+"?ref=bwt";        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);    })(window, document, "clarity", "script", "nzpnglzowb");</script>
</body>
</html>