import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Scout Badge Tracker - Meute (Cubs) Badge Progress Application
 * Version 3: Added approval queue and delivery tracking
 * 
 * Workflow:
 * 1. Star submitted → status: 'pending'
 * 2. Leader approves → status: 'approved', approval_date set
 * 3. Physical badge given → delivered_at set
 * 
 * Data model per star (badge_progress):
 * - status: 'pending' | 'approved' | 'rejected'
 * - approval_date: timestamp (when approved)
 * - delivered_at: timestamp (when physically given)
 */

// ============================================
// BADGE IMAGES
// ============================================
const BADGE_IMAGES = {
  'bagheera.webp': '/uploads/bagheera.webp',
  'baloo.webp': '/uploads/baloo.webp',
  'ferao.webp': '/uploads/ferao.webp',
  'frereGris.webp': '/uploads/frereGris.webp',
  'kaa.webp': '/uploads/kaa.webp',
  'rikki.webp': '/uploads/rikki.webp',
};

// ============================================
// SAMPLE DATA
// ============================================
const sampleParticipants = [
  { id: 57, first_name: 'Émilie', last_name: 'Tremblay', totem: 'Loutre agile' },
  { id: 58, first_name: 'Alexandre', last_name: 'Bouchard', totem: 'Renard rusé' },
  { id: 59, first_name: 'Chloé', last_name: 'Gagnon', totem: 'Hibou sage' },
  { id: 60, first_name: 'Mathis', last_name: 'Roy', totem: 'Loup courageux' },
  { id: 61, first_name: 'Sofia', last_name: 'Lavoie', totem: 'Faucon vif' },
  { id: 62, first_name: 'Noah', last_name: 'Côté', totem: 'Castor travailleur' },
  { id: 63, first_name: 'Léa', last_name: 'Pelletier', totem: 'Biche gracieuse' },
  { id: 64, first_name: 'William', last_name: 'Morin', totem: 'Ours protecteur' },
];

const sampleBadgeTemplates = [
  { id: 1, template_key: 'vrai_comme_baloo', name: 'Vrai comme Baloo', section: 'general', level_count: 3, image: 'baloo.webp' },
  { id: 2, template_key: 'respectueux_comme_rikki_tikki_tavi', name: 'Respectueux comme Rikki Tikki Tavi', section: 'general', level_count: 3, image: 'rikki.webp' },
  { id: 3, template_key: 'fraternel_comme_frere_gris', name: 'Fraternel comme Frère Gris', section: 'general', level_count: 3, image: 'frereGris.webp' },
  { id: 4, template_key: 'debrouillard_comme_bagheera', name: 'Débrouillard comme Bagheera', section: 'general', level_count: 3, image: 'bagheera.webp' },
  { id: 5, template_key: 'sage_comme_kaa', name: 'Sage comme Kaa', section: 'general', level_count: 3, image: 'kaa.webp' },
  { id: 6, template_key: 'joyeux_comme_ferao', name: 'Joyeux comme Ferao', section: 'general', level_count: 3, image: 'ferao.webp' },
];

// Extended sample data with delivery tracking
const sampleBadgeProgress = [
  // Émilie: Baloo (2 stars - 1 delivered, 1 approved not delivered), Rikki (1 star pending)
  {
    id: 1, participant_id: 57, badge_template_id: 1, star_number: 1, type: 'proie',
    objectif: 'Dire la vérité même quand c\'est difficile',
    description: 'A avoué avoir cassé le matériel',
    date_obtention: '2025-10-15', status: 'approved', approval_date: '2025-10-16',
    delivered_at: '2025-10-20', // Given at ceremony
  },
  {
    id: 2, participant_id: 57, badge_template_id: 1, star_number: 2, type: 'battue',
    objectif: 'Activité de groupe sur l\'honnêteté',
    description: 'Animation sur les valeurs du groupe',
    date_obtention: '2025-11-20', status: 'approved', approval_date: '2025-11-21',
    delivered_at: null, // Approved but not yet given
  },
  {
    id: 3, participant_id: 57, badge_template_id: 2, star_number: 1, type: 'proie',
    objectif: 'Aider un nouveau louveteau',
    description: 'A guidé Noah pendant sa première réunion',
    date_obtention: '2025-12-01', status: 'pending', approval_date: null,
    delivered_at: null,
  },
  
  // Alexandre: Bagheera (3 stars - all delivered), Kaa (1 star pending)
  {
    id: 4, participant_id: 58, badge_template_id: 4, star_number: 1, type: 'proie',
    objectif: 'Construire un abri', description: 'Abri en forêt lors du camp',
    date_obtention: '2025-09-10', status: 'approved', approval_date: '2025-09-11',
    delivered_at: '2025-09-15',
  },
  {
    id: 5, participant_id: 58, badge_template_id: 4, star_number: 2, type: 'proie',
    objectif: 'Allumer un feu de camp', description: 'Technique du tipi',
    date_obtention: '2025-10-05', status: 'approved', approval_date: '2025-10-06',
    delivered_at: '2025-10-10',
  },
  {
    id: 6, participant_id: 58, badge_template_id: 4, star_number: 3, type: 'battue',
    objectif: 'Organiser une sortie nature', description: 'Randonnée au parc de la Gatineau',
    date_obtention: '2025-11-15', status: 'approved', approval_date: '2025-11-16',
    delivered_at: '2025-11-20',
  },
  {
    id: 7, participant_id: 58, badge_template_id: 5, star_number: 1, type: 'proie',
    objectif: 'Apprendre une nouvelle compétence', description: 'Apprentissage des nœuds',
    date_obtention: '2025-12-10', status: 'pending', approval_date: null,
    delivered_at: null,
  },
  
  // Chloé: Frère Gris (2 stars - approved not delivered), Ferao (1 star delivered)
  {
    id: 8, participant_id: 59, badge_template_id: 3, star_number: 1, type: 'battue',
    objectif: 'Activité de cohésion', description: 'Organisation du grand jeu',
    date_obtention: '2025-10-20', status: 'approved', approval_date: '2025-10-21',
    delivered_at: null,
  },
  {
    id: 9, participant_id: 59, badge_template_id: 3, star_number: 2, type: 'battue',
    objectif: 'Projet collaboratif', description: 'Décoration de la tanière',
    date_obtention: '2025-11-25', status: 'approved', approval_date: '2025-11-26',
    delivered_at: null,
  },
  {
    id: 10, participant_id: 59, badge_template_id: 6, star_number: 1, type: 'proie',
    objectif: 'Partager sa joie', description: 'A chanté devant le groupe',
    date_obtention: '2025-12-05', status: 'approved', approval_date: '2025-12-06',
    delivered_at: '2025-12-10',
  },
  
  // Mathis: Baloo (1 star pending)
  {
    id: 11, participant_id: 60, badge_template_id: 1, star_number: 1, type: 'proie',
    objectif: 'Être sincère', description: 'Présentation personnelle',
    date_obtention: '2025-12-12', status: 'pending', approval_date: null,
    delivered_at: null,
  },
  
  // Sofia: Rikki (2 stars - 1 delivered, 1 pending), Bagheera (1 star approved not delivered)
  {
    id: 12, participant_id: 61, badge_template_id: 2, star_number: 1, type: 'proie',
    objectif: 'Respecter l\'environnement', description: 'Nettoyage du parc',
    date_obtention: '2025-09-20', status: 'approved', approval_date: '2025-09-21',
    delivered_at: '2025-09-25',
  },
  {
    id: 13, participant_id: 61, badge_template_id: 2, star_number: 2, type: 'battue',
    objectif: 'Projet environnemental de groupe', description: 'Plantation d\'arbres',
    date_obtention: '2025-10-30', status: 'pending', approval_date: null,
    delivered_at: null,
  },
  {
    id: 14, participant_id: 61, badge_template_id: 4, star_number: 1, type: 'proie',
    objectif: 'Apprendre à s\'orienter', description: 'Lecture de carte',
    date_obtention: '2025-11-10', status: 'approved', approval_date: '2025-11-11',
    delivered_at: null,
  },
  
  // Noah: Kaa (1 star approved not delivered)
  {
    id: 15, participant_id: 62, badge_template_id: 5, star_number: 1, type: 'proie',
    objectif: 'Premier apprentissage', description: 'Connaître les symboles scouts',
    date_obtention: '2025-12-08', status: 'approved', approval_date: '2025-12-09',
    delivered_at: null,
  },
  
  // Léa: No badges yet
  
  // William: Frère Gris (1 star delivered), Ferao (2 stars - all delivered)
  {
    id: 16, participant_id: 64, badge_template_id: 3, star_number: 1, type: 'battue',
    objectif: 'Entraide entre louveteaux', description: 'A aidé à monter les tentes',
    date_obtention: '2025-10-10', status: 'approved', approval_date: '2025-10-11',
    delivered_at: '2025-10-15',
  },
  {
    id: 17, participant_id: 64, badge_template_id: 6, star_number: 1, type: 'proie',
    objectif: 'Exprimer sa joie', description: 'A fait rire le groupe',
    date_obtention: '2025-11-01', status: 'approved', approval_date: '2025-11-02',
    delivered_at: '2025-11-05',
  },
  {
    id: 18, participant_id: 64, badge_template_id: 6, star_number: 2, type: 'battue',
    objectif: 'Activité joyeuse de groupe', description: 'Organisation d\'une fête',
    date_obtention: '2025-12-01', status: 'approved', approval_date: '2025-12-02',
    delivered_at: '2025-12-05',
  },
];

// ============================================
// STYLES
// ============================================
const styles = `
  :root {
    --color-mint-light: #E8F5EC;
    --color-mint: #D4EDE0;
    --color-lavender-light: #E8EAF6;
    --color-lavender: #D1D4E8;
    --color-white: #FFFFFF;
    --color-off-white: #FAFBFC;
    
    --color-primary: #2E7D4A;
    --color-primary-dark: #1B5E3A;
    --color-primary-light: #4CAF6E;
    --color-secondary: #5C6BC0;
    --color-secondary-dark: #3F4FA0;
    
    --color-proie: #6366F1;
    --color-proie-bg: #EEF2FF;
    --color-battue: #059669;
    --color-battue-bg: #ECFDF5;
    
    --color-approved: #2E7D32;
    --color-pending: #E65100;
    --color-pending-bg: #FFF3E0;
    --color-delivered: #1565C0;
    --color-delivered-bg: #E3F2FD;
    --color-star-filled: #F59E0B;
    --color-star-empty: #D1D5DB;
    
    --color-text-primary: #1A1A2E;
    --color-text-secondary: #4A4A5A;
    --color-text-muted: #6B6B7B;
    --color-text-inverse: #FFFFFF;
    
    --color-border: #D0D0D8;
    --color-border-focus: #2E7D4A;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.08);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.12);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.16);
    
    --space-xs: 0.25rem;
    --space-sm: 0.5rem;
    --space-md: 1rem;
    --space-lg: 1.5rem;
    --space-xl: 2rem;
    
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-full: 9999px;
    
    --font-family: 'Nunito', 'Segoe UI', system-ui, sans-serif;
    --font-size-xs: 0.75rem;
    --font-size-sm: 0.875rem;
    --font-size-md: 1rem;
    --font-size-lg: 1.125rem;
    --font-size-xl: 1.25rem;
    --font-size-2xl: 1.5rem;
    
    --transition-fast: 150ms ease;
    --transition-normal: 250ms ease;
  }

  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  .badge-tracker {
    font-family: var(--font-family);
    background: linear-gradient(135deg, var(--color-mint-light) 0%, var(--color-lavender-light) 100%);
    min-height: 100vh;
    color: var(--color-text-primary);
  }

  .skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: var(--color-primary);
    color: var(--color-text-inverse);
    padding: var(--space-sm) var(--space-md);
    z-index: 1000;
    text-decoration: none;
    border-radius: 0 0 var(--radius-md) 0;
    font-weight: 600;
  }
  .skip-link:focus { top: 0; }

  /* Header with action indicators */
  .header {
    background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
    color: var(--color-text-inverse);
    padding: var(--space-lg);
    position: sticky;
    top: 0;
    z-index: 100;
    box-shadow: var(--shadow-md);
  }

  .header__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .header__title {
    font-size: var(--font-size-xl);
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .header__subtitle {
    font-size: var(--font-size-sm);
    opacity: 0.9;
    margin-top: var(--space-xs);
  }

  /* Action indicators */
  .action-indicators {
    display: flex;
    gap: var(--space-sm);
  }

  .action-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    border: 2px solid rgba(255,255,255,0.3);
    background: rgba(255,255,255,0.1);
    color: var(--color-text-inverse);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .action-btn:hover {
    background: rgba(255,255,255,0.2);
    border-color: rgba(255,255,255,0.5);
  }

  .action-btn:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255,255,255,0.4);
  }

  .action-btn--active {
    background: var(--color-text-inverse);
    color: var(--color-primary);
    border-color: var(--color-text-inverse);
  }

  .action-btn__badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: #EF4444;
    color: white;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-sm);
  }

  .action-btn__badge--warning {
    background: var(--color-pending);
  }

  .action-btn__badge--info {
    background: var(--color-delivered);
  }

  /* View mode tabs */
  .view-tabs {
    display: flex;
    background: var(--color-white);
    border-bottom: 1px solid var(--color-border);
    overflow-x: auto;
  }

  .view-tab {
    flex: 1;
    min-width: 100px;
    padding: var(--space-md);
    border: none;
    background: transparent;
    font-family: inherit;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: all var(--transition-fast);
    border-bottom: 3px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
  }

  .view-tab:hover {
    color: var(--color-text-primary);
    background: var(--color-off-white);
  }

  .view-tab--active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }

  .view-tab:focus {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--color-border-focus);
  }

  .view-tab__count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-full);
    background: var(--color-off-white);
    font-size: 11px;
  }

  .view-tab--active .view-tab__count {
    background: var(--color-primary);
    color: white;
  }

  .view-tab__count--alert {
    background: var(--color-pending);
    color: white;
  }

  /* Filter bar */
  .filter-bar {
    background: var(--color-white);
    padding: var(--space-md);
    border-bottom: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  @media (min-width: 640px) {
    .filter-bar {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
  }

  .search-input {
    position: relative;
    flex: 1;
    max-width: 400px;
  }

  .search-input__field {
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    padding-left: 2.5rem;
    border: 2px solid var(--color-border);
    border-radius: var(--radius-full);
    font-size: var(--font-size-md);
    font-family: inherit;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  }

  .search-input__field:focus {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.2);
  }

  .search-input__icon {
    position: absolute;
    left: var(--space-md);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-muted);
  }

  /* Main content */
  .main-content {
    padding: var(--space-md);
    max-width: 800px;
    margin: 0 auto;
  }

  /* Stats summary */
  .stats-summary {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-sm);
    margin-bottom: var(--space-lg);
  }

  @media (min-width: 640px) {
    .stats-summary { grid-template-columns: repeat(4, 1fr); }
  }

  .stat-card {
    background: var(--color-white);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    text-align: center;
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--color-border);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .stat-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .stat-card--highlight {
    border-color: var(--color-pending);
    background: var(--color-pending-bg);
  }

  .stat-card__value {
    font-size: var(--font-size-2xl);
    font-weight: 700;
    color: var(--color-primary);
  }

  .stat-card--highlight .stat-card__value {
    color: var(--color-pending);
  }

  .stat-card__label {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Approval Queue */
  .queue-section {
    margin-bottom: var(--space-lg);
  }

  .queue-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-md);
  }

  .queue-title {
    font-size: var(--font-size-lg);
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .queue-title__icon {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }

  .queue-title__icon--pending {
    background: var(--color-pending-bg);
    color: var(--color-pending);
  }

  .queue-title__icon--delivery {
    background: var(--color-delivered-bg);
    color: var(--color-delivered);
  }

  .queue-actions {
    display: flex;
    gap: var(--space-sm);
  }

  /* Queue item */
  .queue-item {
    background: var(--color-white);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    margin-bottom: var(--space-sm);
    border: 1px solid var(--color-border);
    display: flex;
    align-items: center;
    gap: var(--space-md);
    transition: all var(--transition-fast);
  }

  .queue-item:hover {
    box-shadow: var(--shadow-sm);
  }

  .queue-item--pending {
    border-left: 4px solid var(--color-pending);
  }

  .queue-item--delivery {
    border-left: 4px solid var(--color-delivered);
  }

  .queue-item__badge {
    flex-shrink: 0;
  }

  .queue-item__content {
    flex: 1;
    min-width: 0;
  }

  .queue-item__header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-xs);
    flex-wrap: wrap;
  }

  .queue-item__name {
    font-weight: 600;
    font-size: var(--font-size-md);
  }

  .queue-item__badge-name {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  .queue-item__star {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: var(--font-size-xs);
    font-weight: 600;
    background: var(--color-star-filled);
    color: white;
  }

  .queue-item__type {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .queue-item__type--proie {
    background: var(--color-proie-bg);
    color: var(--color-proie);
  }

  .queue-item__type--battue {
    background: var(--color-battue-bg);
    color: var(--color-battue);
  }

  .queue-item__details {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  .queue-item__date {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-xs);
  }

  .queue-item__actions {
    display: flex;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  /* Action buttons */
  .icon-btn {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-border);
    background: var(--color-white);
    color: var(--color-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
  }

  .icon-btn:hover {
    background: var(--color-off-white);
  }

  .icon-btn:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.2);
  }

  .icon-btn--approve {
    border-color: var(--color-approved);
    color: var(--color-approved);
  }

  .icon-btn--approve:hover {
    background: var(--color-approved);
    color: white;
  }

  .icon-btn--deliver {
    border-color: var(--color-delivered);
    color: var(--color-delivered);
  }

  .icon-btn--deliver:hover {
    background: var(--color-delivered);
    color: white;
  }

  .icon-btn--reject {
    border-color: #EF4444;
    color: #EF4444;
  }

  .icon-btn--reject:hover {
    background: #EF4444;
    color: white;
  }

  /* Checkbox for bulk actions */
  .checkbox {
    width: 20px;
    height: 20px;
    border: 2px solid var(--color-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
    flex-shrink: 0;
  }

  .checkbox:hover {
    border-color: var(--color-primary);
  }

  .checkbox--checked {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .checkbox:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.2);
  }

  /* Participant list */
  .participant-list { list-style: none; }

  .participant-list__header {
    font-size: var(--font-size-lg);
    font-weight: 700;
    margin-bottom: var(--space-md);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .participant-list__count {
    font-size: var(--font-size-sm);
    font-weight: 400;
    color: var(--color-text-muted);
  }

  /* Participant card */
  .participant-card {
    background: var(--color-white);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-sm);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    border: 1px solid var(--color-border);
    transition: box-shadow var(--transition-fast), transform var(--transition-fast);
  }

  .participant-card:nth-child(odd) { background: var(--color-mint-light); }
  .participant-card:nth-child(even) { background: var(--color-lavender-light); }

  .participant-card:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .participant-card__header {
    display: flex;
    align-items: center;
    padding: var(--space-md);
    gap: var(--space-md);
    cursor: pointer;
    border: none;
    background: transparent;
    width: 100%;
    text-align: left;
    font-family: inherit;
  }

  .participant-card__header:focus { outline: none; }

  .participant-card__avatar {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    background: linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-primary) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-inverse);
    font-weight: 700;
    font-size: var(--font-size-md);
    flex-shrink: 0;
  }

  .participant-card__info {
    flex: 1;
    min-width: 0;
  }

  .participant-card__name {
    font-weight: 600;
    font-size: var(--font-size-md);
    color: var(--color-text-primary);
    margin-bottom: 2px;
    display: flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .participant-card__indicators {
    display: inline-flex;
    gap: 4px;
  }

  .indicator-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
  }

  .indicator-dot--pending {
    background: var(--color-pending);
  }

  .indicator-dot--delivery {
    background: var(--color-delivered);
  }

  .participant-card__totem {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
    font-style: italic;
  }

  /* Badge preview */
  .badge-preview {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .badge-preview__item {
    position: relative;
    width: 36px;
    height: 36px;
  }

  .badge-preview__image {
    width: 100%;
    height: 100%;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  .badge-preview__stars {
    position: absolute;
    bottom: -4px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 1px;
    background: var(--color-white);
    padding: 1px 3px;
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-sm);
  }

  .badge-preview__star {
    font-size: 8px;
    color: var(--color-star-filled);
  }

  .badge-preview__star--empty {
    color: var(--color-star-empty);
  }

  .badge-preview__star--pending {
    color: var(--color-pending);
  }

  .badge-preview__delivery-indicator {
    position: absolute;
    top: -2px;
    right: -2px;
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    background: var(--color-delivered);
    border: 2px solid white;
  }

  .badge-preview__more {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    background: var(--color-off-white);
    border: 2px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .participant-card__chevron {
    color: var(--color-text-muted);
    transition: transform var(--transition-fast);
    flex-shrink: 0;
  }

  .participant-card__chevron--expanded {
    transform: rotate(180deg);
  }

  /* Badge details */
  .badge-details {
    padding: 0 var(--space-md) var(--space-md);
    animation: slideDown 200ms ease-out;
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Badge card */
  .badge-card {
    background: rgba(255, 255, 255, 0.85);
    border-radius: var(--radius-md);
    padding: var(--space-md);
    margin-bottom: var(--space-sm);
    border: 1px solid var(--color-border);
  }

  .badge-card:last-child { margin-bottom: 0; }

  .badge-card__header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-md);
    margin-bottom: var(--space-md);
  }

  .badge-card__image-container {
    position: relative;
    flex-shrink: 0;
  }

  .badge-card__image {
    width: 56px;
    height: 56px;
    object-fit: contain;
    border-radius: var(--radius-sm);
  }

  .badge-card__info {
    flex: 1;
    min-width: 0;
  }

  .badge-card__title {
    font-weight: 600;
    font-size: var(--font-size-md);
    color: var(--color-text-primary);
    margin-bottom: var(--space-xs);
  }

  .badge-card__progress-text {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }

  /* Star progress */
  .star-progress {
    display: flex;
    gap: var(--space-sm);
    margin-bottom: var(--space-sm);
    flex-wrap: wrap;
  }

  .star-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-sm);
    background: var(--color-off-white);
    border-radius: var(--radius-md);
    border: 2px solid var(--color-border);
    flex: 1;
    min-width: 90px;
    position: relative;
  }

  .star-slot--delivered {
    border-color: var(--color-delivered);
    background: var(--color-delivered-bg);
  }

  .star-slot--approved {
    border-color: var(--color-star-filled);
    background: #FFFBEB;
  }

  .star-slot--pending {
    border-color: var(--color-pending);
    border-style: dashed;
    background: var(--color-pending-bg);
  }

  .star-slot__icon {
    font-size: 1.5rem;
    color: var(--color-star-empty);
  }

  .star-slot--delivered .star-slot__icon,
  .star-slot--approved .star-slot__icon {
    color: var(--color-star-filled);
  }

  .star-slot--pending .star-slot__icon {
    color: var(--color-pending);
  }

  .star-slot__delivery-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-full);
    background: var(--color-delivered);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
  }

  .star-slot__type {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .star-slot__type--proie {
    background: var(--color-proie-bg);
    color: var(--color-proie);
  }

  .star-slot__type--battue {
    background: var(--color-battue-bg);
    color: var(--color-battue);
  }

  .star-slot__date {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  .star-slot__status {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }

  .star-slot__status--pending {
    color: var(--color-pending);
  }

  .star-slot__status--needs-delivery {
    color: var(--color-delivered);
  }

  .star-slot__label {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  /* Add star button */
  .add-star-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-sm);
    background: transparent;
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition-fast);
    flex: 1;
    min-width: 90px;
  }

  .add-star-btn:hover {
    border-color: var(--color-primary);
    color: var(--color-primary);
    background: var(--color-mint-light);
  }

  .add-star-btn:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.2);
  }

  /* FAB */
  .fab {
    position: fixed;
    bottom: var(--space-lg);
    right: var(--space-lg);
    width: 56px;
    height: 56px;
    border-radius: var(--radius-full);
    background: linear-gradient(135deg, var(--color-primary-light) 0%, var(--color-primary) 100%);
    color: var(--color-text-inverse);
    border: none;
    box-shadow: var(--shadow-lg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    transition: transform var(--transition-fast), box-shadow var(--transition-fast);
    z-index: 50;
  }

  .fab:hover { transform: scale(1.05); }
  .fab:focus {
    outline: none;
    box-shadow: 0 0 0 4px rgba(46, 125, 74, 0.4), var(--shadow-lg);
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(26, 26, 46, 0.6);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 200;
    animation: fadeIn 200ms ease-out;
  }

  @media (min-width: 640px) {
    .modal-overlay {
      align-items: center;
      padding: var(--space-lg);
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal {
    background: var(--color-white);
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    animation: slideUp 300ms ease-out;
  }

  @media (min-width: 640px) {
    .modal { border-radius: var(--radius-lg); }
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateY(100px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-lg);
    border-bottom: 1px solid var(--color-border);
    position: sticky;
    top: 0;
    background: var(--color-white);
    z-index: 1;
  }

  .modal__title {
    font-size: var(--font-size-lg);
    font-weight: 700;
  }

  .modal__close {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    border: none;
    background: var(--color-off-white);
    color: var(--color-text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background var(--transition-fast);
  }

  .modal__close:hover { background: var(--color-border); }
  .modal__close:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.3);
  }

  .modal__body { padding: var(--space-lg); }
  .modal__footer {
    display: flex;
    gap: var(--space-sm);
    padding: var(--space-lg);
    padding-top: 0;
  }

  /* Form styles */
  .form-group { margin-bottom: var(--space-lg); }

  .form-label {
    display: block;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--color-text-primary);
    margin-bottom: var(--space-xs);
  }

  .form-label--required::after {
    content: ' *';
    color: var(--color-pending);
  }

  .form-input,
  .form-select,
  .form-textarea {
    width: 100%;
    padding: var(--space-sm) var(--space-md);
    border: 2px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    font-family: inherit;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
    background: var(--color-white);
  }

  .form-input:focus,
  .form-select:focus,
  .form-textarea:focus {
    outline: none;
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.2);
  }

  .form-textarea {
    min-height: 80px;
    resize: vertical;
  }

  .form-hint {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
    margin-top: var(--space-xs);
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-md);
  }

  /* Type selector */
  .type-selector {
    display: flex;
    gap: var(--space-sm);
  }

  .type-option {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-md);
    border: 2px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
    background: var(--color-white);
  }

  .type-option:hover { background: var(--color-off-white); }
  .type-option--selected {
    border-color: var(--color-primary);
    background: var(--color-mint-light);
  }

  .type-option:focus-within {
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.2);
  }

  .type-option__input {
    position: absolute;
    opacity: 0;
  }

  .type-option__icon { font-size: 1.5rem; }
  .type-option__label {
    font-size: var(--font-size-sm);
    font-weight: 600;
  }
  .type-option__desc {
    font-size: var(--font-size-xs);
    color: var(--color-text-muted);
  }

  /* Badge selector */
  .badge-selector {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-sm);
  }

  .badge-selector__option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-sm);
    border: 2px solid var(--color-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-fast);
    background: var(--color-white);
  }

  .badge-selector__option:hover { background: var(--color-off-white); }
  .badge-selector__option--selected {
    border-color: var(--color-primary);
    background: var(--color-mint-light);
  }

  .badge-selector__option:focus-within {
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.2);
  }

  .badge-selector__input {
    position: absolute;
    opacity: 0;
  }

  .badge-selector__image {
    width: 48px;
    height: 48px;
    object-fit: contain;
  }

  .badge-selector__name {
    font-size: var(--font-size-xs);
    font-weight: 500;
    text-align: center;
    line-height: 1.2;
  }

  /* Button styles */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-lg);
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition-fast);
    border: 2px solid transparent;
  }

  .btn--primary {
    background: var(--color-primary);
    color: var(--color-text-inverse);
    border-color: var(--color-primary);
  }

  .btn--primary:hover {
    background: var(--color-primary-dark);
    border-color: var(--color-primary-dark);
  }

  .btn--primary:focus {
    outline: none;
    box-shadow: 0 0 0 3px rgba(46, 125, 74, 0.4);
  }

  .btn--secondary {
    background: var(--color-white);
    color: var(--color-text-primary);
    border-color: var(--color-border);
  }

  .btn--secondary:hover { background: var(--color-off-white); }

  .btn--sm {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
  }

  /* Empty state */
  .empty-state {
    text-align: center;
    padding: var(--space-xl);
    background: var(--color-white);
    border-radius: var(--radius-lg);
    border: 2px dashed var(--color-border);
  }

  .empty-state__icon {
    font-size: 3rem;
    margin-bottom: var(--space-md);
  }

  .empty-state__title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    margin-bottom: var(--space-xs);
  }

  .empty-state__description {
    font-size: var(--font-size-sm);
    color: var(--color-text-muted);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Toast notifications */
  .toast-container {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 300;
  }

  .toast {
    background: var(--color-text-primary);
    color: white;
    padding: var(--space-sm) var(--space-lg);
    border-radius: var(--radius-full);
    font-size: var(--font-size-sm);
    font-weight: 500;
    box-shadow: var(--shadow-lg);
    animation: toastIn 300ms ease-out;
  }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

// ============================================
// ICONS
// ============================================
const Icons = {
  Search: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6"/>
    </svg>
  ),
  Plus: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  ),
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  ),
  Star: ({ filled, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  Check: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  X: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  ),
  Clock: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  Gift: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>
    </svg>
  ),
  User: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  Users: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  Paw: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-4.5 2c0-.8-.7-1.5-1.5-1.5S4.5 11.2 4.5 12s.7 1.5 1.5 1.5 1.5-.7 1.5-1.5zm9 0c0-.8-.7-1.5-1.5-1.5s-1.5.7-1.5 1.5.7 1.5 1.5 1.5 1.5-.7 1.5-1.5zM9 6c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zm10 0c0-1.1-.9-2-2-2s-2 .9-2 2 .9 2 2 2 2-.9 2-2zm-7 12c-2.8 0-5 1.8-5 4h10c0-2.2-2.2-4-5-4z"/>
    </svg>
  ),
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const formatDate = (dateString) => {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
};

const groupBadgeProgress = (progress, participantId) => {
  const participantProgress = progress.filter(p => p.participant_id === participantId);
  const grouped = {};
  participantProgress.forEach(p => {
    if (!grouped[p.badge_template_id]) grouped[p.badge_template_id] = [];
    grouped[p.badge_template_id].push(p);
  });
  Object.keys(grouped).forEach(key => {
    grouped[key].sort((a, b) => a.star_number - b.star_number);
  });
  return grouped;
};

// ============================================
// COMPONENTS
// ============================================

const useFocusTrap = (isActive) => {
  const containerRef = useRef(null);
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };
    firstElement?.focus();
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);
  return containerRef;
};

// Badge Image Component
const BadgeImage = ({ template, size = 48, className = '' }) => {
  const [imgError, setImgError] = useState(false);
  if (imgError || !template?.image) {
    return (
      <div className={className} style={{
        width: size, height: size, background: 'var(--color-off-white)',
        borderRadius: 'var(--radius-sm)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5,
      }} aria-hidden="true">🏅</div>
    );
  }
  return (
    <img
      src={BADGE_IMAGES[template.image] || template.image}
      alt={template.name}
      className={className}
      style={{ width: size, height: size, objectFit: 'contain' }}
      onError={() => setImgError(true)}
    />
  );
};

// Queue Item Component
const QueueItem = ({ item, participant, template, type, onApprove, onReject, onDeliver }) => (
  <div className={`queue-item queue-item--${type}`}>
    <BadgeImage template={template} size={48} />
    <div className="queue-item__content">
      <div className="queue-item__header">
        <span className="queue-item__name">
          {participant?.first_name} {participant?.last_name}
        </span>
        <span className="queue-item__star">★ {item.star_number}</span>
        <span className={`queue-item__type queue-item__type--${item.type}`}>
          {item.type === 'proie' ? <><Icons.User /> Proie</> : <><Icons.Users /> Battue</>}
        </span>
      </div>
      <div className="queue-item__badge-name">{template?.name}</div>
      <div className="queue-item__details">{item.objectif}</div>
      <div className="queue-item__date">
        {type === 'pending' ? `Soumis le ${formatDate(item.date_obtention)}` : `Approuvé le ${formatDate(item.approval_date)}`}
      </div>
    </div>
    <div className="queue-item__actions">
      {type === 'pending' ? (
        <>
          <button
            className="icon-btn icon-btn--approve"
            onClick={() => onApprove(item.id)}
            aria-label="Approuver"
            title="Approuver"
          >
            <Icons.Check />
          </button>
          <button
            className="icon-btn icon-btn--reject"
            onClick={() => onReject(item.id)}
            aria-label="Rejeter"
            title="Rejeter"
          >
            <Icons.X />
          </button>
        </>
      ) : (
        <button
          className="icon-btn icon-btn--deliver"
          onClick={() => onDeliver(item.id)}
          aria-label="Marquer comme remis"
          title="Marquer comme remis"
        >
          <Icons.Gift />
        </button>
      )}
    </div>
  </div>
);

// Badge Preview (collapsed view)
const BadgePreview = ({ participantId, badgeProgress, badgeTemplates }) => {
  const grouped = groupBadgeProgress(badgeProgress, participantId);
  const badgeIds = Object.keys(grouped);
  if (badgeIds.length === 0) return null;
  
  const displayBadges = badgeIds.slice(0, 3);
  const remaining = badgeIds.length - 3;
  
  return (
    <div className="badge-preview" aria-label={`${badgeIds.length} badge${badgeIds.length > 1 ? 's' : ''}`}>
      {displayBadges.map(templateId => {
        const template = badgeTemplates.find(t => t.id === parseInt(templateId));
        const stars = grouped[templateId];
        const maxStars = template?.level_count || 3;
        const hasUndelivered = stars.some(s => s.status === 'approved' && !s.delivered_at);
        
        return (
          <div key={templateId} className="badge-preview__item">
            <BadgeImage template={template} size={36} className="badge-preview__image" />
            {hasUndelivered && <div className="badge-preview__delivery-indicator" title="À remettre" />}
            <div className="badge-preview__stars">
              {[...Array(maxStars)].map((_, i) => {
                const star = stars.find(s => s.star_number === i + 1);
                let starClass = 'badge-preview__star--empty';
                if (star?.status === 'approved') starClass = '';
                if (star?.status === 'pending') starClass = 'badge-preview__star--pending';
                return <span key={i} className={`badge-preview__star ${starClass}`}>★</span>;
              })}
            </div>
          </div>
        );
      })}
      {remaining > 0 && (
        <div className="badge-preview__more" aria-label={`${remaining} autres badges`}>+{remaining}</div>
      )}
    </div>
  );
};

// Star Slot Component
const StarSlot = ({ starNumber, starData, onAddStar }) => {
  const isDelivered = starData?.status === 'approved' && starData?.delivered_at;
  const isApproved = starData?.status === 'approved' && !starData?.delivered_at;
  const isPending = starData?.status === 'pending';
  const isEmpty = !starData;
  
  if (isEmpty) {
    return (
      <button className="add-star-btn" onClick={() => onAddStar(starNumber)} aria-label={`Ajouter étoile ${starNumber}`}>
        <Icons.Plus /><span>Étoile {starNumber}</span>
      </button>
    );
  }
  
  return (
    <div className={`star-slot ${isDelivered ? 'star-slot--delivered' : ''} ${isApproved ? 'star-slot--approved' : ''} ${isPending ? 'star-slot--pending' : ''}`}>
      {isDelivered && (
        <div className="star-slot__delivery-badge" title="Remis">
          <Icons.Check />
        </div>
      )}
      <div className="star-slot__icon"><Icons.Star filled={!isEmpty} /></div>
      {starData.type && (
        <span className={`star-slot__type star-slot__type--${starData.type}`}>
          {starData.type === 'proie' ? <><Icons.User /> Proie</> : <><Icons.Users /> Battue</>}
        </span>
      )}
      {isPending && <span className="star-slot__status star-slot__status--pending">En attente</span>}
      {isApproved && <span className="star-slot__status star-slot__status--needs-delivery">À remettre</span>}
      {isDelivered && <span className="star-slot__date">{formatDate(starData.delivered_at)}</span>}
    </div>
  );
};

// Badge Card (expanded view)
const BadgeCard = ({ template, stars, onAddStar }) => {
  const maxStars = template.level_count || 3;
  const earnedCount = stars.filter(s => s.status === 'approved').length;
  const deliveredCount = stars.filter(s => s.delivered_at).length;
  const pendingCount = stars.filter(s => s.status === 'pending').length;
  const starSlots = [...Array(maxStars)].map((_, i) => stars.find(s => s.star_number === i + 1) || null);
  
  return (
    <div className="badge-card">
      <div className="badge-card__header">
        <div className="badge-card__image-container">
          <BadgeImage template={template} size={56} className="badge-card__image" />
        </div>
        <div className="badge-card__info">
          <h4 className="badge-card__title">{template.name}</h4>
          <p className="badge-card__progress-text">
            {earnedCount}/{maxStars} approuvée{earnedCount !== 1 ? 's' : ''}
            {deliveredCount > 0 && ` • ${deliveredCount} remise${deliveredCount !== 1 ? 's' : ''}`}
            {pendingCount > 0 && ` • ${pendingCount} en attente`}
          </p>
        </div>
      </div>
      <div className="star-progress">
        {starSlots.map((starData, i) => (
          <StarSlot key={i} starNumber={i + 1} starData={starData} onAddStar={onAddStar} />
        ))}
      </div>
    </div>
  );
};

// Participant Card
const ParticipantCard = ({ participant, badgeProgress, badgeTemplates, isExpanded, onToggle, onAddStar }) => {
  const initials = `${participant.first_name[0]}${participant.last_name[0]}`;
  const grouped = groupBadgeProgress(badgeProgress, participant.id);
  const allStars = badgeProgress.filter(p => p.participant_id === participant.id);
  const hasPending = allStars.some(s => s.status === 'pending');
  const hasUndelivered = allStars.some(s => s.status === 'approved' && !s.delivered_at);
  
  return (
    <li className="participant-card">
      <button className="participant-card__header" onClick={onToggle} aria-expanded={isExpanded} aria-controls={`badges-${participant.id}`}>
        <div className="participant-card__avatar" aria-hidden="true">{initials}</div>
        <div className="participant-card__info">
          <div className="participant-card__name">
            {participant.first_name} {participant.last_name}
            {(hasPending || hasUndelivered) && (
              <span className="participant-card__indicators">
                {hasPending && <span className="indicator-dot indicator-dot--pending" title="En attente d'approbation" />}
                {hasUndelivered && <span className="indicator-dot indicator-dot--delivery" title="Badge à remettre" />}
              </span>
            )}
          </div>
          {participant.totem && <div className="participant-card__totem">{participant.totem}</div>}
        </div>
        <BadgePreview participantId={participant.id} badgeProgress={badgeProgress} badgeTemplates={badgeTemplates} />
        <span className={`participant-card__chevron ${isExpanded ? 'participant-card__chevron--expanded' : ''}`} aria-hidden="true">
          <Icons.ChevronDown />
        </span>
      </button>
      {isExpanded && (
        <div id={`badges-${participant.id}`} className="badge-details">
          {Object.keys(grouped).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">🎯</div>
              <div className="empty-state__title">Aucun badge en cours</div>
              <div className="empty-state__description">Utilisez le bouton + pour commencer</div>
            </div>
          ) : (
            Object.entries(grouped).map(([templateId, stars]) => {
              const template = badgeTemplates.find(t => t.id === parseInt(templateId));
              if (!template) return null;
              return (
                <BadgeCard
                  key={templateId}
                  template={template}
                  stars={stars}
                  onAddStar={(starNum) => onAddStar(participant.id, parseInt(templateId), starNum)}
                />
              );
            })
          )}
        </div>
      )}
    </li>
  );
};

// Modal Component
const Modal = ({ isOpen, onClose, title, children }) => {
  const modalRef = useFocusTrap(isOpen);
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal" ref={modalRef}>
        <div className="modal__header">
          <h2 id="modal-title" className="modal__title">{title}</h2>
          <button className="modal__close" onClick={onClose} aria-label="Fermer"><Icons.Close /></button>
        </div>
        {children}
      </div>
    </div>
  );
};

// Add Star Form
const AddStarForm = ({ participants, badgeTemplates, existingProgress, initialData, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    participant_id: initialData?.participant_id || '',
    badge_template_id: initialData?.badge_template_id || '',
    star_number: initialData?.star_number || 1,
    type: 'proie',
    objectif: '',
    description: '',
    date_obtention: new Date().toISOString().split('T')[0],
  });

  const handleChange = (field, value) => setFormData(prev => ({ ...prev, [field]: value }));

  useEffect(() => {
    if (formData.participant_id && formData.badge_template_id) {
      const existing = existingProgress.filter(
        p => p.participant_id === parseInt(formData.participant_id) && p.badge_template_id === parseInt(formData.badge_template_id)
      );
      const nextStar = existing.length > 0 ? Math.max(...existing.map(s => s.star_number)) + 1 : 1;
      handleChange('star_number', nextStar);
    }
  }, [formData.participant_id, formData.badge_template_id, existingProgress]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ ...formData, participant_id: parseInt(formData.participant_id), badge_template_id: parseInt(formData.badge_template_id) });
  };

  const selectedTemplate = badgeTemplates.find(t => t.id === parseInt(formData.badge_template_id));

  return (
    <form onSubmit={handleSubmit}>
      <div className="modal__body">
        <div className="form-group">
          <label className="form-label form-label--required">Participant·e</label>
          <select className="form-select" value={formData.participant_id} onChange={(e) => handleChange('participant_id', e.target.value)} required>
            <option value="">Sélectionner...</option>
            {participants.sort((a, b) => a.first_name.localeCompare(b.first_name, 'fr')).map(p => (
              <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label form-label--required">Badge</label>
          <div className="badge-selector">
            {badgeTemplates.map(template => (
              <label key={template.id} className={`badge-selector__option ${formData.badge_template_id === String(template.id) ? 'badge-selector__option--selected' : ''}`}>
                <input type="radio" name="badge_template" value={template.id} checked={formData.badge_template_id === String(template.id)} onChange={(e) => handleChange('badge_template_id', e.target.value)} className="badge-selector__input" required />
                <BadgeImage template={template} size={48} className="badge-selector__image" />
                <span className="badge-selector__name">{template.name.replace('comme ', '')}</span>
              </label>
            ))}
          </div>
        </div>
        {selectedTemplate && (
          <div className="form-group">
            <label className="form-label">Étoile</label>
            <p className="form-hint" style={{ marginBottom: 0 }}>Étoile #{formData.star_number} sur {selectedTemplate.level_count}</p>
          </div>
        )}
        <div className="form-group">
          <label className="form-label form-label--required">Type d'accomplissement</label>
          <div className="type-selector">
            <label className={`type-option ${formData.type === 'proie' ? 'type-option--selected' : ''}`}>
              <input type="radio" name="type" value="proie" checked={formData.type === 'proie'} onChange={(e) => handleChange('type', e.target.value)} className="type-option__input" />
              <span className="type-option__icon">🎯</span>
              <span className="type-option__label">Proie</span>
              <span className="type-option__desc">Individuel</span>
            </label>
            <label className={`type-option ${formData.type === 'battue' ? 'type-option--selected' : ''}`}>
              <input type="radio" name="type" value="battue" checked={formData.type === 'battue'} onChange={(e) => handleChange('type', e.target.value)} className="type-option__input" />
              <span className="type-option__icon">🐺</span>
              <span className="type-option__label">Battue</span>
              <span className="type-option__desc">Groupe</span>
            </label>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="objectif" className="form-label form-label--required">Objectif</label>
          <input type="text" id="objectif" className="form-input" value={formData.objectif} onChange={(e) => handleChange('objectif', e.target.value)} placeholder="Ex: Présentation sur un sujet" required />
        </div>
        <div className="form-group">
          <label htmlFor="description" className="form-label">Description</label>
          <textarea id="description" className="form-textarea" value={formData.description} onChange={(e) => handleChange('description', e.target.value)} placeholder="Détails de l'accomplissement..." />
        </div>
        <div className="form-group">
          <label htmlFor="date" className="form-label form-label--required">Date d'obtention</label>
          <input type="date" id="date" className="form-input" value={formData.date_obtention} onChange={(e) => handleChange('date_obtention', e.target.value)} required />
        </div>
      </div>
      <div className="modal__footer">
        <button type="button" className="btn btn--secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" className="btn btn--primary" style={{ flex: 1 }}>Ajouter l'étoile</button>
      </div>
    </form>
  );
};

// Main Component
const BadgeTracker = () => {
  const [participants] = useState(sampleParticipants);
  const [badgeTemplates] = useState(sampleBadgeTemplates);
  const [badgeProgress, setBadgeProgress] = useState(sampleBadgeProgress);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('participants'); // participants, pending, delivery
  const [expandedParticipant, setExpandedParticipant] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInitialData, setModalInitialData] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // Queue data
  const pendingItems = badgeProgress.filter(p => p.status === 'pending');
  const needsDelivery = badgeProgress.filter(p => p.status === 'approved' && !p.delivered_at);

  const filteredParticipants = participants
    .filter(p => {
      const fullName = `${p.first_name} ${p.last_name}`.toLowerCase();
      return fullName.includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => a.first_name.localeCompare(b.first_name, 'fr'));

  const stats = {
    totalParticipants: participants.length,
    totalStars: badgeProgress.filter(b => b.status === 'approved').length,
    pendingStars: pendingItems.length,
    needsDelivery: needsDelivery.length,
  };

  const handleApprove = (id) => {
    setBadgeProgress(prev => prev.map(p => 
      p.id === id ? { ...p, status: 'approved', approval_date: new Date().toISOString() } : p
    ));
    showToast('Étoile approuvée ✓');
  };

  const handleReject = (id) => {
    setBadgeProgress(prev => prev.filter(p => p.id !== id));
    showToast('Étoile rejetée');
  };

  const handleDeliver = (id) => {
    setBadgeProgress(prev => prev.map(p => 
      p.id === id ? { ...p, delivered_at: new Date().toISOString() } : p
    ));
    showToast('Étoile marquée comme remise ✓');
  };

  const handleDeliverAll = () => {
    const now = new Date().toISOString();
    setBadgeProgress(prev => prev.map(p => 
      p.status === 'approved' && !p.delivered_at ? { ...p, delivered_at: now } : p
    ));
    showToast(`${needsDelivery.length} étoile(s) marquée(s) comme remise(s) ✓`);
  };

  const handleAddStar = useCallback((formData) => {
    const newProgress = {
      id: Date.now(),
      ...formData,
      status: 'pending',
      approval_date: null,
      delivered_at: null,
    };
    setBadgeProgress(prev => [...prev, newProgress]);
    setIsModalOpen(false);
    setModalInitialData(null);
    showToast('Nouvelle étoile ajoutée');
  }, []);

  const openAddStarModal = (participantId = null, badgeTemplateId = null, starNumber = null) => {
    setModalInitialData({ participant_id: participantId || '', badge_template_id: badgeTemplateId || '', star_number: starNumber || 1 });
    setIsModalOpen(true);
  };

  const getParticipant = (id) => participants.find(p => p.id === id);
  const getTemplate = (id) => badgeTemplates.find(t => t.id === id);

  return (
    <>
      <style>{styles}</style>
      <div className="badge-tracker">
        <a href="#main-content" className="skip-link">Aller au contenu principal</a>

        <header className="header">
          <div className="header__top">
            <div>
              <h1 className="header__title"><Icons.Paw /> Badges de la Meute</h1>
              <p className="header__subtitle">Suivi des progrès des louveteaux</p>
            </div>
            <div className="action-indicators">
              <button
                className={`action-btn ${viewMode === 'pending' ? 'action-btn--active' : ''}`}
                onClick={() => setViewMode(viewMode === 'pending' ? 'participants' : 'pending')}
                aria-label={`${pendingItems.length} étoiles en attente d'approbation`}
                title="Approbations en attente"
              >
                <Icons.Clock />
                {pendingItems.length > 0 && (
                  <span className="action-btn__badge action-btn__badge--warning">{pendingItems.length}</span>
                )}
              </button>
              <button
                className={`action-btn ${viewMode === 'delivery' ? 'action-btn--active' : ''}`}
                onClick={() => setViewMode(viewMode === 'delivery' ? 'participants' : 'delivery')}
                aria-label={`${needsDelivery.length} étoiles à remettre`}
                title="À remettre"
              >
                <Icons.Gift />
                {needsDelivery.length > 0 && (
                  <span className="action-btn__badge action-btn__badge--info">{needsDelivery.length}</span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* View tabs */}
        <div className="view-tabs" role="tablist">
          <button
            className={`view-tab ${viewMode === 'participants' ? 'view-tab--active' : ''}`}
            onClick={() => setViewMode('participants')}
            role="tab"
            aria-selected={viewMode === 'participants'}
          >
            👥 Participants
          </button>
          <button
            className={`view-tab ${viewMode === 'pending' ? 'view-tab--active' : ''}`}
            onClick={() => setViewMode('pending')}
            role="tab"
            aria-selected={viewMode === 'pending'}
          >
            <Icons.Clock />
            Approbations
            <span className={`view-tab__count ${pendingItems.length > 0 ? 'view-tab__count--alert' : ''}`}>
              {pendingItems.length}
            </span>
          </button>
          <button
            className={`view-tab ${viewMode === 'delivery' ? 'view-tab--active' : ''}`}
            onClick={() => setViewMode('delivery')}
            role="tab"
            aria-selected={viewMode === 'delivery'}
          >
            <Icons.Gift />
            À remettre
            <span className="view-tab__count">{needsDelivery.length}</span>
          </button>
        </div>

        {viewMode === 'participants' && (
          <div className="filter-bar" role="search">
            <div className="search-input">
              <span className="search-input__icon" aria-hidden="true"><Icons.Search /></span>
              <input
                type="search"
                className="search-input__field"
                placeholder="Rechercher un louveteau..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Rechercher un participant"
              />
            </div>
          </div>
        )}

        <main id="main-content" className="main-content">
          {viewMode === 'participants' && (
            <>
              <div className="stats-summary" role="region" aria-label="Statistiques">
                <div className="stat-card" onClick={() => setViewMode('participants')}>
                  <div className="stat-card__value">{stats.totalParticipants}</div>
                  <div className="stat-card__label">Louveteaux</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card__value">{stats.totalStars}</div>
                  <div className="stat-card__label">Étoiles ★</div>
                </div>
                <div
                  className={`stat-card ${stats.pendingStars > 0 ? 'stat-card--highlight' : ''}`}
                  onClick={() => setViewMode('pending')}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="stat-card__value">{stats.pendingStars}</div>
                  <div className="stat-card__label">En attente</div>
                </div>
                <div className="stat-card" onClick={() => setViewMode('delivery')} style={{ cursor: 'pointer' }}>
                  <div className="stat-card__value">{stats.needsDelivery}</div>
                  <div className="stat-card__label">À remettre</div>
                </div>
              </div>

              <div className="participant-list__header">
                <span>Participants</span>
                <span className="participant-list__count">{filteredParticipants.length} résultat{filteredParticipants.length !== 1 ? 's' : ''}</span>
              </div>

              {filteredParticipants.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state__icon">🔍</div>
                  <div className="empty-state__title">Aucun résultat</div>
                  <div className="empty-state__description">Essayez une recherche différente</div>
                </div>
              ) : (
                <ul className="participant-list" role="list">
                  {filteredParticipants.map(participant => (
                    <ParticipantCard
                      key={participant.id}
                      participant={participant}
                      badgeProgress={badgeProgress}
                      badgeTemplates={badgeTemplates}
                      isExpanded={expandedParticipant === participant.id}
                      onToggle={() => setExpandedParticipant(prev => prev === participant.id ? null : participant.id)}
                      onAddStar={(pId, tId, starNum) => openAddStarModal(pId, tId, starNum)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          {viewMode === 'pending' && (
            <div className="queue-section">
              <div className="queue-header">
                <h2 className="queue-title">
                  <span className="queue-title__icon queue-title__icon--pending"><Icons.Clock /></span>
                  Approbations en attente
                </h2>
              </div>
              {pendingItems.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state__icon">✓</div>
                  <div className="empty-state__title">Tout est à jour!</div>
                  <div className="empty-state__description">Aucune étoile en attente d'approbation</div>
                </div>
              ) : (
                pendingItems.map(item => (
                  <QueueItem
                    key={item.id}
                    item={item}
                    participant={getParticipant(item.participant_id)}
                    template={getTemplate(item.badge_template_id)}
                    type="pending"
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                ))
              )}
            </div>
          )}

          {viewMode === 'delivery' && (
            <div className="queue-section">
              <div className="queue-header">
                <h2 className="queue-title">
                  <span className="queue-title__icon queue-title__icon--delivery"><Icons.Gift /></span>
                  Étoiles à remettre
                </h2>
                {needsDelivery.length > 0 && (
                  <button className="btn btn--primary btn--sm" onClick={handleDeliverAll}>
                    Tout marquer comme remis
                  </button>
                )}
              </div>
              {needsDelivery.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state__icon">🎁</div>
                  <div className="empty-state__title">Tout est remis!</div>
                  <div className="empty-state__description">Toutes les étoiles approuvées ont été distribuées</div>
                </div>
              ) : (
                needsDelivery.map(item => (
                  <QueueItem
                    key={item.id}
                    item={item}
                    participant={getParticipant(item.participant_id)}
                    template={getTemplate(item.badge_template_id)}
                    type="delivery"
                    onDeliver={handleDeliver}
                  />
                ))
              )}
            </div>
          )}
        </main>

        <button className="fab" onClick={() => openAddStarModal()} aria-label="Ajouter une nouvelle étoile">
          <Icons.Plus />
        </button>

        <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setModalInitialData(null); }} title="Nouvelle étoile">
          <AddStarForm
            participants={participants}
            badgeTemplates={badgeTemplates}
            existingProgress={badgeProgress}
            initialData={modalInitialData}
            onSubmit={handleAddStar}
            onCancel={() => { setIsModalOpen(false); setModalInitialData(null); }}
          />
        </Modal>

        {toast && (
          <div className="toast-container">
            <div className="toast">{toast}</div>
          </div>
        )}
      </div>
    </>
  );
};

export default BadgeTracker;
