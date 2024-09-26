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

// Connect to PostgreSQL using the getDbConnection function from config.php
try {
    $pdo = getDbConnection();

    // Fetch latest news (limit to 3 latest posts)
    $stmt = $pdo->query("SELECT title, content, created_at FROM news ORDER BY created_at DESC LIMIT 3");
    $newsItems = $stmt->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    die("Error fetching news from database: " . $e->getMessage());
}

?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://meute6a.app">
    <meta property="og:title" content="Meute 6a d'Aylmer">
    <meta property="og:description" content="Application pour la gestion des informations d'inscription, la fiche santé et l'acceptation des risques des louveteaux de la Meute 6A St-Paul d'Aylmer. Permet aux parents de suivre les nouvelles, s'inscrire aux alertes et aux enfants de demander la progression des badges.">
    <meta property="og:image" content="https://meute6a.app/images/android-chrome-512x512.png">
    <meta property="fb:app_id" content="2012826655814548">
    <title>Meute 6e A St-Paul</title>
    <link rel="stylesheet" href="/css/styles.css?v=<?php echo filemtime('css/styles.css'); ?>">
    <link rel="manifest" href="/manifest.json">
    <link rel="alternate" type="application/rss+xml" href="/rss.xml" title="Meute 6e A St-Paul">
    <meta name="theme-color" content="#4c65ae">
    <link rel="apple-touch-icon" href="/images/icon-192x192.png">
</head>
<body>
    <div id="language-toggle" class="language-toggle">
        <button id="lang-fr" class="lang-btn active" data-lang="fr">FR</button>
        <button id="lang-en" class="lang-btn" data-lang="en">EN</button>
    </div>

    <div id="app">
        <?php echo translate('loading'); ?>...
    </div>
     <div id="news-widget">
        
        <div class="news-accordion" data-latest-timestamp="<?php echo $newsItems[0]['created_at'] ?? ''; ?>">
            <div class="news-accordion-header">
                <h2><?php echo translate('latest_news'); ?></h2>
            </div>
            <div class="news-accordion-content">
                <?php if (!empty($newsItems)): ?>
                    <?php foreach ($newsItems as $news): ?>
                        <div class="news-item">
                            <h3><?php echo htmlspecialchars($news['title']); ?></h3>
                            <p><?php echo nl2br(htmlspecialchars($news['content'])); ?></p>
                            <?php
                            // Set the locale for the date formatter based on the language
                            $locale = $lang === 'fr' ? 'fr_FR' : 'en_US';

                            // Check if the news array is not null and contains a valid created_at value
                            if (isset($news['created_at']) && !empty($news['created_at'])) {
                                // Create a new DateTime object from the news created_at timestamp
                                try {
                                    $date = new DateTime($news['created_at']);
                                    // Use IntlDateFormatter for locale-aware date formatting
                                    $formatter = new IntlDateFormatter($locale, IntlDateFormatter::LONG, IntlDateFormatter::NONE);
                                    echo '<small>' . $formatter->format($date) . '</small>';
                                } catch (Exception $e) {
                                    echo '<small>' . translate('invalid_date') . '</small>';
                                }
                            } else {
                                // If the date is missing or invalid, display a fallback message
                                echo '<small>' . translate('no_date_available') . '</small>';
                            }
                            ?>
                        </div>
                    <?php endforeach; ?>
                <?php else: ?>
                    <p><?php echo translate('no_news'); ?></p>
                <?php endif; ?>
            </div>
        </div>
    </div>

    
    <div id="loading-indicator" class="hidden">
        <?php echo translate('loading'); ?>...
    </div>
    <div id="offline-indicator">
        <?php echo translate('you_are_offline'); ?>
    </div>
    <script src="/initial-data.php"></script>
    <script type="module" src="/spa/app.js"></script>
    <!-- Clarity tracking code for https://meute6a.app/ -->
    <script src="/spa/clarity-init.js"></script>
    <a href="/politique-de-confidentialite.html" target="_blank" class="privacy-policy-link">Politique de confidentialit&eacute;</a>
</body>
</html>