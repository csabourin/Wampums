/**
 * ManagePointsScreen
 *
 * Mirrors spa/manage_points.js for leaders.
 * Provides quick point adjustments for participants and groups.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { getParticipants, getGroups, updatePoints } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import { Card, LoadingSpinner, ErrorMessage, Button } from '../components';
import SecurityUtils from '../utils/SecurityUtils';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';
import { debugError, debugLog } from '../utils/DebugUtils';

const SORT_TYPES = {
  NAME: 'name',
  GROUP: 'group',
  POINTS: 'points',
};

/**
 * Build a grouped map for participants by group.
 * @param {Array} participants - Participant list.
 * @returns {Record<string, Array>} Grouped participants.
 */
const buildGroupedParticipants = (participants) => {
  return participants.reduce((acc, participant) => {
    const groupKey = participant.group_name || t('groups');
    if (!acc[groupKey]) {
      acc[groupKey] = [];
    }
    acc[groupKey].push(participant);
    return acc;
  }, {});
};

const ManagePointsScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [sortBy, setSortBy] = useState(SORT_TYPES.GROUP);
  const [filterGroupId, setFilterGroupId] = useState('');

  /**
   * Get sorted and filtered groups with participant data
   */
  const sortedAndFilteredData = useMemo(() => {
    // Filter groups if a specific group is selected
    let filteredGroups = filterGroupId && filterGroupId !== ''
      ? groups.filter((g) => g.id === parseInt(filterGroupId))
      : groups;

    // Build group data with participants
    let groupData = filteredGroups.map((group) => {
      const groupParticipants = participants.filter((p) => p.group_id === group.id);
      return {
        group,
        participants: groupParticipants,
      };
    });

    // Apply sorting
    if (sortBy === SORT_TYPES.NAME) {
      // Sort by first participant's name in each group
      groupData.forEach((item) => {
        item.participants.sort((a, b) =>
          (a.firstName || a.first_name || '').localeCompare(b.firstName || b.first_name || '')
        );
      });
    } else if (sortBy === SORT_TYPES.POINTS) {
      // Sort participants by points within each group
      groupData.forEach((item) => {
        item.participants.sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
      });
      // Also sort groups by total points
      groupData.sort((a, b) => (b.group.total_points || 0) - (a.group.total_points || 0));
    } else {
      // Default: sort by group (already grouped)
      // Sort participants by name within each group
      groupData.forEach((item) => {
        item.participants.sort((a, b) =>
          (a.firstName || a.first_name || '').localeCompare(b.firstName || b.first_name || '')
        );
      });
    }

    return groupData;
  }, [groups, participants, sortBy, filterGroupId]);

  /**
   * Load participants and groups for points management.
   */
  const loadPointsData = async () => {
    try {
      setError('');
      const [participantsResponse, groupsResponse] = await Promise.all([
        getParticipants(),
        getGroups(),
      ]);

      const participantRows = participantsResponse.success
        ? participantsResponse.data || []
        : [];
      const groupRows = groupsResponse.success ? groupsResponse.data || [] : [];

      setParticipants(participantRows);
      setGroups(groupRows);
    } catch (err) {
      debugError('Error loading points data:', err);
      setError(err.message || t('error_loading_manage_points'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPointsData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPointsData();
    setRefreshing(false);
  };

  /**
   * Submit a points update to the API.
   * @param {number} points - Points delta.
   */
  const handlePointsUpdate = async (points) => {
    if (!selectedId || !selectedType) {
      setError(t('select_participant'));
      return;
    }

    setSubmitting(true);
    try {
      const response = await updatePoints([
        {
          type: selectedType,
          id: selectedId,
          points,
          timestamp: new Date().toISOString(),
        },
      ]);

      if (!response.success) {
        throw new Error(response.message || t('error_loading_data'));
      }

      debugLog('Points updated:', response.data);

      // Update local state optimistically
      if (selectedType === 'group') {
        // Update group points
        setGroups((prevGroups) =>
          prevGroups.map((g) =>
            g.id === selectedId
              ? { ...g, total_points: (g.total_points || 0) + points }
              : g
          )
        );
        // Update all participants in the group
        setParticipants((prevParticipants) =>
          prevParticipants.map((p) =>
            p.group_id === selectedId
              ? { ...p, total_points: (p.total_points || 0) + points }
              : p
          )
        );
      } else {
        // Update individual participant
        setParticipants((prevParticipants) =>
          prevParticipants.map((p) =>
            p.id === selectedId
              ? { ...p, total_points: (p.total_points || 0) + points }
              : p
          )
        );
      }
    } catch (err) {
      debugError('Error updating points:', err);
      setError(err.message || t('error_loading_manage_points'));
      // Reload data on error to ensure consistency
      await loadPointsData();
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Render a group header
   */
  const renderGroupHeader = (group) => {
    const isSelected = selectedId === group.id && selectedType === 'group';
    return (
      <TouchableOpacity
        key={`group-${group.id}`}
        style={[styles.groupHeader, isSelected && styles.groupHeaderSelected]}
        onPress={() => {
          setSelectedId(group.id);
          setSelectedType('group');
        }}
      >
        <Text style={styles.groupHeaderText}>
          {group.name} - {Number(group.total_points || 0)}
        </Text>
      </TouchableOpacity>
    );
  };

  /**
   * Render a participant item
   */
  const renderParticipant = (participant, index) => {
    const isSelected = selectedId === participant.id && selectedType === 'participant';
    const isEven = index % 2 === 0;
    return (
      <TouchableOpacity
        key={`participant-${participant.id}`}
        style={[
          styles.participantItem,
          isEven ? styles.participantItemEven : styles.participantItemOdd,
          isSelected && styles.participantItemSelected
        ]}
        onPress={() => {
          setSelectedId(participant.id);
          setSelectedType('participant');
        }}
      >
        <Text style={styles.participantName}>
          {participant.firstName || participant.first_name}{' '}
          {participant.lastName || participant.last_name}
        </Text>
        <Text style={styles.participantPoints}>
          {Number(participant.total_points || 0)}
        </Text>
      </TouchableOpacity>
    );
  };

  /**
   * Render a group with its participants
   */
  const renderGroupSection = ({ group, participants: groupParticipants }) => {
    return (
      <View key={`section-${group.id}`} style={styles.groupSection}>
        {renderGroupHeader(group)}
        <View style={styles.groupContent}>
          {groupParticipants.length > 0 ? (
            groupParticipants.map((participant, index) => renderParticipant(participant, index))
          ) : (
            <Text style={styles.emptyText}>{t('no_participants_in_group')}</Text>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadPointsData} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('manage_points')}</Text>
        </View>

        {/* Sort and Filter Controls */}
        <View style={styles.controls}>
          <View style={styles.sortButtons}>
            <Button
              title={t('sort_by_name')}
              variant={sortBy === SORT_TYPES.NAME ? 'primary' : 'secondary'}
              onPress={() => setSortBy(SORT_TYPES.NAME)}
              style={styles.sortButton}
              size="small"
            />
            <Button
              title={t('sort_by_group')}
              variant={sortBy === SORT_TYPES.GROUP ? 'primary' : 'secondary'}
              onPress={() => setSortBy(SORT_TYPES.GROUP)}
              style={styles.sortButton}
              size="small"
            />
            <Button
              title={t('sort_by_points')}
              variant={sortBy === SORT_TYPES.POINTS ? 'primary' : 'secondary'}
              onPress={() => setSortBy(SORT_TYPES.POINTS)}
              style={styles.sortButton}
              size="small"
            />
          </View>

          <View style={styles.filterContainer}>
            <Text style={styles.filterLabel}>{t('filter_by_group')}:</Text>
            <Picker
              selectedValue={filterGroupId}
              onValueChange={(value) => {
                debugLog('Filter changed to:', value);
                setFilterGroupId(value === '' ? '' : value);
              }}
              style={styles.picker}
            >
              <Picker.Item label={t('all_groups')} value="" />
              {groups.map((group) => (
                <Picker.Item key={group.id} label={group.name} value={String(group.id)} />
              ))}
            </Picker>
          </View>
        </View>

        {/* Groups and Participants List */}
        <View style={styles.listContainer}>
          {sortedAndFilteredData.map(renderGroupSection)}
        </View>
      </ScrollView>

      {/* Fixed Bottom Point Buttons */}
      <View style={styles.fixedBottom}>
        <Button
          title="+1"
          onPress={() => handlePointsUpdate(1)}
          disabled={submitting}
          variant="success"
          style={styles.pointButton}
        />
        <Button
          title="+3"
          onPress={() => handlePointsUpdate(3)}
          disabled={submitting}
          variant="success"
          style={styles.pointButton}
        />
        <Button
          title="+5"
          onPress={() => handlePointsUpdate(5)}
          disabled={submitting}
          variant="success"
          style={styles.pointButton}
        />
        <Button
          title="-1"
          onPress={() => handlePointsUpdate(-1)}
          disabled={submitting}
          variant="danger"
          style={styles.pointButton}
        />
        <Button
          title="-3"
          onPress={() => handlePointsUpdate(-3)}
          disabled={submitting}
          variant="danger"
          style={styles.pointButton}
        />
        <Button
          title="-5"
          onPress={() => handlePointsUpdate(-5)}
          disabled={submitting}
          variant="danger"
          style={styles.pointButton}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 80, // Space for fixed bottom buttons
  },
  header: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  title: {
    ...commonStyles.heading2,
    textAlign: 'center',
  },
  controls: {
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  sortButtons: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  sortButton: {
    flex: 1,
  },
  filterContainer: {
    marginBottom: theme.spacing.sm,
  },
  filterLabel: {
    ...commonStyles.bodyText,
    marginBottom: theme.spacing.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  picker: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
  },
  listContainer: {
    paddingHorizontal: theme.spacing.lg,
  },
  groupSection: {
    marginBottom: theme.spacing.lg,
  },
  groupHeader: {
    backgroundColor: '#d3e3dc',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.xs,
  },
  groupHeaderSelected: {
    backgroundColor: theme.colors.primary,
  },
  groupHeaderText: {
    ...commonStyles.heading3,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  groupContent: {
    paddingLeft: theme.spacing.md,
  },
  participantItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  participantItemEven: {
    backgroundColor: '#f8fbf9', // Very light mint green
  },
  participantItemOdd: {
    backgroundColor: '#e7f2ee', // Light green
  },
  participantItemSelected: {
    borderColor: theme.colors.primary,
    borderWidth: 2,
    backgroundColor: theme.colors.primaryLight,
  },
  participantName: {
    ...commonStyles.bodyText,
    flex: 1,
  },
  participantPoints: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  emptyText: {
    ...commonStyles.caption,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: theme.spacing.md,
  },
  fixedBottom: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  pointButton: {
    flex: 1,
    marginHorizontal: theme.spacing.xs,
  },
});

export default ManagePointsScreen;
