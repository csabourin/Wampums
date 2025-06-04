<?php
// Chemin vers le fichier PHP de traductions
$phpFile = __DIR__ . '/en.php'; // adapte le nom si nécessaire

// Inclure le fichier et récupérer le tableau
$translations = include $phpFile;

// Vérifier que c'est bien un tableau
if (!is_array($translations)) {
		die("Le fichier PHP ne retourne pas un tableau valide.\n");
}

// Encoder en JSON avec options lisibles
$json = json_encode($translations, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);

// Vérifier s'il y a une erreur d'encodage
if ($json === false) {
		die("Erreur lors de l'encodage JSON : " . json_last_error_msg() . "\n");
}

// Sauvegarder dans un fichier .json
$jsonFile = __DIR__ . '/translation.json';
file_put_contents($jsonFile, $json);

echo "Fichier JSON généré avec succès : $jsonFile\n";
