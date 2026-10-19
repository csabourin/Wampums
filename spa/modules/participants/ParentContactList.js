import { getParentContactList } from '../../ajax-functions.js';
import { debugError } from '../../utils/DebugUtils.js';
import { translate } from '../../app.js';
import { canSendCommunications, canViewParticipants } from '../../utils/PermissionUtils.js';
import { debounce } from '../../utils/PerformanceUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { createPhoneLink } from '../../utils/PhoneUtils.js';
import { createEmailLink } from '../../utils/EmailUtils.js';
import { escapeHTML, escapeAttribute } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { showPageLoading, showPageError } from '../../utils/PageStateUtils.js';

/** How long typing pauses before the list filters. */
const SEARCH_DEBOUNCE_MS = 300;

export class ParentContactList {
  constructor(app) {
    this.app = app;
    this.children = [];
    this.searchFilter = '';
    this.destroyed = false;
    this.debouncedSearch = debounce((value) => {
      this.searchFilter = value;
      this.updateContactList();
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {{title: string, className: string}} Shared page-state options */
  pageOptions() {
    return { title: translate('parent_contact_list'), className: 'parent-contact-list' };
  }

  async init() {
    if (!canSendCommunications() && !canViewParticipants()) {
      this.app.router.navigate('/');
      return;
    }

    showPageLoading(document.getElementById('app'), this.pageOptions());
    try {
      await this.fetchData();
    } catch (error) {
      debugError('Error initializing parent contact list:', error);
      this.renderError();
      return;
    }
    if (!this.destroyed) {
      this.render();
    }
  }

  async fetchData() {
    try {
      const response = await getParentContactList();
      // Extract contacts from response - API returns {success: true, contacts: [...]}
      const rows = Array.isArray(response?.contacts) ? response.contacts : (Array.isArray(response) ? response : []);

      // Transform flat SQL rows into nested structure
      const childrenMap = {};

      for (const row of rows) {
        const participantId = row.participant_id;

        // Initialize child entry if not exists
        if (!childrenMap[participantId]) {
          childrenMap[participantId] = {
            name: `${row.first_name} ${row.last_name}`,
            groups: new Set(),
            contacts: [],
          };
        }

        // Add group if exists
        if (row.group_name) {
          childrenMap[participantId].groups.add(row.group_name);
        }

        // Add guardian/contact if exists and not already added
        if (
          row.guardian_id &&
          !childrenMap[participantId].contacts.find(
            (c) => c.id === row.guardian_id,
          )
        ) {
          childrenMap[participantId].contacts.push({
            id: row.guardian_id,
            name: `${row.prenom} ${row.nom}`,
            relationship: row.lien,
            email: row.courriel,
            phone_home: row.telephone_residence,
            phone_work: row.telephone_travail,
            phone_cell: row.telephone_cellulaire,
            is_emergency: row.is_emergency_contact,
            is_primary: row.is_primary,
          });
        }
      }

      // Convert groups Set to Array for each child
      for (const child of Object.values(childrenMap)) {
        child.groups = Array.from(child.groups);
      }

      this.children = childrenMap;
    } catch (error) {
      debugError('Error fetching parent contact list:', error);
      throw error;
    }
  }

  render() {
    const content = `
          <section class="page parent-contact-list">
            ${renderBackLink()}
            <h1>${translate('parent_contact_list')}</h1>
            <div class="search-container">
                <label for="contact-search" class="sr-only">${translate('search_participants')}</label>
                <input
                    type="text"
                    id="contact-search"
                    class="search-input"
                    placeholder="${escapeAttribute(translate('search_participants'))}..."
                    value="${escapeAttribute(this.searchFilter)}"
                    aria-controls="contact-list"
                />
            </div>
            <div id="contact-list">
                ${this.renderChildrenByFirstName()}
            </div>
          </section>
        `;
    setContent(document.getElementById('app'), content);
    this.attachEventListeners();
  }

  renderChildrenByFirstName() {
    // Sort children by first name
    let sortedChildren = Object.entries(this.children)
      .map(([id, child]) => ({ id, ...child }))
      .sort((a, b) => {
        const aFirstName = a.name.split(' ')[0];
        const bFirstName = b.name.split(' ')[0];
        return aFirstName.localeCompare(bFirstName);
      });

    // Apply search filter if exists
    if (this.searchFilter) {
      const filterLower = this.searchFilter.toLowerCase();
      sortedChildren = sortedChildren.filter((child) => {
        // Check if child name matches
        if (child.name.toLowerCase().includes(filterLower)) {
          return true;
        }
        // Check if any contact name matches
        return child.contacts.some((contact) =>
          contact.name.toLowerCase().includes(filterLower)
        );
      });
    }

    if (sortedChildren.length === 0) {
      const key = this.searchFilter ? 'parent_contact_list_no_match' : 'parent_contact_list_empty';
      return `<p class="no-data">${translate(key)}</p>`;
    }

    // Collapsed by default: each child opens to show their contacts.
    return sortedChildren.map((child) => this.renderChildCard(child.id, child)).join('');
  }

  renderChildCard(childId, child) {
    return `
            <div class="child-card" data-child-id="${childId}">
                <details>
                    <summary class="child-name">${escapeHTML(child.name)}</summary>
                <div class="contacts">
                    ${this.renderContacts(child.contacts)}
                </div>
                </details>
            </div>
        `;
  }

  renderContacts(contacts) {
    return contacts
      .map(
        (contact) => `
            <div class="contact-info">
                <strong>${escapeHTML(contact.name)}</strong>
                ${
  contact.is_emergency
    ? `<span class="emergency-contact">${translate(
      'is_emergency_contact',
    )}</span>`
    : ''
}
                ${
  contact.email
    ? `<span class="contact-email">${translate('email')}: ${createEmailLink(
      contact.email
    )}</span>`
    : ''
}
                ${
  contact.phone_home
    ? `<span class="phone-number">${translate('phone_home')}: ${createPhoneLink(
      contact.phone_home
    )}</span>`
    : ''
}
                ${
  contact.phone_cell
    ? `<span class="phone-number">${translate('phone_cell')}: ${createPhoneLink(
      contact.phone_cell
    )}</span>`
    : ''
}
                ${
  contact.phone_work
    ? `<span class="phone-number">${translate('phone_work')}: ${createPhoneLink(
      contact.phone_work
    )}</span>`
    : ''
}
            </div>
        `,
      )
      .join('');
  }

  attachEventListeners() {
    // The markup was just replaced, so this listener never stacks.
    const searchInput = document.getElementById('contact-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        // Use debounced search to avoid excessive filtering
        this.debouncedSearch(e.target.value);
      });
    }
  }

  updateContactList() {
    const contactList = document.getElementById('contact-list');
    if (contactList && !this.destroyed) {
      setContent(contactList, this.renderChildrenByFirstName());
    }
  }

  renderError() {
    if (this.destroyed) {
      return;
    }
    showPageError(document.getElementById('app'), {
      ...this.pageOptions(),
      message: translate('error_loading_parent_contact_list'),
    }, () => this.init());
  }
}
