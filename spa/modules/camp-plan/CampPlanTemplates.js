/**
 * The unit's camp plan templates (#1318): rules of life, camp rules, code of
 * ethics and emergency procedures, written once and followed by every camp
 * that does not write its own. Each section saves on its own.
 *
 * Takes `camp_plan_templates.manage`.
 *
 * @module spa/modules/camp-plan/CampPlanTemplates
 */
import { translate } from '../../app.js';
import { setContent, withFormBusy, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { isDemoUser } from '../../utils/PermissionUtils.js';
import { richTextOrPlain } from '../../utils/RichTextUtils.js';
import { richTextEditorHTML, attachRichTextEditor, getRichTextValue } from '../rich-text/RichTextEditor.js';
import { getCampPlanTemplates, saveCampPlanTemplate } from '../../api/api-camp-plans.js';
import { planSectionLabel } from './planLabels.js';
import styles from '../../../css/camp-plan.css?url';

export class CampPlanTemplates {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.templates = [];
    this.canEdit = !isDemoUser();
    this.destroyed = false;
    this.request = 0;
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  async init() {
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp plan stylesheet failed', err));
    const options = { title: translate('camp_plan_templates_title') };
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const response = await getCampPlanTemplates();
      if (this.destroyed || request !== this.request) {
        return;
      }
      if (!Array.isArray(response?.data)) {
        throw new Error('Missing templates');
      }
      this.templates = response.data;
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp plan templates:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_plan_load_failed'), retryId: 'camp-plan-templates-retry' }));
      this.root().querySelector('#camp-plan-templates-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {string} One template, in an editor for whoever may write it */
  templateMarkup(template) {
    const key = template.key;
    const titleId = `camp-plan-template-${key}-title`;
    const helpId = `camp-plan-template-${key}-help`;
    const errorId = `camp-plan-template-${key}-error`;
    const state = `<span class="camp-plan__chip${template.body_html ? '' : ' is-missing'}">${escapeHTML(translate(template.body_html ? 'camp_plan_state_written' : 'camp_plan_state_to_write'))}</span>`;
    const head = `<div class="camp-plan__section-head"><h2 id="${titleId}">${escapeHTML(planSectionLabel(key))}</h2>${state}</div>
      <p class="field-hint" id="${helpId}">${escapeHTML(translate(`camp_plan_help_${key}`))}</p>`;
    if (!this.canEdit) {
      return `${head}${template.body_html
        ? `<div class="camp-plan__text rich-text-content">${richTextOrPlain(template.body_html, template.body_text)}</div>`
        : `<p class="camp-plan__empty">${escapeHTML(translate('camp_plan_state_to_write'))}</p>`}`;
    }
    return `${head}
      <form id="camp-plan-template-form-${key}" class="camp-plan__form" data-camp-plan-template="${key}" novalidate>
        ${richTextEditorHTML({ id: `camp-plan-template-${key}-text`, labelId: titleId, html: template.body_html || '', describedBy: `${helpId} ${errorId}` })}
        <p class="field-error" id="${errorId}" hidden></p>
        <div class="camp-plan__actions">
          <button type="submit" class="button button--primary button--small">${escapeHTML(translate('save'))}</button>
        </div>
      </form>`;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    setContent(this.root(), `<section class="page camp-plan">
        ${renderBackLink()}
        <h1>${escapeHTML(translate('camp_plan_templates_title'))}</h1>
        <p class="camp-plan__intro">${escapeHTML(translate('camp_plan_templates_intro'))}</p>
        ${this.templates.map((template) => `<section class="camp-plan__section" id="camp-plan-template-block-${template.key}"
          aria-labelledby="camp-plan-template-${template.key}-title">${this.templateMarkup(template)}</section>`).join('')}
      </section>`);
    this.root().querySelectorAll('.camp-plan__section').forEach((block) => this.wire(block));
  }

  /** Wire one template's editor; called again whenever it alone is redrawn. */
  wire(block) {
    const form = block.querySelector('form[data-camp-plan-template]');
    if (!form) {
      return;
    }
    const key = form.dataset.campPlanTemplate;
    block.querySelectorAll('[data-rte]').forEach((editor) => attachRichTextEditor(editor));
    form.addEventListener('input', () => {
      const error = block.querySelector(`#camp-plan-template-${key}-error`);
      if (!error.hidden) {
        error.hidden = true;
        error.textContent = '';
        error.removeAttribute('role');
      }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, () => this.save(key, getRichTextValue(form.querySelector('.rte__area'))));
    });
  }

  /** @param {string} key @param {string} html - Empty removes the template */
  async save(key, html) {
    const template = this.templates.find((candidate) => candidate.key === key);
    try {
      const response = await saveCampPlanTemplate(key, { body_html: html, expected_version: Number(template.version) || 0 });
      if (this.destroyed) {
        return;
      }
      if (!response?.data?.key) {
        throw new Error('Missing saved template');
      }
      this.templates = this.templates.map((candidate) => (candidate.key === key ? response.data : candidate));
      this.app.showMessage(translate('camp_plan_template_saved'), 'success');
      const block = this.root().querySelector(`#camp-plan-template-block-${key}`);
      setContent(block, this.templateMarkup(response.data));
      this.wire(block);
      const title = block.querySelector(`#camp-plan-template-${key}-title`);
      title.setAttribute('tabindex', '-1');
      title.focus();
    } catch (err) {
      debugError('Failed to save a camp plan template:', err);
      if (this.destroyed) {
        return;
      }
      const error = this.root().querySelector(`#camp-plan-template-${key}-error`);
      error.textContent = apiErrorMessage(err, 'camp_plan_save_failed');
      error.hidden = false;
      error.setAttribute('role', 'alert');
    }
  }
}
