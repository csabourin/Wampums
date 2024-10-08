import { translate } from "./app.js";

export class JSONFormRenderer {
	constructor(formStructure, formData = {}, formOrigin, useUniqueIds = false, formIndex = null) {
		this.formStructure = typeof formStructure === 'string' ? JSON.parse(formStructure) : formStructure;
		this.formData = formData;
		this.formOrigin = formOrigin;
		this.useUniqueIds = useUniqueIds; 
		this.formIndex = formIndex; 
		console.log("Form structure:", this.formStructure, "Form data:", this.formData);
	}

	render(formData = this.formData) {
		console.log('\x1b[33m%s\x1b[0m', "Rendering with formData:", formData);
		if (!this.formStructure.fields || !Array.isArray(this.formStructure.fields)) {
			console.warn("Invalid form structure:", this.formStructure);
			return '<p>Invalid form structure</p>';
		}

		// Update this.formData to the passed formData for use in renderField
		this.formData = formData.form_data || formData;

		// Render the form with the available form fields
		const renderedFields = this.formStructure.fields.map((field, index) => {
			if (field.type === 'infoText') {
				return `<div class="info-text">${translate(field.infoText)}</div>`;
			}
			return this.renderField(field, this.formOrigin, index);
		});

		return renderedFields.join('');
	}

	renderField(field, formOrigin, index) {
		const { type = 'text', name, label, required, infoText, options } = field;
		const value = this.formData[name] || '';
		const requiredAttr = required ? 'required' : '';

		// Generate a unique ID if useUniqueIds is true
		const fieldId = this.useUniqueIds ? `${name}-${this.formIndex}-${index}` : name;

		let output = `<div class="form-group" data-form-origin="${formOrigin}">`;
		output += `<label for="${fieldId}">${translate(label || name)}</label>`;

		switch (type) {
			case 'textarea':
				output += `<textarea id="${fieldId}" name="${name}" ${requiredAttr}>${value}</textarea>`;
				break;
			case 'select':
				output += `<select id="${fieldId}" name="${name}" ${requiredAttr}>`;
				options.forEach(option => {
					const selected = value === option.value ? 'selected' : '';
					output += `<option value="${option.value}" ${selected}>${translate(option.label)}</option>`;
				});
				output += `</select>`;
				break;
			case 'checkbox':
				const checked = value === '1' || value === true || value === 'on' ? 'checked' : '';
				output += `<input type="checkbox" id="${fieldId}" name="${name}" value="1" ${checked} ${requiredAttr}>`;
				break;
			case 'radio':
				options.forEach(option => {
					const radioId = this.useUniqueIds ? `${name}_${option.value}-${index}` : `${name}_${option.value}`;
					const checked = value === option.value ? 'checked' : '';
					output += `<input type="radio" id="${radioId}" name="${name}" value="${option.value}" ${checked} ${requiredAttr}>`;
					output += `<label for="${radioId}">${translate(option.label)}</label>`;
				});
				break;
			default:
				output += `<input type="${type}" id="${fieldId}" name="${name}" value="${value}" ${requiredAttr}>`;
		}

		if (infoText) {
			output += `<div class="field-info">${translate(infoText)}</div>`;
		}

		output += '</div>';
		return output;
	}

	getFormData(formElement) {
		if (!(formElement instanceof HTMLFormElement)) {
			throw new Error('Invalid form element provided to getFormData');
		}
		const formData = new FormData(formElement);
		return Object.fromEntries(formData.entries());
	}
}
