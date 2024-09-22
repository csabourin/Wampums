document.addEventListener("DOMContentLoaded", function () {
  const form = document.querySelector("form");
  const peutPartirSeulCheckbox = document.getElementById("peut_partir_seul");
  const demeureChezSelect = document.getElementById("demeure_chez");

  // Function to validate email
  function isValidEmail(email) {
    const re =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
    return re.test(email);
  }

  // Function to validate phone number (adjust regex as needed for your format)
  function isValidPhone(phone) {
    const re = /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$/;
    return re.test(phone);
  }

  // Function to validate postal code (adjust regex for Canadian format)
  function isValidPostalCode(postalCode) {
    const re = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
    return re.test(postalCode);
  }

  // Show/hide parent fields based on "demeure_chez" selection
  demeureChezSelect.addEventListener("change", function () {
    const parentFields = document.querySelectorAll('[id^="parent_"]');
    parentFields.forEach((field) => {
      if (this.value === "mere") {
        field.style.display = field.id.includes("_0") ? "block" : "none";
      } else if (this.value === "pere") {
        field.style.display = field.id.includes("_1") ? "block" : "none";
      } else {
        field.style.display = "block";
      }
    });
  });

  // Disable "peut partir seul" for participants under 12
  document
    .getElementById("date_naissance")
    .addEventListener("change", function () {
      const birthDate = new Date(this.value);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      peutPartirSeulCheckbox.disabled = age < 12;
      if (age < 12) {
        peutPartirSeulCheckbox.checked = false;
      }
    });

  // Form validation
  form.addEventListener("submit", function (e) {
    let isValid = true;
    const errorMessages = [];

    // Validate required fields
    form.querySelectorAll("[required]").forEach((field) => {
      if (!field.value.trim()) {
        isValid = false;
        errorMessages.push(
          `Le champ "${field.previousElementSibling.textContent}" est requis.`
        );
      }
    });

    // Validate email
    const emailField = document.getElementById("courriel");
    if (emailField.value && !isValidEmail(emailField.value)) {
      isValid = false;
      errorMessages.push("L'adresse courriel n'est pas valide.");
    }

    // Validate phone
    const phoneField = document.getElementById("telephone");
    if (!isValidPhone(phoneField.value)) {
      isValid = false;
      errorMessages.push("Le numéro de téléphone n'est pas valide.");
    }

    // Validate postal code
    const postalCodeField = document.getElementById("code_postal");
    if (!isValidPostalCode(postalCodeField.value)) {
      isValid = false;
      errorMessages.push("Le code postal n'est pas valide.");
    }

    if (!isValid) {
      e.preventDefault();
      alert(errorMessages.join("\n"));
    }
  });
});
