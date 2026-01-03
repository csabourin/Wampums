/**
 * HonorsScreen
 *
 * Mirrors spa/manage_honors.js for leaders.
 * Allows selecting participants to award honors with reasons.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { awardHonor, getHonors } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import StorageUtils from '../utils/StorageUtils';
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import theme, { commonStyles } from '../theme';
import { debugError, debugLog } from '../utils/DebugUtils';
import { hasPermission } from '../utils/PermissionUtils';
import CONFIG from '../config';

/**
 * Build participant honor stats for the selected date.
 * Filters to show:
 * - All participants on current date (can award honors)
 * - Only participants with honors on past dates (view only)
 *
 * @param {Array} participants - Participants list.
 * @param {Array} honors - Honors list.
 * @param {string} selectedDate - Selected date.
 * @returns {Array} Enriched participant list (filtered).
 */
const buildHonorsList = (participants, honors, selectedDate) => {
  const today = DateUtils.getTodayISO(); // Get today's date in ISO format (YYYY-MM-DD)
  const isCurrentDate = selectedDate === today;

  return participants
    .map((participant) => {
      const honorsForDate = honors.filter(
        (honor) =>
          honor.participant_id === participant.participant_id &&
          honor.date === selectedDate
      );
      const totalHonors = honors.filter(
        (honor) =>
          honor.participant_id === participant.participant_id &&
          new Date(honor.date) <= new Date(selectedDate)
      ).length;

      return {
        ...participant,
        honoredToday: honorsForDate.length > 0,
        totalHonors,
        reason: honorsForDate[0]?.reason || '',
        visible: isCurrentDate || honorsForDate.length > 0, // Show all on current date, only honored on past dates
      };
    })
    .filter((participant) => participant.visible); // Filter out non-visible participants
};

const HonorsScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [honors, setHonors] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(DateUtils.getTodayISO()); // Initialize to today
  const [selectedHonors, setSelectedHonors] = useState({});
  const [saving, setSaving] = useState(false);
  const [userPermissions, setUserPermissions] = useState([]);
  const [sortBy, setSortBy] = useState('name'); // 'name' or 'honors'

  const honorsList = useMemo(() => {
    const list = buildHonorsList(participants, honors, selectedDate);

    // Sort the list based on sortBy
    return list.sort((a, b) => {
      if (sortBy === 'name') {
        const nameA = `${a.last_name} ${a.first_name}`.toLowerCase();
        const nameB = `${b.last_name} ${b.first_name}`.toLowerCase();
        return nameA.localeCompare(nameB);
      } else if (sortBy === 'honors') {
        return b.totalHonors - a.totalHonors; // Descending order (most honors first)
      }
      return 0;
    });
  }, [participants, honors, selectedDate, sortBy]);

  // Calculate permissions-based access
  const canView = hasPermission('honors.view', userPermissions) ||
                  hasPermission('honors.create', userPermissions) ||
                  hasPermission('honors.manage', userPermissions);
  const canAward = hasPermission('honors.create', userPermissions) ||
                   hasPermission('honors.manage', userPermissions);

  /**
   * Check if selected date is in the past
   * Compares ISO date strings to avoid timezone issues
   */
  const isPastDate = () => {
    if (!selectedDate) return false;
    const today = DateUtils.getTodayISO();
    return selectedDate < today; // ISO format strings are lexicographically sortable
  };

  /**
   * Load user permissions from storage
   */
  const loadUserPermissions = async () => {
    try {
      const permissions = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_PERMISSIONS);
      setUserPermissions(permissions || []);
      debugLog('[HonorsScreen] Loaded permissions:', permissions);
    } catch (err) {
      debugError('Error loading permissions:', err);
      setUserPermissions([]);
    }
  };

  /**
   * Load honors data for selected date.
   */
  const loadHonorsData = async (dateOverride = null) => {
    try {
      setError('');
      const targetDate = dateOverride || selectedDate;
      const response = await getHonors(targetDate);

      if (response.success) {
        const data = response.data || response;
        setParticipants(data.participants || []);
        setHonors(data.honors || []);

        // Get available dates from API (in ISO format YYYY-MM-DD)
        const dates = data.availableDates || [];
        const today = DateUtils.getTodayISO(); // Use ISO format to match backend dates

        // Ensure today is always in the list
        const uniqueDates = Array.from(new Set([today, ...dates]));

        // Sort dates in descending order (newest first)
        uniqueDates.sort((a, b) => new Date(b) - new Date(a));

        setAvailableDates(uniqueDates);
      } else {
        throw new Error(response.message || t('error_loading_honors'));
      }
    } catch (err) {
      debugError('Error loading honors:', err);
      setError(err.message || t('error_loading_honors'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserPermissions();
    loadHonorsData();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      loadHonorsData(selectedDate);
    }
  }, [selectedDate]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHonorsData(selectedDate);
    setRefreshing(false);
  };

  const toggleParticipant = (participantId) => {
    setSelectedHonors((prev) => ({
      ...prev,
      [participantId]: {
        ...prev[participantId],
        selected: !prev[participantId]?.selected,
      },
    }));
  };

  const updateReason = (participantId, reason) => {
    setSelectedHonors((prev) => ({
      ...prev,
      [participantId]: {
        ...prev[participantId],
        reason,
      },
    }));
  };

  const handleAwardHonors = async () => {
    const honorsPayload = Object.entries(selectedHonors)
      .filter(([, value]) => value?.selected)
      .map(([participantId, value]) => ({
        participantId,
        date: selectedDate,
        reason: SecurityUtils.sanitizeInput(value?.reason || ''),
      }))
      .filter((honor) => honor.reason);

    if (honorsPayload.length === 0) {
      setError(t('select_individuals'));
      return;
    }

    setSaving(true);
    try {
      const response = await awardHonor(honorsPayload);
      if (!response.success) {
        throw new Error(response.message || t('error_awarding_honor'));
      }
      setSelectedHonors({});
      await loadHonorsData(selectedDate);
    } catch (err) {
      debugError('Error awarding honors:', err);
      setError(err.message || t('error_awarding_honor'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadHonorsData} />;
  }

  // Check if user has permission to view honors
  if (!canView) {
    return (
      <View style={[commonStyles.container, styles.centerContent]}>
        <ErrorMessage
          message={t('insufficient_permissions') || 'You do not have permission to view honors'}
          onRetry={null}
        />
      </View>
    );
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('youth_of_honor')}</Text>
          <Text style={styles.subtitle}>{t('manage_honors')}</Text>
        </View>

        <View style={styles.dateSection}>
          <Text style={styles.sectionTitle}>{t('select_date')}</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selectedDate}
              onValueChange={(itemValue) => setSelectedDate(itemValue)}
              style={styles.picker}
            >
              {availableDates.map((date) => (
                <Picker.Item
                  key={date}
                  label={DateUtils.formatDate(date)}
                  value={date}
                />
              ))}
            </Picker>
          </View>
        </View>

      <View style={styles.sortSection}>
        <Text style={styles.sectionTitle}>{t('sort_by') || 'Sort by'}:</Text>
        <View style={styles.sortButtons}>
          <TouchableOpacity
            style={[styles.sortButton, sortBy === 'name' && styles.sortButtonActive]}
            onPress={() => setSortBy('name')}
          >
            <Text style={[styles.sortButtonText, sortBy === 'name' && styles.sortButtonTextActive]}>
              👤 {t('name') || 'Name'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.sortButton, sortBy === 'honors' && styles.sortButtonActive]}
            onPress={() => setSortBy('honors')}
          >
            <Text style={[styles.sortButtonText, sortBy === 'honors' && styles.sortButtonTextActive]}>
              🏆 {t('honors') || 'Honors'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.listSection}>
        {honorsList.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('no_honors_on_this_date')}</Text>
          </Card>
        ) : (
          honorsList.map((participant) => {
            const isDisabled = !canAward || isPastDate() || participant.honoredToday;
            const selection = selectedHonors[participant.participant_id] || {};
            const isSelected = selection?.selected;
            return (
              <Card
                key={participant.participant_id}
                style={[
                  styles.card,
                  isSelected && styles.cardSelected,
                  isDisabled && styles.cardDisabled
                ]}
              >
                <TouchableOpacity
                  onPress={() => toggleParticipant(participant.participant_id)}
                  disabled={isDisabled}
                  style={styles.participantTouchable}
                >
                  <View style={styles.participantHeader}>
                    <View style={styles.participantInfo}>
                      <Text style={[styles.participantName, isDisabled && styles.textDisabled]}>
                        {participant.first_name} {participant.last_name}
                      </Text>
                      <Text style={styles.captionText}>
                        {t('honors_count')}: {participant.totalHonors}
                      </Text>
                      {participant.reason ? (
                        <Text style={styles.captionText}>{participant.reason}</Text>
                      ) : null}
                    </View>
                    {isSelected && !isDisabled && (
                      <View style={styles.checkmarkContainer}>
                        <Text style={styles.checkmark}>✓</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                {!isDisabled && isSelected ? (
                  <TextInput
                    style={styles.reasonInput}
                    placeholder={t('honor_reason_prompt')}
                    value={selection.reason || ''}
                    onChangeText={(value) => updateReason(participant.participant_id, value)}
                    multiline
                  />
                ) : null}
              </Card>
            );
          })
        )}
      </View>
      </ScrollView>

      {canAward && (
        <View style={styles.fixedButtonContainer}>
          <Button
            title={t('award_honor')}
            onPress={handleAwardHonors}
            loading={saving}
            disabled={isPastDate()}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: theme.spacing.xl,
  },
  header: {
    padding: theme.spacing.lg,
  },
  title: {
    ...commonStyles.heading2,
  },
  subtitle: {
    ...commonStyles.caption,
  },
  sectionTitle: {
    ...commonStyles.sectionTitle,
    marginBottom: theme.spacing.sm,
  },
  dateSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  sortSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  sortButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  sortButton: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  sortButtonActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  sortButtonText: {
    ...commonStyles.caption,
    fontWeight: '500',
  },
  sortButtonTextActive: {
    color: theme.colors.surface,
    fontWeight: '600',
  },
  listSection: {
    paddingHorizontal: theme.spacing.lg,
  },
  card: {
    marginBottom: theme.spacing.sm,
  },
  cardSelected: {
    borderColor: theme.colors.primary,
    borderWidth: 2,
    backgroundColor: theme.colors.primaryLight || '#e8f5e9',
  },
  cardDisabled: {
    opacity: 0.5,
  },
  participantTouchable: {
    padding: theme.spacing.sm,
  },
  participantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    ...commonStyles.heading3,
    marginBottom: theme.spacing.xs,
  },
  textDisabled: {
    color: theme.colors.textSecondary,
  },
  captionText: {
    ...commonStyles.caption,
  },
  checkmarkContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: theme.spacing.sm,
  },
  checkmark: {
    color: theme.colors.surface,
    fontSize: 20,
    fontWeight: 'bold',
  },
  reasonInput: {
    ...commonStyles.input,
    marginTop: theme.spacing.sm,
    marginHorizontal: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  emptyText: {
    ...commonStyles.bodyText,
    textAlign: 'center',
  },
  fixedButtonContainer: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
});

export default HonorsScreen;
