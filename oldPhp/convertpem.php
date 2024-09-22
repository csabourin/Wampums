<?php

/**
 * Convert PEM-formatted public/private key to Base64URL-encoded format.
 * @param string $pemFile Path to the PEM file (public or private key)
 * @return string Base64URL-encoded key
 */
function convertPemToBase64Url($pemFile) {
    // Read the PEM file content
    $pemContent = file_get_contents($pemFile);

    // Remove PEM header and footer (if present)
    $pemContent = preg_replace('/-----(BEGIN|END) (EC PRIVATE|PUBLIC) KEY-----/', '', $pemContent);
    
    // Remove line breaks and whitespace
    $pemContent = trim($pemContent);
    $pemContent = str_replace(["\n", "\r"], '', $pemContent);

    // Decode Base64 PEM content
    $binaryKey = base64_decode($pemContent);

    // Check if the decoded key has a length of 65 bytes (for a VAPID public key)
    if (strlen($binaryKey) !== 65) {
        throw new Exception('The decoded key is not 65 bytes long. It may not be a valid VAPID public key.');
    }

    // Base64URL-encode (replace '+' with '-', '/' with '_', and remove padding '=')
    $base64UrlKey = rtrim(strtr(base64_encode($binaryKey), '+/', '-_'), '=');

    return $base64UrlKey;
}

try {
    // Specify the path to your VAPID PEM files
    $vapidPublicPem = 'vapid_public.pem';

    // Convert the public key
    $vapidPublicKeyBase64Url = convertPemToBase64Url($vapidPublicPem);

    // Output the Base64URL-encoded public key
    echo "VAPID Public Key (Base64URL): " . $vapidPublicKeyBase64Url . PHP_EOL;
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . PHP_EOL;
}

?>
