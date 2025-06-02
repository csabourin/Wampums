<?php

// List of translation files to process
$files = ['en', 'fr'];

foreach ($files as $lang) {
    $phpFile = __DIR__ . "/$lang.php";
    $jsonFile = __DIR__ . "/$lang.json";
    
    if (!file_exists($phpFile)) {
        echo "File not found: $phpFile\n";
        continue;
    }
    
    // Load the PHP array
    $translations = include $phpFile;
    
    // Check if the loaded variable is actually an array
    if (!is_array($translations)) {
        echo "Error: $phpFile did not return an array\n";
        continue;
    }
    
    // Encode to JSON (pretty print, preserve unicode)
    $json = json_encode($translations, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    
    if (file_put_contents($jsonFile, $json)) {
        echo "Converted $phpFile to $jsonFile\n";
    } else {
        echo "Failed to write $jsonFile\n";
    }
}
