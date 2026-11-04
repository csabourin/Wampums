/**
 * The camp plan's written sections (#1318): V.C.P.R.E.F., theme and story,
 * motivation system, the unit's stable sections (rules of life, camp rules,
 * code of ethics, emergency procedures) and the games kept for bad weather.
 *
 * A stable section follows the unit's template until the camp writes its own
 * text, and says which it shows. A section with nothing to show reads "to
 * write", never as complete. Each section saves on its own, so saving one never
 * discards what is being typed in another.
 *
 * The plan is long, so it is shown one part at a time (V.C.P.R.E.F., story and
 * motivation, rules and emergencies, bad-weather games), with a quick
 * navigation saying what each part still lacks. Parts are only hidden, never
 * redrawn, so switching keeps unsaved text; the part shown is kept in the
 * address (`?part=`) so a link can open it.
 *
 * Reading takes `meetings.view`; writing, `meetings.manage`.
 *
 * @module spa/modules/camp-plan/CampPlan
 */
import { translate } from '../../app.js';
import rules from '../../../config/camp_plan.json';
import { setContent, withFormBusy, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { pageLoadingMarkup, pageErrorMarkup } from '../../utils/PageStateUtils.js';
import { apiErrorMessage } from '../../utils/ApiErrorUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { localeForLanguage } from '../../utils/InterfaceLanguageUtils.js';
import { hasPermission, hasOrganizationScope, isDemoUser } from '../../utils/PermissionUtils.js';
import { richTextOrPlain } from '../../utils/RichTextUtils.js';
import { sanitizeRichText } from '../../utils/FormTextUtils.js';
import { confirm } from '../../utils/DialogUtils.js';
import { richTextEditorHTML, attachRichTextEditor, getRichTextValue } from '../rich-text/RichTextEditor.js';
import { getCampPlan, saveCampPlanSection, saveCampPlanRainGames } from '../../api/api-camp-plans.js';
import { getActivityLibrary } from '../../api/api-yearly-planner.js';
import { activityCategoryLabel } from '../../utils/ActivityLibraryUtils.js';
import { CAMP_PLAN_PARTS, planPartOf, planPartLabel, planSectionLabel } from './planLabels.js';
import styles from '../../../css/camp-plan.css?url';

export class CampPlan {
  /**
   * @param {Object} app - Application instance
   * @param {{meetingId: number}} options - The planned camp
   */
  constructor(app, { meetingId }) {
    this.app = app;
    this.meetingId = Number(meetingId);
    this.data = null;
    this.library = [];
    this.libraryFailed = false;
    this.canEdit = hasPermission('meetings.manage') && !isDemoUser();
    this.canEditTemplates = hasPermission('camp_plan_templates.manage') && !isDemoUser();
    this.part = this.partFromAddress();
    this.destroyed = false;
    this.request = 0;
  }

  /** @returns {string} The part the address names, or the first */
  partFromAddress() {
    const asked = new URLSearchParams(window.location.search).get('part');
    return CAMP_PLAN_PARTS.some((part) => part.key === asked) ? asked : CAMP_PLAN_PARTS[0].key;
  }

  destroy() {
    this.destroyed = true;
    this.request += 1;
  }

  /** @returns {HTMLElement|null} */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} */
  lang() {
    return this.app.lang || 'fr';
  }

  /** @returns {string} Back to the camp's overview, or to the camp plans for whoever may not open it */
  backHref() {
    return hasPermission('meetings.view') && hasOrganizationScope() ? `/camp-readiness/${this.meetingId}` : '/camp-plans';
  }

  /** @returns {boolean} Whether the camp may still be written */
  editable() {
    return this.canEdit && !this.data?.camp?.is_cancelled;
  }

  async init() {
    const request = ++this.request;
    loadStylesheet(styles).catch((err) => debugError('Camp plan stylesheet failed', err));
    const options = { title: translate('camp_plan_title'), backHref: this.backHref() };
    setContent(this.root(), pageLoadingMarkup(options));
    try {
      const [response, library] = await Promise.all([
        getCampPlan(this.meetingId),
        // The games to choose from are needed only by whoever may choose; a failure there leaves the plan readable.
        this.canEdit ? getActivityLibrary().catch((err) => {
          debugError('Failed to load the activity library:', err);
          return null;
        }) : Promise.resolve({ data: [] }),
      ]);
      if (this.destroyed || request !== this.request) {
        return;
      }
      if (!response?.data?.camp || !Array.isArray(response.data.sections)) {
        throw new Error('Missing camp plan');
      }
      this.data = response.data;
      this.libraryFailed = !Array.isArray(library?.data);
      this.library = Array.isArray(library?.data) ? library.data : [];
      this.render();
    } catch (err) {
      if (this.destroyed || request !== this.request) {
        return;
      }
      debugError('Failed to load the camp plan:', err);
      setContent(this.root(), pageErrorMarkup({ ...options, message: apiErrorMessage(err, 'camp_plan_load_failed'), retryId: 'camp-plan-retry' }));
      this.root().querySelector('#camp-plan-retry')?.addEventListener('click', () => this.init());
    }
  }

  /** @returns {Object|undefined} */
  section(key) {
    return this.data.sections.find((section) => section.key === key);
  }

  /** @returns {{toWrite: number, toReview: number}} What one part still lacks */
  partGaps(part) {
    const { to_write: toWrite = [], to_review: toReview = [] } = this.data.gaps || {};
    const inPart = (key) => planPartOf(key) === part;
    return { toWrite: toWrite.filter(inPart).length, toReview: toReview.filter(inPart).length };
  }

  /** @returns {string} What a part, or the whole plan, still lacks, in words */
  gapText({ toWrite, toReview }) {
    const number = new Intl.NumberFormat(localeForLanguage(this.lang()));
    const parts = [];
    if (toWrite) {
      parts.push(translate('camp_readiness_left_plan').replace('{count}', number.format(toWrite)));
    }
    if (toReview) {
      parts.push(translate('camp_readiness_left_plan_review').replace('{count}', number.format(toReview)));
    }
    return parts.length ? parts.join(' · ') : translate('camp_plan_part_done');
  }

  /** @returns {string} What the whole plan still lacks, in one line */
  summaryMarkup() {
    const { to_write: toWrite = [], to_review: toReview = [] } = this.data.gaps || {};
    if (!toWrite.length && !toReview.length) {
      return `<p class="camp-plan__complete">${escapeHTML(translate('camp_plan_all_written'))}</p>`;
    }
    return `<p class="camp-plan__left"><strong>${escapeHTML(translate('camp_plan_left'))}</strong>
      ${escapeHTML(this.gapText({ toWrite: toWrite.length, toReview: toReview.length }))}</p>`;
  }

  /** @returns {string} The quick navigation: every part, with what it still lacks */
  navMarkup() {
    const items = CAMP_PLAN_PARTS.map((part, index) => {
      const gaps = this.partGaps(part.key);
      const current = part.key === this.part;
      const left = gaps.toWrite || gaps.toReview;
      return `<li><button type="button" class="camp-plan__nav-button${left ? ' is-attention' : ''}" data-camp-plan-part="${part.key}"
          ${current ? 'aria-current="step"' : ''}>
          <span class="camp-plan__nav-step" aria-hidden="true">${index + 1}</span>
          <span class="camp-plan__nav-name">${escapeHTML(planPartLabel(part.key))}</span>
          <span class="camp-plan__nav-state">${escapeHTML(this.gapText(gaps))}</span>
        </button></li>`;
    }).join('');
    return `<ol class="camp-plan__nav-list">${items}</ol>`;
  }

  /** @returns {string} Previous and next part, at the end of a part */
  pagerMarkup(index) {
    const previous = CAMP_PLAN_PARTS[index - 1];
    const next = CAMP_PLAN_PARTS[index + 1];
    const button = (part, key) => `<button type="button" class="button button--secondary${key === 'camp_plan_next_part' ? ' camp-plan__pager-next' : ''}" data-camp-plan-part="${part.key}">
        ${escapeHTML(translate(key).replace('{name}', planPartLabel(part.key)))}</button>`;
    return `<div class="camp-plan__pager">
        ${previous ? button(previous, 'camp_plan_previous_part') : ''}
        ${next ? button(next, 'camp_plan_next_part') : ''}
      </div>`;
  }

  /** Redraw what tells how far the plan is: the summary and the quick navigation. */
  redrawProgress() {
    setContent(this.root().querySelector('#camp-plan-summary'), this.summaryMarkup());
    setContent(this.root().querySelector('#camp-plan-nav'), this.navMarkup());
  }

  /**
   * Show one part, hide the others, and keep it in the address.
   * @param {string} part - A part key
   * @param {{focus?: boolean}} [options] - Move focus to the part's heading
   */
  showPart(part, { focus = true } = {}) {
    this.part = part;
    this.root().querySelectorAll('[data-camp-plan-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.campPlanPanel !== part;
    });
    this.root().querySelectorAll('#camp-plan-nav [data-camp-plan-part]').forEach((button) => {
      if (button.dataset.campPlanPart === part) {
        button.setAttribute('aria-current', 'step');
      } else {
        button.removeAttribute('aria-current');
      }
    });
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('part', part);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (err) {
      debugError('Could not keep the plan part in the address:', err);
    }
    if (focus) {
      const heading = this.root().querySelector(`#camp-plan-group-${part}`);
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    }
  }

  /** @returns {string} Words for where a section's text comes from */
  stateLabel(section) {
    if (section.source === 'empty') {
      return translate('camp_plan_state_to_write');
    }
    if (section.needs_review) {
      return translate('camp_plan_state_to_review');
    }
    if (section.source === 'template') {
      return translate('camp_plan_state_template');
    }
    return translate(section.modified_for_camp ? 'camp_plan_state_modified' : 'camp_plan_state_written');
  }

  /** @returns {string} The unit's motivation rules, read from its point settings */
  motivationMarkup() {
    const motivation = this.data.motivation || {};
    const number = new Intl.NumberFormat(localeForLanguage(this.lang()));
    const lines = [
      ['camp_plan_motivation_attendance', motivation.attendance_present],
      ['camp_plan_motivation_honor', motivation.honor_award],
      ['camp_plan_motivation_badge', motivation.badge_earn],
      ['camp_plan_motivation_badge_level', motivation.badge_level_up],
    ].filter(([, value]) => Number.isFinite(value) && value > 0)
      .map(([key, value]) => `<li>${escapeHTML(translate(key).replace('{count}', number.format(value)))}</li>`);
    if (!lines.length) {
      return '';
    }
    return `<div class="camp-plan__reminder" id="camp-plan-motivation-reminder">
        <p><strong>${escapeHTML(translate('camp_plan_motivation_reminder'))}</strong></p>
        <ul>${lines.join('')}</ul>
      </div>`;
  }

  /**
   * One section: its name, where its text comes from, its help, then its text,
   * in an editor for whoever may write it.
   * @returns {string}
   */
  sectionMarkup(section) {
    const key = section.key;
    const titleId = `camp-plan-${key}-title`;
    const helpId = `camp-plan-${key}-help`;
    const errorId = `camp-plan-${key}-error`;
    const state = `<span class="camp-plan__chip${section.source === 'empty' ? ' is-missing' : ''}">${escapeHTML(this.stateLabel(section))}</span>`;
    const head = `<div class="camp-plan__section-head"><h3 id="${titleId}">${escapeHTML(planSectionLabel(key))}</h3>${state}</div>
      <p class="field-hint" id="${helpId}">${escapeHTML(translate(`camp_plan_help_${key}`))}</p>
      ${key === 'motivation' ? this.motivationMarkup() : ''}`;
    if (!this.editable()) {
      const body = section.source === 'empty'
        ? `<p class="camp-plan__empty">${escapeHTML(translate('camp_plan_state_to_write'))}</p>`
        : `<div class="camp-plan__text rich-text-content">${richTextOrPlain(section.body_html, section.body_text)}</div>`;
      return `${head}${body}`;
    }
    const revert = section.modified_for_camp
      ? `<button type="button" class="button button--ghost button--small" data-camp-plan-revert="${key}">${escapeHTML(translate('camp_plan_use_template'))}</button>`
      : '';
    return `${head}
      <form id="camp-plan-form-${key}" class="camp-plan__form" data-camp-plan-section="${key}" novalidate>
        ${richTextEditorHTML({ id: `camp-plan-${key}-text`, labelId: titleId, html: section.body_html || '', describedBy: `${helpId} ${errorId}` })}
        <p class="field-error" id="${errorId}" hidden></p>
        <div class="camp-plan__actions">
          <button type="submit" class="button button--primary button--small">${escapeHTML(translate('save'))}</button>
          ${revert}
        </div>
      </form>`;
  }

  /** @returns {string} The bad-weather games, and how to add one */
  rainGamesMarkup() {
    const games = this.data.rain_games || [];
    const number = new Intl.NumberFormat(localeForLanguage(this.lang()));
    const editable = this.editable();
    const items = games.map((game, index) => {
      const duration = [game.estimated_duration_min, game.estimated_duration_max].filter((value) => Number.isFinite(Number(value)) && value !== null);
      const minutes = duration.length
        ? translate('camp_plan_rain_game_minutes').replace('{count}', [...new Set(duration.map((value) => number.format(Number(value))))].join('–'))
        : '';
      const name = escapeHTML(game.name || '');
      const controls = editable ? `<div class="camp-plan__actions">
          <button type="button" class="button button--ghost button--small" data-camp-plan-rain-move="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''}
            aria-label="${escapeAttribute(translate('camp_plan_rain_game_up').replace('{name}', game.name || ''))}">${escapeHTML(translate('move_up'))}</button>
          <button type="button" class="button button--ghost button--small" data-camp-plan-rain-move="${index}" data-direction="1" ${index === games.length - 1 ? 'disabled' : ''}
            aria-label="${escapeAttribute(translate('camp_plan_rain_game_down').replace('{name}', game.name || ''))}">${escapeHTML(translate('move_down'))}</button>
          <button type="button" class="button button--danger button--small" data-camp-plan-rain-remove="${index}"
            aria-label="${escapeAttribute(translate('camp_plan_rain_game_remove').replace('{name}', game.name || ''))}">${escapeHTML(translate('remove'))}</button>
        </div>` : '';
      return `<li class="camp-plan__game">
          <h4>${name}${game.is_active === false ? ` <span class="camp-plan__chip">${escapeHTML(translate('camp_plan_rain_game_hidden'))}</span>` : ''}</h4>
          ${minutes || game.category ? `<p>${escapeHTML([minutes, game.category ? activityCategoryLabel(game.category) : ''].filter(Boolean).join(' · '))}</p>` : ''}
          ${game.material ? `<p><strong>${escapeHTML(translate('camp_plan_rain_game_material'))}</strong> ${escapeHTML(game.material)}</p>` : ''}
          ${game.description ? `<p class="camp-plan__game-description">${escapeHTML(game.description)}</p>` : ''}
          ${controls}
        </li>`;
    }).join('');
    const list = items
      ? `<ol class="camp-plan__games">${items}</ol>`
      : `<p class="camp-plan__empty">${escapeHTML(translate('camp_plan_rain_games_empty'))}</p>`;
    return `${list}${editable ? this.rainGameAddMarkup(games) : ''}`;
  }

  /** @returns {string} Choosing a game from the unit's library */
  rainGameAddMarkup(games) {
    if (this.libraryFailed) {
      return `<p class="status-message error" role="alert">${escapeHTML(translate('camp_plan_library_failed'))}</p>`;
    }
    const chosen = new Set(games.map((game) => Number(game.id)));
    const offered = this.library.filter((activity) => !chosen.has(Number(activity.id)) && activity.is_active !== false);
    if (games.length >= rules.RAIN_GAMES_MAX) {
      return `<p class="field-hint">${escapeHTML(translate('camp_plan_rain_games_full'))}</p>`;
    }
    if (!offered.length) {
      return `<p class="field-hint">${escapeHTML(translate(this.library.length ? 'camp_plan_library_all_chosen' : 'camp_plan_library_empty'))}</p>`;
    }
    return `<form id="camp-plan-rain-form" class="camp-plan__form camp-plan__add" novalidate>
        <div class="form-group">
          <label for="camp-plan-rain-choice">${escapeHTML(translate('camp_plan_rain_game_add_label'))}</label>
          <select id="camp-plan-rain-choice">
            ${offered.map((activity) => `<option value="${Number(activity.id)}">${escapeHTML(activity.name || '')}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="button button--secondary button--small">${escapeHTML(translate('camp_plan_rain_game_add'))}</button>
      </form>`;
  }

  /** @returns {string} One part's sections, or its games */
  partBody(part) {
    if (part.key === 'rain') {
      return `<p class="camp-plan__intro" id="camp-plan-rain-help">${escapeHTML(translate('camp_plan_help_rain_games'))}</p>
        <div id="camp-plan-rain">${this.rainGamesMarkup()}</div>`;
    }
    return `<p class="camp-plan__intro">${escapeHTML(translate(`camp_plan_group_${part.key}_intro`))}</p>
      ${part.key === 'unit' && this.canEditTemplates ? `<p><a class="button button--secondary button--small" href="/camp-plan-templates">${escapeHTML(translate('camp_plan_templates_open'))}</a></p>` : ''}
      ${part.sections.map((key) => `<div class="camp-plan__section" id="camp-plan-block-${key}">${this.sectionMarkup(this.section(key))}</div>`).join('')}`;
  }

  render() {
    if (this.destroyed) {
      return;
    }
    const { camp } = this.data;
    const dates = `${formatDate(camp.date_from, this.lang())} – ${formatDate(camp.date_to, this.lang())}`;
    const panels = CAMP_PLAN_PARTS.map((part, index) => `<section class="camp-plan__group" data-camp-plan-panel="${part.key}"
        aria-labelledby="camp-plan-group-${part.key}" ${part.key === this.part ? '' : 'hidden'}>
        <h2 id="camp-plan-group-${part.key}">${escapeHTML(planPartLabel(part.key))}</h2>
        ${this.partBody(part)}
        ${this.pagerMarkup(index)}
      </section>`).join('');
    setContent(this.root(), `<section class="page camp-plan">
        ${renderBackLink(this.backHref())}
        <h1>${escapeHTML(translate('camp_plan_title'))}</h1>
        <p class="camp-plan__camp"><strong>${escapeHTML(camp.theme || translate('camp_readiness_camp'))}</strong> <span>${escapeHTML(dates)}</span></p>
        ${camp.is_cancelled ? `<p role="status">${escapeHTML(translate('camp_readiness_cancelled'))}</p>` : ''}
        <div id="camp-plan-summary">${this.summaryMarkup()}</div>
        <nav class="camp-plan__nav" id="camp-plan-nav" aria-label="${escapeAttribute(translate('camp_plan_nav_label'))}">${this.navMarkup()}</nav>
        ${panels}
      </section>`);
    this.root().querySelectorAll('.camp-plan__section').forEach((block) => this.wireSection(block));
    this.wireRainGames();
    // One listener for the quick navigation and every pager, which survive redraws of the navigation.
    this.root().querySelector('.camp-plan').addEventListener('click', (event) => {
      const button = event.target.closest('[data-camp-plan-part]');
      if (button) {
        this.showPart(button.dataset.campPlanPart);
      }
    });
  }

  /** Wire one section's editor and buttons; called again whenever that section alone is redrawn. */
  wireSection(block) {
    const form = block.querySelector('form[data-camp-plan-section]');
    if (!form) {
      return;
    }
    const key = form.dataset.campPlanSection;
    block.querySelectorAll('[data-rte]').forEach((editor) => attachRichTextEditor(editor));
    form.addEventListener('input', () => this.clearError(key));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      withFormBusy(form, () => this.saveSection(key, getRichTextValue(form.querySelector('.rte__area'))));
    });
    block.querySelector('[data-camp-plan-revert]')?.addEventListener('click', async () => {
      const confirmed = await confirm({
        title: translate('camp_plan_use_template'),
        message: translate('camp_plan_use_template_confirm'),
      });
      if (confirmed) {
        await withFormBusy(form, () => this.saveSection(key, ''));
      }
    });
  }

  /** Redraw one section, the summary, and nothing else: other editors keep what is being typed. */
  redrawSection(key) {
    const block = this.root()?.querySelector(`#camp-plan-block-${key}`);
    if (!block) {
      return;
    }
    setContent(block, this.sectionMarkup(this.section(key)));
    this.wireSection(block);
    this.redrawProgress();
  }

  clearError(key) {
    const error = this.root()?.querySelector(`#camp-plan-${key}-error`);
    if (error && !error.hidden) {
      error.hidden = true;
      error.textContent = '';
      error.removeAttribute('role');
    }
  }

  /**
   * Save one section's text. Saving a stable section's template unchanged does
   * not make it "modified for this camp".
   * @param {string} key
   * @param {string} html - The editor's text; empty removes the camp's own text
   */
  async saveSection(key, html) {
    const section = this.section(key);
    if (section.source === 'template' && html && sanitizeRichText(html) === sanitizeRichText(section.template_html || '')) {
      this.app.showMessage(translate('camp_plan_unchanged'), 'info');
      return;
    }
    try {
      const response = await saveCampPlanSection(this.meetingId, key, { body_html: html, expected_version: Number(section.version) || 0 });
      if (this.destroyed) {
        return;
      }
      const saved = response?.data?.section;
      if (!saved) {
        throw new Error('Missing saved section');
      }
      this.data.sections = this.data.sections.map((candidate) => (candidate.key === key ? saved : candidate));
      this.data.gaps = response.data.gaps || this.data.gaps;
      this.app.showMessage(translate('camp_plan_saved'), 'success');
      this.redrawSection(key);
      const title = this.root().querySelector(`#camp-plan-${key}-title`);
      title?.setAttribute('tabindex', '-1');
      title?.focus();
    } catch (err) {
      debugError('Failed to save a camp plan section:', err);
      if (this.destroyed) {
        return;
      }
      const error = this.root().querySelector(`#camp-plan-${key}-error`);
      const message = apiErrorMessage(err, 'camp_plan_save_failed');
      if (error) {
        error.textContent = message;
        error.hidden = false;
        error.setAttribute('role', 'alert');
      } else {
        this.app.showMessage(message, 'error');
      }
    }
  }

  wireRainGames() {
    const container = this.root().querySelector('#camp-plan-rain');
    if (!container || !this.editable()) {
      return;
    }
    const ids = () => (this.data.rain_games || []).map((game) => Number(game.id));
    container.querySelectorAll('[data-camp-plan-rain-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.campPlanRainMove);
        const target = index + Number(button.dataset.direction);
        const next = ids();
        [next[index], next[target]] = [next[target], next[index]];
        this.saveRainGames(next, { focus: `[data-camp-plan-rain-move="${target}"][data-direction="${button.dataset.direction}"]` });
      });
    });
    container.querySelectorAll('[data-camp-plan-rain-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.campPlanRainRemove);
        this.saveRainGames(ids().filter((_, position) => position !== index), { focus: '#camp-plan-group-rain' });
      });
    });
    const form = container.querySelector('#camp-plan-rain-form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const chosen = Number(form.querySelector('#camp-plan-rain-choice').value);
      this.saveRainGames([...ids(), chosen], { focus: '#camp-plan-rain-choice' });
    });
  }

  /**
   * Save the bad-weather games as listed, then redraw that list alone.
   * @param {number[]} activityIds - In order
   * @param {{focus?: string}} [options] - Where focus goes afterwards
   */
  async saveRainGames(activityIds, { focus = null } = {}) {
    const container = this.root().querySelector('#camp-plan-rain');
    if (!container || container.getAttribute('aria-busy') === 'true') {
      return;
    }
    container.setAttribute('aria-busy', 'true');
    container.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    let failure = null;
    try {
      const response = await saveCampPlanRainGames(this.meetingId, activityIds);
      if (!Array.isArray(response?.data?.rain_games)) {
        throw new Error('Missing rain games');
      }
      this.data.rain_games = response.data.rain_games;
      this.data.gaps = response.data.gaps || this.data.gaps;
    } catch (err) {
      debugError('Failed to save the bad-weather games:', err);
      failure = apiErrorMessage(err, 'camp_plan_save_failed');
    }
    if (this.destroyed) {
      return;
    }
    // Redrawn either way: the list shows what is saved, with its buttons back as they should be.
    container.removeAttribute('aria-busy');
    setContent(container, this.rainGamesMarkup());
    this.redrawProgress();
    this.wireRainGames();
    if (failure) {
      this.app.showMessage(failure, 'error');
    } else {
      this.app.showMessage(translate('camp_plan_saved'), 'success');
    }
    const heading = this.root().querySelector('#camp-plan-group-rain');
    const target = focus ? container.querySelector(focus) : null;
    if (target && !target.disabled) {
      target.focus();
    } else {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }
}
