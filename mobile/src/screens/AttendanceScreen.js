/**
 * AttendanceScreen
 *
 * Mirrors spa/attendance.js for leaders.
 * Allows marking attendance by date with status selection.
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
import {
  getAttendance,
  getAttendanceDates,
  getParticipants,
  createAttendance,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';
import { debugError } from '../utils/DebugUtils';

/**
 * Normalize participant names to handle API variations.
 * @param {object} participant - Participant record.
 * @returns {object} Normalized participant record.
 */
const normalizeParticipant = (participant) => {
  return {
    id: participant.id || participant.participant_id,
    firstName: participant.firstName || participant.first_name || '',
    lastName: participant.lastName || participant.last_name || '',
    groupName: participant.group || participant.group_name || '',
  };
};

const AttendanceScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [savingId, setSavingId] = useState(null);

  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    );
  }, [participants]);

  /**
   * Load attendance data for the selected date.
   */
  const loadAttendanceData = async (dateOverride = null) => {
    try {
      setError('');
      const targetDate = dateOverride || selectedDate;

      const [participantsResponse, attendanceResponse, datesResponse] = await Promise.all([
        getParticipants(),
        getAttendance(targetDate ? { date: targetDate } : undefined),
        getAttendanceDates(),
      ]);

      const participantRows = participantsResponse.success
        ? (participantsResponse.data || []).map(normalizeParticipant)
        : [];

      const attendanceRows = attendanceResponse.success
        ? attendanceResponse.data || []
        : [];

      const dateRows = datesResponse.success ? datesResponse.data || [] : [];

      const map = attendanceRows.reduce((acc, record) => {
        acc[record.participant_id] = record.status;
        return acc;
      }, {});

      setParticipants(participantRows);
      setAttendanceMap(map);

      const dates = dateRows.length > 0 ? dateRows : [];
      const today = DateUtils.formatDate(new Date());
      const uniqueDates = Array.from(new Set([today, ...dates]));
      setAvailableDates(uniqueDates);

      if (!targetDate) {
        setSelectedDate(uniqueDates[0]);
      }
    } catch (err) {
      debugError('Error loading attendance data:', err);
      setError(err.message || t('error_loading_attendance'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAttendanceData();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      loadAttendanceData(selectedDate);
    }
  }, [selectedDate]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAttendanceData(selectedDate);
    setRefreshing(false);
  };

  /**
   * Persist an attendance update.
   * @param {number} participantId - Participant ID.
   * @param {string} status - Attendance status.
   */
  const handleStatusUpdate = async (participantId, status) => {
    setSavingId(participantId);
    try {
      const previousStatus = attendanceMap[participantId];
      const response = await createAttendance({
        participant_id: participantId,
        status,
        date: selectedDate,
        previous_status: previousStatus,
      });

      if (!response.success) {
        throw new Error(response.message || t('error_loading_attendance'));
      }

      setAttendanceMap((prev) => ({ ...prev, [participantId]: status }));
    } catch (err) {
      debugError('Error updating attendance:', err);
      setError(err.message || t('error_loading_attendance'));
    } finally {
      setSavingId(null);
    }
  };

  const handleDateSubmit = () => {
    const sanitized = SecurityUtils.sanitizeInput(customDate);
    if (!sanitized) {
      setError(t('error_loading_attendance'));
      return;
    }

    setSelectedDate(sanitized);
    setCustomDate('');
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadAttendanceData} />;
  }

  return (
    <ScrollView
      style={commonStyles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('attendance_overview')}</Text>
        <Text style={styles.subtitle}>{t('attendance')}</Text>
      </View>

      <View style={styles.dateSection}>
        <Text style={styles.sectionTitle}>{t('select_date')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.dateChips}>
            {availableDates.map((date) => (
              <TouchableOpacity
                key={date}
                onPress={() => setSelectedDate(date)}
                style={[
                  styles.dateChip,
                  selectedDate === date && styles.dateChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.dateChipText,
                    selectedDate === date && styles.dateChipTextActive,
                  ]}
                >
                  {DateUtils.formatDate(date)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

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
        {sortedParticipants.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('no_participants')}</Text>
          </Card>
        ) : (
          sortedParticipants.map((participant) => (
            <Card key={participant.id} style={styles.attendanceCard}>
              <Text style={styles.participantName}>
                {participant.firstName} {participant.lastName}
              </Text>
              {participant.groupName ? (
                <Text style={styles.groupName}>{participant.groupName}</Text>
              ) : null}
              <View style={styles.statusRow}>
                {CONFIG.UI.ATTENDANCE_STATUSES.map((status) => {
                  const isActive = attendanceMap[participant.id] === status;
                  return (
                    <Button
                      key={`${participant.id}-${status}`}
                      title={t(status)}
                      onPress={() => handleStatusUpdate(participant.id, status)}
                      variant={isActive ? 'primary' : 'secondary'}
                      size="small"
                      disabled={savingId === participant.id}
                      style={styles.statusButton}
                    />
                  );
                })}
              </View>
            </Card>
          ))
        )}
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
  dateChips: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  dateChip: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dateChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  dateChipText: {
    ...commonStyles.caption,
  },
  dateChipTextActive: {
    color: theme.colors.surface,
  },
  customDateRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  input: {
    ...commonStyles.input,
    flex: 1,
  },
  listSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  attendanceCard: {
    marginBottom: theme.spacing.sm,
  },
  participantName: {
    ...commonStyles.heading3,
  },
  groupName: {
    ...commonStyles.caption,
    marginBottom: theme.spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  statusButton: {
    minWidth: theme.spacing.xxl,
  },
  emptyText: {
    ...commonStyles.bodyText,
    textAlign: 'center',
  },
});

export default AttendanceScreen;
