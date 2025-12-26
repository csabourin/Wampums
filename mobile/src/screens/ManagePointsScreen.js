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
  TextInput,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { getParticipants, getGroups, updatePoints } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import { Card, LoadingSpinner, ErrorMessage, Button } from '../components';
import SecurityUtils from '../utils/SecurityUtils';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';
import { debugError, debugLog } from '../utils/DebugUtils';

const VIEW_MODES = {
  PARTICIPANTS: 'participants',
  GROUPS: 'groups',
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
  const [viewMode, setViewMode] = useState(VIEW_MODES.PARTICIPANTS);
  const [customPoints, setCustomPoints] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const groupedParticipants = useMemo(
    () => buildGroupedParticipants(participants),
    [participants]
  );

  const groupTotals = useMemo(() => {
    return groups.map((group) => {
      const members = participants.filter((participant) => participant.group_id === group.id);
      const totalPoints = members.reduce(
        (sum, member) => sum + Number(member.total_points || 0),
        0
      );
      return { ...group, totalPoints };
    });
  }, [groups, participants]);

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
      await loadPointsData();
      setCustomPoints('');
    } catch (err) {
      debugError('Error updating points:', err);
      setError(err.message || t('error_loading_manage_points'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCustomPointsSubmit = () => {
    const sanitized = SecurityUtils.sanitizeNumber(customPoints, true);
    const parsed = Number(sanitized);

    if (Number.isNaN(parsed) || parsed === 0) {
      setError(t('error_loading_data'));
      return;
    }

    handlePointsUpdate(parsed);
  };

  const renderParticipantCard = (participant) => {
    const isSelected = selectedId === participant.id && selectedType === 'participant';
    return (
      <Card
        key={participant.id}
        onPress={() => {
          setSelectedId(participant.id);
          setSelectedType('participant');
        }}
        style={[styles.card, isSelected && styles.cardSelected]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            {participant.firstName || participant.first_name}{' '}
            {participant.lastName || participant.last_name}
          </Text>
          <Text style={styles.pointsValue}>
            {Number(participant.total_points || 0)} {t('points')}
          </Text>
        </View>
        <Text style={styles.cardSubtitle}>
          {participant.group_name || t('groups')}
        </Text>
      </Card>
    );
  };

  const renderGroupCard = (group) => {
    const isSelected = selectedId === group.id && selectedType === 'group';
    return (
      <Card
        key={group.id}
        onPress={() => {
          setSelectedId(group.id);
          setSelectedType('group');
        }}
        style={[styles.card, isSelected && styles.cardSelected]}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{group.name}</Text>
          <Text style={styles.pointsValue}>
            {Number(group.totalPoints || 0)} {t('points')}
          </Text>
        </View>
        <Text style={styles.cardSubtitle}>
          {t('groups')}
        </Text>
      </Card>
    );
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadPointsData} />;
  }

  return (
    <ScrollView
      style={commonStyles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('manage_points')}</Text>
        <Text style={styles.subtitle}>{t('points')}</Text>
      </View>

      <View style={styles.toggleRow}>
        <Button
          title={t('participants')}
          variant={viewMode === VIEW_MODES.PARTICIPANTS ? 'primary' : 'secondary'}
          onPress={() => setViewMode(VIEW_MODES.PARTICIPANTS)}
          style={styles.toggleButton}
        />
        <Button
          title={t('groups')}
          variant={viewMode === VIEW_MODES.GROUPS ? 'primary' : 'secondary'}
          onPress={() => setViewMode(VIEW_MODES.GROUPS)}
          style={styles.toggleButton}
        />
      </View>

      <View style={styles.quickActions}>
        <Text style={styles.sectionTitle}>{t('points')}</Text>
        <View style={styles.actionRow}>
          {CONFIG.UI.POINTS_QUICK_ACTIONS.map((value) => (
            <Button
              key={`points-${value}`}
              title={`${value > 0 ? '+' : ''}${value}`}
              onPress={() => handlePointsUpdate(value)}
              disabled={submitting}
              variant={value > 0 ? 'success' : 'danger'}
              style={styles.quickButton}
              size="small"
            />
          ))}
        </View>
        <View style={styles.customRow}>
          <TextInput
            style={styles.input}
            placeholder={t('points')}
            keyboardType="numeric"
            value={customPoints}
            onChangeText={setCustomPoints}
          />
          <Button
            title={t('update')}
            onPress={handleCustomPointsSubmit}
            disabled={submitting}
            style={styles.updateButton}
          />
        </View>
      </View>

      <View style={styles.section}>
        {viewMode === VIEW_MODES.PARTICIPANTS ? (
          Object.entries(groupedParticipants).map(([groupName, members]) => (
            <View key={groupName} style={styles.groupSection}>
              <Text style={styles.groupTitle}>{groupName}</Text>
              {members.map(renderParticipantCard)}
            </View>
          ))
        ) : (
          groupTotals.map(renderGroupCard)
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  header: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  title: {
    ...commonStyles.heading2,
  },
  subtitle: {
    ...commonStyles.caption,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  toggleButton: {
    flex: 1,
  },
  quickActions: {
    ...commonStyles.card,
    marginHorizontal: theme.spacing.lg,
  },
  sectionTitle: {
    ...commonStyles.sectionTitle,
    marginBottom: theme.spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  quickButton: {
    minWidth: theme.spacing.xxl,
  },
  customRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  input: {
    ...commonStyles.input,
    flex: 1,
  },
  updateButton: {
    minWidth: theme.spacing.xxl,
  },
  section: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  groupSection: {
    marginBottom: theme.spacing.lg,
  },
  groupTitle: {
    ...commonStyles.sectionTitle,
    marginBottom: theme.spacing.sm,
  },
  card: {
    marginBottom: theme.spacing.sm,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    ...commonStyles.heading3,
    flex: 1,
  },
  cardSubtitle: {
    ...commonStyles.caption,
  },
  pointsValue: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.semibold,
  },
});

export default ManagePointsScreen;
