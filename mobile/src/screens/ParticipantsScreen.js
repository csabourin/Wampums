/**
 * Participants Screen
 *
 * Mirrors spa/manage_participants.js functionality
 * Shows list of all participants with search and filter
 * For admin and leader users
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { getParticipants, getGroups } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import {
  ListItem,
  SearchBar,
  FilterBar,
  LoadingState,
  ErrorState,
  EmptyState,
  NoResults,
  useToast,
  ConfirmModal,
} from '../components';
import { hasPermission } from '../utils/PermissionUtils';
import StorageUtils from '../utils/StorageUtils';
import theme from '../theme';
import CONFIG from '../config';

const ParticipantsScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [groups, setGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [userPermissions, setUserPermissions] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  
  const { showToast, ToastComponent } = useToast();

  // Configure navigation header
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('manage_names') || 'Participants',
      headerRight: () =>
        canManage ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('ParticipantDetail', { id: 'new' })}
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
      loadData();
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

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load participants and groups in parallel
      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      if (participantsResponse.success) {
        setParticipants(participantsResponse.data || participantsResponse.participants || []);
      } else {
        throw new Error(participantsResponse.message || 'Failed to load participants');
      }

      if (groupsResponse.success) {
        setGroups(groupsResponse.data || groupsResponse.groups || []);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const canManage = hasPermission('participants.manage', userPermissions);

  // Filter and sort participants
  const filteredParticipants = participants
    .filter((p) => {
      // Filter by group
      if (activeFilter !== 'all' && p.groupId !== parseInt(activeFilter)) {
        return false;
      }

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          p.firstName?.toLowerCase().includes(query) ||
          p.lastName?.toLowerCase().includes(query)
        );
      }

      return true;
    })
    .sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'name':
          aVal = `${a.lastName} ${a.firstName}`.toLowerCase();
          bVal = `${b.lastName} ${b.firstName}`.toLowerCase();
          break;
        case 'age':
          aVal = DateUtils.calculateAge(a.birthdate) || 0;
          bVal = DateUtils.calculateAge(b.birthdate) || 0;
          break;
        case 'group':
          aVal = a.groupName || '';
          bVal = b.groupName || '';
          break;
        default:
          return 0;
      }

      const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      return sortOrder === 'desc' ? -comparison : comparison;
    });

  // Prepare filter options
  const filterOptions = [
    { key: 'all', label: t('all_groups') || 'All', count: participants.length },
    ...groups.map((group) => ({
      key: String(group.id),
      label: group.name,
      count: participants.filter((p) => p.groupId === group.id).length,
    })),
  ];

  const sortOptions = [
    { key: 'name', label: t('name') || 'Name' },
    { key: 'age', label: t('age') || 'Age' },
    { key: 'group', label: t('group') || 'Group' },
  ];

  // Loading state
  if (loading) {
    return <LoadingState message={t('loading')} />;
  }

  // Error state
  if (error) {
    return <ErrorState message={error.message} onRetry={loadData} />;
  }

  // Empty state
  if (participants.length === 0) {
    return (
      <EmptyState
        icon="👥"
        title={t('no_participants') || 'No Participants'}
        message={t('add_first_participant') || 'Add your first participant to get started.'}
        actionLabel={canManage ? (t('add_participant') || 'Add Participant') : undefined}
        onAction={canManage ? () => navigation.navigate('ParticipantDetail', { id: 'new' }) : undefined}
      />
    );
  }

  return (
    <View style={styles.container}>
      {ToastComponent}

      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={t('search_participants') || 'Search participants...'}
      />

      <FilterBar
        filters={filterOptions}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        sortOptions={sortOptions}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(field, order) => {
          setSortBy(field);
          setSortOrder(order);
        }}
      />

      {filteredParticipants.length === 0 ? (
        <NoResults
          searchTerm={searchQuery}
          onClear={() => {
            setSearchQuery('');
            setActiveFilter('all');
          }}
        />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
        >
          {filteredParticipants.map((participant) => (
            <ListItem
              key={participant.id}
              title={`${participant.firstName} ${participant.lastName}`}
              subtitle={[
                participant.groupName,
                `${DateUtils.calculateAge(participant.birthdate)} ${t('years') || 'years'}`,
              ]
                .filter(Boolean)
                .join(' • ')}
              leftIcon="👤"
              onPress={() =>
                navigation.navigate('ParticipantDetail', { id: participant.id })
              }
            />
          ))}
        </ScrollView>
      )}

      <ConfirmModal
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          // Delete logic would go here
          showToast(t('participant_deleted') || 'Participant deleted', 'success');
          setDeleteTarget(null);
          await loadData();
        }}
        title={t('confirm_delete') || 'Delete Participant?'}
        message={
          deleteTarget
            ? t('confirm_delete_participant_message') ||
              `Are you sure you want to delete ${deleteTarget.firstName} ${deleteTarget.lastName}?`
            : ''
        }
        confirmStyle="danger"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  listContent: {
    paddingBottom: theme.spacing.xl,
  },
});

export default ParticipantsScreen;
