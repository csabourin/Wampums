/**
 * Activities Screen
 *
 * Mirrors spa/activities.js functionality
 * Shows list of activities with calendar view
 * For admin and leader users
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  SegmentedControlIOS,
  Platform,
} from 'react-native';
import { getActivities } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import { Card, LoadingSpinner, ErrorMessage } from '../components';
import CONFIG from '../config';

const ActivitiesScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activities, setActivities] = useState([]);
  const [filteredActivities, setFilteredActivities] = useState([]);
  const [filter, setFilter] = useState('upcoming'); // upcoming, past, all

  useEffect(() => {
    loadActivities();
  }, []);

  useEffect(() => {
    filterActivities();
  }, [filter, activities]);

  const loadActivities = async () => {
    try {
      setError('');

      const response = await getActivities();
      if (response.success) {
        // Sort by date descending
        const sorted = response.data.sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        );
        setActivities(sorted);
      }
    } catch (err) {
      setError(err.message || t('common.errorLoadingData'));
    } finally {
      setLoading(false);
    }
  };

  const filterActivities = () => {
    let filtered = [...activities];

    switch (filter) {
      case 'upcoming':
        filtered = filtered.filter((a) => DateUtils.isFuture(a.date));
        // Sort upcoming ascending (soonest first)
        filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
        break;
      case 'past':
        filtered = filtered.filter((a) => DateUtils.isPast(a.date));
        // Sort past descending (most recent first)
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
        break;
      case 'all':
        // Already sorted descending
        break;
    }

    setFilteredActivities(filtered);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadActivities();
    setRefreshing(false);
  };

  const getActivityStatus = (activity) => {
    if (DateUtils.isToday(activity.date)) {
      return { text: t('activities.today'), color: '#34C759' };
    }
    if (DateUtils.isFuture(activity.date)) {
      return { text: t('activities.upcoming'), color: '#007AFF' };
    }
    return { text: t('activities.past'), color: '#8E8E93' };
  };

  const renderActivity = ({ item }) => {
    const status = getActivityStatus(item);

    return (
      <Card onPress={() => navigation.navigate('ActivityDetail', { id: item.id })}>
        <View style={styles.activityHeader}>
          <View style={styles.activityInfo}>
            <Text style={styles.activityName}>{item.name}</Text>
            <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
              <Text style={styles.statusText}>{status.text}</Text>
            </View>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>

        <Text style={styles.activityDate}>
          📅 {DateUtils.formatDate(item.date)} {DateUtils.formatTime(item.date)}
        </Text>

        {item.location && (
          <Text style={styles.activityDetail}>📍 {item.location}</Text>
        )}

        {item.description && (
          <Text style={styles.activityDescription} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        {item.participantCount !== undefined && (
          <Text style={styles.activityDetail}>
            👥 {item.participantCount} {t('activities.participants')}
          </Text>
        )}
      </Card>
    );
  };

  if (loading) {
    return <LoadingSpinner message={t('common.loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadActivities} />;
  }

  return (
    <View style={styles.container}>
      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        {Platform.OS === 'ios' ? (
          <SegmentedControlIOS
            values={[
              t('activities.upcoming'),
              t('activities.past'),
              t('activities.all'),
            ]}
            selectedIndex={
              filter === 'upcoming' ? 0 : filter === 'past' ? 1 : 2
            }
            onChange={(event) => {
              const index = event.nativeEvent.selectedSegmentIndex;
              setFilter(index === 0 ? 'upcoming' : index === 1 ? 'past' : 'all');
            }}
            style={styles.segmentedControl}
          />
        ) : (
          <View style={styles.androidTabs}>
            <TouchableOpacity
              style={[
                styles.androidTab,
                filter === 'upcoming' && styles.androidTabActive,
              ]}
              onPress={() => setFilter('upcoming')}
            >
              <Text
                style={[
                  styles.androidTabText,
                  filter === 'upcoming' && styles.androidTabTextActive,
                ]}
              >
                {t('activities.upcoming')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.androidTab, filter === 'past' && styles.androidTabActive]}
              onPress={() => setFilter('past')}
            >
              <Text
                style={[
                  styles.androidTabText,
                  filter === 'past' && styles.androidTabTextActive,
                ]}
              >
                {t('activities.past')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.androidTab, filter === 'all' && styles.androidTabActive]}
              onPress={() => setFilter('all')}
            >
              <Text
                style={[
                  styles.androidTabText,
                  filter === 'all' && styles.androidTabTextActive,
                ]}
              >
                {t('activities.all')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Activities List */}
      <FlatList
        data={filteredActivities}
        renderItem={renderActivity}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('activities.noActivities')}</Text>
          </View>
        }
      />

      {/* Add Button (for admins/leaders) */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('ActivityDetail', { id: 'new' })}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  filterContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  segmentedControl: {
    height: 32,
  },
  androidTabs: {
    flexDirection: 'row',
  },
  androidTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    marginHorizontal: 4,
    alignItems: 'center',
  },
  androidTabActive: {
    backgroundColor: '#007AFF',
  },
  androidTabText: {
    fontSize: 14,
    color: '#333',
  },
  androidTabTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  activityInfo: {
    flex: 1,
  },
  activityName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  chevron: {
    fontSize: 24,
    color: '#C7C7CC',
    marginLeft: 8,
  },
  activityDate: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  activityDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  activityDescription: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    lineHeight: 20,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '300',
  },
});

export default ActivitiesScreen;
