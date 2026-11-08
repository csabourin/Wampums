import { translate } from '../../app.js';
import { setContent, withFormBusy } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { adoptLinkLanguage } from '../family-access/linkLanguage.js';
import { formatDate } from '../../utils/DateUtils.js';
import { getCampBranchReview, getCampBranchReviewPdf, submitCampBranchReview } from '../../api/api-camp-branch-approval.js';
import { confirmDecision, decisionFields, savePlanDocument } from './CampApprovalForm.js';

const text = (key) => escapeHTML(translate(key));
const LINK_UNAVAILABLE = 410;
const RATE_LIMITED = 429;

export class CampBranchApproval {
  constructor(app) {
    this.app = app;
    this.token = window.location.hash.slice(1);
    this.request = new AbortController();
  }

  destroy() {
    this.request.abort();
    this.token = '';
  }

  /** Render the public page with the same heading throughout loading, review and completion. */
  render(content, busy = false) {
    const root = document.getElementById('app');
    setContent(root, `<section class="page"${busy ? ' aria-busy="true"' : ''}>
      ${this.app.isLoggedIn ? renderBackLink() : ''}
      <h1 tabindex="-1">${text('camp_approval_public_title')}</h1>
      ${content}</section>`);
    return root;
  }

  async init() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(this.token)) {
      this.renderUnavailable();
      return;
    }
    this.render(`<p role="status">${text('loading')}</p>`, true);
    try {
      const response = await getCampBranchReview(this.token, this.request.signal);
      if (this.request.signal.aborted) {
        return;
      }
      if (response.status === LINK_UNAVAILABLE) {
        this.renderUnavailable();
        return;
      }
      if (!response.ok) {
        throw new Error('Camp approval request failed');
      }
      const { data } = await response.json();
      if (await adoptLinkLanguage(this.app, data.language) || this.request.signal.aborted) {
        return;
      }
      this.renderReview(data);
    } catch {
      if (!this.request.signal.aborted) {
        const root = this.render(`<p role="alert">${text('camp_approval_load_failed')}</p>
          <button type="button" class="button button--secondary" data-retry>${text('retry')}</button>`);
        root.querySelector('[data-retry]').addEventListener('click', () => this.init());
      }
    }
  }

  renderUnavailable(focus = false) {
    const root = this.render(`<p role="status">${text('camp_approval_link_unavailable')}</p>`);
    if (focus) {
      root.querySelector('h1').focus();
    }
  }

  /** Show the plan and its code before offering the signature form. */
  renderReview(data) {
    const code = String(data.code || '');
    const version = new Intl.NumberFormat(this.app.lang).format(Number(data.version_number));
    const root = this.render(`
      <p><strong>${escapeHTML(data.camp_name || translate('camp_readiness_camp'))}</strong> · ${escapeHTML(data.unit_name || '')}</p>
      <p>${escapeHTML(translate('camp_plan_version_label').replace('{version}', version))} ·
        ${text('camp_plan_version_code')} <strong>${escapeHTML(code)}</strong></p>
      <p>${text('camp_approval_link_sent_on')} ${escapeHTML(formatDate(data.sent_at, this.app.lang))}</p>
      <p>${text('camp_approval_public_intro')}</p>
      <p><button type="button" class="button button--secondary" data-review-pdf>${text('camp_approval_download_plain')}</button></p>
      <p role="alert" class="field-error" data-pdf-error></p>
      <form aria-label="${text('camp_approval_public_title')}">${decisionFields('branch-approval', { external: true })}</form>`);
    root.querySelector('[data-review-pdf]').addEventListener('click', (event) => this.download(event.currentTarget, data.version_number));
    root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const { signer_name: name, ...fields } = Object.fromEntries(new FormData(form));
      withFormBusy(form, () => this.submit(form, { ...fields, name }, code));
    });
  }

  async download(button, version) {
    button.disabled = true;
    const message = document.querySelector('[data-pdf-error]');
    message.textContent = '';
    try {
      const response = await getCampBranchReviewPdf(this.token, this.request.signal);
      if (response.status === LINK_UNAVAILABLE && !this.request.signal.aborted) {
        this.renderUnavailable(true);
        return;
      }
      if (!response.ok) {
        throw new Error('Camp plan download failed');
      }
      const blob = await response.blob();
      if (!this.request.signal.aborted) {
        savePlanDocument(blob, `camp-plan-v${Number(version)}.pdf`);
      }
    } catch {
      if (!this.request.signal.aborted) {
        message.textContent = translate('camp_plan_version_download_failed');
      }
    } finally {
      button.disabled = false;
    }
  }

  async submit(form, payload, code) {
    const message = form.querySelector('[data-approval-error]');
    message.textContent = '';
    if (!await confirmDecision(payload.decision, code) || this.request.signal.aborted) {
      return;
    }
    try {
      const response = await submitCampBranchReview(this.token, payload, this.request.signal);
      if (this.request.signal.aborted) {
        return;
      }
      if (response.ok) {
        this.token = '';
        history.replaceState(history.state, '', window.location.pathname);
        const root = this.render(`<p role="status">${text('camp_approval_saved')}</p>`);
        root.querySelector('h1').focus();
      } else if (response.status === LINK_UNAVAILABLE) {
        this.renderUnavailable(true);
      } else {
        message.textContent = translate(response.status === RATE_LIMITED ? 'camp_approval_rate_limit' : 'camp_approval_save_failed');
      }
    } catch {
      if (!this.request.signal.aborted) {
        message.textContent = translate('camp_approval_save_failed');
      }
    }
  }
}
