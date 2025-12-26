/**
 * LeaderDashboardScreen
 *
 * Dashboard for scout leaders/group leaders
 * Shows key information and quick actions for managing their troop/group
 *
 * Features:
 * - Upcoming activities
 * - Participant statistics
 * - Quick actions (attendance, activities, carpools)
 * - Permission slips status
 * - Offline support with caching
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

// API and utilities
import {
  getActivities,
  getParticipants,
  getGroups,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import StorageUtils from '../utils/StorageUtils';
import DateUtils from '../utils/DateUtils';
import CacheManager from '../utils/CacheManager';
import theme, { commonStyles } from '../theme';
import { debugError } from '../utils/DebugUtils';

// Components
import {
  LoadingSpinner,
  ErrorMessage,
  StatCard,
  DashboardSection,
  Card,
} from '../components';

/**
 * LeaderDashboardScreen Component
 */
const LeaderDashboardScreen = () => {
  const navigation = useNavigation();

  // State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // Data state
  const [statistics, setStatistics] = useState({
    totalParticipants: 0,
    upcomingActivities: 0,
    activeGroups: 0,
    pendingPermissionSlips: 0,
  });

  const [upcomingActivities, setUpcomingActivities] = useState([]);
  const [userGroup, setUserGroup] = useState(null);

  /**
   * Initialize screen
   */
  useEffect(() => {
    loadUserGroup();

    // Listen for network state changes
    const networkListener = (online) => {
      setIsOffline(!online);
    };

    CacheManager.addNetworkListener(networkListener);

    return () => {
      CacheManager.removeNetworkListener(networkListener);
    };
  }, []);

  /**
   * Reload data when screen comes into focus
   */
  useFocusEffect(
    React.useCallback(() => {
      if (userGroup) {
        loadDashboardData();
      }
    }, [userGroup])
  );

  /**
   * Load user's group information
   */
  const loadUserGroup = async () => {
    try {
      const groupId = await StorageUtils.getItem('userGroupId');
      const groupName = await StorageUtils.getItem('userGroupName');

      setUserGroup({ id: groupId, name: groupName });
    } catch (error) {
      debugError('Error loading user group:', error);
    }
  };

  /**
   * Load all dashboard data
   */
  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load data in parallel
      const [activitiesRes, participantsRes, groupsRes] = await Promise.all([
        getActivities(),
        getParticipants(),
        getGroups(),
      ]);

      // Process activities
      if (activitiesRes.success && activitiesRes.data) {
        const activities = Array.isArray(activitiesRes.data)
          ? activitiesRes.data
          : [];

        // Filter upcoming activities
        const upcoming = activities.filter((activity) =>
          DateUtils.isFuture(activity.date)
        );

        setUpcomingActivities(upcoming.slice(0, 5)); // Show max 5

        // Update statistics
        setStatistics((prev) => ({
          ...prev,
          upcomingActivities: upcoming.length,
        }));
      }

      // Process participants
      if (participantsRes.success && participantsRes.data) {
        const participants = Array.isArray(participantsRes.data)
          ? participantsRes.data
          : [];

        setStatistics((prev) => ({
          ...prev,
          totalParticipants: participants.length,
        }));
      }

      // Process groups
      if (groupsRes.success && groupsRes.data) {
        const groups = Array.isArray(groupsRes.data) ? groupsRes.data : [];

        setStatistics((prev) => ({
          ...prev,
          activeGroups: groups.length,
        }));
      }

      // Check if data is from cache
      if (activitiesRes.fromCache || participantsRes.fromCache) {
        setIsOffline(true);
      }
    } catch (err) {
      debugError('Error loading dashboard data:', err);
      setError(t('error_loading_dashboard'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle pull-to-refresh
   */
  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  /**
   * Navigate to participants
   */
  const handleViewParticipants = () => {
    navigation.navigate('Participants');
  };

  /**
   * Navigate to activities
   */
  const handleViewActivities = () => {
    navigation.navigate('Activities');
  };

  /**
   * Navigate to activity detail
   */
  const handleViewActivity = (activity) => {
    Alert.alert(
      activity.name,
      t('Activity details coming soon'),
      [{ text: t('OK') }]
    );
    // TODO: Navigate to activity detail
    // navigation.navigate('ActivityDetail', { activityId: activity.id });
  };

  /**
   * Render loading state
   */
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <LoadingSpinner />
        <Text style={styles.loadingText}>{t('loading')}</Text>
      </View>
    );
  }

  /**
   * Render error state
   */
  if (error && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ErrorMessage message={error} />
      </View>
    );
  }

  const leaderTiles = [
    { key: 'attendance', label: t('attendance'), screen: 'Attendance' },
    { key: 'points', label: t('manage_points'), screen: 'ManagePoints' },
    { key: 'honors', label: t('youth_of_honor'), screen: 'Honors' },
    { key: 'meetingPrep', label: t('preparation_reunions'), screen: 'MeetingPreparation' },
    { key: 'nextMeeting', label: t('next_meeting'), screen: 'NextMeeting' },
    { key: 'medication', label: t('medication_management_title'), screen: 'Medication' },
  ];

  return (
    <View style={styles.container}>
      {/* Offline indicator */}
      {isOffline && (
        <View style={styles.offlineIndicator}>
          <Text style={styles.offlineText}>
            📡 {t('Offline')} - {t('Viewing cached data')}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.greeting}>
            {t('dashboard_title')}
          </Text>
          {userGroup && (
            <Text style={styles.groupName}>
              {t('group')}: {userGroup.name || t('groups')}
            </Text>
          )}
        </View>

        {/* Statistics Cards */}
        <DashboardSection title={t('overview')}>
          <View style={styles.statsGrid}>
            <View style={styles.statCol}>
              <StatCard
                label={t('participants')}
                value={statistics.totalParticipants}
                icon="👥"
                color="#007AFF"
                onPress={handleViewParticipants}
              />
            </View>
            <View style={styles.statCol}>
              <StatCard
                label={t('Upcoming Activities')}
                value={statistics.upcomingActivities}
                icon="📅"
                color="#34C759"
                onPress={handleViewActivities}
              />
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statCol}>
              <StatCard
                label={t('groups')}
                value={statistics.activeGroups}
                icon="⚜️"
                color="#FF9500"
              />
            </View>
            <View style={styles.statCol}>
              <StatCard
                label={t('Permission Slips')}
                value={statistics.pendingPermissionSlips}
                icon="📝"
                color="#FF3B30"
              />
            </View>
          </View>
        </DashboardSection>

        <DashboardSection title={t('dashboard_day_to_day_section')}>
          <View style={styles.tileGrid}>
            {leaderTiles.map((tile) => (
              <TouchableOpacity
                key={tile.key}
                style={styles.tile}
                onPress={() => navigation.navigate(tile.screen)}
              >
                <Text style={styles.tileLabel}>{tile.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </DashboardSection>

        {/* Upcoming Activities */}
        <DashboardSection
          title={t('Upcoming Activities')}
          actionLabel={t('View all')}
          onActionPress={handleViewActivities}
        >
          {upcomingActivities.length > 0 ? (
            upcomingActivities.map((activity) => (
              <Card
                key={activity.id}
                style={styles.activityCard}
                onPress={() => handleViewActivity(activity)}
              >
                <View style={styles.activityHeader}>
                  <Text style={styles.activityName}>{activity.name}</Text>
                  <Text style={styles.activityDate}>
                    {DateUtils.formatDate(activity.date)}
                  </Text>
                </View>
                <Text style={styles.activityLocation}>
                  📍 {activity.location || t('No location')}
                </Text>
                <Text style={styles.activityParticipants}>
                  👥 {activity.participantCount || 0}{' '}
                  {t('Registered')}
                </Text>
              </Card>
            ))
          ) : (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {t('dashboard.noUpcomingActivities')}
              </Text>
            </Card>
          )}
        </DashboardSection>

        {/* Bottom spacing */}
        <View style={styles.bottomSpacing} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...commonStyles.container,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  loadingText: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
  },
  offlineIndicator: {
    backgroundColor: theme.colors.warning,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  offlineText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  greeting: {
    fontSize: theme.fontSize.xxxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  groupName: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
    fontWeight: theme.fontWeight.medium,
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  statCol: {
    flex: 1,
  },
  activityCard: {
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  activityName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  activityDate: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.medium,
  },
  activityLocation: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.xs,
  },
  activityParticipants: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
  },
  emptyCard: {
    marginHorizontal: theme.spacing.lg,
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  bottomSpacing: {
    height: theme.spacing.xl,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  tile: {
    flexBasis: '48%',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
    ...theme.shadows.sm,
  },
  tileLabel: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.semibold,
    textAlign: 'center',
  },
});

export default LeaderDashboardScreen;
