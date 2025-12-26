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

// Components
import {
  LoadingSpinner,
  ErrorMessage,
  StatCard,
  QuickActionButton,
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
      console.error('Error loading user group:', error);
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
      console.error('Error loading dashboard data:', err);
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
   * Navigate to take attendance
   */
  const handleTakeAttendance = () => {
    Alert.alert(
      t('Take Attendance'),
      t('dashboard.selectActivity'),
      [{ text: t('OK') }]
    );
    // TODO: Navigate to attendance screen
  };

  /**
   * Navigate to create activity
   */
  const handleCreateActivity = () => {
    Alert.alert(
      t('Create Activity'),
      t('Coming soon'),
      [{ text: t('OK') }]
    );
    // TODO: Navigate to create activity screen
  };

  /**
   * Navigate to carpools
   */
  const handleViewCarpools = () => {
    Alert.alert(
      t('Carpools'),
      t('Coming soon'),
      [{ text: t('OK') }]
    );
    // TODO: Navigate to carpools screen
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
            {t('Welcome, Leader!')}
          </Text>
          {userGroup && (
            <Text style={styles.groupName}>
              {userGroup.name || t('Your Group')}
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

        {/* Quick Actions */}
        <DashboardSection title={t('Quick Actions')}>
          <View style={styles.actionsGrid}>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="✓"
                label={t('Take Attendance')}
                onPress={handleTakeAttendance}
                color="#34C759"
              />
            </View>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="+"
                label={t('Create Activity')}
                onPress={handleCreateActivity}
                color="#007AFF"
              />
            </View>
          </View>

          <View style={styles.actionsGrid}>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="🚗"
                label={t('Carpools')}
                onPress={handleViewCarpools}
                color="#FF9500"
              />
            </View>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="👥"
                label={t('participants')}
                onPress={handleViewParticipants}
                color="#5856D6"
              />
            </View>
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
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  offlineIndicator: {
    backgroundColor: '#FFA500',
    padding: 12,
    alignItems: 'center',
  },
  offlineText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    paddingBottom: 10,
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  groupName: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
  },
  statCol: {
    flex: 1,
  },
  actionsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
  },
  actionCol: {
    flex: 1,
  },
  activityCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  activityName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    marginRight: 12,
  },
  activityDate: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  activityLocation: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  activityParticipants: {
    fontSize: 14,
    color: '#666',
  },
  emptyCard: {
    marginHorizontal: 20,
    padding: 30,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  bottomSpacing: {
    height: 30,
  },
});

export default LeaderDashboardScreen;
