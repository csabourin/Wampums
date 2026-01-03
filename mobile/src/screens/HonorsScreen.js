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
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import theme, { commonStyles } from '../theme';
import { debugError } from '../utils/DebugUtils';

/**
 * Build participant honor stats for the selected date.
 * @param {Array} participants - Participants list.
 * @param {Array} honors - Honors list.
 * @param {string} selectedDate - Selected date.
 * @returns {Array} Enriched participant list.
 */
const buildHonorsList = (participants, honors, selectedDate) => {
  return participants.map((participant) => {
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
    };
  });
};

const HonorsScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [honors, setHonors] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [selectedHonors, setSelectedHonors] = useState({});
  const [saving, setSaving] = useState(false);

  const honorsList = useMemo(
    () => buildHonorsList(participants, honors, selectedDate),
    [participants, honors, selectedDate]
  );

  const isPastDate = () => {
    if (!selectedDate) return false;
    const target = new Date(selectedDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return target < today;
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

        const dates = data.availableDates || [];
        const today = DateUtils.formatDate(new Date());
        const uniqueDates = Array.from(new Set([today, ...dates]));
        setAvailableDates(uniqueDates);

        if (!targetDate) {
          setSelectedDate(uniqueDates[0]);
        }
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

  const handleDateSubmit = () => {
    const sanitized = SecurityUtils.sanitizeInput(customDate);
    if (!sanitized) {
      setError(t('error_loading_honors'));
      return;
    }

    setSelectedDate(sanitized);
    setCustomDate('');
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadHonorsData} />;
  }

  return (
    <ScrollView
      style={commonStyles.container}
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
        <View style={styles.customDateRow}>
          <TextInput
            style={styles.input}
            placeholder={t('date')}
            value={customDate}
            onChangeText={setCustomDate}
          />
          <Button title={t('update')} onPress={handleDateSubmit} />
        </View>
      </View>

      <View style={styles.listSection}>
        {honorsList.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('no_honors_on_this_date')}</Text>
          </Card>
        ) : (
          honorsList.map((participant) => {
            const isDisabled = isPastDate() || participant.honoredToday;
            const selection = selectedHonors[participant.participant_id] || {};
            return (
              <Card key={participant.participant_id} style={styles.card}>
                <TouchableOpacity
                  onPress={() => toggleParticipant(participant.participant_id)}
                  disabled={isDisabled}
                >
                  <Text style={styles.participantName}>
                    {participant.first_name} {participant.last_name}
                  </Text>
                  <Text style={styles.captionText}>
                    {t('honors_count')}: {participant.totalHonors}
                  </Text>
                  {participant.reason ? (
                    <Text style={styles.captionText}>{participant.reason}</Text>
                  ) : null}
                </TouchableOpacity>
                {!isDisabled && selection?.selected ? (
                  <TextInput
                    style={styles.input}
                    placeholder={t('honor_reason_prompt')}
                    value={selection.reason || ''}
                    onChangeText={(value) => updateReason(participant.participant_id, value)}
                  />
                ) : null}
              </Card>
            );
          })
        )}
      </View>

      <View style={styles.saveSection}>
        <Button
          title={t('award_honor')}
          onPress={handleAwardHonors}
          loading={saving}
          disabled={isPastDate()}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
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
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  customDateRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  input: {
    ...commonStyles.input,
    flex: 1,
    marginBottom: theme.spacing.sm,
  },
  listSection: {
    paddingHorizontal: theme.spacing.lg,
  },
  card: {
    marginBottom: theme.spacing.sm,
  },
  participantName: {
    ...commonStyles.heading3,
  },
  captionText: {
    ...commonStyles.caption,
  },
  emptyText: {
    ...commonStyles.bodyText,
    textAlign: 'center',
  },
  saveSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
});

export default HonorsScreen;
