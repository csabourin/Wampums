import { translate } from "./app.js";
import {
  getBadgeProgress,
  saveBadgeProgress,
  getCurrentStars,
  fetchParticipant
} from "./ajax-functions.js";

export class BadgeForm {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.badgeProgress = [];
    this.currentStars = 0;
    this.hasPending = false;
    this.formData = {};
  }

  async init(participantId) {
    try {
      await this.fetchParticipant(participantId);
      await this.fetchBadgeProgress();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      console.error("Error initializing badge form:", error);
      this.renderError();
    }
  }

  async fetchParticipant(participantId) {
    try {
      this.participant = await fetchParticipant(participantId);
      if (!this.participant) {
        throw new Error("Participant not found");
      }
    } catch (error) {
      console.error("Error fetching participant:", error);
      throw new Error(`Failed to fetch participant: ${error.message}`);
    }
  }

  async fetchBadgeProgress() {
    this.badgeProgress = await getBadgeProgress(this.participant.id);
  }

  updateFormData() {
    const form = document.getElementById('badge-form');
    this.formData = {
      territoire_chasse: form.querySelector('#territoire_chasse').value,
      objectif: form.querySelector('#objectif').value,
      description: form.querySelector('#description').value,
      fierte: form.querySelector('#fierte').checked,
      raison: form.querySelector('#raison').value,
      date_obtention: form.querySelector('#date_obtention').value,
    };
  }

  render() {
    const content = `
            <h1>${translate("badge_progress_form")}</h1>
            <h2>${this.participant ? `${this.participant.first_name} ${this.participant.last_name}` : translate("participant_name")}</h2>
            <div id="success-message" style="display: none;"></div>
            <button id="print-view-btn">${translate("print_badge_form")}</button>
            <form id="badge-form">
                <label for="territoire_chasse">${translate(
                  "territoire_chasse"
                )}:</label>
                <select id="territoire_chasse" name="territoire_chasse" required>
                    <option value="-1" selected disabled>...</option>
                    <option value="Débrouillard comme Kaa">Débrouillard comme Kaa</option>
                    <option value="Vrai comme Baloo">Vrai comme Baloo</option>
                    <option value="Respectueux comme Rikki Tikki Tavi">Respectueux comme Rikki Tikki Tavi</option>
                    <option value="Dynamique comme Bagheera">Dynamique comme Bagheera</option>
                    <option value="Heureux comme Ferao">Heureux comme Ferao</option>
                    <option value="Solidaire comme Frère Gris">Solidaire comme Frère Gris</option>
                </select>

                <div id="starInfo">
                    ${translate(
                      "current_stars"
                    )}: <span id="currentStarsDisplay">0</span>
                </div>

                <input type="hidden" id="currentStars" name="currentStars" value="0">
                <input type="hidden" name="participant_id" value="${
                  this.participant.id
                }">


                <label for="objectif">${translate("objectif_proie")}:</label>
                <textarea id="objectif" name="objectif" required></textarea>

                <label for="description">${translate("description")}:</label>
                <textarea id="description" name="description" required></textarea>

                <label for="fierte">${translate("fierte")}:</label>
                <input type="checkbox" id="fierte" name="fierte">

                <label for="raison">${translate("raison")}:</label>
                <textarea id="raison" name="raison" required></textarea>

                <label for="date_obtention">${translate(
                  "date_obtention"
                )}:</label>
                <input type="date" id="date_obtention" name="date_obtention" required>

                <input type="hidden" id="etoiles" name="etoiles" value="1">

                <input type="submit" id="submitButton" value="${translate(
                  "save_badge_progress"
                )}">
            </form>

            <h2>${translate("existing_badge_progress")}</h2>
            <div class="badge-grid">
                ${this.renderBadgeGrid()}
            </div>

            <p><a href="/parent-dashboard">${translate("back_to_dashboard")}</a></p>
        `;

    document.getElementById("app").innerHTML = content;
  }

  renderPrintView() {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>${translate("badge_application_form")}</title>
          <style>
            @page {
              size: letter;
              margin: 0.5in;
            }
            body {
              font-family: Arial, sans-serif;
              font-size: 14pt;
            }
            h1, h2 {
              text-align: center;
            }
            .form-field {
              margin-bottom: 20px;
            }
            .form-field label {
              display: block;
              font-weight: bold;
              margin-bottom: 5px;
            }
            .form-field .input-line {
              border-bottom: 1px solid black;
              min-height: 30px;
              width: 100%;
              word-wrap: break-word;
            }
            .long-input {
              min-height: 90px;
            }
            .signature-line {
              border-top: 1px solid black;
              width: 50%;
              margin-top: 50px;
            }
            .checkbox-field {
              display: flex;
              align-items: center;
            }
            .checkbox-field input {
              margin-right: 10px;
            }
          </style>
        </head>
        <body>
          <h1>${translate("badge_application_form")}</h1>
          <h2>${this.participant ? `${this.participant.first_name} ${this.participant.last_name}` : translate("participant_name")}</h2>

          <div class="form-field">
            <label>${translate("territoire_chasse")}:</label>
            <div class="input-line">${this.formData.territoire_chasse || ''}</div>
          </div>

          <div class="form-field">
            <label>${translate("objectif_proie")}:</label>
            <div class="input-line long-input">${this.formData.objectif || ''}</div>
          </div>

          <div class="form-field">
            <label>${translate("description")}:</label>
            <div class="input-line long-input">${this.formData.description || ''}</div>
          </div>

          <div class="form-field checkbox-field">
            <input type="checkbox" ${this.formData.fierte ? 'checked' : ''} disabled>
            <label>${translate("fierte")}</label>
          </div>

          <div class="form-field">
            <label>${translate("raison")}:</label>
            <div class="input-line long-input">${this.formData.raison || ''}</div>
          </div>

          <div class="form-field">
            <label>${translate("date_obtention")}:</label>
            <div class="input-line">${this.formData.date_obtention || ''}</div>
          </div>

          <div class="form-field">
            <label>${translate("signature_participant")}:</label>
            <div class="signature-line"></div>
          </div>

          <div class="form-field">
            <label>${translate("signature_parent")}:</label>
            <div class="signature-line"></div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  }

  renderBadgeGrid() {
    const territoires = [
      "Débrouillard comme Kaa",
      "Vrai comme Baloo",
      "Respectueux comme Rikki Tikki Tavi",
      "Dynamique comme Bagheera",
      "Heureux comme Ferao",
      "Solidaire comme Frère Gris",
    ];

    return territoires
      .map((territoire) => {
        const badge = this.badgeProgress.find(
          (b) => b.territoire_chasse === territoire && b.status === "approved"
        );
        const stars = badge ? badge.etoiles : 0;
        const pendingStars = this.getPendingStars(territoire);

        return `
                <div class="badge-item">
                    <img src="images/${this.getTerritoireImage(
                      territoire
                    )}" alt="${territoire}">
                    <h3>${territoire}</h3>
                    <div class="stars">
                        ${this.renderStars(stars, pendingStars)}
                    </div>
                    ${badge ? this.renderBadgeDetails(badge) : ""}
                </div>
            `;
      })
      .join("");
  }

  renderStars(stars, pendingStars) {
    let html = "";
    for (let i = 0; i < 3; i++) {
      if (i < stars) {
        html += "⭐";
      } else if (i < stars + pendingStars) {
        html += "🕒"; // Pending star
      } else {
        html += "☆";
      }
    }
    return html;
  }

  renderBadgeDetails(badge) {
    return `
            <p>${translate("date")}: ${badge.date_obtention}</p>
            <details>
                <summary>${translate("details")}</summary>
                <p>${translate("objectif")}: ${badge.objectif}</p>
                <p>${translate("description")}: ${badge.description}</p>
                <p>${translate("fierte")}: ${
      badge.fierte ? translate("yes") : translate("no")
    }</p>
                <p>${translate("raison")}: ${badge.raison}</p>
            </details>
        `;
  }

  getTerritoireImage(territoire) {
    const imageMap = {
      "Débrouillard comme Kaa": "kaa.jpg",
      "Vrai comme Baloo": "baloo.jpg",
      "Respectueux comme Rikki Tikki Tavi": "rikki.jpg",
      "Dynamique comme Bagheera": "bagheera.jpg",
      "Heureux comme Ferao": "ferao.jpg",
      "Solidaire comme Frère Gris": "frereGris.jpg",
    };
    return imageMap[territoire] || "default.jpg";
  }

  getPendingStars(territoire) {
    return this.badgeProgress.filter(
      (b) => b.territoire_chasse === territoire && b.status === "pending"
    ).length;
  }

  attachEventListeners() {
    const form = document.getElementById("badge-form");
    const fierteCheckbox = document.getElementById("fierte");
    const raisonTextarea = document.getElementById("raison");
    const territoireSelect = document.getElementById("territoire_chasse");
    const submitButton = document.getElementById("submitButton");

    document.getElementById('badge-form').addEventListener('input', (e) => {
      this.updateFormData();
    });

    document.getElementById('print-view-btn').addEventListener('click', () => {
      this.updateFormData();
      this.renderPrintView();
    });

    fierteCheckbox.addEventListener("change", () => {
      raisonTextarea.required = fierteCheckbox.checked;
    });

    territoireSelect.addEventListener("change", () => {
      this.fetchCurrentStars(territoireSelect.value);
    });

    form.addEventListener("submit", (e) => this.handleSubmit(e));
  }

  async fetchCurrentStars(territoire) {
    try {
      const data = await getCurrentStars(this.participant.id, territoire);
      this.currentStars = data.current_stars;
      this.hasPending = data.has_pending;
      document.getElementById("currentStars").value = this.currentStars;
      document.getElementById("currentStarsDisplay").textContent =
        this.currentStars;
      this.updateSubmitButton();
    } catch (error) {
      console.error("Error fetching current stars:", error);
    }
  }

  updateSubmitButton() {
    const submitButton = document.getElementById("submitButton");
    if (this.currentStars >= 3 || this.hasPending) {
      submitButton.disabled = true;
      submitButton.value =
        this.currentStars >= 3
          ? translate("max_stars_reached")
          : translate("pending_submission_exists");
    } else {
      submitButton.disabled = false;
      submitButton.value = translate("save_badge_progress");
    }
  }

  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    if (this.validateForm(form)) {
      try {
        const result = await saveBadgeProgress(Object.fromEntries(formData));
        if (result.status === "success") {
          this.showSuccessMessage(
            translate("badge_progress_submitted_for_approval")
          );
          await this.fetchBadgeProgress();
          this.render();
        } else {
          throw new Error(JSON.stringify(result));
        }
      } catch (error) {
        console.error("Error saving badge progress:", error);
        alert(translate("error_saving_badge_progress") + ": " + error.message);
      }
    }
  }

  validateForm(form) {
    let isValid = true;
    const errorMessages = [];

    form.querySelectorAll("[required]").forEach((field) => {
      if (!field.value.trim()) {
        isValid = false;
        errorMessages.push(
          `${field.previousElementSibling.textContent.replace(
            ":",
            ""
          )} is required.`
        );
      }
    });

    if (!isValid) {
      alert(errorMessages.join("\n"));
    }

    return isValid;
  }

  showSuccessMessage(message) {
    const successMessage = document.getElementById("success-message");
    successMessage.textContent = message;
    successMessage.style.display = "block";
    setTimeout(() => {
      successMessage.style.display = "none";
    }, 3000);
  }

  renderError() {
    const errorMessage = `
            <h1>${translate("error")}</h1>
            <p>${translate("error_loading_badge_form")}</p>
        `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
