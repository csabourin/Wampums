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
  FlatList,
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
import { debugError } from '../utils/DebugUtils';
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
      debugError('Error loading permissions:', err);
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
      if (activeFilter !== 'all' && p.group_id !== parseInt(activeFilter)) {
        return false;
      }

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          p.first_name?.toLowerCase().includes(query) ||
          p.last_name?.toLowerCase().includes(query)
        );
      }

      return true;
    })
    .sort((a, b) => {
      let aVal, bVal;

      switch (sortBy) {
        case 'name':
          aVal = `${a.last_name} ${a.first_name}`.toLowerCase();
          bVal = `${b.last_name} ${b.first_name}`.toLowerCase();
          break;
        case 'age':
          aVal = DateUtils.calculateAge(a.birthdate) || 0;
          bVal = DateUtils.calculateAge(b.birthdate) || 0;
          break;
        case 'group':
          aVal = a.group_name || '';
          bVal = b.group_name || '';
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
      count: participants.filter((p) => p.group_id === group.id).length,
    })),
  ];

  const sortOptions = [
    { key: 'name', label: t('name') || 'Name' },
    { key: 'age', label: t('age') || 'Age' },
    { key: 'group', label: t('group') || 'Group' },
  ];

  // Render function for FlatList
  const renderParticipantItem = useCallback(({ item: participant }) => (
    <ListItem
      title={`${participant.first_name} ${participant.last_name}`}
      subtitle={[
        participant.group_name,
        `${DateUtils.calculateAge(participant.birthdate)} ${t('years') || 'years'}`,
      ]
        .filter(Boolean)
        .join(' • ')}
      leftIcon="👤"
      onPress={() =>
        navigation.navigate('ParticipantDetail', { id: participant.id })
      }
    />
  ), [navigation]);

  const keyExtractor = useCallback((item) => item.id.toString(), []);

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

      <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('search_participants') || 'Search participants...'}
        filterOptions={filterOptions.map(f => ({
          label: f.label,
          value: f.key,
          active: f.key === activeFilter
        }))}
        onFilterToggle={(value) => setActiveFilter(value)}
        showFilters={groups.length > 0}
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
        <FlatList
          data={filteredParticipants}
          renderItem={renderParticipantItem}
          keyExtractor={keyExtractor}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={10}
        />
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
              `Are you sure you want to delete ${deleteTarget.first_name} ${deleteTarget.last_name}?`
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
