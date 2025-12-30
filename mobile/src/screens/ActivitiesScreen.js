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
      console.log('=== Activities API Response ===');
      console.log('Success:', response.success);
      console.log('Data length:', response.data?.length);
      console.log('First activity:', response.data?.[0]);
      console.log('================================');
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
    console.log('=== Filtering Activities ===');
    console.log('Total activities:', activities.length);
    console.log('Active filter:', activeFilter);

    let filtered = [...activities];
    const now = new Date();
    console.log('Current date:', now);

    // Apply time filter
    if (activeFilter === 'upcoming') {
      filtered = filtered.filter((activity) => {
        const activityDate = activity.date || activity.activity_date;
        if (!activityDate) {
          console.log('Activity has no date:', activity.name);
          return false;
        }
        // Extract just the date portion (YYYY-MM-DD) from datetime string
        const dateOnly = activityDate.substring(0, 10);
        // Parse as local date to avoid timezone issues
        const [year, month, day] = dateOnly.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);
        const isUpcoming = localDate >= now;
        console.log(`${activity.name}: ${activityDate} -> ${dateOnly} -> ${localDate} -> ${isUpcoming ? 'UPCOMING' : 'PAST'}`);
        return isUpcoming;
      });
    } else if (activeFilter === 'past') {
      filtered = filtered.filter((activity) => {
        const activityDate = activity.date || activity.activity_date;
        if (!activityDate) return false;
        // Extract just the date portion (YYYY-MM-DD) from datetime string
        const dateOnly = activityDate.substring(0, 10);
        // Parse as local date to avoid timezone issues
        const [year, month, day] = dateOnly.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);
        return localDate < now;
      });
    }
    // 'all' shows everything

    console.log('Filtered count:', filtered.length);
    console.log('===========================');

    // Apply sort
    filtered.sort((a, b) => {
      const aDateStr = a.date || a.activity_date;
      const bDateStr = b.date || b.activity_date;

      if (sortBy === 'date') {
        if (!aDateStr || !bDateStr) return 0;
        // Extract date portions and parse as local dates
        const aDateOnly = aDateStr.substring(0, 10);
        const bDateOnly = bDateStr.substring(0, 10);
        const [aYear, aMonth, aDay] = aDateOnly.split('-').map(Number);
        const [bYear, bMonth, bDay] = bDateOnly.split('-').map(Number);
        const aDate = new Date(aYear, aMonth - 1, aDay);
        const bDate = new Date(bYear, bMonth - 1, bDay);
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

  const canManage = hasPermission('activities.manage', userPermissions);

  // Filter options
  const filterOptions = [
    {
      value: 'upcoming',
      label: t('upcoming') || 'Upcoming',
      count: activities.filter((a) => {
        const dateStr = a.date || a.activity_date;
        if (!dateStr) return false;
        const dateOnly = dateStr.substring(0, 10);
        const [year, month, day] = dateOnly.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);
        return localDate >= new Date();
      }).length,
    },
    {
      value: 'past',
      label: t('past') || 'Past',
      count: activities.filter((a) => {
        const dateStr = a.date || a.activity_date;
        if (!dateStr) return false;
        const dateOnly = dateStr.substring(0, 10);
        const [year, month, day] = dateOnly.split('-').map(Number);
        const localDate = new Date(year, month - 1, day);
        return localDate < new Date();
      }).length,
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
    const dateStr = activity.date || activity.activity_date;
    if (!dateStr) return null;

    // Extract date portion and parse as local date to avoid timezone issues
    const dateOnly = dateStr.substring(0, 10);
    const [year, month, day] = dateOnly.split('-').map(Number);
    const activityDate = new Date(year, month - 1, day);

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
            // Parse date as local to avoid timezone issues
            const dateStr = activity.date || activity.activity_date;
            const activityDate = dateStr
              ? (() => {
                  const dateOnly = dateStr.substring(0, 10);
                  const [year, month, day] = dateOnly.split('-').map(Number);
                  const localDate = new Date(year, month - 1, day);
                  return DateUtils.formatDate(localDate);
                })()
              : '';
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
                    : '') +
                  (activity.carpool_offer_count
                    ? `\n🚗 ${activity.carpool_offer_count} ${t('vehicles') || 'vehicles'}`
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
                rightAction={
                  activity.carpool_offer_count > 0
                    ? {
                        label: t('view_carpools') || 'Carpools',
                        onPress: () => navigation.navigate('Carpool', { activityId: activity.id }),
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
