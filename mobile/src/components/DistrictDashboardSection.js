/**
 * DistrictDashboardSection
 *
 * Shared district dashboard content for full-screen and embedded views.
 */

import React, { useEffect, useState } from 'react';
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
import { debugError } from '../utils/DebugUtils';

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
 * @param {Object} props
 * @param {'screen'|'embedded'} [props.variant='embedded'] - Layout context for the section.
 * @returns {JSX.Element}
 */
const DistrictDashboardSection = ({ variant = 'embedded' }) => {
  const navigation = useNavigation();
  const isEmbedded = variant === 'embedded';

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
   * Navigate to reports
   */
  const handleViewReports = () => {
    Alert.alert(
      t('Reports'),
      t('Coming soon'),
      [{ text: t('OK') }]
    );
    // TODO: Navigate to reports screen
  };

  /**
   * Navigate to finance
   */
  const handleViewFinance = () => {
    Alert.alert(
      t('finance'),
      t('Coming soon'),
      [{ text: t('OK') }]
    );
    // TODO: Navigate to finance screen
  };

  /**
   * Navigate to manage groups
   */
  const handleManageGroups = () => {
    Alert.alert(
      t('Manage Groups'),
      t('Coming soon'),
      [{ text: t('OK') }]
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
      t('Activity details coming soon'),
      [{ text: t('OK') }]
    );
    // TODO: Navigate to activity detail
  };

  /**
   * Render loading state
   */
  if (loading) {
    return (
      <View style={isEmbedded ? styles.sectionLoading : styles.centerContainer}>
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
      <View style={isEmbedded ? styles.sectionLoading : styles.centerContainer}>
        <ErrorMessage message={error} />
      </View>
    );
  }

  const content = (
    <>
      {/* Offline indicator */}
      {isOffline && (
        <View style={styles.offlineIndicator}>
          <Text style={styles.offlineText}>
            📡 {t('Offline')} - {t('Viewing cached data')}
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {t('Welcome, Admin!')}
        </Text>
        <Text style={styles.subtitle}>
          {t('District Overview')}
        </Text>
      </View>

      {/* Statistics Cards - District-Wide */}
      <DashboardSection title={t('District Statistics')}>
        <View style={styles.statsGrid}>
          <View style={styles.statCol}>
            <StatCard
              label={t('Total Participants')}
              value={statistics.totalParticipants}
              icon="👥"
              color="#007AFF"
              onPress={handleViewParticipants}
            />
          </View>
          <View style={styles.statCol}>
            <StatCard
              label={t('Total Groups')}
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
              label={t('Upcoming Activities')}
              value={statistics.upcomingActivities}
              icon="📅"
              color="#FF9500"
              onPress={handleViewActivities}
            />
          </View>
          <View style={styles.statCol}>
            <StatCard
              label={t('Active Leaders')}
              value={statistics.activeLeaders}
              icon="🎖️"
              color="#5856D6"
            />
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCol}>
            <StatCard
              label={t('Total Activities')}
              value={statistics.totalActivities}
              icon="📊"
              color="#FF3B30"
              onPress={handleViewActivities}
            />
          </View>
          <View style={styles.statCol}>
            <StatCard
              label={t('Revenue')}
              value={NumberUtils.formatCurrency(statistics.totalRevenue)}
              icon="💰"
              color="#AF52DE"
              onPress={handleViewFinance}
            />
          </View>
        </View>
      </DashboardSection>

      {/* Admin Quick Actions */}
      <DashboardSection title={t('dashboard_admin_section')}>
        <View style={styles.actionsGrid}>
          <View style={styles.actionCol}>
            <QuickActionButton
              icon="📊"
              label={t('Reports')}
              onPress={handleViewReports}
              color="#007AFF"
            />
          </View>
          <View style={styles.actionCol}>
            <QuickActionButton
              icon="💰"
              label={t('finance')}
              onPress={handleViewFinance}
              color="#34C759"
            />
          </View>
        </View>

        <View style={styles.actionsGrid}>
          <View style={styles.actionCol}>
            <QuickActionButton
              icon="⚜️"
              label={t('Manage Groups')}
              onPress={handleManageGroups}
              color="#FF9500"
            />
          </View>
          <View style={styles.actionCol}>
            <QuickActionButton
              icon="⚙️"
              label={t('settings')}
              onPress={handleSettings}
              color="#5856D6"
            />
          </View>
        </View>
      </DashboardSection>

      {/* Groups Overview */}
      <DashboardSection
        title={t('groups')}
        actionLabel={t('View all')}
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
                {t('participants')}
              </Text>
              <Text style={styles.groupDetail}>
                🎖️ {group.leaderCount || 0} {t('Leaders')}
              </Text>
            </Card>
          ))
        ) : (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {t('No groups found')}
            </Text>
          </Card>
        )}
      </DashboardSection>

      {/* Recent Activities */}
      <DashboardSection
        title={t('Recent Activities')}
        actionLabel={t('View all')}
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
              {t('No recent activities')}
            </Text>
          </Card>
        )}
      </DashboardSection>

      {/* Bottom spacing */}
      <View style={styles.bottomSpacing} />
    </>
  );

  if (isEmbedded) {
    return <View style={styles.embeddedContainer}>{content}</View>;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {content}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  embeddedContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    overflow: 'hidden',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  sectionLoading: {
    paddingVertical: 20,
    alignItems: 'center',
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
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: '#007AFF',
    padding: 20,
    paddingTop: 40,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 16,
    color: '#fff',
    opacity: 0.8,
    marginTop: 5,
  },
  statsGrid: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  statCol: {
    flex: 1,
    marginHorizontal: 5,
  },
  actionsGrid: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  actionCol: {
    flex: 1,
    marginHorizontal: 5,
  },
  groupCard: {
    marginBottom: 10,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  groupName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  groupBadge: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  groupBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  groupDetail: {
    color: '#666',
    marginBottom: 2,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    color: '#666',
    fontStyle: 'italic',
  },
  activityCard: {
    marginBottom: 10,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  activityName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  activityDate: {
    fontSize: 12,
    color: '#666',
  },
  activityGroup: {
    color: '#666',
    marginBottom: 2,
  },
  activityLocation: {
    color: '#666',
    marginBottom: 2,
  },
  activityParticipants: {
    color: '#666',
  },
  bottomSpacing: {
    height: 30,
  },
});

export default DistrictDashboardSection;
