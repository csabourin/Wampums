import { getParticipants, getGroups } from '../../ajax-functions.js';
import { debugError } from '../../utils/DebugUtils.js';
import { translate } from '../../app.js';
import { normalizeParticipantList } from '../../utils/ParticipantRoleUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { youthDisplayName, youthFirstName } from '../../utils/DisplayNameUtils.js';

export class PrintableGroupParticipantReport {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.groups = [];
  }

  async init() {
    try {
      await this.fetchData();
    } catch (error) {
      debugError('Error loading report data:', error);
      // Continue rendering even if some data failed to load
      this.app.showMessage(translate('error_loading_data'), 'warning');
    }

    // Always render the page, even with partial data
    try {
      this.render();
      this.attachEventListeners();
    } catch (error) {
      debugError('Error rendering report:', error);
      this.renderError();
    }
  }

  async fetchData() {
    // Load data with individual error handling to prevent total failure
    const [participantsResponse, groupsResponse] = await Promise.all([
      getParticipants().catch(error => {
        debugError('Error loading participants:', error);
        return { data: [] };
      }),
      getGroups().catch(error => {
        debugError('Error loading groups:', error);
        return { data: [] };
      })
    ]);

    // Support both new format (data) and old format (participants/groups)
    this.participants = normalizeParticipantList(
      participantsResponse.data || participantsResponse.participants || []
    );
    this.groups = groupsResponse.data || groupsResponse.groups || [];

    // Sort groups alphabetically
    if (Array.isArray(this.groups)) {
      this.groups.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  render() {
    const content = `
						<div class="den-list-report">
								${renderBackLink()}
								<h1>${translate('den_list_report')}</h1>
								<div id="report-content">
										${this.renderTable()}
								</div>
								<div class="den-list-report__actions">
										<button type="button" class="button button--primary" id="print-report">${translate('print_report')}</button>
										<p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
								</div>
						</div>
				`;
    setContent(document.getElementById('app'), content);
  }

  renderTable() {
    return `
						<table class="den-list">
								<thead>
										<tr>
												<th scope="col">${translate('Tannière')}</th>
												<th scope="col">${translate('name')}</th>
												<th scope="col">${translate('role')}</th>
										</tr>
								</thead>
								${this.renderTableRows()}
						</table>
				`;
  }

  renderTableRows() {
    return this.groups.map(group => {
      const groupParticipants = this.participants.filter(p => p.group_id === group.id);
      groupParticipants.sort((a, b) => {
        if (a.first_leader) {return -1;}
        if (b.first_leader) {return 1;}
        if (a.second_leader) {return 1;}
        if (b.second_leader) {return -1;}
        return youthFirstName(a).localeCompare(youthFirstName(b));
      });

      if (groupParticipants.length === 0) {
        return '';
      }

      return `<tbody>${groupParticipants.map((participant, index) => `
									<tr>
											${index === 0 ? `<td rowspan="${groupParticipants.length}">${escapeHTML(group.name)}</td>` : ''}
											<td>${escapeHTML(youthDisplayName(participant))}</td>
											<td>
													${participant.first_leader ? `<strong>${translate('first_leader')}</strong>` :
    participant.second_leader ? `<strong>${translate('second_leader')}</strong>` : ''}
											</td>
									</tr>
							`).join('')}</tbody>`;
    }).join('');
  }

  attachEventListeners() {
    document.getElementById('print-report').addEventListener('click', () => window.print());
  }

  renderError() {
    const errorMessage = `
						<h1>${translate('error')}</h1>
						<p>${translate('error_loading_group_participant_report')}</p>
						<p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
				`;
    setContent(document.getElementById('app'), errorMessage);
  }
}
