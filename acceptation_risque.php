<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$participant_id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
$participant = null;
$acceptation_risque = null;

if ($participant_id) {
    // Fetch participant data
    $stmt = $pdo->prepare("SELECT * FROM participants WHERE id = ?");
    $stmt->execute([$participant_id]);
    $participant = $stmt->fetch(PDO::FETCH_ASSOC);

    // Fetch acceptation_risque data
    $stmt = $pdo->prepare("SELECT * FROM acceptation_risque WHERE participant_id = ?");
    $stmt->execute([$participant_id]);
    $acceptation_risque = $stmt->fetch(PDO::FETCH_ASSOC);
}

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    try {
        $pdo->beginTransaction();

        $acceptationRisqueData = [
            'participant_id' => $participant_id,
            'groupe_district' => $_POST['groupe_district'],
            'accepte_risques' => isset($_POST['accepte_risques']) ? 1 : 0,
            'accepte_covid19' => isset($_POST['accepte_covid19']) ? 1 : 0,
            'nom_parent_tuteur' => $_POST['nom_parent_tuteur'],
            'date_signature' => $_POST['date_signature']
        ];

        if ($acceptation_risque) {
            // Update existing acceptation_risque
            $stmt = $pdo->prepare("UPDATE acceptation_risque SET 
                groupe_district = :groupe_district,
                accepte_risques = :accepte_risques,
                accepte_covid19 = :accepte_covid19,
                nom_parent_tuteur = :nom_parent_tuteur,
                date_signature = :date_signature
                WHERE participant_id = :participant_id");
        } else {
            // Insert new acceptation_risque
            $stmt = $pdo->prepare("INSERT INTO acceptation_risque (
                participant_id, groupe_district, accepte_risques, accepte_covid19,
                nom_parent_tuteur, date_signature
            ) VALUES (
                :participant_id, :groupe_district, :accepte_risques, :accepte_covid19,
                :nom_parent_tuteur, :date_signature
            )");
        }

        $stmt->execute($acceptationRisqueData);

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
    <title><?php echo translate('acceptation_risque'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <h1><?php echo translate('acceptation_risque'); ?></h1>
    <?php if (isset($error)): ?>
        <div class="error"><?php echo $error; ?></div>
    <?php endif; ?>
    <form method="post">
        <h2><?php echo translate('informations_participant'); ?></h2>
        <p><?php echo translate('nom_participant'); ?>: <?php echo htmlspecialchars($participant['first_name'] . ' ' . $participant['last_name']); ?></p>
        <p><?php echo translate('age_participant'); ?>: <?php echo calculateAge($participant['date_naissance']); ?></p>

        <label for="groupe_district"><?php echo translate('groupe_district'); ?>:</label>
        <input type="text" id="groupe_district" name="groupe_district" value="<?php echo htmlspecialchars($acceptation_risque['groupe_district'] ?? ''); ?>" required>

        <h2><?php echo translate('acceptation_risques_activites'); ?></h2>
        <p><?php echo translate('texte_risques_activites'); ?></p>
        <label for="accepte_risques">
            <input type="checkbox" id="accepte_risques" name="accepte_risques" <?php echo ($acceptation_risque['accepte_risques'] ?? false) ? 'checked' : ''; ?> required>
            <?php echo translate('jaccepte_risques_activites'); ?>
        </label>

        <h2><?php echo translate('covid19_autres_maladies'); ?></h2>
        <p><?php echo translate('texte_covid19'); ?></p>
        <label for="accepte_covid19">
            <input type="checkbox" id="accepte_covid19" name="accepte_covid19" <?php echo ($acceptation_risque['accepte_covid19'] ?? false) ? 'checked' : ''; ?> required>
            <?php echo translate('jaccepte_risques_covid19'); ?>
        </label>

        <h2><?php echo translate('signature'); ?></h2>
        <label for="nom_parent_tuteur"><?php echo translate('nom_parent_tuteur'); ?>:</label>
        <input type="text" id="nom_parent_tuteur" name="nom_parent_tuteur" value="<?php echo htmlspecialchars($acceptation_risque['nom_parent_tuteur'] ?? ''); ?>" required>

        <label for="date_signature"><?php echo translate('date_signature'); ?>:</label>
        <input type="date" id="date_signature" name="date_signature" value="<?php echo htmlspecialchars($acceptation_risque['date_signature'] ?? date('Y-m-d')); ?>" required>

        <input type="submit" value="<?php echo translate('soumettre_acceptation_risque'); ?>">
    </form>
    <p><a href="dashboard.php"><?php echo translate('retour_tableau_bord'); ?></a></p>

    <script src="js/acceptation_risque.js"></script>
</body>
</html>
