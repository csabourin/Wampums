/**
 * Participants Screen
 *
 * Mirrors spa/manage_participants.js functionality
 * Shows list of all participants with search and filter
 * For admin and leader users
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { getParticipants, getGroups } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import { Card, LoadingSpinner, ErrorMessage } from '../components';
import CONFIG from '../config';

const ParticipantsScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [filteredParticipants, setFilteredParticipants] = useState([]);
  const [groups, setGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    filterParticipants();
  }, [searchQuery, selectedGroup, participants]);

  const loadData = async () => {
    try {
      setError('');

      // Load participants and groups in parallel
      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      if (participantsResponse.success) {
        setParticipants(participantsResponse.data);
      }

      if (groupsResponse.success) {
        setGroups(groupsResponse.data);
      }
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const filterParticipants = () => {
    let filtered = [...participants];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.firstName?.toLowerCase().includes(query) ||
          p.lastName?.toLowerCase().includes(query)
      );
    }

    // Filter by group
    if (selectedGroup !== 'all') {
      filtered = filtered.filter((p) => p.groupId === selectedGroup);
    }

    // Sort by last name, first name
    filtered.sort((a, b) => {
      const aName = `${a.lastName} ${a.firstName}`.toLowerCase();
      const bName = `${b.lastName} ${b.firstName}`.toLowerCase();
      return aName.localeCompare(bName);
    });

    setFilteredParticipants(filtered);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const renderParticipant = ({ item }) => (
    <Card onPress={() => navigation.navigate('ParticipantDetail', { participantId: item.id })}>
      <View style={styles.participantRow}>
        <View style={styles.participantInfo}>
          <Text style={styles.participantName}>
            {item.firstName} {item.lastName}
          </Text>
          <Text style={styles.participantDetail}>
            {t('age')}: {DateUtils.calculateAge(item.birthdate)}{' '}
            {t('years')}
          </Text>
          {item.group && (
            <Text style={styles.participantDetail}>
              {t('group')}: {item.group}
            </Text>
          )}
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Card>
  );

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('Search participants')}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Group Filter */}
      <View style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, selectedGroup === 'all' && styles.filterButtonActive]}
          onPress={() => setSelectedGroup('all')}
        >
          <Text
            style={[
              styles.filterButtonText,
              selectedGroup === 'all' && styles.filterButtonTextActive,
            ]}
          >
            {t('all_groups')}
          </Text>
        </TouchableOpacity>
        {groups.map((group) => (
          <TouchableOpacity
            key={group.id}
            style={[
              styles.filterButton,
              selectedGroup === group.id && styles.filterButtonActive,
            ]}
            onPress={() => setSelectedGroup(group.id)}
          >
            <Text
              style={[
                styles.filterButtonText,
                selectedGroup === group.id && styles.filterButtonTextActive,
              ]}
            >
              {group.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Participants List */}
      <FlatList
        data={filteredParticipants}
        renderItem={renderParticipant}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{t('no_participants')}</Text>
          </View>
        }
      />

      {/* Add Button (for admins) */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('ParticipantDetail', { id: 'new' })}
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
  searchContainer: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  searchInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
  },
  filterContainer: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f5f5f5',
    marginRight: 8,
  },
  filterButtonActive: {
    backgroundColor: '#007AFF',
  },
  filterButtonText: {
    fontSize: 14,
    color: '#333',
  },
  filterButtonTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  listContainer: {
    padding: 16,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  participantDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  chevron: {
    fontSize: 24,
    color: '#C7C7CC',
    marginLeft: 8,
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

export default ParticipantsScreen;
