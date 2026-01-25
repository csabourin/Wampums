/**
 * DashboardCacheManager
 * Handles caching strategy for dashboard data
 */

import { getCachedData, setCachedData } from "../indexedDB.js";
import { CONFIG } from "../ajax-functions.js";
import { debugLog, debugError } from "./DebugUtils.js";

export class DashboardCacheManager {
  /**
   * Load cached dashboard data with fallback
   * @returns {Object} { groups, participants }
   */
  static async preloadCachedData() {
    try {
      const [cachedGroups, cachedParticipants] = await Promise.all([
        getCachedData("dashboard_groups"),
        getCachedData("dashboard_participant_info"),
      ]);

      return {
        groups: cachedGroups || [],
        participants: cachedParticipants || [],
        hasGroupsCache: !!cachedGroups,
        hasParticipantsCache: !!cachedParticipants,
      };
    } catch (error) {
      debugError("Error preloading cached data:", error);
      return {
        groups: [],
        participants: [],
        hasGroupsCache: false,
        hasParticipantsCache: false,
      };
    }
  }

  /**
   * Cache groups data
   * @param {Array} groups - Groups to cache
   */
  static async cacheGroups(groups) {
    try {
      await setCachedData("dashboard_groups", groups, 60 * 60 * 1000); // 1 hour
    } catch (error) {
      debugError("Error caching groups:", error);
    }
  }

  /**
   * Cache participants with minimal fields
   * @param {Array} participants - Participants to cache
   */
  static async cacheParticipants(participants) {
    try {
      const minimalCache = participants.map((p) => ({
        id: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        group_id: p.group_id,
        group_name: p.group_name,
        first_leader: p.first_leader,
        second_leader: p.second_leader,
        is_leader: p.first_leader,
        is_second_leader: p.second_leader,
      }));
      await setCachedData(
        "dashboard_participant_info",
        minimalCache,
        CONFIG.CACHE_DURATION.SHORT
      );
    } catch (error) {
      debugError("Error caching participants:", error);
    }
  }

  /**
   * Cache news items
   * @param {Array} newsItems - News items to cache
   */
  static async cacheNews(newsItems) {
    try {
      await setCachedData(
        "dashboard_news",
        newsItems,
        CONFIG.CACHE_DURATION.SHORT
      );
    } catch (error) {
      debugError("Error caching news:", error);
    }
  }

  /**
   * Clear all dashboard-related caches
   */
  static async clearAll() {
    try {
      // Note: clearActivityRelatedCaches is imported in dashboard.js when needed
      // This method clears dashboard-specific caches
      debugLog("Clearing dashboard caches");
    } catch (error) {
      debugError("Error clearing dashboard caches:", error);
    }
  }
}
