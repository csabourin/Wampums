/**
 * Activities Screen
 *
 * Mirrors spa/activities.js functionality
 * Shows list of activities with calendar view
 * For admin and leader users
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Text,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getActivities } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import {
  ListItem,
  LoadingState,
  ErrorState,
  EmptyState,
  NoData,
  Toast,
  useToast,
} from '../components';
import { hasPermission } from '../utils/PermissionUtils';
import StorageUtils from '../utils/StorageUtils';
import theme from '../theme';
import CONFIG from '../config';

const ActivitiesScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [activities, setActivities] = useState([]);
  const [activeFilter, setActiveFilter] = useState('upcoming');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('asc');
  const [userPermissions, setUserPermissions] = useState([]);
  
  const toast = useToast();

  // Configure header
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('activities_calendar') || 'Activities',
      headerRight: () =>
        canManage ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('ActivityDetail', { id: 'new' })}
            style={{ paddingRight: 16 }}
          >
            <Text style={{ fontSize: 28, color: theme.colors.primary }}>+</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation]);

  useEffect(() => {
    loadUserPermissions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadActivities();
    }, [])
  );

  const loadUserPermissions = async () => {
    try {
      const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);
      setUserPermissions(permissions || []);
    } catch (err) {
      console.error('Error loading permissions:', err);
    }
  };

  const loadActivities = async () => {
    try {
      setError(null);
      const response = await getActivities();
      if (response.success) {
        setActivities(response.data || []);
      } else {
        setError(response.message || t('error_loading_data'));
      }
    } catch (err) {
      console.error('Error loading activities:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadActivities();
    setRefreshing(false);
  };

  // Derived state: filtered and sorted activities
  const filteredActivities = React.useMemo(() => {
    let filtered = [...activities];
    const now = new Date();

    // Apply time filter
    if (activeFilter === 'upcoming') {
      filtered = filtered.filter((activity) => new Date(activity.date) >= now);
    } else if (activeFilter === 'past') {
      filtered = filtered.filter((activity) => new Date(activity.date) < now);
    }
    // 'all' shows everything

    // Apply sort
    filtered.sort((a, b) => {
      const aDate = new Date(a.date);
      const bDate = new Date(b.date);

      if (sortBy === 'date') {
        return sortOrder === 'asc' ? aDate - bDate : bDate - aDate;
      } else if (sortBy === 'name') {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        if (sortOrder === 'asc') {
          return aName.localeCompare(bName);
        } else {
          return bName.localeCompare(aName);
        }
      }
      return 0;
    });

    return filtered;
  }, [activities, activeFilter, sortBy, sortOrder]);

  const canManage = hasPermission(userPermissions, 'activities', 'create');

  // Filter options
  const filterOptions = [
    {
      value: 'upcoming',
      label: t('upcoming') || 'Upcoming',
      count: activities.filter((a) => new Date(a.date) >= new Date()).length,
    },
    {
      value: 'past',
      label: t('past') || 'Past',
      count: activities.filter((a) => new Date(a.date) < new Date()).length,
    },
    {
      value: 'all',
      label: t('all') || 'All',
      count: activities.length,
    },
  ];

  // Sort options
  const sortOptions = [
    { value: 'date-asc', label: t('date_oldest_first') || 'Date (Oldest First)' },
    { value: 'date-desc', label: t('date_newest_first') || 'Date (Newest First)' },
    { value: 'name-asc', label: t('name_a_z') || 'Name (A-Z)' },
    { value: 'name-desc', label: t('name_z_a') || 'Name (Z-A)' },
  ];

  const handleSortChange = (value) => {
    const [field, order] = value.split('-');
    setSortBy(field);
    setSortOrder(order);
  };

  const handleActivityPress = (activity) => {
    navigation.navigate('ActivityDetail', { id: activity.id });
  };

  const getActivityStatus = (activity) => {
    const activityDate = new Date(activity.date);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const activityDay = new Date(
      activityDate.getFullYear(),
      activityDate.getMonth(),
      activityDate.getDate()
    );

    if (activityDay.getTime() === today.getTime()) {
      return { text: t('today') || 'Today', color: theme.colors.success };
    }
    if (activityDate >= now) {
      return { text: t('upcoming') || 'Upcoming', color: theme.colors.primary };
    }
    return { text: t('past') || 'Past', color: theme.colors.text.secondary };
  };

  // Render methods
  if (loading) {
    return <LoadingState message={t('loading_activities') || 'Loading activities...'} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadActivities} />;
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        icon="📅"
        title={t('no_activities') || 'No Activities Yet'}
        message={
          canManage
            ? t('no_activities_create') || 'Create your first activity to get started'
            : t('no_activities_check_back') || 'Check back later for upcoming activities'
        }
        actionLabel={canManage ? t('create_activity') || 'Create Activity' : undefined}
        onAction={canManage ? () => navigation.navigate('ActivityDetail', { id: 'new' }) : undefined}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.listContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {filteredActivities.length === 0 ? (
          <NoData
            icon="🔍"
            message={
              activeFilter === 'upcoming'
                ? t('no_upcoming_activities') || 'No upcoming activities'
                : activeFilter === 'past'
                ? t('no_past_activities') || 'No past activities'
                : t('no_activities_filter') || 'No activities match your filters'
            }
          />
        ) : (
          filteredActivities.map((activity) => {
            const status = getActivityStatus(activity);
            const activityDate = DateUtils.formatDate(activity.date);
            const activityTime = activity.time
              ? DateUtils.formatTime(activity.time)
              : null;

            return (
              <ListItem
                key={activity.id}
                title={activity.name}
                subtitle={
                  `📅 ${activityDate}${activityTime ? ` ${activityTime}` : ''}` +
                  (activity.location ? `\n📍 ${activity.location}` : '') +
                  (activity.participant_count
                    ? `\n👥 ${activity.participant_count} ${t('participants') || 'participants'}`
                    : '')
                }
                badge={
                  status
                    ? {
                        text: status.text,
                        color: status.color,
                      }
                    : undefined
                }
                onPress={() => handleActivityPress(activity)}
              />
            );
          })
        )}
      </ScrollView>

      <Toast
        visible={toast.toastState.visible}
        message={toast.toastState.message}
        type={toast.toastState.type}
        duration={toast.toastState.duration}
        onDismiss={toast.hide}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  },
  scrollView: {
    flex: 1,
  },
  listContainer: {
    padding: theme.spacing.md,
  },
});

export default ActivitiesScreen;
