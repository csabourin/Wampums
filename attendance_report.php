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
    <title><?php echo translate('attendance_report'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <h1><?php echo translate('attendance_report'); ?></h1>
    <div id="report-container">
        <p><?php echo translate('loading_report'); ?>...</p>
    </div>
    <script src="get_translations.php"></script>
    <script type="module">
        import { fetchAndStoreAttendanceReport } from './js/app.js';
        import { displayAttendanceReport } from './js/attendance_report.js';

        document.addEventListener('DOMContentLoaded', async function() {
            try {
                const reportData = await fetchAndStoreAttendanceReport();
                console.log('Report data from fetchAndStoreAttendanceReport:', reportData);
                await displayAttendanceReport();
            } catch (error) {
                console.error('Error in main script:', error);
                document.getElementById('report-container').innerHTML = `<p>${translations['error_loading_report']}</p>`;
            }
        });
    </script>
    <p><a href="dashboard.php"><?php echo translate('back_to_dashboard'); ?></a></p>
</body>
</html>