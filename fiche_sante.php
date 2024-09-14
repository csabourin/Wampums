<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$participant_id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
$participant = null;
$fiche_sante = null;
$parents = [];

if ($participant_id) {
    // Check if the user has access to this participant
    if ($_SESSION['user_role'] === 'animation' || $_SESSION['user_role'] === 'admin') {
        $stmt = $pdo->prepare("SELECT * FROM participants WHERE id = ?");
        $stmt->execute([$participant_id]);
    } else {
        $stmt = $pdo->prepare("
            SELECT p.* 
            FROM participants p
            JOIN user_participants up ON p.id = up.participant_id
            WHERE p.id = ? AND up.user_id = ?
        ");
        $stmt->execute([$participant_id, $_SESSION['user_id']]);
    }
    $participant = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$participant) {
        // Redirect if the participant doesn't exist or the user doesn't have access
        header('Location: index.php');
        exit;
    }

    // Fetch fiche_sante data
    $stmt = $pdo->prepare("SELECT * FROM fiche_sante WHERE participant_id = ?");
    $stmt->execute([$participant_id]);
    $fiche_sante = $stmt->fetch(PDO::FETCH_ASSOC);

    // Fetch parents/guardians data
    $stmt = $pdo->prepare("
        SELECT pg.* 
        FROM parents_guardians pg
        JOIN participant_guardians pgp ON pg.id = pgp.parent_guardian_id
        WHERE pgp.participant_id = ?
        ORDER BY pg.is_primary DESC
    ");
    $stmt->execute([$participant_id]);
    $parents = $stmt->fetchAll(PDO::FETCH_ASSOC);
} else {
    // If no participant_id is provided, redirect to index.php
    header('Location: index.php');
    exit;
}

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    try {
        $pdo->beginTransaction();

        $ficheSanteData = [
            'participant_id' => $participant_id,
            'nom_fille_mere' => $_POST['nom_fille_mere'],
            'medecin_famille' => isset($_POST['medecin_famille']) ? 1 : 0,
            'nom_medecin' => isset($_POST['medecin_famille']) ? $_POST['nom_medecin'] : null,
            'probleme_sante' => $_POST['probleme_sante'],
            'allergie' => $_POST['allergie'],
            'epipen' => isset($_POST['epipen']) ? 1 : 0,
            'medicament' => $_POST['medicament'],
            'limitation' => $_POST['limitation'],
            'vaccins_a_jour' => isset($_POST['vaccins_a_jour']) ? 1 : 0,
            'blessures_operations' => $_POST['blessures_operations'],
            'niveau_natation' => $_POST['niveau_natation'],
            'doit_porter_vfi' => isset($_POST['doit_porter_vfi']) ? 1 : 0,
            'regles' => isset($_POST['regles']) ? 1 : 0,
            'renseignee' => isset($_POST['renseignee']) ? 1 : 0,
        ];

        if ($fiche_sante) {
            // Update existing fiche_sante
            $stmt = $pdo->prepare("UPDATE fiche_sante SET 
                nom_fille_mere = :nom_fille_mere,
                medecin_famille = :medecin_famille,
                nom_medecin = :nom_medecin,
                probleme_sante = :probleme_sante,
                allergie = :allergie,
                epipen = :epipen,
                medicament = :medicament,
                limitation = :limitation,
                vaccins_a_jour = :vaccins_a_jour,
                blessures_operations = :blessures_operations,
                niveau_natation = :niveau_natation,
                doit_porter_vfi = :doit_porter_vfi,
                regles = :regles,
                renseignee = :renseignee
                WHERE participant_id = :participant_id");
        } else {
            // Insert new fiche_sante
            $stmt = $pdo->prepare("INSERT INTO fiche_sante (
                participant_id, nom_fille_mere, medecin_famille, nom_medecin,
                probleme_sante, allergie, epipen, medicament, limitation,
                vaccins_a_jour, blessures_operations, niveau_natation, doit_porter_vfi,
                regles, renseignee
            ) VALUES (
                :participant_id, :nom_fille_mere, :medecin_famille, :nom_medecin,
                :probleme_sante, :allergie, :epipen, :medicament, :limitation,
                :vaccins_a_jour, :blessures_operations, :niveau_natation, :doit_porter_vfi,
                :regles, :renseignee
            )");
        }

        $stmt->execute($ficheSanteData);

        // Update emergency contact status for parents/guardians
        if (isset($_POST['is_emergency_contact'])) {
            // First, reset all emergency contacts for this participant
            $stmt = $pdo->prepare("
                UPDATE parents_guardians 
                SET is_emergency_contact = false 
                WHERE id IN (
                    SELECT parent_guardian_id 
                    FROM participant_guardians 
                    WHERE participant_id = ?
                )
            ");
            $stmt->execute([$participant_id]);

            // Then, set the selected guardians as emergency contacts
            foreach ($_POST['is_emergency_contact'] as $parent_id) {
                $stmt = $pdo->prepare("UPDATE parents_guardians SET is_emergency_contact = true WHERE id = ?");
                $stmt->execute([$parent_id]);
            }
        }

        $pdo->commit();
        header("Location: index.php");
        exit();
    } catch (Exception $e) {
        $pdo->rollBack();
        $error = "Une erreur est survenue lors de l'enregistrement: " . $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="<?php echo htmlspecialchars($lang); ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('fiche_sante'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <div id="loading-indicator" style="display: none;">
        <?php echo translate('loading'); ?>...
    </div>
    <h1><?php echo translate('fiche_sante'); ?></h1>
    <?php if (isset($error)): ?>
        <div class="error"><?php echo $error; ?></div>
    <?php endif; ?>
    <form method="post">
        <h2><?php echo translate('informations_generales'); ?></h2>
        <p><?php echo translate('nom_complet'); ?>: <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?></p>
        <p><?php echo translate('date_naissance'); ?>: <?php echo htmlspecialchars($participant['date_naissance']); ?></p>

        <label for="nom_fille_mere"><?php echo translate('nom_fille_mere'); ?>:</label>
        <input type="text" id="nom_fille_mere" name="nom_fille_mere" value="<?php echo htmlspecialchars($fiche_sante['nom_fille_mere'] ?? ''); ?>">

        <h2><?php echo translate('medecin'); ?></h2>
        <label for="medecin_famille"><?php echo translate('medecin_famille'); ?>:</label>
        <input type="checkbox" id="medecin_famille" name="medecin_famille" <?php echo ($fiche_sante['medecin_famille'] ?? false) ? 'checked' : ''; ?>>

        <label for="nom_medecin"><?php echo translate('nom_medecin'); ?>:</label>
        <input type="text" id="nom_medecin" name="nom_medecin" value="<?php echo htmlspecialchars($fiche_sante['nom_medecin'] ?? ''); ?>">

        <h2><?php echo translate('urgence'); ?></h2>
        <?php foreach ($parents as $index => $parent): ?>
            <h3><?php echo translate('contact') . ' ' . ($index + 1); ?></h3>
            <p><?php echo htmlspecialchars($parent['prenom'] . ' ' . $parent['nom']); ?></p>
            <p><?php echo translate('telephone'); ?>: <?php echo htmlspecialchars($parent['telephone_cellulaire']); ?></p>
            <label>
                <input type="checkbox" name="is_emergency_contact[]" value="<?php echo $parent['id']; ?>" 
                       <?php echo $parent['is_emergency_contact'] ? 'checked' : ''; ?>>
                <?php echo translate('is_emergency_contact'); ?>
            </label>
        <?php endforeach; ?>

        <h2><?php echo translate('informations_medicales'); ?></h2>
        <label for="probleme_sante"><?php echo translate('probleme_sante'); ?>:</label>
        <textarea id="probleme_sante" name="probleme_sante"><?php echo htmlspecialchars($fiche_sante['probleme_sante'] ?? ''); ?></textarea>

        <label for="allergie"><?php echo translate('allergie'); ?>:</label>
        <textarea id="allergie" name="allergie"><?php echo htmlspecialchars($fiche_sante['allergie'] ?? ''); ?></textarea>

        <label for="epipen"><?php echo translate('epipen'); ?>:</label>
        <input type="checkbox" id="epipen" name="epipen" <?php echo ($fiche_sante['epipen'] ?? false) ? 'checked' : ''; ?>>

        <label for="medicament"><?php echo translate('medicament'); ?>:</label>
        <textarea id="medicament" name="medicament"><?php echo htmlspecialchars($fiche_sante['medicament'] ?? ''); ?></textarea>

        <label for="limitation"><?php echo translate('limitation'); ?>:</label>
        <textarea id="limitation" name="limitation"><?php echo htmlspecialchars($fiche_sante['limitation'] ?? ''); ?></textarea>

        <label for="vaccins_a_jour"><?php echo translate('vaccins_a_jour'); ?>:</label>
        <input type="checkbox" id="vaccins_a_jour" name="vaccins_a_jour" <?php echo ($fiche_sante['vaccins_a_jour'] ?? false) ? 'checked' : ''; ?>>

        <label for="blessures_operations"><?php echo translate('blessures_operations'); ?>:</label>
        <textarea id="blessures_operations" name="blessures_operations"><?php echo htmlspecialchars($fiche_sante['blessures_operations'] ?? ''); ?></textarea>

        <h2><?php echo translate('natation'); ?></h2>
        <label for="niveau_natation"><?php echo translate('niveau_natation'); ?>:</label>
        <select id="niveau_natation" name="niveau_natation">
            <option value="ne_sait_pas_nager" <?php echo ($fiche_sante['niveau_natation'] ?? '') == 'ne_sait_pas_nager' ? 'selected' : ''; ?>><?php echo translate('ne_sait_pas_nager'); ?></option>
            <option value="eau_peu_profonde" <?php echo ($fiche_sante['niveau_natation'] ?? '') == 'eau_peu_profonde' ? 'selected' : ''; ?>><?php echo translate('eau_peu_profonde'); ?></option>
            <option value="eau_profonde" <?php echo ($fiche_sante['niveau_natation'] ?? '') == 'eau_profonde' ? 'selected' : ''; ?>><?php echo translate('eau_profonde'); ?></option>
        </select>

        <label for="doit_porter_vfi"><?php echo translate('doit_porter_vfi'); ?>:</label>
        <input type="checkbox" id="doit_porter_vfi" name="doit_porter_vfi" <?php echo ($fiche_sante['doit_porter_vfi'] ?? false) ? 'checked' : ''; ?>>

        <h2><?php echo translate('pour_filles'); ?></h2>
        <label for="regles"><?php echo translate('regles'); ?>:</label>
        <input type="checkbox" id="regles" name="regles" <?php echo ($fiche_sante['regles'] ?? false) ? 'checked' : ''; ?>>

        <label for="renseignee"><?php echo translate('renseignee'); ?>:</label>
        <input type="checkbox" id="renseignee" name="renseignee" <?php echo ($fiche_sante['renseignee'] ?? false) ? 'checked' : ''; ?>>

        <input type="submit" value="<?php echo translate('enregistrer_fiche_sante'); ?>">
    </form>
    <p><a href="index.php"><?php echo translate('retour_tableau_bord'); ?></a></p>

    <script src="js/fiche_sante.js"></script>
</body>
</html>