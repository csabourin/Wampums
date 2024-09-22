import { translate } from "./app.js";
import {
  fetchParticipant,
  saveFicheSante,
  getParentsGuardians,
  fetchFicheSante,
} from "./ajax-functions.js";

export class FicheSante {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.ficheSante = null;
    this.parents = [];
    this.participantId = null;
  }

  async init(participantId) {
    this.participantId = participantId;
    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      console.error("Error initializing fiche sante:", error);
      this.renderError(translate("error_loading_fiche_sante"));
    }
  }

  async fetchData() {
    try {
      [this.participant, this.ficheSante, this.parents] = await Promise.all([
        fetchParticipant(this.participantId),
        fetchFicheSante(this.participantId),
        getParentsGuardians(this.participantId),
      ]);

      console.log("Fetched participant:", this.participant); // Verify participant data
      console.log("Fetched fiche sante:", this.ficheSante); // Verify fiche sante data

      if (!this.participant) {
        throw new Error("Participant data is missing");
      }
    } catch (error) {
      console.error("Error fetching fiche sante data:", error);
      throw error;
    }
  }

  render() {
    const content = `
            <div class="fiche-sante-form">
                <h1>${translate("fiche_sante")}</h1>
                <form id="fiche-sante-form">
                    ${this.renderGeneralInfo()}
                    ${this.renderMedicalInfo()}
                    ${this.renderEmergencyContacts()}
                    ${this.renderNatationInfo()}
                    ${this.renderForGirls()}
                    <div class="form-group">
                        <button type="submit">${translate(
                          "enregistrer_fiche_sante"
                        )}</button>
                    </div>
                </form>
            </div>
            <p><a href="/dashboard">${translate("retour_tableau_bord")}</a></p>
        `;
    document.getElementById("app").innerHTML = content;
  }

  renderGeneralInfo() {
    console.log("Rendering general info, ficheSante:", this.ficheSante); // Debugging output
    return `
      <h2>${translate("informations_generales")}</h2>
      <div class="form-group">
        <p>${translate("nom_complet")}: ${this.participant.first_name} ${
      this.participant.last_name
    }</p>
        <p>${translate("date_naissance")}: ${
      this.participant.date_naissance
    }</p>
      </div>
      <div class="form-group">
        <label for="nom_fille_mere">${translate("nom_fille_mere")}:</label>
        <input type="text" id="nom_fille_mere" name="nom_fille_mere" value="${
          this.ficheSante?.nom_fille_mere || ""
        }">
      </div>
    `;
  }

  renderMedicalInfo() {
    return `
            <h2>${translate("informations_medicales")}</h2>
            <div class="form-group checkbox-group">
                <input type="checkbox" id="medecin_famille" name="medecin_famille" ${
                  this.ficheSante?.medecin_famille ? "checked" : ""
                }>
                <label for="medecin_famille">${translate(
                  "medecin_famille"
                )}</label>
            </div>
            <div class="form-group">
                <label for="nom_medecin">${translate("nom_medecin")}:</label>
                <input type="text" id="nom_medecin" name="nom_medecin" value="${
                  this.ficheSante?.nom_medecin || ""
                }">
            </div>
            <div class="form-group">
                <label for="probleme_sante">${translate(
                  "probleme_sante"
                )}:</label>
                <textarea id="probleme_sante" name="probleme_sante">${
                  this.ficheSante?.probleme_sante || ""
                }</textarea>
            </div>
            <div class="form-group">
                <label for="allergie">${translate("allergie")}:</label>
                <textarea id="allergie" name="allergie">${
                  this.ficheSante?.allergie || ""
                }</textarea>
            </div>
            <div class="form-group checkbox-group">
                <input type="checkbox" id="epipen" name="epipen" ${
                  this.ficheSante?.epipen ? "checked" : ""
                }>
                <label for="epipen">${translate("epipen")}</label>
            </div>
            <div class="form-group">
                <label for="medicament">${translate("medicament")}:</label>
                <textarea id="medicament" name="medicament">${
                  this.ficheSante?.medicament || ""
                }</textarea>
            </div>
            <div class="form-group">
                <label for="limitation">${translate("limitation")}:</label>
                <textarea id="limitation" name="limitation">${
                  this.ficheSante?.limitation || ""
                }</textarea>
            </div>
            <div class="form-group checkbox-group">
                <input type="checkbox" id="vaccins_a_jour" name="vaccins_a_jour" ${
                  this.ficheSante?.vaccins_a_jour ? "checked" : ""
                }>
                <label for="vaccins_a_jour">${translate(
                  "vaccins_a_jour"
                )}</label>
            </div>
            <div class="form-group">
                <label for="blessures_operations">${translate(
                  "blessures_operations"
                )}:</label>
                <textarea id="blessures_operations" name="blessures_operations">${
                  this.ficheSante?.blessures_operations || ""
                }</textarea>
            </div>
        `;
  }

  renderEmergencyContacts() {
    return `
            <h2>${translate("urgence")}</h2>
            ${this.parents
              .map(
                (parent, index) => `
                <div class="form-group">
                    <h3>${translate("contact")} ${index + 1}</h3>
                    <p>${parent.prenom} ${parent.nom}</p>
                    <p>${translate("telephone")}: ${
                  parent.telephone_cellulaire
                }</p>
                    <div class="checkbox-group">
                        <input type="checkbox" id="emergency_contact_${
                          parent.id
                        }" name="emergency_contacts[]" value="${parent.id}" ${
                  parent.is_emergency_contact ? "checked" : ""
                }>
                        <label for="emergency_contact_${parent.id}">${translate(
                  "is_emergency_contact"
                )}</label>
                    </div>
                </div>
            `
              )
              .join("")}
        `;
  }

  renderNatationInfo() {
    return `
            <h2>${translate("natation")}</h2>
            <div class="form-group">
                <label for="niveau_natation">${translate(
                  "niveau_natation"
                )}:</label>
                <select id="niveau_natation" name="niveau_natation">
                    <option value="ne_sait_pas_nager" ${
                      this.ficheSante?.niveau_natation === "ne_sait_pas_nager"
                        ? "selected"
                        : ""
                    }>${translate("ne_sait_pas_nager")}</option>
                    <option value="eau_peu_profonde" ${
                      this.ficheSante?.niveau_natation === "eau_peu_profonde"
                        ? "selected"
                        : ""
                    }>${translate("eau_peu_profonde")}</option>
                    <option value="eau_profonde" ${
                      this.ficheSante?.niveau_natation === "eau_profonde"
                        ? "selected"
                        : ""
                    }>${translate("eau_profonde")}</option>
                </select>
            </div>
            <div class="form-group checkbox-group">
                <input type="checkbox" id="doit_porter_vfi" name="doit_porter_vfi" ${
                  this.ficheSante?.doit_porter_vfi ? "checked" : ""
                }>
                <label for="doit_porter_vfi">${translate(
                  "doit_porter_vfi"
                )}</label>
            </div>
        `;
  }

  renderForGirls() {
    return `
            <h2>${translate("pour_filles")}</h2>
            <div class="form-group checkbox-group">
                <input type="checkbox" id="regles" name="regles" ${
                  this.ficheSante?.regles ? "checked" : ""
                }>
                <label for="regles">${translate("regles")}</label>
            </div>
            <div class="form-group checkbox-group">
                <input type="checkbox" id="renseignee" name="renseignee" ${
                  this.ficheSante?.renseignee ? "checked" : ""
                }>
                <label for="renseignee">${translate("renseignee")}</label>
            </div>
        `;
  }

  attachEventListeners() {
    document
      .getElementById("fiche-sante-form")
      .addEventListener("submit", (e) => this.handleSubmit(e));
  }

  async handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const ficheSanteData = {
      participant_id: this.participantId,
      nom_fille_mere: formData.get("nom_fille_mere"),
      medecin_famille: formData.get("medecin_famille") ? 1 : 0,
      nom_medecin: formData.get("medecin_famille")
        ? formData.get("nom_medecin")
        : null,
      probleme_sante: formData.get("probleme_sante"),
      allergie: formData.get("allergie"),
      epipen: formData.get("epipen") ? 1 : 0,
      medicament: formData.get("medicament"),
      limitation: formData.get("limitation"),
      vaccins_a_jour: formData.get("vaccins_a_jour") ? 1 : 0,
      blessures_operations: formData.get("blessures_operations"),
      niveau_natation: formData.get("niveau_natation"),
      doit_porter_vfi: formData.get("doit_porter_vfi") ? 1 : 0,
      regles: formData.get("regles") ? 1 : 0,
      renseignee: formData.get("renseignee") ? 1 : 0,
      emergency_contacts: formData.getAll("emergency_contacts[]"),
    };

    try {
      await saveFicheSante(ficheSanteData);
      this.app.router.navigate("/dashboard");
    } catch (error) {
      console.error("Error saving fiche sante:", error);
      this.renderError(translate("error_saving_fiche_sante"));
    }
  }

  renderError(message) {
    const errorMessage = `
            <h1>${translate("error")}</h1>
            <p>${message}</p>
            <p><a href="/dashboard">${translate("retour_tableau_bord")}</a></p>
        `;
    document.getElementById("app").innerHTML = errorMessage;
  }
}
