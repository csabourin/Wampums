<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$participant_id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
$participant = null;
$fiche_sante = null;

if ($participant_id) {
    // Fetch participant data
    $stmt = $pdo->prepare("SELECT * FROM participants WHERE id = ?");
    $stmt->execute([$participant_id]);
    $participant = $stmt->fetch(PDO::FETCH_ASSOC);

    // Fetch fiche_sante data
    $stmt = $pdo->prepare("SELECT * FROM fiche_sante WHERE participant_id = ?");
    $stmt->execute([$participant_id]);
    $fiche_sante = $stmt->fetch(PDO::FETCH_ASSOC);
}

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    try {
        $pdo->beginTransaction();

        $ficheSanteData = [
            'participant_id' => $participant_id,
            'nom_fille_mere' => $_POST['nom_fille_mere'],
            'medecin_famille' => isset($_POST['medecin_famille']) ? 1 : 0,
            'nom_medecin' => $_POST['nom_medecin'],
            'contact_urgence_1_nom' => $_POST['contact_urgence_1_nom'],
            'contact_urgence_1_telephone' => $_POST['contact_urgence_1_telephone'],
            'contact_urgence_1_lien' => $_POST['contact_urgence_1_lien'],
            'contact_urgence_2_nom' => $_POST['contact_urgence_2_nom'],
            'contact_urgence_2_telephone' => $_POST['contact_urgence_2_telephone'],
            'contact_urgence_2_lien' => $_POST['contact_urgence_2_lien'],
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
                contact_urgence_1_nom = :contact_urgence_1_nom,
                contact_urgence_1_telephone = :contact_urgence_1_telephone,
                contact_urgence_1_lien = :contact_urgence_1_lien,
                contact_urgence_2_nom = :contact_urgence_2_nom,
                contact_urgence_2_telephone = :contact_urgence_2_telephone,
                contact_urgence_2_lien = :contact_urgence_2_lien,
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
                contact_urgence_1_nom, contact_urgence_1_telephone, contact_urgence_1_lien,
                contact_urgence_2_nom, contact_urgence_2_telephone, contact_urgence_2_lien,
                probleme_sante, allergie, epipen, medicament, limitation,
                vaccins_a_jour, blessures_operations, niveau_natation, doit_porter_vfi,
                regles, renseignee
            ) VALUES (
                :participant_id, :nom_fille_mere, :medecin_famille, :nom_medecin,
                :contact_urgence_1_nom, :contact_urgence_1_telephone, :contact_urgence_1_lien,
                :contact_urgence_2_nom, :contact_urgence_2_telephone, :contact_urgence_2_lien,
                :probleme_sante, :allergie, :epipen, :medicament, :limitation,
                :vaccins_a_jour, :blessures_operations, :niveau_natation, :doit_porter_vfi,
                :regles, :renseignee
            )");
        }

        $stmt->execute($ficheSanteData);

        $pdo->commit();
        header("Location: dashboard.php");
        exit();
    } catch (Exception $e) {
        $pdo->rollBack();
        $error = "Une erreur est survenue lors de l'enregistrement: " . htmlspecialchars($e->getMessage());
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
        <h3><?php echo translate('contact_1'); ?></h3>
        <label for="contact_urgence_1_nom"><?php echo translate('nom'); ?>:</label>
        <input type="text" id="contact_urgence_1_nom" name="contact_urgence_1_nom" value="<?php echo htmlspecialchars($fiche_sante['contact_urgence_1_nom'] ?? ''); ?>" required>

        <label for="contact_urgence_1_telephone"><?php echo translate('telephone'); ?>:</label>
        <input type="tel" id="contact_urgence_1_telephone" name="contact_urgence_1_telephone" value="<?php echo htmlspecialchars($fiche_sante['contact_urgence_1_telephone'] ?? ''); ?>" required>

        <label for="contact_urgence_1_lien"><?php echo translate('lien'); ?>:</label>
        <input type="text" id="contact_urgence_1_lien" name="contact_urgence_1_lien" value="<?php echo htmlspecialchars($fiche_sante['contact_urgence_1_lien'] ?? ''); ?>" required>

        <h3><?php echo translate('contact_2'); ?></h3>
        <label for="contact_urgence_2_nom"><?php echo translate('nom'); ?>:</label>
        <input type="text" id="contact_urgence_2_nom" name="contact_urgence_2_nom" value="<?php echo htmlspecialchars($fiche_sante['contact_urgence_2_nom'] ?? ''); ?>">

        <label for="contact_urgence_2_telephone"><?php echo translate('telephone'); ?>:</label>
        <input type="tel" id="contact_urgence_2_telephone" name="contact_urgence_2_telephone" value="<?php echo htmlspecialchars($fiche_sante['contact_urgence_2_telephone'] ?? ''); ?>">

        <label for="contact_urgence_2_lien"><?php echo translate('lien'); ?>:</label>
        <input type="text" id="contact_urgence_2_lien" name="contact_urgence_2_lien" value="<?php echo htmlspecialchars($fiche_sante['contact_urgence_2_lien'] ?? ''); ?>">

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
    <p><a href="dashboard.php"><?php echo translate('retour_tableau_bord'); ?></a></p>

    <script src="js/fiche_sante.js"></script>
</body>
</html>