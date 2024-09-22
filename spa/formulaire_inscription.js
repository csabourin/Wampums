import { translate } from "./app.js";
import {
  fetchParticipant,
  saveParticipant,
  fetchParents,
  saveParent,
  linkParentToParticipant,
} from "./ajax-functions.js";

export class FormulaireInscription {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.guardians = [];
    this.participantId = null;
    this.removedGuardians = [];
  }

  async init(participantId = null) {
    this.participantId = participantId;
    console.log("Initializing form with participantId:", participantId);
    try {
      if (this.participantId) {
        this.participant = await fetchParticipant(this.participantId);
        console.log("Fetched participant:", this.participant);
        this.guardians = await fetchParents(this.participantId);
        console.log("Fetched guardians:", this.guardians);
      }
      this.render();
      this.attachEventListeners();
    } catch (error) {
      console.error("Error initializing form:", error);
      this.render();
      this.attachEventListeners();
      this.showError(translate("error_loading_form"));
    }
  }

  async fetchParents() {
    try {
      this.parents = await fetchParents();
    } catch (error) {
      console.error("Error fetching parents:", error);
      this.parents = []; // Ensure this.parents is always an array
    }
  }

  render() {
    console.log(
      "Rendering form. Participant:",
      this.participant,
      "Guardians:",
      this.guardians
    );
    const content = `
            <h1>${translate("formulaire_inscription")}</h1>
            <div id="error-message" class="error hidden" ></div>
            <form id="inscription-form">
                ${this.renderParticipantSection()}
                ${this.renderGuardiansSection()}
                ${this.renderInscriptionSection()}
                     ${this.renderConsentSection()}
                ${this.renderAuthorizationSection()}
                <input type="submit" value="${translate(
                  "enregistrer_inscription"
                )}">
            </form>
        `;
    document.getElementById("app").innerHTML = content;
  }

  renderGuardiansSection() {
    console.log("Rendering guardians section. Guardians:", this.guardians);
    let html = `
            <h2>${translate("informations_parents")}</h2>
            <div id="guardians-container">
        `;

    if (this.guardians.length > 0) {
      this.guardians.forEach((guardian, index) => {
        html += this.renderGuardianForm(index, guardian);
      });
    } else {
      // If no guardians, render two empty forms
      html += this.renderGuardianForm(0);
      html += this.renderGuardianForm(1);
    }

    html += `
            </div>
            <button type="button" id="add-guardian">${translate(
              "add_parent_guardian"
            )}</button>
        `;

    return html;
  }

  renderGuardianForm(index, guardian = {}) {
    return `
            <div class="guardian-form" data-index="${index}">
                <h3>${translate("parent_tuteur")} ${index + 1}</h3>
                <input type="hidden" name="guardian_id_${index}" value="${
      guardian.id || ""
    }">
                <input type="text" name="guardian_nom_${index}" value="${
      guardian.nom || ""
    }" placeholder="${translate("nom")}" required>
                <input type="text" name="guardian_prenom_${index}" value="${
      guardian.prenom || ""
    }" placeholder="${translate("prenom")}" required>
                <input type="text" name="guardian_lien_${index}" value="${
      guardian.lien || ""
    }" placeholder="${translate("lien")}">
                <input type="email" name="guardian_courriel_${index}" value="${
      guardian.courriel || ""
    }" placeholder="${translate("courriel")}" required>
                <input type="tel" name="guardian_telephone_residence_${index}" value="${
      guardian.telephone_residence || ""
    }" placeholder="${translate("telephone_residence")}">
                <input type="tel" name="guardian_telephone_travail_${index}" value="${
      guardian.telephone_travail || ""
    }" placeholder="${translate("telephone_travail")}">
                <input type="tel" name="guardian_telephone_cellulaire_${index}" value="${
      guardian.telephone_cellulaire || ""
    }" placeholder="${translate("telephone_cellulaire")}">
                <label>
                    <input type="checkbox" name="guardian_is_primary_${index}" ${
      guardian.is_primary ? "checked" : ""
    }>
                    ${translate("is_primary")}
                </label>
                <label>
                    <input type="checkbox" name="guardian_is_emergency_contact_${index}" ${
      guardian.is_emergency_contact ? "checked" : ""
    }>
                    ${translate("is_emergency_contact")}
                </label>
                ${
                  index > 1
                    ? `<button type="button" class="remove-guardian">${translate(
                        "remove_guardian"
                      )}</button>`
                    : ""
                }
            </div>
        `;
  }

  renderParticipantSection() {
    return `
            <h2>${translate("informations_participant")}</h2>
            <label for="prenom">${translate("prenom")}:</label>
            <input type="text" id="prenom" name="prenom" value="${
              this.participant?.first_name || ""
            }" required>

            <label for="nom">${translate("nom")}:</label>
            <input type="text" id="nom" name="nom" value="${
              this.participant?.last_name || ""
            }" required>

            <label for="date_naissance">${translate("date_naissance")}:</label>
            <input type="date" id="date_naissance" name="date_naissance" value="${
              this.participant?.date_naissance || ""
            }" required>

            <label for="sexe">${translate("sexe")}:</label>
            <select id="sexe" name="sexe" required>
                <option value="M" ${
                  this.participant?.sexe === "M" ? "selected" : ""
                }>${translate("masculin")}</option>
                <option value="F" ${
                  this.participant?.sexe === "F" ? "selected" : ""
                }>${translate("feminin")}</option>
                <option value="A" ${
                  this.participant?.sexe === "A" ? "selected" : ""
                }>${translate("autre")}</option>
            </select>

            <label for="adresse">${translate("adresse")}:</label>
            <input type="text" id="adresse" name="adresse" value="${
              this.participant?.adresse || ""
            }" required>

            <label for="ville">${translate("ville")}:</label>
            <input type="text" id="ville" name="ville" value="${
              this.participant?.ville || ""
            }" required>

            <label for="province">${translate("province")}:</label>
            <input type="text" id="province" name="province" value="${
              this.participant?.province || ""
            }" required>

            <label for="code_postal">${translate("code_postal")}:</label>
            <input type="text" id="code_postal" name="code_postal" value="${
              this.participant?.code_postal || ""
            }" required>

            <label for="courriel">${translate("courriel")}:</label>
            <input type="email" id="courriel" name="courriel" value="${
              this.participant?.courriel || ""
            }">

            <label for="telephone">${translate("telephone")}:</label>
            <input type="tel" id="telephone" name="telephone" value="${
              this.participant?.telephone || ""
            }" required>
        `;
  }

  renderInscriptionSection() {
    return `
            <h2>${translate("informations_inscription")}</h2>
            <label for="district">${translate("district")}:</label>
            <input type="text" id="district" name="district" value="${
              this.participant?.district || "District des Trois-Rives"
            }" required>

            <label for="unite">${translate("unite")}:</label>
            <input type="text" id="unite" name="unite" value="${
              this.participant?.unite || "6e A St-Paul d'Aylmer"
            }" required>

            <label for="demeure_chez">${translate("demeure_chez")}:</label>
            <select id="demeure_chez" name="demeure_chez">
                <option value="parents" ${
                  this.participant?.demeure_chez === "parents" ? "selected" : ""
                }>${translate("parents")}</option>
                <option value="mere" ${
                  this.participant?.demeure_chez === "mere" ? "selected" : ""
                }>${translate("mere")}</option>
                <option value="pere" ${
                  this.participant?.demeure_chez === "pere" ? "selected" : ""
                }>${translate("pere")}</option>
                <option value="garde_partagee" ${
                  this.participant?.demeure_chez === "garde_partagee"
                    ? "selected"
                    : ""
                }>${translate("garde_partagee")}</option>
                <option value="autre" ${
                  this.participant?.demeure_chez === "autre" ? "selected" : ""
                }>${translate("autre")}</option>
            </select>

                    <label for="peut_partir_seul">${translate(
                      "peut_partir_seul"
                    )}:</label>
            <input type="checkbox" id="peut_partir_seul" name="peut_partir_seul" ${
              this.participant?.peut_partir_seul ? "checked" : ""
            }>
            <label for="langue_maison">${translate("langue_maison")}:</label>
            <input type="text" id="langue_maison" name="langue_maison" value="${
              this.participant?.langue_maison || ""
            }">
            <label for="autres_langues">${translate("autres_langues")}:</label>
            <input type="text" id="autres_langues" name="autres_langues" value="${
              this.participant?.autres_langues || ""
            }">
            <label for="particularites">${translate("particularites")}:</label>
            <textarea id="particularites" name="particularites">${
              this.participant?.particularites || ""
            }</textarea>

            <label for="source_information">${translate(
              "source_information"
            )}:</label>
            <select id="source_information" name="source_information">
                <option value="" ${
                  !this.participant?.source_information ? "selected" : ""
                }>${translate("choisir_option")}</option>
                <option value="ecole" ${
                  this.participant?.source_information === "ecole"
                    ? "selected"
                    : ""
                }>${translate("ecole")}</option>
                <option value="bouche_a_oreille" ${
                  this.participant?.source_information === "bouche_a_oreille"
                    ? "selected"
                    : ""
                }>${translate("bouche_a_oreille")}</option>
                <option value="repertoire_loisir" ${
                  this.participant?.source_information === "repertoire_loisir"
                    ? "selected"
                    : ""
                }>${translate("repertoire_loisir")}</option>
                <option value="medias" ${
                  this.participant?.source_information === "medias"
                    ? "selected"
                    : ""
                }>${translate("medias")}</option>
                <option value="site_internet" ${
                  this.participant?.source_information === "site_internet"
                    ? "selected"
                    : ""
                }>${translate("site_internet")}</option>
                <option value="reseaux_sociaux" ${
                  this.participant?.source_information === "reseaux_sociaux"
                    ? "selected"
                    : ""
                }>${translate("reseaux_sociaux")}</option>
                <option value="depliant_affiche" ${
                  this.participant?.source_information === "depliant_affiche"
                    ? "selected"
                    : ""
                }>${translate("depliant_affiche")}</option>
                <option value="famille_mouvement" ${
                  this.participant?.source_information === "famille_mouvement"
                    ? "selected"
                    : ""
                }>${translate("famille_mouvement")}</option>
                <option value="camp_jour" ${
                  this.participant?.source_information === "camp_jour"
                    ? "selected"
                    : ""
                }>${translate("camp_jour")}</option>
                <option value="salons" ${
                  this.participant?.source_information === "salons"
                    ? "selected"
                    : ""
                }>${translate("salons")}</option>
                <option value="ami_enfant" ${
                  this.participant?.source_information === "ami_enfant"
                    ? "selected"
                    : ""
                }>${translate("ami_enfant")}</option>
                <option value="scout_un_jour" ${
                  this.participant?.source_information === "scout_un_jour"
                    ? "selected"
                    : ""
                }>${translate("scout_un_jour")}</option>
                <option value="autre" ${
                  this.participant?.source_information === "autre"
                    ? "selected"
                    : ""
                }>${translate("autres")}</option>
            </select>
        `;
  }

  renderConsentSection() {
    return `
            <h2>${translate("consentement_soins_medicaux")}</h2>
            <p>${translate("consentement_soins_medicaux_texte")}</p>
            <label>
                <input type="checkbox" name="consentement_soins_medicaux" ${
                  this.participant?.consentement_soins_medicaux ? "checked" : ""
                } required>
                ${translate("comprends_administrer_soins")}
            </label>

            <h2>${translate("consentement_photos_videos")}</h2>
            <p>${translate("consentement_photos_videos_texte")}</p>
            <label>
                <input type="checkbox" name="consentement_photos_videos" ${
                  this.participant?.consentement_photos_videos ? "checked" : ""
                } required>
                ${translate("autorisation_photos_videos")}
            </label>

            <h2>${translate("protection_renseignements_personnels")}</h2>
            <p>${translate("protection_renseignements_personnels_texte")}</p>
            <label>
                <input type="checkbox" name="protection_renseignements_personnels" ${
                  this.participant?.protection_renseignements_personnels
                    ? "checked"
                    : ""
                } required>
                ${translate("accepte_protection_renseignements")}
            </label>
        `;
  }

  renderAuthorizationSection() {
    return `
            <h2>${translate("autorisation_participer")}</h2>
            <p>${translate("autorisation_participer_texte")}</p>
            <p>${translate("acceptation_risques")}</p>
            <label>
                <input type="checkbox" name="autorisation_participer" ${
                  this.participant?.autorisation_participer ? "checked" : ""
                } required>
                ${translate("accepte_autorisation_participer")}
            </label>
            <div>
                <label for="signature">${translate("signature")}:</label>
                <input type="text" id="signature" name="signature" value="${
                  this.participant?.signature || ""
                }" required>
            </div>
            <div>
                <label for="date_signature">${translate(
                  "date_signature"
                )}:</label>
                <input type="date" id="date_signature" name="date_signature" value="${
                  this.participant?.signature_date || ""
                }" required>
            </div>
            <p><em>${translate("signature_parent_tuteur")}</em></p>
        `;
  }

  attachEventListeners() {
    document
      .getElementById("inscription-form")
      .addEventListener("submit", this.handleSubmit.bind(this));
    document
      .getElementById("add-guardian")
      .addEventListener("click", this.addGuardianForm.bind(this));
    document.querySelectorAll(".remove-guardian").forEach((button) => {
      button.addEventListener("click", this.removeGuardianForm.bind(this));
    });
  }

  removeGuardianForm(event) {
    const guardianId = event.target.dataset.id;
    if (guardianId) {
      this.removedGuardians.push(guardianId);
    }
    event.target.closest(".guardian-form").remove();
  }

  addGuardianForm() {
    const container = document.getElementById("guardians-container");
    const index = container.children.length;
    const newForm = this.renderGuardianForm(index);
    container.insertAdjacentHTML("beforeend", newForm);
    container.lastElementChild
      .querySelector(".remove-guardian")
      .addEventListener("click", this.removeGuardianForm.bind(this));
  }

  async handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const participantData = this.getParticipantData(formData);
    const guardiansData = this.getGuardiansData(formData);

    console.log("Participant Data:", participantData);
    console.log("Guardians Data:", guardiansData);
    console.log("Removed Guardians:", this.removedGuardians);

    try {
      const savedParticipant = await saveParticipant(participantData);
      console.log("Saved Participant Response:", savedParticipant);
      if (!savedParticipant.success) {
        throw new Error(savedParticipant.message);
      }

      for (const guardianData of guardiansData) {
        guardianData.participant_id = savedParticipant.participant_id;
        console.log("Sending Guardian Data:", guardianData);
        const savedGuardian = await saveParent(guardianData);
        console.log("Saved Guardian Response:", savedGuardian);
        if (!savedGuardian.success) {
          throw new Error(savedGuardian.message);
        }
      }

      if (this.removedGuardians.length > 0) {
        const removeResult = await this.removeGuardians(
          savedParticipant.participant_id,
          this.removedGuardians
        );
        console.log("Remove Guardians Response:", removeResult);
        if (!removeResult.success) {
          throw new Error(removeResult.message);
        }
      }

      this.showMessage(translate("inscription_saved_successfully"));
      this.app.router.route("/parent_dashboard");
    } catch (error) {
      console.error("Error saving data:", error);
      this.showError(translate("error_saving_data") + ": " + error.message);
    }
  }

  getGuardiansData(formData) {
    const guardiansData = [];
    const guardianForms = document.querySelectorAll(".guardian-form");

    guardianForms.forEach((form, index) => {
      const guardianData = {
        id: formData.get(`guardian_id_${index}`) || null,
        nom: formData.get(`guardian_nom_${index}`),
        prenom: formData.get(`guardian_prenom_${index}`),
        lien: formData.get(`guardian_lien_${index}`),
        courriel: formData.get(`guardian_courriel_${index}`),
        telephone_residence: formData.get(
          `guardian_telephone_residence_${index}`
        ),
        telephone_travail: formData.get(`guardian_telephone_travail_${index}`),
        telephone_cellulaire: formData.get(
          `guardian_telephone_cellulaire_${index}`
        ),
        is_primary: formData.get(`guardian_is_primary_${index}`) === "on",
        is_emergency_contact:
          formData.get(`guardian_is_emergency_contact_${index}`) === "on",
      };
      guardiansData.push(guardianData);
    });

    return guardiansData;
  }

  toggleNewParentForm() {
    const form = document.getElementById("new-parent-form");
    const button = document.getElementById("toggle-new-parent-form");

    if (form.classList.contains("hidden")) {
      form.classList.remove("hidden");
      form.classList.add("visible");
      button.textContent = translate("cancel");
    } else {
      form.classList.remove("visible");
      form.classList.add("hidden");
      button.textContent = translate("add_new_parent");
    }
  }

  async handleSaveNewParent() {
    const parentData = {
      nom: document.getElementById("parent-nom").value.trim(),
      prenom: document.getElementById("parent-prenom").value.trim(),
      lien: document.getElementById("parent-lien").value.trim(),
      courriel: document.getElementById("parent-courriel").value.trim(),
      telephone_residence: document
        .getElementById("parent-telephone-residence")
        .value.trim(),
      telephone_travail: document
        .getElementById("parent-telephone-travail")
        .value.trim(),
      telephone_cellulaire: document
        .getElementById("parent-telephone-cellulaire")
        .value.trim(),
      is_primary: document.getElementById("parent-is-primary").checked,
      is_emergency_contact: document.getElementById(
        "parent-is-emergency-contact"
      ).checked,
    };

    // Validate required fields for parent
    const requiredParentFields = ["nom", "prenom", "courriel"];
    const missingParentFields = requiredParentFields.filter(
      (field) => !parentData[field]
    );

    if (missingParentFields.length > 0) {
      this.showError(
        translate("required_parent_fields_missing") +
          ": " +
          missingParentFields.join(", ")
      );
      return;
    }

    // If you have a participant ID at this point, include it
    if (this.participantId) {
      parentData.participant_id = this.participantId;
    }

    console.log("Parent data being sent:", parentData);

    try {
      const result = await saveParent(parentData);
      if (result.success) {
        this.parents.push(result.parent);
        this.updateParentSelect();
        this.toggleNewParentForm();
        this.showMessage(translate("parent_saved_successfully"));
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      console.error("Error saving parent:", error);
      this.showError(translate("error_saving_parent") + ": " + error.message);
    }
  }

  updateParentSelect() {
    const select = document.getElementById("parent-select");
    select.innerHTML = `
            <option value="">${translate("select_parent")}</option>
            ${this.parents
              .map(
                (parent) => `
                <option value="${parent.id}">${parent.prenom} ${parent.nom}</option>
            `
              )
              .join("")}
        `;
    select.value = this.parents[this.parents.length - 1].id;
  }

  showMessage(message) {
    const messageElement = document.createElement("p");
    messageElement.textContent = message;
    document.getElementById("app").appendChild(messageElement);
  }

  showError(message) {
    const errorMessage = `
            <h1>${translate("error")}</h1>
            <p>${message}</p>
        `;
    document.getElementById("app").innerHTML = errorMessage;
  }

  getParticipantData(formData) {
    return {
      id: this.participantId,
      first_name: formData.get("prenom"),
      last_name: formData.get("nom"),
      date_naissance: formData.get("date_naissance"),
      sexe: formData.get("sexe"),
      adresse: formData.get("adresse"),
      ville: formData.get("ville"),
      province: formData.get("province"),
      code_postal: formData.get("code_postal"),
      courriel: formData.get("courriel"),
      telephone: formData.get("telephone"),
      district: formData.get("district"),
      unite: formData.get("unite"),
      demeure_chez: formData.get("demeure_chez"),
      peut_partir_seul: formData.get("peut_partir_seul") === "on",
      langue_maison: formData.get("langue_maison"),
      autres_langues: formData.get("autres_langues"),
      particularites: formData.get("particularites"),
      consentement_soins_medicaux:
        formData.get("consentement_soins_medicaux") === "on",
      consentement_photos_videos:
        formData.get("consentement_photos_videos") === "on",
      protection_renseignements_personnels:
        formData.get("protection_renseignements_personnels") === "on",
      autorisation_participer: formData.get("autorisation_participer") === "on",
      signature: formData.get("signature"),
      signature_date: formData.get("date_signature"),
      source_information: formData.get("source_information"),
    };
  }

  async handleSaveNewParent() {
    const parentData = {
      nom: document.getElementById("parent-nom").value.trim(),
      prenom: document.getElementById("parent-prenom").value.trim(),
      lien: document.getElementById("parent-lien").value.trim(),
      courriel: document.getElementById("parent-courriel").value.trim(),
      telephone_residence: document
        .getElementById("parent-telephone-residence")
        .value.trim(),
      telephone_travail: document
        .getElementById("parent-telephone-travail")
        .value.trim(),
      telephone_cellulaire: document
        .getElementById("parent-telephone-cellulaire")
        .value.trim(),
      is_primary: document.getElementById("parent-is-primary").checked,
      is_emergency_contact: document.getElementById(
        "parent-is-emergency-contact"
      ).checked,
    };

    // Validate required fields for parent
    const requiredParentFields = ["nom", "prenom", "courriel"];
    const missingParentFields = requiredParentFields.filter(
      (field) => !parentData[field]
    );

    if (missingParentFields.length > 0) {
      this.showError(
        translate("required_parent_fields_missing") +
          ": " +
          missingParentFields.join(", ")
      );
      return;
    }

    // If you have a participant ID at this point, include it
    if (this.participantId) {
      parentData.participant_id = this.participantId;
    }

    try {
      const result = await saveParent(parentData);
      if (result.success) {
        this.parents.push(result.parent);
        this.updateParentSelect();
        this.toggleNewParentForm();
        this.showMessage(translate("parent_saved_successfully"));
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      console.error("Error saving parent:", error);
      this.showError(translate("error_saving_parent") + ": " + error.message);
    }
  }
}
export default FormulaireInscription;
