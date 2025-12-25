/**
 * DistrictDashboardScreen
 *
 * Dashboard for district administrators
 * Shows district-wide statistics and administrative functions
 *
 * Features:
 * - District-wide statistics
 * - All groups overview
 * - Financial summary
 * - System-wide quick actions
 * - Recent activities across all groups
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
import DateUtils from '../utils/DateUtils';
import NumberUtils from '../utils/NumberUtils';
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
 * DistrictDashboardScreen Component
 */
const DistrictDashboardScreen = () => {
  const navigation = useNavigation();

  // State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // Data state
  const [statistics, setStatistics] = useState({
    totalParticipants: 0,
    totalGroups: 0,
    totalActivities: 0,
    upcomingActivities: 0,
    totalRevenue: 0,
    activeLeaders: 0,
  });

  const [groups, setGroups] = useState([]);
  const [recentActivities, setRecentActivities] = useState([]);

  /**
   * Initialize screen
   */
  useEffect(() => {
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
      loadDashboardData();
    }, [])
  );

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

        // Sort by date and take most recent
        const recent = activities
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .slice(0, 5);

        setRecentActivities(recent);

        // Update statistics
        setStatistics((prev) => ({
          ...prev,
          totalActivities: activities.length,
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
        const groupsData = Array.isArray(groupsRes.data) ? groupsRes.data : [];

        setGroups(groupsData.slice(0, 5)); // Show top 5

        setStatistics((prev) => ({
          ...prev,
          totalGroups: groupsData.length,
          activeLeaders: groupsData.reduce(
            (sum, group) => sum + (group.leaderCount || 0),
            0
          ),
        }));
      }

      // Check if data is from cache
      if (activitiesRes.fromCache || participantsRes.fromCache) {
        setIsOffline(true);
      }
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError(t('dashboard.errorLoading'));
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
   * Navigate to reports
   */
  const handleViewReports = () => {
    Alert.alert(
      t('dashboard.reports'),
      t('common.comingSoon'),
      [{ text: t('common.ok') }]
    );
    // TODO: Navigate to reports screen
  };

  /**
   * Navigate to finance
   */
  const handleViewFinance = () => {
    Alert.alert(
      t('dashboard.finance'),
      t('common.comingSoon'),
      [{ text: t('common.ok') }]
    );
    // TODO: Navigate to finance screen
  };

  /**
   * Navigate to manage groups
   */
  const handleManageGroups = () => {
    Alert.alert(
      t('dashboard.manageGroups'),
      t('common.comingSoon'),
      [{ text: t('common.ok') }]
    );
    // TODO: Navigate to groups screen
  };

  /**
   * Navigate to settings
   */
  const handleSettings = () => {
    navigation.navigate('Settings');
  };

  /**
   * Navigate to all participants
   */
  const handleViewParticipants = () => {
    navigation.navigate('Participants');
  };

  /**
   * Navigate to all activities
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
      t('dashboard.activityDetailComingSoon'),
      [{ text: t('common.ok') }]
    );
    // TODO: Navigate to activity detail
  };

  /**
   * Render loading state
   */
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <LoadingSpinner />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
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
            📡 {t('common.offline')} - {t('common.viewingCachedData')}
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
            {t('dashboard.welcomeAdmin')}
          </Text>
          <Text style={styles.subtitle}>
            {t('dashboard.districtOverview')}
          </Text>
        </View>

        {/* Statistics Cards - District-Wide */}
        <DashboardSection title={t('dashboard.districtStatistics')}>
          <View style={styles.statsGrid}>
            <View style={styles.statCol}>
              <StatCard
                label={t('dashboard.totalParticipants')}
                value={statistics.totalParticipants}
                icon="👥"
                color="#007AFF"
                onPress={handleViewParticipants}
              />
            </View>
            <View style={styles.statCol}>
              <StatCard
                label={t('dashboard.totalGroups')}
                value={statistics.totalGroups}
                icon="⚜️"
                color="#34C759"
                onPress={handleManageGroups}
              />
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statCol}>
              <StatCard
                label={t('dashboard.upcomingActivities')}
                value={statistics.upcomingActivities}
                icon="📅"
                color="#FF9500"
                onPress={handleViewActivities}
              />
            </View>
            <View style={styles.statCol}>
              <StatCard
                label={t('dashboard.activeLeaders')}
                value={statistics.activeLeaders}
                icon="🎖️"
                color="#5856D6"
              />
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statCol}>
              <StatCard
                label={t('dashboard.totalActivities')}
                value={statistics.totalActivities}
                icon="📊"
                color="#FF3B30"
                onPress={handleViewActivities}
              />
            </View>
            <View style={styles.statCol}>
              <StatCard
                label={t('dashboard.revenue')}
                value={NumberUtils.formatCurrency(statistics.totalRevenue)}
                icon="💰"
                color="#AF52DE"
                onPress={handleViewFinance}
              />
            </View>
          </View>
        </DashboardSection>

        {/* Admin Quick Actions */}
        <DashboardSection title={t('dashboard.adminActions')}>
          <View style={styles.actionsGrid}>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="📊"
                label={t('dashboard.reports')}
                onPress={handleViewReports}
                color="#007AFF"
              />
            </View>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="💰"
                label={t('dashboard.finance')}
                onPress={handleViewFinance}
                color="#34C759"
              />
            </View>
          </View>

          <View style={styles.actionsGrid}>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="⚜️"
                label={t('dashboard.manageGroups')}
                onPress={handleManageGroups}
                color="#FF9500"
              />
            </View>
            <View style={styles.actionCol}>
              <QuickActionButton
                icon="⚙️"
                label={t('dashboard.settings')}
                onPress={handleSettings}
                color="#5856D6"
              />
            </View>
          </View>
        </DashboardSection>

        {/* Groups Overview */}
        <DashboardSection
          title={t('dashboard.groups')}
          actionLabel={t('common.viewAll')}
          onActionPress={handleManageGroups}
        >
          {groups.length > 0 ? (
            groups.map((group) => (
              <Card key={group.id} style={styles.groupCard}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <View style={styles.groupBadge}>
                    <Text style={styles.groupBadgeText}>
                      {group.participantCount || 0}
                    </Text>
                  </View>
                </View>
                <Text style={styles.groupDetail}>
                  👥 {group.participantCount || 0}{' '}
                  {t('dashboard.participants')}
                </Text>
                <Text style={styles.groupDetail}>
                  🎖️ {group.leaderCount || 0} {t('dashboard.leaders')}
                </Text>
              </Card>
            ))
          ) : (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {t('dashboard.noGroupsFound')}
              </Text>
            </Card>
          )}
        </DashboardSection>

        {/* Recent Activities */}
        <DashboardSection
          title={t('dashboard.recentActivities')}
          actionLabel={t('common.viewAll')}
          onActionPress={handleViewActivities}
        >
          {recentActivities.length > 0 ? (
            recentActivities.map((activity) => (
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
                {activity.groupName && (
                  <Text style={styles.activityGroup}>
                    ⚜️ {activity.groupName}
                  </Text>
                )}
                <Text style={styles.activityLocation}>
                  📍 {activity.location || t('common.noLocation')}
                </Text>
                <Text style={styles.activityParticipants}>
                  👥 {activity.participantCount || 0}{' '}
                  {t('dashboard.registered')}
                </Text>
              </Card>
            ))
          ) : (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {t('dashboard.noRecentActivities')}
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
  subtitle: {
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
  groupCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  groupName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  groupBadge: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  groupBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  groupDetail: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
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
  activityGroup: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
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

export default DistrictDashboardScreen;
