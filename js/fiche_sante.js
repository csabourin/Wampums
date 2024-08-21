document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    const medecinFamilleCheckbox = document.getElementById('medecin_famille');
    const nomMedecinInput = document.getElementById('nom_medecin');
    const epipenCheckbox = document.getElementById('epipen');
    const allergieTextarea = document.getElementById('allergie');
    const niveauNatationSelect = document.getElementById('niveau_natation');
    const doitPorterVfiCheckbox = document.getElementById('doit_porter_vfi');
    const reglesCheckbox = document.getElementById('regles');
    const renseigneeCheckbox = document.getElementById('renseignee');

    // Function to validate phone number (adjust regex as needed for your format)
    function isValidPhone(phone) {
        const re = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
        return re.test(phone);
    }

    // Toggle nom_medecin input based on medecin_famille checkbox
    medecinFamilleCheckbox.addEventListener('change', function() {
        nomMedecinInput.disabled = !this.checked;
        if (!this.checked) {
            nomMedecinInput.value = '';
        }
    });

    // Require allergie textarea if epipen is checked
    epipenCheckbox.addEventListener('change', function() {
        allergieTextarea.required = this.checked;
        if (this.checked && !allergieTextarea.value.trim()) {
            allergieTextarea.focus();
        }
    });

    // Auto-check doit_porter_vfi if niveau_natation is "ne_sait_pas_nager"
    niveauNatationSelect.addEventListener('change', function() {
        if (this.value === 'ne_sait_pas_nager') {
            doitPorterVfiCheckbox.checked = true;
        }
    });

    // Require renseignee to be checked if regles is checked
    reglesCheckbox.addEventListener('change', function() {
        renseigneeCheckbox.required = this.checked;
        if (this.checked && !renseigneeCheckbox.checked) {
            renseigneeCheckbox.focus();
        }
    });

    // Form validation
    form.addEventListener('submit', function(e) {
        let isValid = true;
        const errorMessages = [];

        // Validate required fields
        form.querySelectorAll('[required]').forEach(field => {
            if (!field.value.trim()) {
                isValid = false;
                errorMessages.push(`Le champ "${field.previousElementSibling.textContent.replace(':', '')}" est requis.`);
            }
        });

        // Validate phone numbers
        ['contact_urgence_1_telephone', 'contact_urgence_2_telephone'].forEach(id => {
            const phoneField = document.getElementById(id);
            if (phoneField.value && !isValidPhone(phoneField.value)) {
                isValid = false;
                errorMessages.push(`Le numéro de téléphone "${phoneField.previousElementSibling.textContent.replace(':', '')}" n'est pas valide.`);
            }
        });

        // Check if nom_medecin is filled when medecin_famille is checked
        if (medecinFamilleCheckbox.checked && !nomMedecinInput.value.trim()) {
            isValid = false;
            errorMessages.push('Veuillez indiquer le nom du médecin de famille.');
        }

        // Check if allergie is filled when epipen is checked
        if (epipenCheckbox.checked && !allergieTextarea.value.trim()) {
            isValid = false;
            errorMessages.push('Veuillez indiquer l\'allergie nécessitant un EpiPen.');
        }

        // Check if renseignee is checked when regles is checked
        if (reglesCheckbox.checked && !renseigneeCheckbox.checked) {
            isValid = false;
            errorMessages.push('Veuillez confirmer que la jeune femme est renseignée sur les règles.');
        }

        if (!isValid) {
            e.preventDefault();
            alert('Veuillez corriger les erreurs suivantes :\n\n' + errorMessages.join('\n'));
        }
    });

    // Initialize form state
    medecinFamilleCheckbox.dispatchEvent(new Event('change'));
    epipenCheckbox.dispatchEvent(new Event('change'));
    reglesCheckbox.dispatchEvent(new Event('change'));
});