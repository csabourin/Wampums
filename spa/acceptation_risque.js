import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import {
  fetchParticipant,
  fetchAcceptationRisque,
  saveAcceptationRisque,
} from "./ajax-functions.js";

export class AcceptationRisque {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.acceptationRisque = null;
    this.participantId = null;
  }

  async init(participantId) {
    this.participantId = participantId;
    try {
      await this.fetchData();
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError("Error initializing acceptation risque:", error);
      this.renderError(translate("error_loading_acceptation_risque"));
    }
  }

  async fetchData() {
    try {
      [this.participant, this.acceptationRisque] = await Promise.all([
        fetchParticipant(this.participantId),
        fetchAcceptationRisque(this.participantId),
      ]);
    } catch (error) {
      debugError("Error fetching acceptation risque data:", error);
      throw error;
    }
  }

  render() {
    const content = `
            <h1>${translate("formulaire_acceptation_risque")}</h1>
            <form id="acceptation-risque-form">
                <h2>${translate("informations_participant")}</h2>
                <p>${translate("nom_participant")}: ${
      this.participant.first_name
    } ${this.participant.last_name}</p>
                <p>${translate("age_participant")}: ${this.calculateAge(
      this.participant.date_naissance
    )}</p>

                <label for="groupe_district">${translate(
                  "groupe_district"
                )}:</label>
                <input type="text" id="groupe_district" name="groupe_district" value="${
                  this.acceptationRisque?.groupe_district || ""
                }" required>

                <h2>${translate("risques_inherents")}</h2>
                <p>${translate("paragraphe_acceptation_risque")}</p>
                <ul>
                    <li>${translate("risque_blessures_chutes")}</li>
                    <li>${translate("risque_blessures_objets")}</li>
                    <li>${translate("risque_blessures_contact")}</li>
                    <li>${translate("risque_hypothermie")}</li>
                    <li>${translate("risque_brulures")}</li>
                    <li>${translate("risque_allergies")}</li>
                    <li>${translate("risque_animaux_plantes")}</li>
                    <li>${translate("risque_vol_perte_objets")}</li>
                    <li>${translate("risque_defaillance_equipements")}</li>
                    <li>${translate("risque_comportements_negligents")}</li>
                    <li>${translate("risque_deces")}</li>
                </ul>
                <label for="accepte_risques">
                    <input type="checkbox" id="accepte_risques" name="accepte_risques" ${
                      this.acceptationRisque?.accepte_risques ? "checked" : ""
                    } required>
                    ${translate("jaccepte_risques_activites")}
                </label>

                <h2>${translate("covid19_et_autres_maladies")}</h2>
                <p>${translate("texte_covid19")}</p>

                <p>
                    <label for="participation_volontaire">
                        <input type="checkbox" id="participation_volontaire" name="participation_volontaire" ${
                          this.acceptationRisque?.participation_volontaire
                            ? "checked"
                            : ""
                        } required>
                        ${translate("participation_volontaire")}
                    </label>
                </p>
                <p>
                    <label for="declaration_sante">
                        <input type="checkbox" id="declaration_sante" name="declaration_sante" ${
                          this.acceptationRisque?.declaration_sante
                            ? "checked"
                            : ""
                        } required>
                        ${translate("declaration_sante")}
                    </label>
                </p>
                <p>
                    <label for="declaration_voyage">
                        <input type="checkbox" id="declaration_voyage" name="declaration_voyage" ${
                          this.acceptationRisque?.declaration_voyage
                            ? "checked"
                            : ""
                        } required>
                        ${translate("declaration_voyage")}
                    </label>
                </p>
                <p>
                    <label for="accepte_covid19">
                        <input type="checkbox" id="accepte_covid19" name="accepte_covid19" ${
                          this.acceptationRisque?.accepte_covid19
                            ? "checked"
                            : ""
                        } required>
                        ${translate("jaccepte_risques_covid19")}
                    </label>
                </p>

                <h2>${translate("signature")}</h2>
                <p>${translate("parent_tuteur_confirmation")}</p>
                <label for="nom_parent_tuteur">${translate(
                  "nom_parent_tuteur"
                )}:</label>
                <input type="text" id="nom_parent_tuteur" name="nom_parent_tuteur" value="${
                  this.acceptationRisque?.nom_parent_tuteur || ""
                }" required>

                <label for="date_signature">${translate(
                  "date_signature"
                )}:</label>
                <input type="date" id="date_signature" name="date_signature" value="${
                  this.acceptationRisque?.date_signature ||
                  new Date().toISOString().split("T")[0]
                }" required>

                <input type="submit" value="${translate(
                  "soumettre_acceptation_risque"
                )}">
            </form>
            <p><a href="/dashboard">${translate("retour_tableau_bord")}</a></p>
        `;
    document.getElementById("app").innerHTML = content;
  }

  attachEventListeners() {
    document
      .getElementById("acceptation-risque-form")
      .addEventListener("submit", (e) => this.handleSubmit(e));
  }

  async handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const acceptationRisqueData = {
      participant_id: this.participantId,
      groupe_district: formData.get("groupe_district"),
      accepte_risques: formData.get("accepte_risques") ? 1 : 0,
      accepte_covid19: formData.get("accepte_covid19") ? 1 : 0,
      participation_volontaire: formData.get("participation_volontaire")
        ? 1
        : 0,
      declaration_sante: formData.get("declaration_sante") ? 1 : 0,
      declaration_voyage: formData.get("declaration_voyage") ? 1 : 0,
      nom_parent_tuteur: formData.get("nom_parent_tuteur"),
      date_signature: formData.get("date_signature"),
    };

    try {
      await saveAcceptationRisque(acceptationRisqueData);
      this.app.router.navigate("/dashboard");
    } catch (error) {
      debugError("Error saving acceptation risque:", error);
      this.renderError(translate("error_saving_acceptation_risque"));
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

  calculateAge(dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }
    return age;
  }
}
