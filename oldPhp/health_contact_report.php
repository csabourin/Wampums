<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

// Check if user has animation or admin role
if ($_SESSION['user_role'] !== 'animation' && $_SESSION['user_role'] !== 'admin') {
    header('Location: index.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="<?php echo $lang; ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('health_contact_report'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <div id="loading-indicator" style="display: none;">
        <?php echo translate('loading'); ?>...
    </div>
    <div id="offline-indicator" style="display: none;">
      <?php echo translate('you_are_offline'); ?>
    </div>
    <h1><?php echo translate('health_contact_report'); ?></h1>
    <div id="report-container">
        <p><?php echo translate('loading_report'); ?>...</p>
    </div>
    <script src="get_translations.php"></script>
    <script src="js/indexedDB.js" type="module"></script>
    <script src="js/app.js" type="module"></script>
    <script src="js/health_contact_report.js" type="module"></script>
    <script type="module">
        import { fetchAndStoreHealthContactReport } from './js/app.js';
        import { displayHealthContactReport } from './js/health_contact_report.js';

        document.addEventListener('DOMContentLoaded', async function() {
            try {
                await fetchAndStoreHealthContactReport();
                console.log('Health and contact report fetched and stored');
                await displayHealthContactReport();
            } catch (error) {
                console.error('Error in main script:', error);
                document.getElementById('report-container').innerHTML = `<p>${translations['error_loading_report']}</p>`;
            }
        });
    </script>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
</body>
</html>