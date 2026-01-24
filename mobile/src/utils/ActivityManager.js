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
    this.meetingLengthMinutes = 120; // Default: 2 hours
    this.durationOverride = null; // Optional override for special meetings
  }

  /**
   * Set section configuration
   */
  setSectionConfig(sectionConfig) {
    this.sectionConfig = sectionConfig;
  }

  /**
   * Set meeting length and optional duration override
   */
  setMeetingLength(lengthMinutes, durationOverride = null) {
    this.meetingLengthMinutes = lengthMinutes || 120;
    this.durationOverride = durationOverride;
  }

  /**
   * Calculate actual meeting duration based on activities
   */
  calculateMeetingDuration(activities) {
    if (!Array.isArray(activities) || activities.length === 0) {
      return 0;
    }

    const times = activities
      .filter(a => a.time && a.duration)
      .map(a => {
        const [hours, minutes] = (a.time || '').split(':').map(Number);
        const [durHours, durMinutes] = (a.duration || '00:00').split(':').map(Number);
        const startMinutes = (hours || 0) * 60 + (minutes || 0);
        const duration = (durHours || 0) * 60 + (durMinutes || 0);
        return { start: startMinutes, duration };
      });

    if (times.length === 0) {
      return 0;
    }

    const firstStart = Math.min(...times.map(t => t.start));
    const lastEnd = Math.max(...times.map(t => t.start + t.duration));
    return Math.max(0, lastEnd - firstStart);
  }

  /**
   * Initialize placeholder activities with defaults
   */
  initializePlaceholderActivities(existingActivities = null) {
    // Determine the planned duration (use override if special meeting, otherwise use default)
    const plannedDuration = this.durationOverride || this.meetingLengthMinutes;
    
    // Calculate actual duration if we have existing activities
    let actualDuration = 0;
    if (existingActivities && Array.isArray(existingActivities) && existingActivities.length > 0) {
      actualDuration = this.calculateMeetingDuration(existingActivities);
    }

    // Only add template placeholders if actual duration < planned duration
    if (actualDuration >= plannedDuration) {
      return existingActivities || [];
    }

    // Create templates
    if (!this.activityTemplates || this.activityTemplates.length === 0) {
      return existingActivities || [];
    }

    const templates = this.activityTemplates.map((template, index) => ({
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

    // If there are existing activities, merge them
    if (existingActivities && Array.isArray(existingActivities) && existingActivities.length > 0) {
      const nonDefaultActivities = existingActivities.filter(a => !a.isDefault);
      return [...nonDefaultActivities, ...templates];
    }

    return templates;
  }
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
