/**
 * Badge Tracker Module
 *
 * Scout Badge Tracker with approval queue and delivery tracking
 *
 * Workflow:
 * 1. Star submitted → status: 'pending'
 * 2. Leader approves → status: 'approved', approval_date set
 * 3. Physical badge given → delivered_at set
 */

import { translate } from './app.js';
import { debugLog, debugError } from './utils/DebugUtils.js';
import { sanitizeHTML } from './utils/SecurityUtils.js';
import { setContent } from './utils/DOMUtils.js';
import { formatDateShort } from './utils/DateUtils.js';
import { canApproveBadges, canManageBadges, canViewBadges } from './utils/PermissionUtils.js';
import {
  getBadgeTrackerSummary,
  approveBadge,
  rejectBadge,
  markBadgeDelivered,
  markBadgesDeliveredBulk,
  saveBadgeProgress,
} from './api/api-endpoints.js';

export class BadgeTracker {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.badges = [];
    this.templates = [];
    this.stats = {};
    this.searchTerm = '';
    this.viewMode = 'participants'; // participants, pending, delivery
    this.expandedParticipant = null;
    this.isModalOpen = false;
    this.modalInitialData = null;
    this.loading = true;
    this.canManage = false;
    this.canApprove = false;
    this.modalKeydownHandler = null;
  }

  async init() {
    debugLog('[BadgeTracker] Initializing...');

    // Check permissions
    const canView = await canViewBadges();
    this.canManage = await canManageBadges();
    this.canApprove = await canApproveBadges();

    if (!canView && !this.canManage && !this.canApprove) {
      this.renderNotAuthorized();
      return;
    }

    this.renderSkeleton();
    await this.loadData();
    this.render();
    this.attachEventListeners();
  }

  async loadData(forceRefresh = false) {
    try {
      const response = await getBadgeTrackerSummary({ forceRefresh });
      if (response?.success && response.data) {
        this.badges = response.data.badges || [];
        this.templates = response.data.templates || [];
        this.participants = response.data.participants || [];
        this.stats = response.data.stats || {};
      }
      this.loading = false;
    } catch (error) {
      debugError('[BadgeTracker] Error loading data:', error);
      this.loading = false;
      this.showToast(translate('error_loading_data'), 'error');
    }
  }

  showToast(message, type = 'info') {
    if (this.app?.showMessage) {
      this.app.showMessage(message, type);
    }
  }

  /**
   * Determine the maximum number of stars for a template.
   * @param {Object|null} template - Badge template data.
   * @returns {number} Maximum star count.
   */
  getTemplateLevelCount(template) {
    if (!template) return 3;
    if (template.level_count) return template.level_count;
    if (Array.isArray(template.levels) && template.levels.length > 0) {
      return template.levels.length;
    }
    return 3;
  }

  /**
   * Get the next star number and max for a participant/template.
   * @param {number|null} participantId - Participant ID.
   * @param {number|null} templateId - Badge template ID.
   * @returns {{nextStar: number|null, maxStars: number|null}} Next and max star counts.
   */
  getNextStarInfo(participantId, templateId) {
    if (!participantId || !templateId) {
      return { nextStar: null, maxStars: null };
    }

    const template = this.templates.find(t => t.id === templateId);
    const maxStars = this.getTemplateLevelCount(template);
    const existingStars = this.badges.filter(
      badge => badge.participant_id === participantId && badge.badge_template_id === templateId
    );
    const existingLevels = existingStars.map(star => star.etoiles).filter(Boolean);
    const highestLevel = existingLevels.length > 0 ? Math.max(...existingLevels) : 0;
    const nextStar = Math.min(highestLevel + 1, maxStars);

    return { nextStar, maxStars };
  }

  // Group badge progress by participant
  groupByParticipant() {
    const participantMap = new Map();

    // Initialize all participants
    this.participants.forEach(p => {
      participantMap.set(p.id, {
        ...p,
        badges: new Map(),
        hasPending: false,
        hasUndelivered: false,
        totalStars: 0,
      });
    });

    // Add badge progress to participants
    this.badges.forEach(badge => {
      const participant = participantMap.get(badge.participant_id);
      if (!participant) return;

      const templateId = badge.badge_template_id;
      if (!participant.badges.has(templateId)) {
        const template = this.templates.find(t => t.id === templateId);
        participant.badges.set(templateId, {
          template,
          stars: [],
        });
      }

      participant.badges.get(templateId).stars.push(badge);

      if (badge.status === 'pending') {
        participant.hasPending = true;
      }
      if (badge.status === 'approved' && !badge.delivered_at) {
        participant.hasUndelivered = true;
      }
      if (badge.status === 'approved') {
        participant.totalStars++;
      }
    });

    return participantMap;
  }

  // Get pending items for approval queue
  getPendingItems() {
    return this.badges.filter(b => b.status === 'pending');
  }

  // Get items awaiting delivery
  getDeliveryItems() {
    return this.badges.filter(b => b.status === 'approved' && !b.delivered_at);
  }

  // Filter participants by search term
  getFilteredParticipants() {
    const participantMap = this.groupByParticipant();
    let filtered = Array.from(participantMap.values());

    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(p => {
        const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
        const totem = (p.totem || '').toLowerCase();
        return fullName.includes(term) || totem.includes(term);
      });
    }

    return filtered.sort((a, b) =>
      a.first_name.localeCompare(b.first_name, 'fr')
    );
  }

  renderSkeleton() {
    const app = document.getElementById('app');
    setContent(app, `
      <div class="badge-tracker">
        <div class="badge-tracker__skeleton">
          <div class="skeleton skeleton--header"></div>
          <div class="skeleton skeleton--tabs"></div>
          <div class="skeleton skeleton--stats"></div>
          <div class="skeleton skeleton--list"></div>
        </div>
      </div>
    `);
  }

  render() {
    const pendingCount = this.getPendingItems().length;
    const deliveryCount = this.getDeliveryItems().length;
    const filteredParticipants = this.getFilteredParticipants();

    const app = document.getElementById('app');
    setContent(app, `
      <div class="badge-tracker">
        <a href="#main-content" class="badge-tracker__skip-link">${translate('skip_to_content')}</a>

        <!-- Header -->
        <header class="badge-tracker__header">
          <div class="badge-tracker__header-top">
            <div>
              <h1 class="badge-tracker__title">
                <span class="badge-tracker__icon">🐾</span>
                ${translate('badge_tracker_title') || 'Badges de la Meute'}
              </h1>
              <p class="badge-tracker__subtitle">${translate('badge_tracker_subtitle') || 'Suivi des progrès des louveteaux'}</p>
            </div>
            <div class="badge-tracker__actions">
              <button class="badge-tracker__action-btn ${this.viewMode === 'pending' ? 'badge-tracker__action-btn--active' : ''}"
                      data-action="toggle-view" data-view="pending"
                      title="${translate('badge_pending_approvals')}">
                <span class="badge-tracker__action-icon">🕐</span>
                ${pendingCount > 0 ? `<span class="badge-tracker__action-badge badge-tracker__action-badge--warning">${pendingCount}</span>` : ''}
              </button>
              <button class="badge-tracker__action-btn ${this.viewMode === 'delivery' ? 'badge-tracker__action-btn--active' : ''}"
                      data-action="toggle-view" data-view="delivery"
                      title="${translate('badge_awaiting_delivery')}">
                <span class="badge-tracker__action-icon">🎁</span>
                ${deliveryCount > 0 ? `<span class="badge-tracker__action-badge badge-tracker__action-badge--info">${deliveryCount}</span>` : ''}
              </button>
            </div>
          </div>
        </header>

        <!-- View Tabs -->
        <nav class="badge-tracker__tabs" role="tablist">
          <button class="badge-tracker__tab ${this.viewMode === 'participants' ? 'badge-tracker__tab--active' : ''}"
                  data-action="set-view" data-view="participants" role="tab" aria-selected="${this.viewMode === 'participants'}">
            👥 ${translate('participants')}
          </button>
          <button class="badge-tracker__tab ${this.viewMode === 'pending' ? 'badge-tracker__tab--active' : ''}"
                  data-action="set-view" data-view="pending" role="tab" aria-selected="${this.viewMode === 'pending'}">
            🕐 ${translate('badge_pending_approvals') || 'Approbations'}
            <span class="badge-tracker__tab-count ${pendingCount > 0 ? 'badge-tracker__tab-count--alert' : ''}">${pendingCount}</span>
          </button>
          <button class="badge-tracker__tab ${this.viewMode === 'delivery' ? 'badge-tracker__tab--active' : ''}"
                  data-action="set-view" data-view="delivery" role="tab" aria-selected="${this.viewMode === 'delivery'}">
            🎁 ${translate('badge_awaiting_delivery') || 'À remettre'}
            <span class="badge-tracker__tab-count">${deliveryCount}</span>
          </button>
        </nav>

        ${this.viewMode === 'participants' ? this.renderFilterBar() : ''}

        <main id="main-content" class="badge-tracker__content">
          ${this.viewMode === 'participants' ? this.renderParticipantsView(filteredParticipants) : ''}
          ${this.viewMode === 'pending' ? this.renderPendingView() : ''}
          ${this.viewMode === 'delivery' ? this.renderDeliveryView() : ''}
        </main>

        ${this.canManage ? `
        <button class="badge-tracker__fab" data-action="add-star" title="${translate('badge_add_star')}">
          <span>+</span>
        </button>
        ` : ''}

        <div id="badge-tracker-modal" class="badge-tracker__modal-container ${this.isModalOpen ? '' : 'hidden'}"></div>
      </div>
    `);
  }

  renderFilterBar() {
    return `
      <div class="badge-tracker__filter-bar" role="search">
        <div class="badge-tracker__search">
          <span class="badge-tracker__search-icon">🔍</span>
          <input type="search"
                 class="badge-tracker__search-input"
                 placeholder="${translate('badge_search_placeholder') || translate('search_participants') || 'Rechercher un louveteau...'}"
                 value="${sanitizeHTML(this.searchTerm)}"
                 data-action="search"
                 aria-label="${translate('search_participants')}">
        </div>
      </div>
    `;
  }

  renderParticipantsView(participants) {
    const stats = this.stats;

    return `
      <!-- Stats Summary -->
      <div class="badge-tracker__stats" role="region" aria-label="${translate('badge_statistics')}">
        <div class="badge-tracker__stat-card" data-action="set-view" data-view="participants">
          <div class="badge-tracker__stat-value">${stats.totalParticipants || 0}</div>
          <div class="badge-tracker__stat-label">${translate('participants') || 'Louveteaux'}</div>
        </div>
        <div class="badge-tracker__stat-card">
          <div class="badge-tracker__stat-value">${stats.totalApproved || 0}</div>
          <div class="badge-tracker__stat-label">${translate('badge_stars_label') || translate('badge_stars') || 'Étoiles'} ★</div>
        </div>
        <div class="badge-tracker__stat-card ${stats.pendingApproval > 0 ? 'badge-tracker__stat-card--highlight' : ''}"
             data-action="set-view" data-view="pending">
          <div class="badge-tracker__stat-value">${stats.pendingApproval || 0}</div>
          <div class="badge-tracker__stat-label">${translate('badge_status_pending') || 'En attente'}</div>
        </div>
        <div class="badge-tracker__stat-card" data-action="set-view" data-view="delivery">
          <div class="badge-tracker__stat-value">${stats.awaitingDelivery || 0}</div>
          <div class="badge-tracker__stat-label">${translate('badge_awaiting_delivery') || 'À remettre'}</div>
        </div>
      </div>

      <!-- Participant List Header -->
      <div class="badge-tracker__list-header">
        <span>${translate('participants')}</span>
        <span class="badge-tracker__list-count">${participants.length} ${translate('results') || 'résultat(s)'}</span>
      </div>

      ${participants.length === 0 ? this.renderEmptyState('search') : `
      <ul class="badge-tracker__participant-list" role="list">
        ${participants.map(p => this.renderParticipantCard(p)).join('')}
      </ul>
      `}
    `;
  }

  renderParticipantCard(participant) {
    const initials = `${(participant.first_name || '')[0] || ''}${(participant.last_name || '')[0] || ''}`.toUpperCase();
    const isExpanded = this.expandedParticipant === participant.id;
    const badges = Array.from(participant.badges.values());

    return `
      <li class="badge-tracker__participant-card ${isExpanded ? 'badge-tracker__participant-card--expanded' : ''}">
        <button class="badge-tracker__participant-header"
                data-action="toggle-participant"
                data-participant-id="${participant.id}"
                aria-expanded="${isExpanded}"
                aria-controls="badges-${participant.id}">
          <div class="badge-tracker__avatar">${sanitizeHTML(initials)}</div>
          <div class="badge-tracker__participant-info">
            <div class="badge-tracker__participant-name">
              ${sanitizeHTML(participant.first_name)} ${sanitizeHTML(participant.last_name)}
              ${participant.hasPending || participant.hasUndelivered ? `
                <span class="badge-tracker__indicators">
                  ${participant.hasPending ? `<span class="badge-tracker__indicator badge-tracker__indicator--pending" title="${translate('badge_pending_indicator') || "En attente d'approbation"}"></span>` : ''}
                  ${participant.hasUndelivered ? `<span class="badge-tracker__indicator badge-tracker__indicator--delivery" title="${translate('badge_delivery_indicator') || 'Badge à remettre'}"></span>` : ''}
                </span>
              ` : ''}
            </div>
            ${participant.totem ? `<div class="badge-tracker__totem">${sanitizeHTML(participant.totem)}</div>` : ''}
          </div>
          ${this.renderBadgePreview(badges)}
          <span class="badge-tracker__chevron ${isExpanded ? 'badge-tracker__chevron--expanded' : ''}">▼</span>
        </button>

        ${isExpanded ? `
        <div id="badges-${participant.id}" class="badge-tracker__badge-details">
          ${badges.length === 0 ? this.renderEmptyState('no-badges') :
            badges.map(b => this.renderBadgeCard(participant.id, b)).join('')}
        </div>
        ` : ''}
      </li>
    `;
  }

  renderBadgePreview(badges) {
    if (badges.length === 0) return '';

    const displayBadges = badges.slice(0, 3);
    const remaining = badges.length - 3;

    return `
      <div class="badge-tracker__badge-preview">
      ${displayBadges.map(b => {
        const template = b.template;
        const maxStars = this.getTemplateLevelCount(template);
        const hasUndelivered = b.stars.some(s => s.status === 'approved' && !s.delivered_at);

          return `
            <div class="badge-tracker__preview-item">
              ${template?.image ? `<img src="/assets/images/${template.image}" alt="${sanitizeHTML(template.name)}" class="badge-tracker__preview-image">` : '<span class="badge-tracker__preview-placeholder">🏅</span>'}
              ${hasUndelivered ? '<div class="badge-tracker__preview-delivery-indicator"></div>' : ''}
              <div class="badge-tracker__preview-stars">
                ${Array.from({ length: maxStars }, (_, i) => {
                  const star = b.stars.find(s => s.etoiles === i + 1);
                  let starClass = 'badge-tracker__preview-star--empty';
                  if (star?.status === 'approved') starClass = '';
                  if (star?.status === 'pending') starClass = 'badge-tracker__preview-star--pending';
                  return `<span class="badge-tracker__preview-star ${starClass}">★</span>`;
                }).join('')}
              </div>
            </div>
          `;
        }).join('')}
        ${remaining > 0 ? `<div class="badge-tracker__preview-more">+${remaining}</div>` : ''}
      </div>
    `;
  }

  renderBadgeCard(participantId, badgeData) {
    const template = badgeData.template;
    const stars = badgeData.stars;
    const maxStars = this.getTemplateLevelCount(template);
    const approvedCount = stars.filter(s => s.status === 'approved').length;
    const deliveredCount = stars.filter(s => s.delivered_at).length;
    const pendingCount = stars.filter(s => s.status === 'pending').length;

    return `
      <div class="badge-tracker__badge-card">
        <div class="badge-tracker__badge-header">
          <div class="badge-tracker__badge-image-container">
            ${template?.image ?
              `<img src="/assets/images/${template.image}" alt="${sanitizeHTML(template?.name || '')}" class="badge-tracker__badge-image">` :
              '<div class="badge-tracker__badge-placeholder">🏅</div>'}
          </div>
          <div class="badge-tracker__badge-info">
            <h4 class="badge-tracker__badge-title">${sanitizeHTML(template?.name || translate('unknown_badge'))}</h4>
            <p class="badge-tracker__badge-progress-text">
              ${approvedCount}/${maxStars} ${translate('badge_status_approved') || 'approuvée(s)'}
              ${deliveredCount > 0 ? ` • ${deliveredCount} ${translate('badge_delivered') || 'remise(s)'}` : ''}
              ${pendingCount > 0 ? ` • ${pendingCount} ${translate('badge_status_pending') || 'en attente'}` : ''}
            </p>
          </div>
        </div>
        <div class="badge-tracker__star-progress">
          ${Array.from({ length: maxStars }, (_, i) => {
            const starData = stars.find(s => s.etoiles === i + 1);
            return this.renderStarSlot(participantId, template?.id, i + 1, starData);
          }).join('')}
        </div>
      </div>
    `;
  }

  renderStarSlot(participantId, templateId, starNumber, starData) {
    if (!starData) {
      const ariaLabel = `${translate('badge_add_star') || 'Ajouter une étoile'} ${starNumber}`;
      return `
        <button class="badge-tracker__add-star-btn"
                data-action="add-star-to-badge"
                data-participant-id="${participantId}"
                data-template-id="${templateId}"
                data-star-number="${starNumber}"
                ${!this.canManage ? 'disabled' : ''}
                aria-label="${ariaLabel}">
          <span>+</span> ${translate('badge_star_label') || translate('badge_star') || 'Étoile'} ${starNumber}
        </button>
      `;
    }

    const isDelivered = starData.status === 'approved' && starData.delivered_at;
    const isApproved = starData.status === 'approved' && !starData.delivered_at;
    const isPending = starData.status === 'pending';

    let slotClass = '';
    if (isDelivered) slotClass = 'badge-tracker__star-slot--delivered';
    else if (isApproved) slotClass = 'badge-tracker__star-slot--approved';
    else if (isPending) slotClass = 'badge-tracker__star-slot--pending';

    return `
      <div class="badge-tracker__star-slot ${slotClass}">
        ${isDelivered ? '<div class="badge-tracker__star-delivery-badge">✓</div>' : ''}
        <div class="badge-tracker__star-icon">★</div>
        ${starData.star_type ? `
          <span class="badge-tracker__star-type badge-tracker__star-type--${starData.star_type}">
            ${starData.star_type === 'proie'
              ? `🎯 ${translate('badge_type_proie') || 'Proie'}`
              : `🐺 ${translate('badge_type_battue') || 'Battue'}`}
          </span>
        ` : ''}
        ${isPending ? `<span class="badge-tracker__star-status badge-tracker__star-status--pending">${translate('badge_status_pending') || 'En attente'}</span>` : ''}
        ${isApproved ? `<span class="badge-tracker__star-status badge-tracker__star-status--needs-delivery">${translate('badge_awaiting_delivery') || 'À remettre'}</span>` : ''}
        ${isDelivered ? `<span class="badge-tracker__star-date">${this.formatDate(starData.delivered_at)}</span>` : ''}
      </div>
    `;
  }

  renderPendingView() {
    const pendingItems = this.getPendingItems();

    return `
      <div class="badge-tracker__queue-section">
        <div class="badge-tracker__queue-header">
          <h2 class="badge-tracker__queue-title">
            <span class="badge-tracker__queue-icon badge-tracker__queue-icon--pending">🕐</span>
            ${translate('badge_pending_approvals') || 'Approbations en attente'}
          </h2>
        </div>
        ${pendingItems.length === 0 ? this.renderEmptyState('all-approved') : `
          ${pendingItems.map(item => this.renderQueueItem(item, 'pending')).join('')}
        `}
      </div>
    `;
  }

  renderDeliveryView() {
    const deliveryItems = this.getDeliveryItems();

    return `
      <div class="badge-tracker__queue-section">
        <div class="badge-tracker__queue-header">
          <h2 class="badge-tracker__queue-title">
            <span class="badge-tracker__queue-icon badge-tracker__queue-icon--delivery">🎁</span>
            ${translate('badge_awaiting_delivery') || 'Étoiles à remettre'}
          </h2>
          ${deliveryItems.length > 0 && this.canApprove ? `
            <button class="button button--primary button--sm" data-action="deliver-all">
              ${translate('badge_mark_all_delivered') || 'Tout marquer comme remis'}
            </button>
          ` : ''}
        </div>
        ${deliveryItems.length === 0 ? this.renderEmptyState('all-delivered') : `
          ${deliveryItems.map(item => this.renderQueueItem(item, 'delivery')).join('')}
        `}
      </div>
    `;
  }

  renderQueueItem(item, type) {
    const template = this.templates.find(t => t.id === item.badge_template_id);

    return `
      <div class="badge-tracker__queue-item badge-tracker__queue-item--${type}">
        ${template?.image ?
          `<img src="/assets/images/${template.image}" alt="" class="badge-tracker__queue-badge-image">` :
          '<div class="badge-tracker__queue-badge-placeholder">🏅</div>'}
        <div class="badge-tracker__queue-content">
          <div class="badge-tracker__queue-item-header">
            <span class="badge-tracker__queue-name">${sanitizeHTML(item.first_name)} ${sanitizeHTML(item.last_name)}</span>
            <span class="badge-tracker__queue-star">★ ${item.etoiles}</span>
            ${item.star_type ? `
              <span class="badge-tracker__queue-type badge-tracker__queue-type--${item.star_type}">
                ${item.star_type === 'proie'
                  ? `🎯 ${translate('badge_type_proie') || 'Proie'}`
                  : `🐺 ${translate('badge_type_battue') || 'Battue'}`}
              </span>
            ` : ''}
          </div>
          <div class="badge-tracker__queue-badge-name">${sanitizeHTML(template?.name || item.badge_name || '')}</div>
          ${item.objectif ? `<div class="badge-tracker__queue-details">${sanitizeHTML(item.objectif)}</div>` : ''}
          <div class="badge-tracker__queue-date">
            ${type === 'pending' ?
              `${translate('badge_submitted_on') || 'Soumis le'} ${this.formatDate(item.date_obtention || item.created_at)}` :
              `${translate('badge_approved_on') || 'Approuvé le'} ${this.formatDate(item.approval_date)}`}
          </div>
        </div>
        <div class="badge-tracker__queue-actions">
          ${type === 'pending' && this.canApprove ? `
            <button class="badge-tracker__icon-btn badge-tracker__icon-btn--approve"
                    data-action="approve" data-badge-id="${item.id}"
                    title="${translate('approve')}">✓</button>
            <button class="badge-tracker__icon-btn badge-tracker__icon-btn--reject"
                    data-action="reject" data-badge-id="${item.id}"
                    title="${translate('reject')}">✗</button>
          ` : ''}
          ${type === 'delivery' && this.canApprove ? `
            <button class="badge-tracker__icon-btn badge-tracker__icon-btn--deliver"
                    data-action="deliver" data-badge-id="${item.id}"
                    title="${translate('badge_mark_delivered') || translate('mark_delivered')}">🎁</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderEmptyState(type) {
    const config = {
      'search': {
        icon: '🔍',
        title: translate('no_results_found') || 'Aucun résultat',
        description: translate('try_different_search') || 'Essayez une recherche différente',
      },
      'no-badges': {
        icon: '🎯',
        title: translate('badge_no_progress_title') || 'Aucun badge en cours',
        description: translate('badge_no_progress_description') || 'Utilisez le bouton + pour commencer',
      },
      'all-approved': {
        icon: '✓',
        title: translate('badge_all_up_to_date_title') || 'Tout est à jour!',
        description: translate('badge_no_pending_approvals') || "Aucune étoile en attente d'approbation",
      },
      'all-delivered': {
        icon: '🎁',
        title: translate('badge_all_delivered_title') || 'Tout est remis!',
        description: translate('badge_all_delivered_description') || 'Toutes les étoiles approuvées ont été distribuées',
      },
    };

    const { icon, title, description } = config[type] || config['search'];

    return `
      <div class="badge-tracker__empty-state">
        <div class="badge-tracker__empty-icon">${icon}</div>
        <div class="badge-tracker__empty-title">${title}</div>
        <div class="badge-tracker__empty-description">${description}</div>
      </div>
    `;
  }

  renderModal() {
    const modalContainer = document.getElementById('badge-tracker-modal');
    if (!modalContainer) return;

    if (!this.isModalOpen) {
      modalContainer.classList.add('hidden');
      setContent(modalContainer, '');
      document.body.style.overflow = '';
      if (this.modalKeydownHandler) {
        document.removeEventListener('keydown', this.modalKeydownHandler);
        this.modalKeydownHandler = null;
      }
      return;
    }

    document.body.style.overflow = 'hidden';
    modalContainer.classList.remove('hidden');
    setContent(modalContainer, `
      <div class="badge-tracker__modal-overlay" data-action="close-modal"></div>
      <div class="badge-tracker__modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="badge-tracker__modal-header">
          <h2 id="modal-title" class="badge-tracker__modal-title">${translate('badge_add_star') || 'Nouvelle étoile'}</h2>
          <button class="badge-tracker__modal-close" data-action="close-modal" aria-label="${translate('close')}">✕</button>
        </div>
        <form id="add-star-form" class="badge-tracker__modal-body">
          <div class="form-group">
            <label for="modal-participant" class="form-label form-label--required">${translate('participant')}</label>
            <select id="modal-participant" name="participant_id" required>
              <option value="">${translate('select') || 'Sélectionner...'}</option>
              ${this.participants
                .sort((a, b) => a.first_name.localeCompare(b.first_name, 'fr'))
                .map(p => `<option value="${p.id}" ${this.modalInitialData?.participant_id === p.id ? 'selected' : ''}>${sanitizeHTML(p.first_name)} ${sanitizeHTML(p.last_name)}</option>`)
                .join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label form-label--required">${translate('badge')}</label>
            <div class="badge-tracker__badge-selector">
              ${this.templates.map(template => `
                <label class="badge-tracker__badge-option ${this.modalInitialData?.template_id === template.id ? 'badge-tracker__badge-option--selected' : ''}">
                  <input type="radio" name="badge_template_id" value="${template.id}"
                         ${this.modalInitialData?.template_id === template.id ? 'checked' : ''} required>
                  ${template.image ?
                    `<img src="/assets/images/${template.image}" alt="" class="badge-tracker__badge-option-image">` :
                    '<span class="badge-tracker__badge-option-placeholder">🏅</span>'}
                  <span class="badge-tracker__badge-option-name">${sanitizeHTML(template.name.replace('comme ', ''))}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="badge-tracker__star-info hidden" data-star-info>
            <span class="badge-tracker__star-info-label">${translate('badge_star_label') || translate('badge_star') || 'Étoile'}</span>
            <span class="badge-tracker__star-info-value" data-star-count></span>
            <input type="hidden" name="etoiles" value="" data-star-input>
          </div>

          <div class="form-group">
            <label class="form-label form-label--required">${translate('achievement_type') || "Type d'accomplissement"}</label>
            <div class="badge-tracker__type-selector">
              <label class="badge-tracker__type-option ${!this.modalInitialData?.star_type || this.modalInitialData?.star_type === 'proie' ? 'badge-tracker__type-option--selected' : ''}">
                <input type="radio" name="star_type" value="proie" ${!this.modalInitialData?.star_type || this.modalInitialData?.star_type === 'proie' ? 'checked' : ''}>
                <span class="badge-tracker__type-icon">🎯</span>
                <span class="badge-tracker__type-label">${translate('badge_type_proie') || 'Proie'}</span>
                <span class="badge-tracker__type-desc">${translate('badge_type_proie_description') || translate('individual') || 'Individuel'}</span>
              </label>
              <label class="badge-tracker__type-option ${this.modalInitialData?.star_type === 'battue' ? 'badge-tracker__type-option--selected' : ''}">
                <input type="radio" name="star_type" value="battue" ${this.modalInitialData?.star_type === 'battue' ? 'checked' : ''}>
                <span class="badge-tracker__type-icon">🐺</span>
                <span class="badge-tracker__type-label">${translate('badge_type_battue') || 'Battue'}</span>
                <span class="badge-tracker__type-desc">${translate('badge_type_battue_description') || translate('group') || 'Groupe'}</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label for="modal-objectif" class="form-label form-label--required">${translate('objective') || 'Objectif'}</label>
            <input type="text" id="modal-objectif" name="objectif" required
                   placeholder="${translate('objective_placeholder') || 'Ex: Présentation sur un sujet'}">
          </div>

          <div class="form-group">
            <label for="modal-description" class="form-label">${translate('description')}</label>
            <textarea id="modal-description" name="description" rows="2"
                      placeholder="${translate('badge_description_placeholder') || "Détails de l'accomplissement..."}"></textarea>
          </div>

          <div class="form-group">
            <label for="modal-date" class="form-label form-label--required">${translate('achievement_date') || "Date d'obtention"}</label>
            <input type="date" id="modal-date" name="date_obtention" required value="${new Date().toISOString().split('T')[0]}">
          </div>
        </form>
        <div class="badge-tracker__modal-footer">
          <button type="button" class="button button--secondary" data-action="close-modal">${translate('cancel')}</button>
          <button type="submit" form="add-star-form" class="button button--primary">${translate('badge_add_star') || "Ajouter l'étoile"}</button>
        </div>
      </div>
    `);

    // Focus trap and event listeners
    this.attachModalEventListeners();
  }

  attachEventListeners() {
    const app = document.getElementById('app');
    if (!app) return;

    // Delegation for all actions
    app.addEventListener('click', async (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.dataset.action;
      const badgeId = actionEl.dataset.badgeId;
      const participantId = actionEl.dataset.participantId;
      const templateId = actionEl.dataset.templateId;
      const view = actionEl.dataset.view;
      const starNumber = actionEl.dataset.starNumber;

      switch (action) {
        case 'set-view':
        case 'toggle-view':
          this.viewMode = action === 'toggle-view' && this.viewMode === view ? 'participants' : view;
          this.render();
          this.attachEventListeners();
          break;

        case 'toggle-participant':
          this.expandedParticipant = this.expandedParticipant === parseInt(participantId) ? null : parseInt(participantId);
          this.render();
          this.attachEventListeners();
          break;

        case 'add-star':
          this.modalInitialData = null;
          this.isModalOpen = true;
          this.renderModal();
          break;

        case 'add-star-to-badge':
          this.modalInitialData = {
            participant_id: parseInt(participantId),
            template_id: parseInt(templateId),
            star_number: parseInt(starNumber),
          };
          this.isModalOpen = true;
          this.renderModal();
          break;

        case 'approve':
          await this.handleApprove(parseInt(badgeId));
          break;

        case 'reject':
          await this.handleReject(parseInt(badgeId));
          break;

        case 'deliver':
          await this.handleDeliver(parseInt(badgeId));
          break;

        case 'deliver-all':
          await this.handleDeliverAll();
          break;

        case 'close-modal':
          this.isModalOpen = false;
          this.modalInitialData = null;
          this.renderModal();
          break;
      }
    });

    // Search input
    const searchInput = app.querySelector('[data-action="search"]');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value;
        this.render();
        this.attachEventListeners();
        // Re-focus search input
        const newSearchInput = document.querySelector('[data-action="search"]');
        if (newSearchInput) {
          newSearchInput.focus();
          newSearchInput.setSelectionRange(this.searchTerm.length, this.searchTerm.length);
        }
      });
    }
  }

  attachModalEventListeners() {
    const modal = document.getElementById('badge-tracker-modal');
    if (!modal) return;

    const modalElement = modal.querySelector('.badge-tracker__modal');
    const starInfo = modal.querySelector('[data-star-info]');
    const starCountEl = modal.querySelector('[data-star-count]');
    const starInput = modal.querySelector('[data-star-input]');
    const participantSelect = modal.querySelector('#modal-participant');

    const updateStarInfo = () => {
      const participantId = parseInt(participantSelect?.value || '', 10);
      const selectedBadge = modal.querySelector('input[name="badge_template_id"]:checked');
      const templateId = selectedBadge ? parseInt(selectedBadge.value, 10) : null;

      const { nextStar, maxStars } = this.getNextStarInfo(participantId, templateId);
      if (!nextStar || !maxStars) {
        starInfo?.classList.add('hidden');
        if (starInput) {
          starInput.value = '';
        }
        return;
      }

      if (starInfo) {
        starInfo.classList.remove('hidden');
      }
      if (starCountEl) {
        starCountEl.textContent = `#${nextStar} ${translate('badge_star_of') || 'sur'} ${maxStars}`;
      }
      if (starInput) {
        starInput.value = nextStar;
      }
    };

    // Close on escape and focus trap
    this.modalKeydownHandler = (e) => {
      if (e.key === 'Escape' && this.isModalOpen) {
        this.isModalOpen = false;
        this.modalInitialData = null;
        this.renderModal();
        return;
      }

      if (e.key !== 'Tab' || !modalElement) return;
      const focusable = modalElement.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', this.modalKeydownHandler);

    // Type selector visual update
    modal.querySelectorAll('.badge-tracker__type-option input').forEach(input => {
      input.addEventListener('change', () => {
        modal.querySelectorAll('.badge-tracker__type-option').forEach(opt =>
          opt.classList.remove('badge-tracker__type-option--selected'));
        input.closest('.badge-tracker__type-option').classList.add('badge-tracker__type-option--selected');
      });
    });

    // Badge selector visual update
    modal.querySelectorAll('.badge-tracker__badge-option input').forEach(input => {
      input.addEventListener('change', () => {
        modal.querySelectorAll('.badge-tracker__badge-option').forEach(opt =>
          opt.classList.remove('badge-tracker__badge-option--selected'));
        input.closest('.badge-tracker__badge-option').classList.add('badge-tracker__badge-option--selected');
        updateStarInfo();
      });
    });

    participantSelect?.addEventListener('change', updateStarInfo);

    // Form submission
    const form = modal.querySelector('#add-star-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleAddStar(new FormData(form));
      });
    }

    updateStarInfo();

    const firstFocusable = modalElement?.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    firstFocusable?.focus();
  }

  async handleApprove(badgeId) {
    try {
      const result = await approveBadge(badgeId);
      if (result?.success) {
        this.showToast(translate('badge_approved_success') || 'Étoile approuvée ✓', 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        this.showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Approve error:', error);
      this.showToast(translate('error'), 'error');
    }
  }

  async handleReject(badgeId) {
    if (!confirm(translate('badge_confirm_reject') || 'Êtes-vous sûr de vouloir rejeter cette étoile?')) return;

    try {
      const result = await rejectBadge(badgeId);
      if (result?.success) {
        this.showToast(translate('badge_rejected_success') || 'Étoile rejetée', 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        this.showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Reject error:', error);
      this.showToast(translate('error'), 'error');
    }
  }

  async handleDeliver(badgeId) {
    try {
      const result = await markBadgeDelivered(badgeId);
      if (result?.success) {
        this.showToast(translate('badge_delivered_success') || 'Étoile marquée comme remise ✓', 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        this.showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Deliver error:', error);
      this.showToast(translate('error'), 'error');
    }
  }

  async handleDeliverAll() {
    const deliveryItems = this.getDeliveryItems();
    if (deliveryItems.length === 0) return;

    if (!confirm(translate('badge_confirm_deliver_all') || `Marquer ${deliveryItems.length} étoile(s) comme remise(s)?`)) return;

    try {
      const badgeIds = deliveryItems.map(item => item.id);
      const result = await markBadgesDeliveredBulk(badgeIds);
      if (result?.success) {
        this.showToast(`${result.count || deliveryItems.length} ${translate('badge_stars_delivered') || 'étoile(s) marquée(s) comme remise(s)'} ✓`, 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        this.showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Deliver all error:', error);
      this.showToast(translate('error'), 'error');
    }
  }

  async handleAddStar(formData) {
    const participantId = parseInt(formData.get('participant_id'));
    const templateId = parseInt(formData.get('badge_template_id'));
    const starLevel = parseInt(formData.get('etoiles'), 10);
    const { maxStars } = this.getNextStarInfo(participantId, templateId);

    if (!participantId || !templateId) {
      this.showToast(translate('missing_required_fields') || translate('error'), 'error');
      return;
    }

    if (!starLevel || (maxStars && starLevel > maxStars)) {
      this.showToast(translate('badge_max_stars_reached') || translate('error'), 'error');
      return;
    }

    const payload = {
      participant_id: participantId,
      badge_template_id: templateId,
      star_type: formData.get('star_type'),
      objectif: formData.get('objectif'),
      description: formData.get('description'),
      date_obtention: formData.get('date_obtention'),
      etoiles: starLevel,
    };

    try {
      const result = await saveBadgeProgress(payload);
      if (result?.success) {
        this.showToast(translate('badge_star_added') || 'Nouvelle étoile ajoutée', 'success');
        this.isModalOpen = false;
        this.modalInitialData = null;
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        this.showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Add star error:', error);
      this.showToast(translate('error'), 'error');
    }
  }

  formatDate(dateString) {
    if (!dateString) return '';
    try {
      return formatDateShort(dateString, this.app?.lang || 'fr');
    } catch {
      return '';
    }
  }

  renderNotAuthorized() {
    setContent(document.getElementById('app'), `
      <section class="badge-tracker badge-tracker--error">
        <h1>${translate('not_authorized')}</h1>
        <p>${translate('badge_no_access') || "Vous n'avez pas accès à cette fonctionnalité."}</p>
        <p><a href="/dashboard">${translate('back_to_dashboard')}</a></p>
      </section>
    `);
  }
}
