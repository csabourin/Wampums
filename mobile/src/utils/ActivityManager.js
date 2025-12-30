/**
 * ActivityManager for Mobile
 *
 * Mirrors spa/modules/ActivityManager.js
 * Handles activity templates, descriptions, and editing logic
 */

import { debugLog } from './DebugUtils';

export class ActivityManager {
  constructor(animateurs = [], activityTemplates = []) {
    this.animateurs = animateurs;
    this.activityTemplates = activityTemplates;
    this.selectedActivities = [];
    this.sectionConfig = null;
  }

  /**
   * Set section configuration
   */
  setSectionConfig(sectionConfig) {
    this.sectionConfig = sectionConfig;
  }

  /**
   * Initialize placeholder activities with defaults
   */
  initializePlaceholderActivities() {
    if (!this.activityTemplates || this.activityTemplates.length === 0) {
      return [];
    }

    return this.activityTemplates.map((template, index) => ({
      id: template.id || `template-${index}`,
      position: template.position ?? index,
      time: template.time || '18:30',
      duration: template.duration || '00:45',
      activity: template.activity || '',
      type: template.type || 'activity',
      responsable: '',
      materiel: '',
      description: template.description || '',
      isDefault: true,
    }));
  }

  /**
   * Get activity template by ID
   */
  getActivityTemplate(activityId) {
    return this.activityTemplates.find(t => t.id === activityId);
  }

  /**
   * Get activity description
   */
  getActivityDescription(activityName) {
    const template = this.activityTemplates.find(
      t => t.activity === activityName
    );
    return template?.description || '';
  }

  /**
   * Update activity with template data
   */
  updateActivityWithTemplate(activity, templateId) {
    const template = this.getActivityTemplate(templateId);
    if (!template) return activity;

    return {
      ...activity,
      activity: template.activity,
      time: template.time || activity.time,
      duration: template.duration || activity.duration,
      description: template.description || '',
    };
  }

  /**
   * Get responsable options for activity
   */
  getResponsableOptions() {
    return this.animateurs.map(a => ({
      id: a.id,
      name: a.full_name || a.name,
    }));
  }

  /**
   * Validate activity data
   */
  validateActivity(activity) {
    const errors = [];

    if (!activity.time) errors.push('Time is required');
    if (!activity.duration) errors.push('Duration is required');
    if (!activity.activity) errors.push('Activity is required');

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Format activity for display
   */
  formatActivityForDisplay(activity) {
    return {
      ...activity,
      time: activity.time || '18:30',
      duration: activity.duration || '00:45',
      responsable: activity.responsable || 'Non assigné',
    };
  }

  /**
   * Merge activity with defaults
   */
  mergeActivityWithDefaults(activity, defaultActivity = {}) {
    return {
      ...defaultActivity,
      ...activity,
      time: activity.time || defaultActivity.time || '18:30',
      duration: activity.duration || defaultActivity.duration || '00:45',
    };
  }
}

export default ActivityManager;
