<?php

// Your JSON structure
$vapidJson = '{
  "subject": "mailto:info@christiansabourin.com",
  "publicKey": "BPsOyoPVxNCN6BqsLdHwc5aaNPERFO2yq-xF3vqHJ7CdMlHRn5EBPnxcoOKGkeIO1_9zHnF5CRyD6RvLlOKPcTE",
  "privateKey": "vNvCumXGA29kMzTr6usJqYGZsKh1cQF_NpLV5--ZfjQ"
}';

// Decode the JSON into a PHP array
$vapidData = json_decode($vapidJson, true);

// Extract the individual values
$subject = $vapidData['subject'];
$publicKey = $vapidData['publicKey'];
$privateKey = $vapidData['privateKey'];

/**
 * Converts a Base64URL-encoded private key into a PEM-formatted EC private key.
 * @param string $base64UrlKey The VAPID private key in Base64URL format.
 * @return string The PEM-formatted EC private key.
 */
function convertBase64UrlToECPem($base64UrlKey) {
    // Convert Base64URL to Base64 by replacing characters
    $base64Key = str_replace(['-', '_'], ['+', '/'], $base64UrlKey);

    // Add padding if necessary
    $padding = strlen($base64Key) % 4;
    if ($padding) {
        $base64Key .= str_repeat('=', 4 - $padding);
    }

    // Decode the Base64 key into binary
    $binaryKey = base64_decode($base64Key);

    // Format it as a PEM-encoded EC private key by adding headers/footers
    $pem = "-----BEGIN EC PRIVATE KEY-----\n";
    $pem .= chunk_split(base64_encode($binaryKey), 64, "\n");
    $pem .= "-----END EC PRIVATE KEY-----\n";

    return $pem;
}

// Convert the Base64URL private key to PEM format for EC private key
$privateKeyPem = convertBase64UrlToECPem($privateKey);

// Output the values to verify
echo "Subject: " . $subject . PHP_EOL;
echo "Public Key: " . $publicKey . PHP_EOL;
echo "Private Key (PEM): " . $privateKeyPem . PHP_EOL;

?>
