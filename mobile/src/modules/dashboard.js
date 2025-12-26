/**
 * Dashboard Module
 *
 * Unified dashboard functionality for the mobile app
 * Mirrors spa/dashboard.js structure and functionality
 *
 * Provides:
 * - Dashboard data loading and caching
 * - Organization information management
 * - Statistics calculation
 * - Prefetching for critical pages
 * - News feed management
 * - Common dashboard utilities
 */

import {
  getParticipants,
  getGroups,
  getNews,
  getActivities,
} from '../api/api-endpoints';
import CacheManager from '../utils/CacheManager';
import DateUtils from '../utils/DateUtils';
import StorageUtils from '../utils/StorageUtils';
import CONFIG from '../config';

/**
 * Dashboard data manager class
 * Handles loading, caching, and managing dashboard data
 */
export class DashboardManager {
  constructor() {
    this.groups = [];
    this.participants = [];
    this.newsItems = [];
    this.activities = [];
    this.statistics = {
      totalParticipants: 0,
      upcomingActivities: 0,
      activeGroups: 0,
      totalActivities: 0,
      totalPoints: 0,
    };
    this.organizationName = '';
    this.organizationLogo = '';
    this.isLoading = true;
    this.newsLoading = true;
    this.newsError = null;
  }

  /**
   * Initialize dashboard data
   * Loads organization info and preloads dashboard data
   */
  async init() {
    try {
      this.isLoading = true;
      await this.fetchOrganizationInfo();
      await this.preloadDashboardData();
      this.isLoading = false;

      // Prefetch critical pages data in background
      this.prefetchCriticalPages();

      // Load news feed
      this.loadNews();

      return { success: true };
    } catch (error) {
      console.error('Error initializing dashboard:', error);
      this.isLoading = false;
      return { success: false, error };
    }
  }

  /**
   * Fetch organization information from settings
   */
  async fetchOrganizationInfo() {
    try {
      const settings = await StorageUtils.getItem('organizationSettings');
      const org = settings?.organization_info;

      if (org?.name) {
        this.organizationName = org.name;
        this.organizationLogo = org.logo;
      } else {
        this.organizationName = 'Scouts';
      }
    } catch (error) {
      console.error('Error fetching organization info:', error);
      this.organizationName = 'Scouts';
    }
  }

  /**
   * Preload dashboard data with caching strategy
   * Similar to spa/dashboard.js preloadDashboardData
   */
  async preloadDashboardData() {
    try {
      // Try to load from cache first
      const [cachedGroups, cachedParticipants] = await Promise.all([
        CacheManager.get('dashboard_groups'),
        CacheManager.get('dashboard_participant_info'),
      ]);

      const shouldCacheParticipants = !cachedParticipants;
      const needsFreshGroups = !cachedGroups;

      // Use cached data if available
      if (cachedParticipants) {
        this.participants = this.normalizeParticipantList(cachedParticipants);
      }

      if (cachedGroups) {
        this.groups = cachedGroups;
      }

      // Fetch fresh data
      const [participantsResponse, groupsResponse, activitiesResponse] =
        await Promise.all([
          getParticipants().catch((err) => {
            console.error('Error loading participants:', err);
            return { success: false, data: [] };
          }),
          getGroups().catch((err) => {
            console.error('Error loading groups:', err);
            return { success: false, data: [] };
          }),
          getActivities().catch((err) => {
            console.error('Error loading activities:', err);
            return { success: false, data: [] };
          }),
        ]);

      // Process participants
      if (participantsResponse.success) {
        const freshParticipants =
          participantsResponse.data || participantsResponse.participants || [];

        if (freshParticipants.length) {
          this.participants = this.normalizeParticipantList(freshParticipants);
        }

        // Cache participants
        if (shouldCacheParticipants && this.participants.length) {
          const minimalCache = this.participants.map((p) => ({
            id: p.id,
            first_name: p.first_name,
            last_name: p.last_name,
            group_id: p.group_id,
            group_name: p.group_name,
            first_leader: p.first_leader,
            second_leader: p.second_leader,
            total_points: p.total_points,
          }));
          await CacheManager.set(
            'dashboard_participant_info',
            minimalCache,
            CONFIG.CACHE_DURATION?.SHORT || 5 * 60 * 1000
          );
        }
      }

      // Process groups
      if (groupsResponse.success) {
        const groups = groupsResponse.data || groupsResponse.groups || [];
        if (groups.length) {
          this.groups = groups.sort((a, b) => a.name.localeCompare(b.name));

          // Cache groups
          if (needsFreshGroups) {
            await CacheManager.set(
              'dashboard_groups',
              this.groups,
              60 * 60 * 1000
            );
          }
        }
      }

      // Process activities
      if (activitiesResponse.success) {
        const activities = activitiesResponse.data || [];
        this.activities = Array.isArray(activities) ? activities : [];
      }

      // Calculate statistics
      this.calculateStatistics();
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      throw error;
    }
  }

  /**
   * Normalize participant list to ensure consistent data structure
   * Handles role fields (first_leader, second_leader)
   */
  normalizeParticipantList(participants) {
    return participants.map((p) => ({
      ...p,
      first_leader: p.first_leader ?? p.is_leader ?? false,
      second_leader: p.second_leader ?? p.is_second_leader ?? false,
      total_points: parseInt(p.total_points) || 0,
    }));
  }

  /**
   * Calculate dashboard statistics
   */
  calculateStatistics() {
    // Total participants
    this.statistics.totalParticipants = this.participants.length;

    // Active groups
    this.statistics.activeGroups = this.groups.length;

    // Total activities
    this.statistics.totalActivities = this.activities.length;

    // Upcoming activities
    const now = new Date();
    this.statistics.upcomingActivities = this.activities.filter((activity) =>
      DateUtils.isFuture(activity.activity_date || activity.date)
    ).length;

    // Total points
    this.statistics.totalPoints = this.participants.reduce(
      (sum, p) => sum + (parseInt(p.total_points) || 0),
      0
    );
  }

  /**
   * Prefetch critical data for most time-sensitive pages
   * Runs in background after dashboard is ready
   */
  async prefetchCriticalPages() {
    try {
      // This runs in background, errors are non-blocking
      console.log('Prefetching critical pages data...');

      // Add any critical page prefetching here
      // For mobile, we might prefetch:
      // - Today's attendance data
      // - Recent activities
      // - etc.

      console.log('Critical pages prefetch completed');
    } catch (error) {
      // Non-blocking: errors shouldn't affect dashboard
      console.log('Critical pages prefetch error (non-blocking):', error);
    }
  }

  /**
   * Load news feed
   * @param {boolean} force - Force refresh from server
   */
  async loadNews(force = false) {
    // Try cache first if not forcing
    if (!force) {
      const cached = await CacheManager.get('dashboard_news');
      if (cached?.length) {
        this.newsItems = cached;
        this.newsLoading = false;
        return;
      }
    }

    this.newsLoading = true;
    this.newsError = null;

    try {
      const res = await getNews();
      this.newsItems = this.normalizeNewsItems(res);
      this.newsLoading = false;

      // Cache news
      await CacheManager.set(
        'dashboard_news',
        this.newsItems,
        CONFIG.CACHE_DURATION?.SHORT || 5 * 60 * 1000
      );
    } catch (error) {
      console.error('Error loading news:', error);
      this.newsLoading = false;
      this.newsError = 'Failed to load news';
    }
  }

  /**
   * Normalize news items response
   */
  normalizeNewsItems(response) {
    const list = Array.isArray(response?.news)
      ? response.news
      : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
          ? response
          : [];

    return list.slice(0, 5).map((item, index) => ({
      id: item.id || `news-${index}`,
      title: item.title || item.heading || 'Untitled',
      summary: item.summary || item.description || item.content || '',
      link: item.link || item.url || null,
      date: item.published_at || item.date || item.created_at || '',
    }));
  }

  /**
   * Get participants for a specific group
   * @param {number} groupId - Group ID
   * @returns {Array} Participants in the group
   */
  getParticipantsByGroup(groupId) {
    return this.participants.filter((p) => p.group_id === groupId);
  }

  /**
   * Get group by ID
   * @param {number} groupId - Group ID
   * @returns {Object|null} Group object
   */
  getGroupById(groupId) {
    return this.groups.find((g) => g.id === groupId) || null;
  }

  /**
   * Get participant by ID
   * @param {number} participantId - Participant ID
   * @returns {Object|null} Participant object
   */
  getParticipantById(participantId) {
    return this.participants.find((p) => p.id === participantId) || null;
  }

  /**
   * Refresh all dashboard data
   */
  async refresh() {
    this.isLoading = true;
    await this.preloadDashboardData();
    await this.loadNews(true);
    this.isLoading = false;
  }

  /**
   * Get upcoming activities
   * @param {number} limit - Maximum number of activities to return
   * @returns {Array} Upcoming activities
   */
  getUpcomingActivities(limit = 5) {
    const now = new Date();
    return this.activities
      .filter((activity) =>
        DateUtils.isFuture(activity.activity_date || activity.date)
      )
      .sort(
        (a, b) =>
          new Date(a.activity_date || a.date) -
          new Date(b.activity_date || b.date)
      )
      .slice(0, limit);
  }

  /**
   * Get recent activities
   * @param {number} limit - Maximum number of activities to return
   * @returns {Array} Recent activities
   */
  getRecentActivities(limit = 5) {
    return this.activities
      .sort(
        (a, b) =>
          new Date(b.activity_date || b.date) -
          new Date(a.activity_date || a.date)
      )
      .slice(0, limit);
  }

  /**
   * Get group points summary
   * @returns {Array} Groups with total points
   */
  getGroupPointsSummary() {
    return this.groups.map((group) => {
      const participants = this.getParticipantsByGroup(group.id);
      const totalPoints = participants.reduce(
        (sum, p) => sum + (parseInt(p.total_points) || 0),
        0
      );

      return {
        ...group,
        participantCount: participants.length,
        totalPoints,
      };
    });
  }
}

/**
 * Singleton instance of DashboardManager
 */
let dashboardInstance = null;

/**
 * Get or create dashboard manager instance
 * @returns {DashboardManager}
 */
export const getDashboardManager = () => {
  if (!dashboardInstance) {
    dashboardInstance = new DashboardManager();
  }
  return dashboardInstance;
};

/**
 * Reset dashboard manager instance
 * Useful for testing or force refresh
 */
export const resetDashboardManager = () => {
  dashboardInstance = null;
};

/**
 * Helper function to format date for display
 * @param {string} date - ISO date string
 * @param {string} locale - Locale code (en, fr)
 * @returns {string} Formatted date
 */
export const formatNewsDate = (date, locale = 'en') => {
  if (!date) return '';
  const dateObj = new Date(date);
  if (isNaN(dateObj)) return '';

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(dateObj);
};

/**
 * Helper function to format currency
 * @param {number} amount - Amount to format
 * @param {string} locale - Locale code (en, fr)
 * @returns {string} Formatted currency
 */
export const formatCurrency = (amount, locale = 'en') => {
  const value = Number(amount) || 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * Calculate current fiscal year (Sept 1 - Aug 31)
 * @returns {Object} Fiscal year info
 */
export const getCurrentFiscalYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  if (month >= 8) {
    // September or later (month 8 = September)
    return {
      start: `${year}-09-01`,
      end: `${year + 1}-08-31`,
      label: `${year}-${year + 1}`,
    };
  } else {
    return {
      start: `${year - 1}-09-01`,
      end: `${year}-08-31`,
      label: `${year - 1}-${year}`,
    };
  }
};

export default {
  DashboardManager,
  getDashboardManager,
  resetDashboardManager,
  formatNewsDate,
  formatCurrency,
  getCurrentFiscalYear,
};
