import { debugLog, debugError, debugWarn } from './utils/DebugUtils.js';
import { app, translate } from './app.js';
import { DynamicFormHandler } from './dynamicFormHandler.js';
import { familyOperationErrorKey } from './modules/family-access/operations.js';
import { hasPermission } from './utils/PermissionUtils.js';
import { confirm } from './utils/DialogUtils.js';
import { removeGuardian } from './api/api-endpoints.js';
import { registerChild, updateOwnChild } from './api/api-family.js';
import { setContent } from './utils/DOMUtils.js';
import { escapeHTML } from './utils/SecurityUtils.js';
import { getTodayISO, isoToDateString } from './utils/DateUtils.js';
import { CONFIG } from './config.js';
import {
  fetchParticipant,
  saveFormSubmission,
  saveParticipant,
  getGuardiansForParticipant,
  saveGuardian
} from './ajax-functions.js';

/** The parent_guardian form's own columns; anything else is a unit's custom field. */
const CORE_GUARDIAN_FIELDS = [
  'nom', 'prenom', 'lien', 'courriel', 'telephone_residence', 'telephone_travail',
  'telephone_cellulaire', 'is_primary', 'is_emergency_contact',
  'guardian_id', 'account_user_id', 'custom_fields',
];

/**
 * The fields a unit added to the parent_guardian form, from one guardian's
 * form values.
 *
 * @param {Object} guardian - Values read from the guardian's form
 * @returns {Object} Custom fields only
 */
function customFieldsOf(guardian) {
  return Object.fromEntries(
    Object.entries(guardian).filter(([key]) => !CORE_GUARDIAN_FIELDS.includes(key))
  );
}

export class FormulaireInscription {
  constructor(app) {
    this.app = app;
    this.participant = null;
    this.participantId = null;
    this.formData = {};
    this.formStructures = {};
    this.participantFormHandler = null;
    this.guardianFormHandlers = [];
  }

  render() {
    debugLog('Rendering form');

    // Render the participant's form
    const participantContainer = document.getElementById('participant-form');
    if (participantContainer && this.participantFormHandler) {
      this.participantFormHandler.render(); // No need to pass the container since it defaults to the one set in init
    } else {
      debugError('Participant container or form handler not found');
    }

    // Render the guardian forms
    this.renderGuardianForms();
  }

  async init(participantId = null) {
    debugLog('Initializing FormulaireInscription with ID:', participantId);
    this.participantId = participantId;
    try {
      // Check if participant ID exists and fetch participant data accordingly
      if (this.participantId) {
        debugLog('Fetching participant data for ID:', this.participantId);
        await this.fetchParticipantData(); // Fetching participant data
        await this.fetchGuardianData(); // Fetching associated guardian data
      } else {
        debugLog('No participant ID provided, initializing empty form');
        this.formData = { guardians: [] }; // Initialize empty form data
      }

      // Create the form structure and initialize the form handlers
      this.createInitialStructure();

      // Initialize DynamicFormHandler for participant form, passing the correct participant ID
      this.participantFormHandler = new DynamicFormHandler(this.app, this.saveParticipantAndGuardians.bind(this));
      await this.participantFormHandler.init('participant_registration', this.participantId, this.formData, 'participant-form');

      // Render the form and attach event listeners
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Error initializing form:', error);
      this.showError(translate('error_loading_form'));
    }
  }



  async fetchParticipantData() {
    try {
      const response = await fetchParticipant(this.participantId);
      debugLog('Fetched participant data:', response);

      if (response.success && response.participant) {
        this.formData = {
          ...response.participant,
          first_name: response.participant.first_name,
          last_name: response.participant.last_name,
          date_naissance: response.participant.date_naissance
        };

        this.participantId = response.participant.id; // **Ensure participantId is captured here**
        this.formData.guardians = response.participant.guardians || [];
        debugLog('Assigned formData:', this.formData);
      } else {
        throw new Error('Invalid participant data received');
      }
    } catch (error) {
      debugError('Error fetching participant data:', error);
      throw error;
    }
  }



  async fetchGuardianData() {
    try {
      // The API answers { success, data }: the guardians are in data.
      const response = await getGuardiansForParticipant(this.participantId, { includeAccountHolders: true });
      const guardianData = Array.isArray(response) ? response : response?.data;
      if (Array.isArray(guardianData)) {
        this.formData.guardians = guardianData;
      } else {
        debugWarn('No guardians found or invalid guardian data received');
        this.formData.guardians = [];
      }
    } catch (error) {
      debugWarn('Error fetching guardian data:', error.message);
      this.formData.guardians = [];
    }
    debugLog('Guardian data after fetch:', this.formData.guardians);
  }

  createInitialStructure() {
    debugLog('Creating initial structure');
    // Get today's date in YYYY-MM-DD format (local time, not UTC)
    const inscriptionDate = isoToDateString(this.formData.inscription_date) || getTodayISO();

    const content = `
         <button type="button" id="go-to-dashboard">${translate('go_to_dashboard')}</button>
          <h1>${this.participantId ? translate('edit_participant') : translate('add_participant')}</h1>
          <form id="inscription-form">
            <fieldset id="participant-form"></fieldset>  <!-- Changed to a fieldset -->

            <div class="form-group">
              <label for="inscription-date">${translate('inscription_date_label')}</label>
              <input type="date" id="inscription-date" name="inscription_date" value="${escapeHTML(inscriptionDate)}" required>
              <small class="form-text">${translate('inscription_date_help')}</small>
            </div>

            <h2>${translate('informations_parents')}</h2>
            <button type="button" id="add-guardian">${translate('add_parent_guardian')}</button>
            <div id="guardians-container"></div>
            <button type="submit" id="submit-form">${translate('save')}</button>
          </form>
          <div id="error-message" class="error hidden"></div>
            <div id="success-message" class="success hidden"></div>
        `;
    setContent(document.getElementById('app'), content);
  }



  renderGuardianForms() {
    debugLog('Rendering guardian forms');
    const container = document.getElementById('guardians-container');
    if (!container) {
      debugError('Guardians container not found');
      return;
    }
    setContent(container, '');  // Clear the container

    this.guardianFormHandlers = [];  // Reset handlers to avoid duplicate form handling

    debugLog('Guardian form data:', this.formData.guardians);

    if (Array.isArray(this.formData.guardians) && this.formData.guardians.length > 0) {
      this.formData.guardians.forEach((guardian, index) => {
        debugLog(`Rendering guardian at index: ${index}`, guardian);
        this.renderGuardianForm(index, guardian);

      });
    } else {
      // Render an empty form if no guardians exist
      this.renderGuardianForm(0);
    }
  }


  renderGuardianForm(index, guardianData = {}) {
    const formHandler = new DynamicFormHandler(this.app, null, index); // Pass the formIndex here
    const formContainer = document.createElement('div');
    formContainer.className = 'guardian-form';
    formContainer.dataset.index = index;

    const guardianContainer = document.getElementById('guardians-container');
    guardianContainer.appendChild(formContainer);

    debugLog(`Initializing guardian form at index ${index} with data:`, guardianData);

    const defaultGuardianData = {
      nom: '',
      prenom: '',
      lien: '',
      courriel: '',
      telephone_residence: '',
      telephone_travail: '',
      telephone_cellulaire: '',
      is_primary: false,
      is_emergency_contact: false,
      ...guardianData,  // Overwrite defaults with actual data if present
      // Fields the unit added to this form, saved on the child's submission.
      ...(guardianData.custom_fields || {})
    };

    // Initialize the form handler with the correct index
    const fieldsContainer = document.createElement('div');
    formContainer.appendChild(fieldsContainer);
    formHandler.init('parent_guardian', null, defaultGuardianData, fieldsContainer, true, index);
    if (!guardianData.guardian_id || hasPermission('guardians.manage')) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button button--danger';
      remove.textContent = translate('family_guardian_remove');
      remove.addEventListener('click', () => this.removeGuardianForm(index));
      formContainer.appendChild(remove);
    }

    this.guardianFormHandlers.push(formHandler);
  }






  attachEventListeners() {
    debugLog('Attaching event listeners');
    const form = document.getElementById('inscription-form');
    const addGuardianButton = document.getElementById('add-guardian');
    const dashboardButton = document.getElementById('go-to-dashboard');

    if (dashboardButton) {
      dashboardButton.addEventListener('click', () => {
        this.app.router.navigate('/parent-dashboard');
      });
    } else {
      debugError('Go to dashboard button not found');
    }

    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e));
    } else {
      debugError('Inscription form not found');
    }

    if (addGuardianButton) {
      addGuardianButton.addEventListener('click', () => this.addGuardianForm());
    } else {
      debugError('Add guardian button not found');
    }
  }

  /** Capture every live field before adding/removing a guardian rebuilds the forms. */
  captureGuardianDrafts() {
    this.formData.guardians = this.guardianFormHandlers.map((handler, index) => ({
      ...this.formData.guardians?.[index],
      ...handler.getFormData(index),
    }));
  }

  addGuardianForm() {
    if (this.saving) {return;}
    this.captureGuardianDrafts();
    this.formData.guardians.push({});
    this.renderGuardianForms();
  }

  /** Remove a draft or explicitly unlink a saved guardian, preserving other access sources. */
  async removeGuardianForm(index) {
    if (this.saving) {return;}
    this.captureGuardianDrafts();
    const guardian = this.formData.guardians[index];
    if (guardian?.guardian_id) {
      const accepted = await confirm({
        title: translate('family_guardian_remove'),
        message: translate('family_guardian_remove_confirm'),
        confirmLabel: translate('family_guardian_remove'), danger: true,
      });
      if (!accepted) {return;}
      if (this.saving) {return;}
      this.saving = true;
      try {
        const response = await removeGuardian(this.participantId, guardian.guardian_id);
        this.showMessage(translate(response?.data?.access_remaining
          ? 'family_guardian_removed_access_remains' : 'family_guardian_removed'),
        response?.data?.access_remaining ? 'warning' : 'success');
      } catch (err) {
        debugError('Failed to unlink guardian:', err);
        this.showError(translate('error_saving_data'));
        return;
      } finally {
        this.saving = false;
      }
    }
    // Edits made while the confirmation was open must survive the rebuild too.
    this.captureGuardianDrafts();
    this.formData.guardians.splice(index, 1);
    this.renderGuardianForms();
  }


  async handleSubmit(e) {
    debugLog('Form submission started');
    e.preventDefault();
    e.stopPropagation();
    if (this.saving) {return;}

    // Step 1: Get the participant data from the participant form
    const participantData = this.participantFormHandler.getFormData();

    // **Ensure participant ID is passed for update**
    const participantCoreData = {
      first_name: participantData.first_name || null,
      last_name: participantData.last_name || null,
      date_naissance: participantData.date_naissance || null,
      inscription_date: document.getElementById('inscription-date')?.value || null,
      id: this.participantId || participantData.id // **Ensure ID is passed for update**
    };

    // Step 2: Validate participant core data before submission
    if (!participantCoreData.first_name || !participantCoreData.last_name || !participantCoreData.date_naissance) {
      debugError('Missing required participant core fields.');
      this.showError(translate('missing_required_fields'));
      return; // Stop submission if core data is missing
    }

    // Step 3: Get guardian data separately, ensuring each handler has the correct formIndex
    const guardiansData = this.guardianFormHandlers.map((handler, index) => handler.getFormData(index));

    // Step 4: Prepare form submission data
    const formSubmissionData = {
      ...participantData,
      inscription_date: participantCoreData.inscription_date,
      guardians: guardiansData
    };

    debugLog('Full form data to be submitted:', { participantCoreData, formSubmissionData });

    this.saving = true;
    const controls = [...document.querySelectorAll('#inscription-form button')];
    controls.forEach((button) => { button.disabled = true; });
    try {
      await this.saveParticipantAndGuardians(participantCoreData, formSubmissionData);
      this.showMessage(translate('form_saved_successfully'), 'success');

      setTimeout(() => {
        this.app.router.navigate('/parent-dashboard');
      }, CONFIG.UI.SUCCESS_REDIRECT_DELAY);

    } catch (error) {
      debugError('Error during form submission:', error);
      this.showError(translate(familyOperationErrorKey(error, this.coreSaved ? 'family_registration_partial' : 'error_saving_data')));
    } finally {
      this.saving = false;
      controls.forEach((button) => { button.disabled = false; });
    }
  }



  async saveParticipantAndGuardians(participantCoreData, formSubmissionData) {
    debugLog('Saving participant registration', {
      participantData: participantCoreData,
      guardiansData: formSubmissionData.guardians
    });

    try {
      const isNewParticipant = !this.participantId && !participantCoreData.id;
      const details = { ...participantCoreData, id: this.participantId || participantCoreData.id };
      const familyRegistration = hasPermission('participants.create_own');
      const saveParticipantResult = familyRegistration
        ? await (isNewParticipant ? registerChild(details) : updateOwnChild(details.id, details))
        : await saveParticipant(details, { queueOffline: false });
      if (!saveParticipantResult.success) {
        throw new Error(translate('error_saving_participant'));
      }
      const participantId = saveParticipantResult.data?.participant_id
          || saveParticipantResult.data?.child?.id || details.id;
      if (!participantId) {throw new Error(translate('error_saving_participant'));}
      this.participantId = participantId;
      this.coreSaved = true;

      // Step 2: Save the remaining fields in `form_submissions` for the participant
      const participantSubmissionData = { ...formSubmissionData };
      delete participantSubmissionData.guardians;

      const formSubmissionResult = await saveFormSubmission('participant_registration', participantId, participantSubmissionData, { queueOffline: false });
      if (!formSubmissionResult.success) {
        throw new Error(formSubmissionResult.message || translate('error_saving_form'));
      }

      // Step 3: Save guardians and link them to the participant
      await this.saveGuardians(participantId, formSubmissionData.guardians);


      debugLog('Participant and guardians saved successfully');
    } catch (error) {
      debugError('Error saving participant and guardians:', error);
      throw error;
    }
  }

  async saveGuardians(participantId, guardians) {
    if (guardians && guardians.length > 0) {
      debugLog('Guardians data before saving:', guardians);

      for (const [index, guardian] of guardians.entries()) {
        // The form only holds the visible fields; which record it edits comes
        // from what was loaded, so a save updates that record instead of
        // trying to create a second one with the same address.
        this.formData.guardians ||= [];
        const loaded = this.formData.guardians[index] ||= {};
        const guardianData = {
          participant_id: participantId,
          guardian_id: loaded.guardian_id || undefined,
          // An entry offered from an account: the new record is theirs.
          account_user_id: loaded.guardian_id ? undefined : (loaded.account_user_id || undefined),
          nom: guardian.nom,
          prenom: guardian.prenom,
          lien: guardian.lien,
          courriel: guardian.courriel,
          telephone_residence: guardian.telephone_residence,
          telephone_travail: guardian.telephone_travail,
          telephone_cellulaire: guardian.telephone_cellulaire,
          is_primary: guardian.is_primary,
          is_emergency_contact: guardian.is_emergency_contact,
          // Fields the unit added to this form. The API keeps them on the
          // child's submission, per guardian, in the same transaction.
          custom_fields: customFieldsOf(guardian)
        };

        try {
          // Guardians share record identities from each preceding save; keep the sequence.
          // eslint-disable-next-line no-await-in-loop -- retry must retain each saved guardian id
          const result = await saveGuardian(guardianData, { queueOffline: false });
          if (!result.success) {
            throw new Error(result.message || 'Failed to save guardian');
          }
          debugLog('Guardian saved successfully:', result);

          // Saving also links the guardian to the participant.
          loaded.guardian_id = result.data?.guardian_id;
        } catch (error) {
          debugError('Error saving guardian:', error);
          throw error;
        }
      }
    }
  }


  showMessage(message, type = 'success') {
    app.showMessage(message, type);
  }

  showError(message) {
    app.showMessage(message, 'error');
  }

}
