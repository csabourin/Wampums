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

header('Content-Type: application/json');

$pdo = getDbConnection();

$query = "
    SELECT 
        p.id AS participant_id,
        p.first_name,
        p.last_name,
        p.date_naissance,
        g.name AS group_name,
        fs.nom_fille_mere,
        fs.medecin_famille,
        fs.nom_medecin,
        fs.contact_urgence_1_nom,
        fs.contact_urgence_1_telephone,
        fs.contact_urgence_1_lien,
        fs.contact_urgence_2_nom,
        fs.contact_urgence_2_telephone,
        fs.contact_urgence_2_lien,
        fs.probleme_sante,
        fs.allergie,
        fs.epipen,
        fs.medicament,
        fs.limitation,
        fs.vaccins_a_jour,
        fs.blessures_operations,
        fs.niveau_natation,
        fs.doit_porter_vfi,
        fs.regles,
        fs.renseignee
    FROM participants p
    LEFT JOIN groups g ON p.group_id = g.id
    LEFT JOIN fiche_sante fs ON p.id = fs.participant_id
    ORDER BY g.name, p.last_name, p.first_name
";

$stmt = $pdo->query($query);
$healthContactData = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo json_encode($healthContactData);