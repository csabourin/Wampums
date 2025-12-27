import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { translate } from "./app.js";
import { DynamicFormHandler } from "./dynamicFormHandler.js";
import { setContent } from "./utils/DOMUtils.js";
import {
  fetchParticipant,
  fetchParents,
  getCurrentOrganizationId,
} from "./ajax-functions.js";

export class FicheSante {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.parents = [];
    this.participantId = null;
    this.formHandler = null;
    this.organizationId = null;
  }

  async init(participantId) {
    this.participantId = participantId;
    try {
      await this.fetchData();
      await this.initializeFormHandler();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing fiche sante:", error);
      this.renderError(translate("error_loading_fiche_sante"));
    }
  }

  async fetchData() {
    try {
      [this.participant, this.parents, this.organizationId] = await Promise.all([
        fetchParticipant(this.participantId),
        fetchParents(this.participantId),
        getCurrentOrganizationId(),
      ]);

      debugLog("Fetched participant:", this.participant);
      debugLog("Fetched parents:", this.parents);
      debugLog("Organization ID:", this.organizationId);

      if (!this.participant) {
        throw new Error("Participant data is missing");
      }
    } catch (error) {
      debugError("Error fetching fiche sante data:", error);
      throw error;
    }
  }

  async initializeFormHandler() {
    // Initialize the DynamicFormHandler for the fiche_sante form
    this.formHandler = new DynamicFormHandler(this.app);
    await this.formHandler.init(
      'fiche_sante',
      this.participantId,
      {},
      'fiche-sante-container',
      false,
      null,
      null,
      this.organizationId
    );
  }

  render() {
    const content = `
      <div class="fiche-sante-form">
        <h1>${translate("fiche_sante")}</h1>

        <!-- General Information Section -->
        <div class="general-info">
          <h2>${translate("informations_generales")}</h2>
          <div class="form-group">
            <p><strong>${translate("nom_complet")}:</strong> ${this.participant.first_name} ${this.participant.last_name}</p>
            <p><strong>${translate("date_naissance")}:</strong> ${this.participant.date_naissance}</p>
          </div>
        </div>

        <!-- Dynamic Form Container -->
        <form id="fiche-sante-form">
          <div id="fiche-sante-container"></div>

          <!-- Emergency Contacts Section -->
          ${this.renderEmergencyContacts()}

          <div class="form-group">
            <button type="submit">${translate("enregistrer_fiche_sante")}</button>
          </div>
        </form>
      </div>
      <p><a href="/dashboard">${translate("retour_tableau_bord")}</a></p>
    `;

    setContent(document.getElementById("app"), content);
    // Re-initialize the form handler after the container is in the DOM
    if (this.formHandler) {
      this.formHandler.container = document.getElementById('fiche-sante-container');
      this.formHandler.render();
    }
  }

  renderEmergencyContacts() {
    if (!this.parents || this.parents.length === 0) {
      return '';
    }

    return `
      <h2>${translate("urgence")}</h2>
      ${this.parents
        .map(
          (parent, index) => `
            <div class="form-group">
              <h3>${translate("contact")} ${index + 1}</h3>
              <p>${parent.prenom} ${parent.nom}</p>
              <p>${translate("telephone")}: ${parent.telephone_cellulaire || parent.telephone_residence || parent.telephone_travail || translate("no_phone")}</p>
              <div class="checkbox-group">
                <input type="checkbox" id="emergency_contact_${parent.id}" name="emergency_contacts[]" value="${parent.id}" ${parent.is_emergency_contact ? "checked" : ""}>
                <label for="emergency_contact_${parent.id}">${translate("is_emergency_contact")}</label>
              </div>
            </div>
          `
        )
        .join("")}
    `;
  }

  attachEventListeners() {
    const formElement = document.getElementById("fiche-sante-form");
    if (formElement) {
      formElement.addEventListener("submit", (e) => this.handleSubmit(e));
    }
  }

  async handleSubmit(e) {
    e.preventDefault();

    try {
      // Get form data from the dynamic form handler
      const ficheSanteData = this.formHandler.getFormData();

      // Get emergency contacts
      const formData = new FormData(e.target);
      const emergencyContacts = formData.getAll("emergency_contacts[]");

      // Merge the data
      const completeData = {
        ...ficheSanteData,
        emergency_contacts: emergencyContacts,
        participant_id: this.participantId,
      };

      debugLog("Submitting fiche sante data:", completeData);

      // Save using the form handler's save method
      await this.formHandler.saveFormData(completeData);

      // Navigate back to dashboard on success
      this.app.router.navigate("/dashboard");
    } catch (error) {
      debugError("Error saving fiche sante:", error);
      this.renderError(translate("error_saving_fiche_sante"));
    }
  }

  renderError(message) {
    const errorMessage = `
      <h1>${translate("error")}</h1>
      <p>${message}</p>
      <p><a href="/dashboard">${translate("retour_tableau_bord")}</a></p>
    `;
    setContent(document.getElementById("app"), errorMessage);
  }
}
