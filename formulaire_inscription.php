<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();
requireLogin();

$pdo = getDbConnection();

$participant_id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
$participant = null;
$parents = [];
$inscription = null;

if ($participant_id) {
    // Fetch participant data
    $stmt = $pdo->prepare("SELECT * FROM participants WHERE id = ? AND user_id = ?");
    $stmt->execute([$participant_id, $_SESSION['user_id']]);
    $participant = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$participant) {
        // Redirect if the participant doesn't belong to the user
        header('Location: index.php');
        exit;
    }

    // Fetch parents/guardians data
    $stmt = $pdo->prepare("SELECT * FROM parents_guardians WHERE participant_id = ? ORDER BY is_primary DESC");
    $stmt->execute([$participant_id]);
    $parents = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Fetch inscription data
    $stmt = $pdo->prepare("SELECT * FROM inscriptions WHERE participant_id = ?");
    $stmt->execute([$participant_id]);
    $inscription = $stmt->fetch(PDO::FETCH_ASSOC);
}

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    try {
        $pdo->beginTransaction();

        // Process participant data
        $participantData = [
            'first_name' => $_POST['prenom'],
            'last_name' => $_POST['nom'],
            'date_naissance' => $_POST['date_naissance'],
            'sexe' => $_POST['sexe'],
            'adresse' => $_POST['adresse'],
            'ville' => $_POST['ville'],
            'province' => $_POST['province'],
            'code_postal' => $_POST['code_postal'],
            'courriel' => $_POST['courriel'],
            'telephone' => $_POST['telephone'],
            'user_id' => $_SESSION['user_id']
        ];

        if ($participant_id) {
            // Update existing participant
            $stmt = $pdo->prepare("UPDATE participants SET first_name = :first_name, last_name = :last_name, 
                date_naissance = :date_naissance, sexe = :sexe, adresse = :adresse, ville = :ville, 
                province = :province, code_postal = :code_postal, courriel = :courriel, telephone = :telephone");
            $stmt->execute(array_merge($participantData, ['id' => $participant_id]));
        } else {
            // Insert new participant
            $stmt = $pdo->prepare("INSERT INTO participants (first_name, last_name, date_naissance, sexe, adresse, 
                ville, province, code_postal, courriel, telephone, user_id) VALUES (:first_name, :last_name, 
                :date_naissance, :sexe, :adresse, :ville, :province, :code_postal, :courriel, :telephone, :user_id)");
            $stmt->execute($participantData);
            $participant_id = $pdo->lastInsertId();
        }

        // Process parents/guardians data
        $stmt = $pdo->prepare("DELETE FROM parents_guardians WHERE participant_id = ?");
        $stmt->execute([$participant_id]);

        foreach ($_POST['parent_nom'] as $index => $nom) {
            $stmt = $pdo->prepare("INSERT INTO parents_guardians (participant_id, nom, prenom, lien, courriel, 
                telephone_residence, telephone_travail, telephone_cellulaire, is_primary) VALUES 
                (?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $participant_id,
                $nom,
                $_POST['parent_prenom'][$index],
                $_POST['parent_lien'][$index],
                $_POST['parent_courriel'][$index],
                $_POST['parent_telephone_residence'][$index],
                $_POST['parent_telephone_travail'][$index],
                $_POST['parent_telephone_cellulaire'][$index],
                $index == 0 ? 1 : 0
            ]);
        }

        // Process inscription data
        $inscriptionData = [
            'participant_id' => $participant_id,
            'district' => $_POST['district'],
            'unite' => $_POST['unite'],
            'demeure_chez' => $_POST['demeure_chez'],
            'peut_partir_seul' => isset($_POST['peut_partir_seul']) ? 1 : 0,
            'langue_maison' => $_POST['langue_maison'],
            'autres_langues' => $_POST['autres_langues'],
            'particularites' => $_POST['particularites'],
            'consentement_soins_medicaux' => isset($_POST['consentement_soins_medicaux']) ? 1 : 0,
            'consentement_photos_videos' => isset($_POST['consentement_photos_videos']) ? 1 : 0,
            'source_information' => $_POST['source_information']
        ];

        if ($inscription) {
            // Update existing inscription
            $stmt = $pdo->prepare("UPDATE inscriptions SET district = :district, unite = :unite, 
                demeure_chez = :demeure_chez, peut_partir_seul = :peut_partir_seul, langue_maison = :langue_maison, 
                autres_langues = :autres_langues, particularites = :particularites, 
                consentement_soins_medicaux = :consentement_soins_medicaux, 
                consentement_photos_videos = :consentement_photos_videos, 
                source_information = :source_information WHERE participant_id = :participant_id");
            $stmt->execute($inscriptionData);
        } else {
            // Insert new inscription
            $stmt = $pdo->prepare("INSERT INTO inscriptions (participant_id, district, unite, demeure_chez, 
                peut_partir_seul, langue_maison, autres_langues, particularites, consentement_soins_medicaux, 
                consentement_photos_videos, source_information) VALUES (:participant_id, :district, :unite, 
                :demeure_chez, :peut_partir_seul, :langue_maison, :autres_langues, :particularites, 
                :consentement_soins_medicaux, :consentement_photos_videos, :source_information)");
            $stmt->execute($inscriptionData);
        }

        $pdo->commit();
        header("Location: index.php");
        exit();
    } catch (Exception $e) {
        $pdo->rollBack();
        $error = "Une erreur est survenue lors de l'enregistrement: " . $e->getMessage();
    }
}

// Fetch groups for dropdown
$stmt = $pdo->query("SELECT id, name FROM groups ORDER BY name");
$groups = $stmt->fetchAll(PDO::FETCH_ASSOC);
?>
<!DOCTYPE html>
<html lang="<?php echo htmlspecialchars($lang); ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo translate('formulaire_inscription'); ?></title>
    <link rel="stylesheet" href="css/styles.css">
</head>
<body>
    <h1><?php echo translate('formulaire_inscription'); ?></h1>
    <?php if (isset($error)): ?>
        <div class="error"><?php echo htmlspecialchars($error); ?></div>
    <?php endif; ?>
    <form method="post">
        <h2><?php echo translate('informations_participant'); ?></h2>
        <label for="prenom"><?php echo translate('prenom'); ?>:</label>
        <input type="text" id="prenom" name="prenom" value="<?php echo htmlspecialchars($participant['first_name'] ?? ''); ?>" required>

        <label for="nom"><?php echo translate('nom'); ?>:</label>
        <input type="text" id="nom" name="nom" value="<?php echo htmlspecialchars($participant['last_name'] ?? ''); ?>" required>

        <label for="date_naissance"><?php echo translate('date_naissance'); ?>:</label>
        <input type="date" id="date_naissance" name="date_naissance" value="<?php echo htmlspecialchars($participant['date_naissance'] ?? ''); ?>" required>

        <label for="sexe"><?php echo translate('sexe'); ?>:</label>
        <select id="sexe" name="sexe" required>
            <option value="M" <?php echo ($participant['sexe'] ?? '') == 'M' ? 'selected' : ''; ?>><?php echo translate('masculin'); ?></option>
            <option value="F" <?php echo ($participant['sexe'] ?? '') == 'F' ? 'selected' : ''; ?>><?php echo translate('feminin'); ?></option>
            <option value="A" <?php echo ($participant['sexe'] ?? '') == 'A' ? 'selected' : ''; ?>><?php echo translate('autre'); ?></option>
        </select>

        <label for="adresse"><?php echo translate('adresse'); ?>:</label>
        <input type="text" id="adresse" name="adresse" value="<?php echo htmlspecialchars($participant['adresse'] ?? ''); ?>" required>

        <label for="ville"><?php echo translate('ville'); ?>:</label>
        <input type="text" id="ville" name="ville" value="<?php echo htmlspecialchars($participant['ville'] ?? ''); ?>" required>

        <label for="province"><?php echo translate('province'); ?>:</label>
        <input type="text" id="province" name="province" value="<?php echo htmlspecialchars($participant['province'] ?? ''); ?>" required>

        <label for="code_postal"><?php echo translate('code_postal'); ?>:</label>
        <input type="text" id="code_postal" name="code_postal" value="<?php echo htmlspecialchars($participant['code_postal'] ?? ''); ?>" required>

        <label for="courriel"><?php echo translate('courriel'); ?>:</label>
        <input type="email" id="courriel" name="courriel" value="<?php echo htmlspecialchars($participant['courriel'] ?? ''); ?>">

        <label for="telephone"><?php echo translate('telephone'); ?>:</label>
        <input type="tel" id="telephone" name="telephone" value="<?php echo htmlspecialchars($participant['telephone'] ?? ''); ?>" required>

        <h2><?php echo translate('informations_parents'); ?></h2>
        <?php for ($i = 0; $i < 2; $i++): ?>
            <h3><?php echo translate('parent_tuteur') . ' ' . ($i + 1); ?></h3>
            <label for="parent_nom_<?php echo $i; ?>"><?php echo translate('nom'); ?>:</label>
            <input type="text" id="parent_nom_<?php echo $i; ?>" name="parent_nom[]" value="<?php echo htmlspecialchars($parents[$i]['nom'] ?? ''); ?>">

            <label for="parent_prenom_<?php echo $i; ?>"><?php echo translate('prenom'); ?>:</label>
            <input type="text" id="parent_prenom_<?php echo $i; ?>" name="parent_prenom[]" value="<?php echo htmlspecialchars($parents[$i]['prenom'] ?? ''); ?>">

            <label for="parent_lien_<?php echo $i; ?>"><?php echo translate('lien'); ?>:</label>
            <input type="text" id="parent_lien_<?php echo $i; ?>" name="parent_lien[]" value="<?php echo htmlspecialchars($parents[$i]['lien'] ?? ''); ?>">

            <label for="parent_courriel_<?php echo $i; ?>"><?php echo translate('courriel'); ?>:</label>
            <input type="email" id="parent_courriel_<?php echo $i; ?>" name="parent_courriel[]" value="<?php echo htmlspecialchars($parents[$i]['courriel'] ?? ''); ?>">

            <label for="parent_telephone_residence_<?php echo $i; ?>"><?php echo translate('telephone_residence'); ?>:</label>
            <input type="tel" id="parent_telephone_residence_<?php echo $i; ?>" name="parent_telephone_residence[]" value="<?php echo htmlspecialchars($parents[$i]['telephone_residence'] ?? ''); ?>">

            <label for="parent_telephone_travail_<?php echo $i; ?>"><?php echo translate('telephone_travail'); ?>:</label>
            <input type="tel" id="parent_telephone_travail_<?php echo $i; ?>" name="parent_telephone_travail[]" value="<?php echo htmlspecialchars($parents[$i]['telephone_travail'] ?? ''); ?>">

            <label for="parent_telephone_cellulaire_<?php echo $i; ?>"><?php echo translate('telephone_cellulaire'); ?>:</label>
            <input type="tel" id="parent_telephone_cellulaire_<?php echo $i; ?>" name="parent_telephone_cellulaire[]" value="<?php echo htmlspecialchars($parents[$i]['telephone_cellulaire'] ?? ''); ?>">
        <?php endfor; ?>

        <h2><?php echo translate('informations_inscription'); ?></h2>
        <label for="district"><?php echo translate('district'); ?>:</label>
        <input type="text" id="district" name="district" value="<?php echo htmlspecialchars($inscription['district'] ?? 'District des Trois-Rives'); ?>" required>

        <label for="unite"><?php echo translate('unite'); ?>:</label>
        <input type="text" id="unite" name="unite" value="<?php echo htmlspecialchars($inscription['unite'] ?? '6e A St-Paul d\'Aylmer'); ?>" required>

        <label for="demeure_chez"><?php echo translate('demeure_chez'); ?>:</label>
        <select id="demeure_chez" name="demeure_chez">
            <option value="parents" <?php echo ($inscription['demeure_chez'] ?? '') == 'parents' ? 'selected' : ''; ?>><?php echo translate('parents'); ?></option>
            <option value="mere" <?php echo ($inscription['demeure_chez'] ?? '') == 'mere' ? 'selected' : ''; ?>><?php echo translate('mere'); ?></option>
            <option value="pere" <?php echo ($inscription['demeure_chez'] ?? '') == 'pere' ? 'selected' : ''; ?>><?php echo translate('pere'); ?></option>
            <option value="garde_partagee" <?php echo ($inscription['demeure_chez'] ?? '') == 'garde_partagee' ? 'selected' : ''; ?>><?php echo translate('garde_partagee'); ?></option>
            <option value="autre" <?php echo ($inscription['demeure_chez'] ?? '') == 'autre' ? 'selected' : ''; ?>><?php echo translate('autre'); ?></option>
        </select>

        <label for="peut_partir_seul"><?php echo translate('peut_partir_seul'); ?>:</label>
        <input type="checkbox" id="peut_partir_seul" name="peut_partir_seul" <?php echo ($inscription['peut_partir_seul'] ?? false) ? 'checked' : ''; ?>>

        <label for="langue_maison"><?php echo translate('langue_maison'); ?>:</label>
        <input type="text" id="langue_maison" name="langue_maison" value="<?php echo htmlspecialchars($inscription['langue_maison'] ?? ''); ?>">

        <label for="autres_langues"><?php echo translate('autres_langues'); ?>:</label>
        <input type="text" id="autres_langues" name="autres_langues" value="<?php echo htmlspecialchars($inscription['autres_langues'] ?? ''); ?>">

        <label for="particularites"><?php echo translate('particularites'); ?>:</label>
        <textarea id="particularites" name="particularites"><?php echo htmlspecialchars($inscription['particularites'] ?? ''); ?></textarea>

        <label for="consentement_soins_medicaux"><?php echo translate('consentement_soins_medicaux'); ?>:</label>
        <input type="checkbox" id="consentement_soins_medicaux" name="consentement_soins_medicaux" <?php echo ($inscription['consentement_soins_medicaux'] ?? false) ? 'checked' : ''; ?>>

        <label for="consentement_photos_videos"><?php echo translate('consentement_photos_videos'); ?>:</label>
        <input type="checkbox" id="consentement_photos_videos" name="consentement_photos_videos" <?php echo ($inscription['consentement_photos_videos'] ?? false) ? 'checked' : ''; ?>>

        <label for="source_information"><?php echo translate('source_information'); ?>:</label>
        <select id="source_information" name="source_information">
            <option value="" <?php echo ($inscription['source_information'] ?? '') == '' ? 'selected' : ''; ?>><?php echo translate('choisir_option'); ?></option>
            <option value="ecole" <?php echo ($inscription['source_information'] ?? '') == 'ecole' ? 'selected' : ''; ?>><?php echo translate('ecole'); ?></option>
            <option value="bouche_a_oreille" <?php echo ($inscription['source_information'] ?? '') == 'bouche_a_oreille' ? 'selected' : ''; ?>><?php echo translate('bouche_a_oreille'); ?></option>
            <option value="internet" <?php echo ($inscription['source_information'] ?? '') == 'internet' ? 'selected' : ''; ?>><?php echo translate('internet'); ?></option>
            <option value="autre" <?php echo ($inscription['source_information'] ?? '') == 'autre' ? 'selected' : ''; ?>><?php echo translate('autre'); ?></option>
        </select>

        <input type="submit" value="<?php echo translate('enregistrer_inscription'); ?>">
    </form>
    <p><a href="index.php"><?php echo translate('retour_tableau_bord'); ?></a></p>

    <script src="js/inscription.js"></script>
</body>
</html>