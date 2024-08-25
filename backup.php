<?php
// Include the config file to get the database connection details
require 'config.php';

// Function to create a backup
function createBackup($dbUrl) {
    $dbName = ltrim($dbUrl['path'], '/');
    $dbHost = $dbUrl['host'] ?? 'localhost';
    $dbUser = $dbUrl['user'] ?? 'user';
    $dbPass = $dbUrl['pass'] ?? '';
    $backupFile = __DIR__ . "/backup/" . $dbName . "_backup_" . date("Y-m-d_H-i-s") . ".backup";

    // Build the pg_dump command
    $command = "PGPASSWORD='$dbPass' pg_dump -U $dbUser -h $dbHost -F c -b -v -f $backupFile $dbName";

    // Execute the backup command and capture output
    exec($command . ' 2>&1', $output, $return_var);

    // Output the result of the command for debugging
    echo "Command executed: $command\n";
    echo "Command output: " . implode("\n", $output) . "\n";

    // Check if the command was successful
    if ($return_var === 0) {
        echo "Backup successfully created at: $backupFile";
    } else {
        echo "An error occurred during the backup process.";
    }
}

// Ensure backup directory exists
if (!file_exists(__DIR__ . '/backup')) {
    mkdir(__DIR__ . '/backup', 0777, true);
}

// Initialize database and create backup
try {
    $pdo = getDbConnection();
    createTables($pdo);

    // Parse the DATABASE_URL and pass to createBackup function
    $dbUrl = parse_url($_ENV['DATABASE_URL']);
    createBackup($dbUrl);

} catch (PDOException $e) {
    die("Database error: " . $e->getMessage());
}
