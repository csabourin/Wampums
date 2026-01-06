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
import { showToast } from './utils/ToastUtils.js';
import { canApproveBadges, canManageBadges, canViewBadges } from './utils/PermissionUtils.js';
import {
  getBadgeTrackerSummary,
  getPendingBadges,
  getBadgesAwaitingDelivery,
  approveBadge,
  rejectBadge,
  markBadgeDelivered,
  markBadgesDeliveredBulk,
  saveBadgeProgress,
} from './api/api-endpoints.js';
import { clearBadgeRelatedCaches } from './indexedDB.js';

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
      showToast(translate('error_loading_data'), 'error');
    }
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
                      title="${translate('pending_approvals')}">
                <span class="badge-tracker__action-icon">🕐</span>
                ${pendingCount > 0 ? `<span class="badge-tracker__action-badge badge-tracker__action-badge--warning">${pendingCount}</span>` : ''}
              </button>
              <button class="badge-tracker__action-btn ${this.viewMode === 'delivery' ? 'badge-tracker__action-btn--active' : ''}"
                      data-action="toggle-view" data-view="delivery"
                      title="${translate('awaiting_delivery')}">
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
            🕐 ${translate('approvals') || 'Approbations'}
            <span class="badge-tracker__tab-count ${pendingCount > 0 ? 'badge-tracker__tab-count--alert' : ''}">${pendingCount}</span>
          </button>
          <button class="badge-tracker__tab ${this.viewMode === 'delivery' ? 'badge-tracker__tab--active' : ''}"
                  data-action="set-view" data-view="delivery" role="tab" aria-selected="${this.viewMode === 'delivery'}">
            🎁 ${translate('to_deliver') || 'À remettre'}
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
        <button class="badge-tracker__fab" data-action="add-star" title="${translate('add_star')}">
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
                 placeholder="${translate('search_participant') || 'Rechercher un louveteau...'}"
                 value="${sanitizeHTML(this.searchTerm)}"
                 data-action="search"
                 aria-label="${translate('search_participant')}">
        </div>
      </div>
    `;
  }

  renderParticipantsView(participants) {
    const stats = this.stats;

    return `
      <!-- Stats Summary -->
      <div class="badge-tracker__stats" role="region" aria-label="${translate('statistics')}">
        <div class="badge-tracker__stat-card" data-action="set-view" data-view="participants">
          <div class="badge-tracker__stat-value">${stats.totalParticipants || 0}</div>
          <div class="badge-tracker__stat-label">${translate('participants') || 'Louveteaux'}</div>
        </div>
        <div class="badge-tracker__stat-card">
          <div class="badge-tracker__stat-value">${stats.totalApproved || 0}</div>
          <div class="badge-tracker__stat-label">${translate('stars') || 'Étoiles'} ★</div>
        </div>
        <div class="badge-tracker__stat-card ${stats.pendingApproval > 0 ? 'badge-tracker__stat-card--highlight' : ''}"
             data-action="set-view" data-view="pending">
          <div class="badge-tracker__stat-value">${stats.pendingApproval || 0}</div>
          <div class="badge-tracker__stat-label">${translate('pending') || 'En attente'}</div>
        </div>
        <div class="badge-tracker__stat-card" data-action="set-view" data-view="delivery">
          <div class="badge-tracker__stat-value">${stats.awaitingDelivery || 0}</div>
          <div class="badge-tracker__stat-label">${translate('to_deliver') || 'À remettre'}</div>
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
                  ${participant.hasPending ? '<span class="badge-tracker__indicator badge-tracker__indicator--pending" title="En attente"></span>' : ''}
                  ${participant.hasUndelivered ? '<span class="badge-tracker__indicator badge-tracker__indicator--delivery" title="À remettre"></span>' : ''}
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
          const approvedStars = b.stars.filter(s => s.status === 'approved').length;
          const maxStars = template?.level_count || 3;
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
    const maxStars = template?.level_count || 3;
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
              ${approvedCount}/${maxStars} ${translate('approved') || 'approuvée(s)'}
              ${deliveredCount > 0 ? ` • ${deliveredCount} ${translate('delivered') || 'remise(s)'}` : ''}
              ${pendingCount > 0 ? ` • ${pendingCount} ${translate('pending') || 'en attente'}` : ''}
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
      return `
        <button class="badge-tracker__add-star-btn"
                data-action="add-star-to-badge"
                data-participant-id="${participantId}"
                data-template-id="${templateId}"
                data-star-number="${starNumber}"
                ${!this.canManage ? 'disabled' : ''}>
          <span>+</span> ${translate('star') || 'Étoile'} ${starNumber}
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
            ${starData.star_type === 'proie' ? '🎯 Proie' : '🐺 Battue'}
          </span>
        ` : ''}
        ${isPending ? `<span class="badge-tracker__star-status badge-tracker__star-status--pending">${translate('pending') || 'En attente'}</span>` : ''}
        ${isApproved ? `<span class="badge-tracker__star-status badge-tracker__star-status--needs-delivery">${translate('to_deliver') || 'À remettre'}</span>` : ''}
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
            ${translate('pending_approvals') || 'Approbations en attente'}
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
            ${translate('awaiting_delivery') || 'Étoiles à remettre'}
          </h2>
          ${deliveryItems.length > 0 && this.canApprove ? `
            <button class="button button--primary button--sm" data-action="deliver-all">
              ${translate('mark_all_delivered') || 'Tout marquer comme remis'}
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
                ${item.star_type === 'proie' ? '🎯 Proie' : '🐺 Battue'}
              </span>
            ` : ''}
          </div>
          <div class="badge-tracker__queue-badge-name">${sanitizeHTML(template?.name || item.badge_name || '')}</div>
          ${item.objectif ? `<div class="badge-tracker__queue-details">${sanitizeHTML(item.objectif)}</div>` : ''}
          <div class="badge-tracker__queue-date">
            ${type === 'pending' ?
              `${translate('submitted') || 'Soumis le'} ${this.formatDate(item.date_obtention || item.created_at)}` :
              `${translate('approved') || 'Approuvé le'} ${this.formatDate(item.approval_date)}`}
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
                    title="${translate('mark_delivered')}">🎁</button>
          ` : ''}
        </div>
      </div>
    `;
  }

  renderEmptyState(type) {
    const config = {
      'search': {
        icon: '🔍',
        title: translate('no_results') || 'Aucun résultat',
        description: translate('try_different_search') || 'Essayez une recherche différente',
      },
      'no-badges': {
        icon: '🎯',
        title: translate('no_badges_yet') || 'Aucun badge en cours',
        description: translate('use_plus_to_start') || 'Utilisez le bouton + pour commencer',
      },
      'all-approved': {
        icon: '✓',
        title: translate('all_up_to_date') || 'Tout est à jour!',
        description: translate('no_pending_approvals') || "Aucune étoile en attente d'approbation",
      },
      'all-delivered': {
        icon: '🎁',
        title: translate('all_delivered') || 'Tout est remis!',
        description: translate('all_badges_distributed') || 'Toutes les étoiles approuvées ont été distribuées',
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
      return;
    }

    modalContainer.classList.remove('hidden');
    setContent(modalContainer, `
      <div class="badge-tracker__modal-overlay" data-action="close-modal"></div>
      <div class="badge-tracker__modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="badge-tracker__modal-header">
          <h2 id="modal-title" class="badge-tracker__modal-title">${translate('add_star') || 'Nouvelle étoile'}</h2>
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

          <div class="form-group">
            <label class="form-label form-label--required">${translate('achievement_type') || "Type d'accomplissement"}</label>
            <div class="badge-tracker__type-selector">
              <label class="badge-tracker__type-option ${!this.modalInitialData?.star_type || this.modalInitialData?.star_type === 'proie' ? 'badge-tracker__type-option--selected' : ''}">
                <input type="radio" name="star_type" value="proie" checked>
                <span class="badge-tracker__type-icon">🎯</span>
                <span class="badge-tracker__type-label">Proie</span>
                <span class="badge-tracker__type-desc">${translate('individual') || 'Individuel'}</span>
              </label>
              <label class="badge-tracker__type-option ${this.modalInitialData?.star_type === 'battue' ? 'badge-tracker__type-option--selected' : ''}">
                <input type="radio" name="star_type" value="battue">
                <span class="badge-tracker__type-icon">🐺</span>
                <span class="badge-tracker__type-label">Battue</span>
                <span class="badge-tracker__type-desc">${translate('group') || 'Groupe'}</span>
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
                      placeholder="${translate('description_placeholder') || "Détails de l'accomplissement..."}"></textarea>
          </div>

          <div class="form-group">
            <label for="modal-date" class="form-label form-label--required">${translate('achievement_date') || "Date d'obtention"}</label>
            <input type="date" id="modal-date" name="date_obtention" required value="${new Date().toISOString().split('T')[0]}">
          </div>
        </form>
        <div class="badge-tracker__modal-footer">
          <button type="button" class="button button--secondary" data-action="close-modal">${translate('cancel')}</button>
          <button type="submit" form="add-star-form" class="button button--primary">${translate('add_star') || "Ajouter l'étoile"}</button>
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

    // Close on escape
    const handleEscape = (e) => {
      if (e.key === 'Escape' && this.isModalOpen) {
        this.isModalOpen = false;
        this.modalInitialData = null;
        this.renderModal();
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);

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
      });
    });

    // Form submission
    const form = modal.querySelector('#add-star-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleAddStar(new FormData(form));
      });
    }
  }

  async handleApprove(badgeId) {
    try {
      const result = await approveBadge(badgeId);
      if (result?.success) {
        showToast(translate('star_approved') || 'Étoile approuvée ✓', 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Approve error:', error);
      showToast(translate('error'), 'error');
    }
  }

  async handleReject(badgeId) {
    if (!confirm(translate('confirm_reject') || 'Êtes-vous sûr de vouloir rejeter cette étoile?')) return;

    try {
      const result = await rejectBadge(badgeId);
      if (result?.success) {
        showToast(translate('star_rejected') || 'Étoile rejetée', 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Reject error:', error);
      showToast(translate('error'), 'error');
    }
  }

  async handleDeliver(badgeId) {
    try {
      const result = await markBadgeDelivered(badgeId);
      if (result?.success) {
        showToast(translate('star_delivered') || 'Étoile marquée comme remise ✓', 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Deliver error:', error);
      showToast(translate('error'), 'error');
    }
  }

  async handleDeliverAll() {
    const deliveryItems = this.getDeliveryItems();
    if (deliveryItems.length === 0) return;

    if (!confirm(translate('confirm_deliver_all') || `Marquer ${deliveryItems.length} étoile(s) comme remise(s)?`)) return;

    try {
      const badgeIds = deliveryItems.map(item => item.id);
      const result = await markBadgesDeliveredBulk(badgeIds);
      if (result?.success) {
        showToast(`${result.count || deliveryItems.length} ${translate('stars_delivered') || 'étoile(s) marquée(s) comme remise(s)'} ✓`, 'success');
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Deliver all error:', error);
      showToast(translate('error'), 'error');
    }
  }

  async handleAddStar(formData) {
    const payload = {
      participant_id: parseInt(formData.get('participant_id')),
      badge_template_id: parseInt(formData.get('badge_template_id')),
      star_type: formData.get('star_type'),
      objectif: formData.get('objectif'),
      description: formData.get('description'),
      date_obtention: formData.get('date_obtention'),
    };

    try {
      const result = await saveBadgeProgress(payload);
      if (result?.success) {
        showToast(translate('star_added') || 'Nouvelle étoile ajoutée', 'success');
        this.isModalOpen = false;
        this.modalInitialData = null;
        await this.loadData(true);
        this.render();
        this.attachEventListeners();
      } else {
        showToast(result?.message || translate('error'), 'error');
      }
    } catch (error) {
      debugError('[BadgeTracker] Add star error:', error);
      showToast(translate('error'), 'error');
    }
  }

  formatDate(dateString) {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
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
