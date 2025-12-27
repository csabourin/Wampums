import {
  debugLog,
  debugError,
  debugWarn,
  debugInfo,
} from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import {
  getBadgeProgress,
  saveBadgeProgress,
  getCurrentStars,
  fetchParticipant,
  getBadgeSystemSettings,
} from "./ajax-functions.js";

export class BadgeForm {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.badgeProgress = [];
    this.currentStars = 0;
    this.hasPending = false;
    this.maxLevel = 3;
    this.formData = {};
    this.badgeSystemSettings = null;
    this.territoires = [];
    this.templates = [];
    this.participantSection = "general";
  }

  async init(participantId) {
    try {
      await this.fetchBadgeSystemSettings();
      await this.fetchParticipant(participantId);
      await this.fetchBadgeProgress();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing badge form:", error);
      this.renderError();
    }
  }

  async fetchBadgeSystemSettings() {
    try {
      const result = await getBadgeSystemSettings();
      if (result && result.data) {
        this.badgeSystemSettings = result.data;
        this.templates = result.data.templates || [];
        this.territoires = result.data.territoires || [];
      } else {
        this.templates = [];
        this.territoires = this.getDefaultTerritoires();
      }
    } catch (error) {
      debugError("Error fetching badge system settings:", error);
      this.templates = [];
      this.territoires = this.getDefaultTerritoires();
    }
  }

  getDefaultTerritoires() {
    return [
      { name: "Débrouillard comme Kaa", image: "kaa.png" },
      { name: "Vrai comme Baloo", image: "baloo.png" },
      { name: "Respectueux comme Rikki Tikki Tavi", image: "rikki.png" },
      { name: "Dynamique comme Bagheera", image: "bagheera.png" },
      { name: "Heureux comme Ferao", image: "ferao.png" },
      { name: "Solidaire comme Frère Gris", image: "frereGris.png" },
    ];
  }

  getTemplatesForSection() {
    const section = this.participantSection || "general";
    return (this.templates || []).filter(
      (template) =>
        template.section === section || template.section === "general",
    );
  }

  getTemplateById(templateId) {
    const normalizedId = Number.isFinite(Number(templateId))
      ? Number(templateId)
      : templateId;
    return (this.templates || []).find(
      (template) => template.id === normalizedId,
    );
  }

  getTemplateLabel(template) {
    if (!template) return translate("badge_unknown_label");
    return (
      translate(template.translation_key) ||
      template.name ||
      translate("badge_unknown_label")
    );
  }

  async fetchParticipant(participantId) {
    try {
      const result = await fetchParticipant(participantId);
      if (!result || !result.participant) {
        // Check if the participant exists in the response
        throw new Error("Participant not found");
      }
      this.participant = result.participant; // Assign the participant object correctly
      this.participantSection =
        this.participant.group_section || this.participant.section || "general";
    } catch (error) {
      debugError("Error fetching participant:", error);
      throw new Error(`Failed to fetch participant: ${error.message}`);
    }
  }

  async fetchBadgeProgress() {
    const result = await getBadgeProgress(this.participant.id);
    this.badgeProgress = Array.isArray(result) ? result : result?.data || [];
  }

  updateFormData() {
    const form = document.getElementById("badge-form");
    const templateId = parseInt(
      form.querySelector("#badge_template_id")?.value,
      10,
    );
    this.formData = {
      badge_template_id: templateId,
      badge_template_label: this.getTemplateLabel(
        this.getTemplateById(templateId),
      ),
      objectif: form.querySelector("#objectif").value,
      description: form.querySelector("#description").value,
      fierte: form.querySelector("#fierte").checked,
      raison: form.querySelector("#raison").value,
      date_obtention: form.querySelector("#date_obtention").value,
    };
  }

  renderTemplateOptions() {
    return this.getTemplatesForSection()
      .map(
        (template) =>
          `<option value="${template.id}">${this.getTemplateLabel(template)}</option>`,
      )
      .join("");
  }

  render() {
    const templates = this.getTemplatesForSection();
    const hasTemplates = templates.length > 0;
    const content = `
            <h1>${translate("badge_progress_form")}</h1>
            <h2>${this.participant ? `${this.participant.first_name} ${this.participant.last_name}` : translate("participant_name")}</h2>
            <div id="success-message" class="hidden"></div>
            <button id="print-view-btn">${translate("print_badge_form")}</button>
            <form id="badge-form">
                <label for="badge_template_id">${
                  translate("badge_select_badge") || translate("badge")
                }:</label>
                <select id="badge_template_id" name="badge_template_id" required ${hasTemplates ? "" : "disabled"}>
                    <option value="-1" selected disabled>...</option>
                    ${this.renderTemplateOptions()}
                </select>
                ${hasTemplates ? "" : `<p class="warning">${translate("no_badge_templates_for_section") || translate("no_badges") || ""}</p>`}

                <div id="starInfo">
                    ${translate(
                      "current_stars",
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
                  "date_obtention",
                )}:</label>
                <input type="date" id="date_obtention" name="date_obtention" required>

                <input type="submit" id="submitButton" ${hasTemplates ? "" : "disabled"} value="${translate(
                  "save_badge_progress",
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
    const printWindow = window.open("", "_blank");
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
            <label>${translate("badge_select_badge") || translate("badge")}:</label>
            <div class="input-line">${this.formData.badge_template_label || ""}</div>
          </div>

          <div class="form-field">
            <label>${translate("objectif_proie")}:</label>
            <div class="input-line long-input">${this.formData.objectif || ""}</div>
          </div>

          <div class="form-field">
            <label>${translate("description")}:</label>
            <div class="input-line long-input">${this.formData.description || ""}</div>
          </div>

          <div class="form-field checkbox-field">
            <input type="checkbox" ${this.formData.fierte ? "checked" : ""} disabled>
            <label>${translate("fierte")}</label>
          </div>

          <div class="form-field">
            <label>${translate("raison")}:</label>
            <div class="input-line long-input">${this.formData.raison || ""}</div>
          </div>

          <div class="form-field">
            <label>${translate("date_obtention")}:</label>
            <div class="input-line">${this.formData.date_obtention || ""}</div>
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
    const templates = this.getTemplatesForSection();

    if (!templates.length) {
      return `<p class="muted">${translate("no_badge_templates_for_section") || translate("no_badges") || ""}</p>`;
    }

    return templates
      .map((template) => {
        const entries = this.badgeProgress.filter(
          (b) => b.badge_template_id === template.id,
        );
        const approvedEntries = entries.filter((b) => b.status === "approved");
        const pendingEntries = entries.filter((b) => b.status === "pending");
        const approvedLevels = this.countLevels(approvedEntries, template);
        const pendingLevels = this.countLevels(pendingEntries, template);
        const levelCount = template.level_count || template.levels?.length || 3;
        const latestEntry = this.getLatestEntry(approvedEntries);
        const imageName =
          template.image || this.getTerritoireImage(template.name);

        return `
                <div class="badge-item">
                    ${imageName ? `<img src="/assets/images/${imageName}" alt="${this.getTemplateLabel(template)}" class="badge-image">` : ""}
                    <h3>${this.getTemplateLabel(template)}</h3>
                    <div class="stars">
                        ${this.renderStars(approvedLevels, pendingLevels, levelCount)}
                    </div>
                    ${latestEntry ? this.renderBadgeDetails(latestEntry) : ""}
                </div>
            `;
      })
      .join("");
  }

  countLevels(entries = [], template = null, uniqueOnly = true) {
    const levelLimit =
      template?.level_count ||
      (Array.isArray(template?.levels) ? template.levels.length : 0);
    if (!uniqueOnly) {
      return entries.length;
    }
    const levelSet = new Set();
    entries.forEach((entry) => {
      const level = parseInt(entry.etoiles, 10) || 0;
      if (level > 0 && (!levelLimit || level <= levelLimit)) {
        levelSet.add(level);
      }
    });
    return levelSet.size;
  }

  getLatestEntry(entries = []) {
    if (!entries.length) return null;
    return [...entries].sort(
      (a, b) =>
        new Date(b.date_obtention || 0) - new Date(a.date_obtention || 0),
    )[0];
  }

  renderStars(stars, pendingStars, total = 3) {
    let html = "";
    for (let i = 0; i < total; i++) {
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
            <p>${translate("badge_select_badge") || translate("badge")}: ${badge.badge_name || badge.territoire_chasse || ""}</p>
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
    const found = this.territoires.find((t) => t.name === territoire);
    return found ? found.image : "default.jpg";
  }

  getPendingStars(templateId) {
    return this.badgeProgress.filter(
      (b) => b.badge_template_id === templateId && b.status === "pending",
    ).length;
  }

  attachEventListeners() {
    const form = document.getElementById("badge-form");
    const fierteCheckbox = document.getElementById("fierte");
    const raisonTextarea = document.getElementById("raison");
    const templateSelect = document.getElementById("badge_template_id");
    const submitButton = document.getElementById("submitButton");

    document.getElementById("badge-form").addEventListener("input", (e) => {
      this.updateFormData();
    });

    document.getElementById("print-view-btn").addEventListener("click", () => {
      this.updateFormData();
      this.renderPrintView();
    });

    fierteCheckbox.addEventListener("change", () => {
      raisonTextarea.required = fierteCheckbox.checked;
    });

    templateSelect?.addEventListener("change", () => {
      const templateId = parseInt(templateSelect.value, 10);
      if (Number.isInteger(templateId)) {
        this.fetchCurrentStars(templateId);
      }
    });

    form.addEventListener("submit", (e) => this.handleSubmit(e));
  }

  async fetchCurrentStars(templateId) {
    try {
      const response = await getCurrentStars(this.participant.id, templateId);
      const data = response?.data || response;
      this.currentStars = data.current_stars;
      this.hasPending = data.has_pending;
      this.maxLevel = data.max_level || this.maxLevel || 3;
      document.getElementById("currentStars").value = this.currentStars;
      document.getElementById("currentStarsDisplay").textContent =
        this.currentStars;
      this.updateSubmitButton();
    } catch (error) {
      debugError("Error fetching current stars:", error);
    }
  }

  updateSubmitButton() {
    const submitButton = document.getElementById("submitButton");
    const reachedMax = this.currentStars >= (this.maxLevel || 3);
    if (reachedMax || this.hasPending) {
      submitButton.disabled = true;
      submitButton.value = reachedMax
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
        const payload = Object.fromEntries(formData);
        payload.badge_template_id = parseInt(payload.badge_template_id, 10);
        payload.participant_id = this.participant.id;

        const result = await saveBadgeProgress(payload);
        if (result.success) {
          this.showSuccessMessage(
            translate("badge_progress_submitted_for_approval"),
          );
          await this.fetchBadgeProgress();
          this.render();
        } else {
          throw new Error(JSON.stringify(result));
        }
      } catch (error) {
        debugError("Error saving badge progress:", error);
        alert(translate("error_saving_badge_progress") + ": " + error.message);
      }
    }
  }

  validateForm(form) {
    let isValid = true;
    const errorMessages = [];

    form.querySelectorAll("[required]").forEach((field) => {
      if (!field.value.trim() || field.value === "-1") {
        isValid = false;
        errorMessages.push(
          `${field.previousElementSibling.textContent.replace(
            ":",
            "",
          )} is required.`,
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
