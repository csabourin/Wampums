import { translate } from "./app.js";
import { debugLog, debugError, debugWarn, debugInfo } from "./utils/DebugUtils.js";
import { isDependencyMet } from "./utils/FormDependencyUtils.js";

export class JSONFormRenderer {
	constructor(formStructure, formData = {}, formOrigin, useUniqueIds = false, formIndex = null) {
		this.formStructure = typeof formStructure === 'string' ? JSON.parse(formStructure) : formStructure;
		this.formData = formData;
		this.formOrigin = formOrigin;
		this.useUniqueIds = useUniqueIds; 
		this.formIndex = formIndex; 
		debugLog("Form structure:", this.formStructure, "Form data:", this.formData);
	}

	render(formData = this.formData) {
		debugLog('\x1b[33m%s\x1b[0m', "Rendering with formData:", formData);
		if (!this.formStructure.fields || !Array.isArray(this.formStructure.fields)) {
			debugWarn("Invalid form structure:", this.formStructure);
			return '<p>Invalid form structure</p>';
		}

		// Update this.formData to the passed formData for use in renderField
		this.formData = formData.form_data || formData;

		// Render the form with the available form fields
		const renderedFields = this.formStructure.fields.map((field, index) => {
			if (field.type === 'infoText') {
				return `<div class="info-text">${translate(field.infoText)}</div>`;
			}
			const fieldHtml = this.renderField(field, this.formOrigin, index);
			return fieldHtml;
		});

		return renderedFields.join('');
	}

	/**
	 * Whether a `dependsOn` condition is already satisfied by the saved answers.
	 *
	 * @param {Object} dependsOn - `{ field, value }` from the form format
	 * @returns {boolean} True when the dependent field should be editable
	 */
	isDependencyMet(dependsOn) {
		return isDependencyMet(dependsOn, this.formData);
	}

	renderField(field, formOrigin, index) {
			const { type = 'text', name, label, required, infoText, options, dependsOn } = field;
			let value = this.formData[name] || '';

			// Convert date values from ISO format to YYYY-MM-DD for HTML5 date inputs
			if (type === 'date' && value) {
				try {
					// Handle both ISO format dates and already formatted dates
					if (value.includes('T') || value.includes(':')) {
						const date = new Date(value);
						if (!isNaN(date.getTime())) {
							// Format as YYYY-MM-DD in local time (UTC would
							// shift the date across midnight)
							value = date.toLocaleDateString('en-CA');
						}
					}
				} catch (e) {
					debugWarn('Error formatting date value:', value, e);
				}
			}

			const requiredAttr = required ? 'required' : '';

			// If the field has a dependsOn attribute, include it as a data-depends-on attribute in the HTML
			const dependsOnAttr = dependsOn ? `data-depends-on='${JSON.stringify(dependsOn)}'` : '';
			// A dependent field starts disabled only when its condition is not
			// already met by the saved answers. Disabling it unconditionally made
			// a filled-in fiche santé open with its allergy greyed out and
			// uneditable, and — on the standalone form, which submits through
			// FormData — dropped that allergy from the next save, because a
			// disabled input is not submitted.
			const disabled = dependsOn && !this.isDependencyMet(dependsOn) ? 'disabled' : '';

			const fieldId = this.useUniqueIds ? `${name}-${this.formIndex}-${index}` : name;

			// A dependent field whose condition is not met is hidden as well as
			// disabled: the issue asked for the precision box to appear only when it
			// is relevant. `disabled` stays, because it is also what makes the field
			// required once the condition is met.
			const groupClasses = ['form-group'];
			if (dependsOn) {
					groupClasses.push('form-group--dependent');
					if (disabled) {
							groupClasses.push('form-group--hidden');
					}
			}

			let output = `<div class="${groupClasses.join(' ')}" data-form-origin="${formOrigin}"${dependsOnAttr ? ` data-group-for="${name}"` : ''}>`;
			output += `<label for="${fieldId}">${translate(label || name)}</label>`;

			switch (type) {
					case 'textarea':
							output += `<textarea id="${fieldId}" name="${name}" ${requiredAttr} ${disabled} ${dependsOnAttr}>${value}</textarea>`;
							break;
					case 'select':
							if (field.multiple) {
								// Multi-select: render as checkbox group
								const selectedValues = Array.isArray(value) ? value : (value ? String(value).split(',') : []);
								output += `<div class="checkbox-group" data-field-name="${name}">`;
								options.forEach(option => {
									const cbId = this.useUniqueIds ? `${name}_${option.value}-${this.formIndex}-${index}` : `${name}_${option.value}`;
									const isChecked = selectedValues.includes(option.value) ? 'checked' : '';
									output += `<div class="checkbox-option">`;
									output += `<input type="checkbox" id="${cbId}" name="${name}" value="${option.value}" ${isChecked} ${dependsOnAttr}>`;
									output += `<label for="${cbId}">${translate(option.label)}</label>`;
									output += `</div>`;
								});
								output += `</div>`;
							} else {
								output += `<select id="${fieldId}" name="${name}" ${requiredAttr} ${dependsOnAttr}>`;
								options.forEach(option => {
									const selected = value === option.value ? 'selected' : '';
									output += `<option value="${option.value}" ${selected}>${translate(option.label)}</option>`;
								});
								output += `</select>`;
							}
							break;
					case 'checkbox':
							const checked = value === '1' || value === true || value === 'on' ? 'checked' : '';
							output += `<input type="checkbox" id="${fieldId}" name="${name}" value="1" ${checked} ${requiredAttr} ${disabled} ${dependsOnAttr}>`;
							break;
					case 'radio':
							// Wrapped so the options lay out as a row. Bare inputs and labels
							// dropped straight into `.form-group` (a column flex container)
							// put every option on its own line under the question.
							output += `<div class="radio-group" data-field-name="${name}">`;
							options.forEach(option => {
									const radioId = this.useUniqueIds ? `${name}_${option.value}-${index}` : `${name}_${option.value}`;
									const checked = value === option.value ? 'checked' : '';
									output += `<div class="radio-option">`;
									output += `<input type="radio" id="${radioId}" name="${name}" value="${option.value}" ${checked} ${requiredAttr} ${disabled} ${dependsOnAttr}>`;
									output += `<label for="${radioId}">${translate(option.label)}</label>`;
									output += `</div>`;
							});
							output += `</div>`;
							break;
					default:
							output += `<input type="${type}" id="${fieldId}" name="${name}" value="${value}" ${requiredAttr} ${dependsOnAttr} ${disabled}>`;
			}

			if (infoText) {
					output += `<div class="field-info">${translate(infoText)}</div>`;
			}

			output += '</div>';
			return output;
	}

	

	// Get the appropriate event type based on field type
	getEventType(fieldType) {
			switch (fieldType) {
					case 'text':
					case 'textarea':
					case 'select':
							return 'input';
					case 'checkbox':
					case 'radio':
							return 'change';
					default:
							return 'input';
			}
	}

	// Get the current value of a field based on its type
	getFieldValue(field, element) {
			switch (field.type) {
					case 'checkbox':
							return element.checked ? 'yes' : 'no'; // Normalizing value for checkboxes
					case 'radio':
							return element.checked ? element.value : '';
					default:
							return element.value;
			}
	}


	getFormData(formElement) {
		if (!(formElement instanceof HTMLFormElement)) {
			throw new Error('Invalid form element provided to getFormData');
		}
		const formData = new FormData(formElement);
		const result = {};

		// Collect all keys first to detect multi-value fields (checkbox groups)
		const allKeys = [...formData.keys()];
		const multiKeys = new Set(allKeys.filter((k, i) => allKeys.indexOf(k) !== i));

		for (const [key, val] of formData.entries()) {
			if (multiKeys.has(key)) {
				// Multi-select checkbox group: collect all values as comma-separated string
				if (!result[key]) {
					result[key] = formData.getAll(key).join(',');
				}
			} else {
				result[key] = val;
			}
		}

		return result;
	}
}
