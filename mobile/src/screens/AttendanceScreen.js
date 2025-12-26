/**
 * AttendanceScreen
 *
 * Mirrors spa/attendance.js for leaders with full feature parity.
 * Allows marking attendance by date with group/individual selection.
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
  Alert,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  getAttendance,
  getAttendanceDates,
  getParticipants,
  createAttendance,
  saveGuest,
  getGuestsByDate,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { Button, ErrorMessage, LoadingSpinner } from '../components';
import CONFIG from '../config';
import theme, { commonStyles } from '../theme';
import { debugError, debugLog } from '../utils/DebugUtils';
import CacheManager from '../utils/CacheManager';

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
    groupId: participant.groupId || participant.group_id,
    groupName: participant.groupName || participant.group_name || participant.group || '',
    firstLeader: participant.firstLeader || participant.first_leader || false,
    secondLeader: participant.secondLeader || participant.second_leader || false,
  };
};

/**
 * Format a YYYY-MM-DD date string for display without timezone conversion issues.
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Formatted date string
 */
const formatDateForDisplay = (dateString) => {
  if (!dateString) return '';

  // Parse the date string manually to avoid timezone issues
  const parts = dateString.split('-');
  if (parts.length !== 3) return dateString;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // 0-indexed
  const day = parseInt(parts[2], 10);

  // Create date at noon local time to avoid timezone issues
  const date = new Date(year, month, day, 12, 0, 0);

  if (isNaN(date.getTime())) return dateString;

  // Use DateUtils for proper locale formatting
  return DateUtils.formatDate(date);
};

const AttendanceScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [availableDates, setAvailableDates] = useState([]);
  // Initialize with today's date in local timezone
  const [selectedDate, setSelectedDate] = useState(DateUtils.formatDate(new Date()));
  const [savingId, setSavingId] = useState(null);

  // Selection states
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedParticipant, setSelectedParticipant] = useState(null);

  // Guest states
  const [guests, setGuests] = useState([]);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  // Group participants by group
  const groups = useMemo(() => {
    const groupMap = {};

    participants.forEach((participant) => {
      const groupId = participant.groupId || 'no-group';
      if (!groupMap[groupId]) {
        groupMap[groupId] = {
          id: groupId,
          name: participant.groupName || t('no_group'),
          participants: [],
        };
      }
      groupMap[groupId].participants.push(participant);
    });

    // Sort participants within each group (leaders first, then alphabetically)
    Object.values(groupMap).forEach((group) => {
      group.participants.sort((a, b) => {
        // First leaders first
        if (a.firstLeader && !b.firstLeader) return -1;
        if (!a.firstLeader && b.firstLeader) return 1;

        // Second leaders last
        if (a.secondLeader && !b.secondLeader) return 1;
        if (!a.secondLeader && b.secondLeader) return -1;

        // Alphabetically by first name
        return a.firstName.localeCompare(b.firstName);
      });
    });

    // Sort groups alphabetically, no-group last
    return Object.values(groupMap).sort((a, b) => {
      if (a.id === 'no-group') return 1;
      if (b.id === 'no-group') return -1;
      return a.name.localeCompare(b.name);
    });
  }, [participants]);

  /**
   * Load initial data (participants, dates, and today's attendance).
   */
  const loadInitialData = async () => {
    try {
      setError('');
      setLoading(true);

      const today = DateUtils.formatDate(new Date());

      const [participantsResponse, attendanceResponse, datesResponse, guestsResponse] = await Promise.all([
        getParticipants(),
        getAttendance(today),
        getAttendanceDates(),
        getGuestsByDate(today),
      ]);

      const participantRows = participantsResponse.success
        ? (participantsResponse.data || []).map(normalizeParticipant)
        : [];

      const attendanceRows = attendanceResponse.success
        ? attendanceResponse.data || []
        : [];

      const dateRows = datesResponse.success ? datesResponse.data || [] : [];

      const guestRows = guestsResponse.success
        ? guestsResponse.guests || []
        : [];

      debugLog('Initial data loaded:', {
        participants: participantRows.length,
        attendanceRows: attendanceRows.length,
        dates: dateRows.length,
        guests: guestRows.length,
      });

      const map = attendanceRows.reduce((acc, record) => {
        acc[record.participant_id] = record.status;
        return acc;
      }, {});

      setParticipants(participantRows);
      setAttendanceMap(map);
      setGuests(guestRows);

      // Ensure today is first in the list
      const dates = dateRows.length > 0 ? dateRows : [];
      const uniqueDates = Array.from(new Set([today, ...dates]));
      setAvailableDates(uniqueDates);
    } catch (err) {
      debugError('Error loading initial data:', err);
      setError(err.message || t('error_loading_attendance'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Load attendance data for a specific date.
   */
  const loadAttendanceForDate = async (date) => {
    try {
      setError('');
      debugLog(`Loading attendance for date: ${date}`);

      // Clear cache before loading to ensure fresh data
      await CacheManager.clearAttendanceRelatedCaches();

      const [attendanceResponse, guestsResponse] = await Promise.all([
        getAttendance(date),
        getGuestsByDate(date),
      ]);

      const attendanceRows = attendanceResponse.success
        ? attendanceResponse.data || []
        : [];

      const guestRows = guestsResponse.success
        ? guestsResponse.guests || []
        : [];

      debugLog('Attendance API response for', date, ':', {
        success: attendanceResponse.success,
        dataLength: attendanceRows.length,
        sampleRecord: attendanceRows[0] || 'none',
      });

      const map = attendanceRows.reduce((acc, record) => {
        acc[record.participant_id] = record.status;
        return acc;
      }, {});

      debugLog(`Loaded ${Object.keys(map).length} attendance records and ${guestRows.length} guests for ${date}`);

      setAttendanceMap(map);
      setGuests(guestRows);

      // Clear any selections when changing dates
      setSelectedGroup(null);
      setSelectedParticipant(null);
    } catch (err) {
      debugError('Error loading attendance for date:', err);
      setError(err.message || t('error_loading_attendance'));
    }
  };

  // Load initial data on mount
  useEffect(() => {
    loadInitialData();
  }, []);

  // Load attendance when date changes (but skip initial mount)
  useEffect(() => {
    if (!loading && selectedDate) {
      loadAttendanceForDate(selectedDate);
    }
  }, [selectedDate]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAttendanceForDate(selectedDate);
    setRefreshing(false);
  };

  /**
   * Toggle group selection
   */
  const handleGroupPress = (groupId) => {
    // Deselect participant if any
    setSelectedParticipant(null);

    // Toggle group selection
    if (selectedGroup === groupId) {
      setSelectedGroup(null);
    } else {
      setSelectedGroup(groupId);
    }
  };

  /**
   * Toggle individual participant selection
   */
  const handleParticipantPress = (participantId) => {
    // Deselect group if any
    setSelectedGroup(null);

    // Toggle participant selection
    if (selectedParticipant === participantId) {
      setSelectedParticipant(null);
    } else {
      setSelectedParticipant(participantId);
    }
  };

  /**
   * Update status for selected participant(s)
   */
  const handleStatusUpdate = async (status) => {
    if (selectedParticipant) {
      // Update individual participant
      await updateIndividualStatus(selectedParticipant, status);
    } else if (selectedGroup) {
      // Update all participants in group
      await updateGroupStatus(selectedGroup, status);
    } else {
      Alert.alert(t('error'), t('no_selection'));
    }
  };

  /**
   * Update status for individual participant
   */
  const updateIndividualStatus = async (participantId, status) => {
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

      // Clear attendance cache to ensure fresh data on next load
      await CacheManager.clearAttendanceRelatedCaches();

      setAttendanceMap((prev) => ({ ...prev, [participantId]: status }));
    } catch (err) {
      debugError('Error updating attendance:', err);
      Alert.alert(t('error'), err.message || t('error_loading_attendance'));
    } finally {
      setSavingId(null);
    }
  };

  /**
   * Update status for all participants in group
   */
  const updateGroupStatus = async (groupId, status) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const participantIds = group.participants.map((p) => p.id);
    const previousStatuses = {};

    // Optimistically update UI
    const newMap = { ...attendanceMap };
    participantIds.forEach((id) => {
      previousStatuses[id] = attendanceMap[id];
      newMap[id] = status;
    });
    setAttendanceMap(newMap);

    try {
      // Update all participants
      const results = await Promise.all(
        participantIds.map((id) =>
          createAttendance({
            participant_id: id,
            status,
            date: selectedDate,
            previous_status: previousStatuses[id],
          })
        )
      );

      const allSucceeded = results.every((result) => result.success);

      if (!allSucceeded) {
        // Rollback on failure
        const rollbackMap = { ...attendanceMap };
        participantIds.forEach((id) => {
          rollbackMap[id] = previousStatuses[id];
        });
        setAttendanceMap(rollbackMap);
        throw new Error(t('error_updating_group_attendance'));
      }

      // Clear attendance cache to ensure fresh data on next load
      await CacheManager.clearAttendanceRelatedCaches();
    } catch (err) {
      debugError('Error updating group attendance:', err);
      Alert.alert(t('error'), err.message || t('error_updating_group_attendance'));
      // Rollback
      const rollbackMap = { ...attendanceMap };
      participantIds.forEach((id) => {
        rollbackMap[id] = previousStatuses[id];
      });
      setAttendanceMap(rollbackMap);
    }
  };

  /**
   * Add guest
   */
  const handleAddGuest = async () => {
    const sanitizedName = SecurityUtils.sanitizeInput(guestName.trim());
    const sanitizedEmail = SecurityUtils.sanitizeInput(guestEmail.trim());

    if (!sanitizedName) {
      Alert.alert(t('error'), t('guest_name_required'));
      return;
    }

    try {
      const response = await saveGuest({
        name: sanitizedName,
        email: sanitizedEmail,
        attendance_date: selectedDate,
      });

      if (!response.success) {
        throw new Error(response.message || t('error_saving_guest'));
      }

      // Clear attendance cache to ensure fresh data on next load
      await CacheManager.clearAttendanceRelatedCaches();

      setGuests([...guests, { name: sanitizedName, email: sanitizedEmail, attendance_date: selectedDate }]);
      setGuestName('');
      setGuestEmail('');
      Alert.alert(t('success'), t('guest_added_successfully'));
    } catch (err) {
      debugError('Error adding guest:', err);
      Alert.alert(t('error'), err.message || t('error_saving_guest'));
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadInitialData} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Date Picker */}
        <View style={styles.dateSection}>
          <Text style={styles.sectionTitle}>{t('select_date')}</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selectedDate}
              onValueChange={(itemValue) => {
                debugLog(`Date changed from ${selectedDate} to ${itemValue}`);
                setSelectedDate(itemValue);
              }}
              style={styles.picker}
            >
              {availableDates.map((date) => (
                <Picker.Item
                  key={date}
                  label={formatDateForDisplay(date)}
                  value={date}
                />
              ))}
            </Picker>
          </View>
        </View>

        {/* Groups and Participants */}
        <View style={styles.listSection}>
          {groups.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('no_participants')}</Text>
            </View>
          ) : (
            groups.map((group) => (
              <View key={group.id} style={styles.groupCard}>
                {/* Group Header */}
                <TouchableOpacity
                  onPress={() => handleGroupPress(group.id)}
                  style={[
                    styles.groupHeader,
                    selectedGroup === group.id && styles.groupHeaderSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.groupHeaderText,
                      selectedGroup === group.id && styles.groupHeaderTextSelected,
                    ]}
                  >
                    {group.name}
                  </Text>
                </TouchableOpacity>

                {/* Participants */}
                {group.participants.map((participant) => {
                  const status = attendanceMap[participant.id] || 'present';
                  const isSelected = selectedParticipant === participant.id;
                  const isHighlighted = selectedGroup === group.id;

                  return (
                    <TouchableOpacity
                      key={participant.id}
                      onPress={() => handleParticipantPress(participant.id)}
                      style={[
                        styles.participantRow,
                        isSelected && styles.participantRowSelected,
                        isHighlighted && styles.participantRowHighlighted,
                      ]}
                    >
                      <View style={styles.participantInfo}>
                        <Text style={styles.participantName}>
                          {participant.firstName} {participant.lastName}
                        </Text>
                        {participant.firstLeader && (
                          <View style={styles.badge}>
                            <Text style={styles.badgeText}>{t('first_leader')}</Text>
                          </View>
                        )}
                        {participant.secondLeader && (
                          <View style={[styles.badge, styles.badgeSecondary]}>
                            <Text style={styles.badgeText}>{t('second_leader')}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.statusText, styles[`status_${status}`]]}>
                        {t(status)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))
          )}
        </View>

        {/* Guests Section */}
        <View style={styles.guestSection}>
          <Text style={styles.guestTitle}>{t('add_guest')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('guest_name')}
            value={guestName}
            onChangeText={setGuestName}
          />
          <TextInput
            style={styles.input}
            placeholder={t('guest_email_optional')}
            value={guestEmail}
            onChangeText={setGuestEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Button title={t('add_guest_button')} onPress={handleAddGuest} />

          {/* Guest List */}
          {guests.length > 0 && (
            <View style={styles.guestList}>
              {guests.map((guest, index) => (
                <View key={index} style={styles.guestRow}>
                  <Text style={styles.guestName}>{guest.name}</Text>
                  <Text style={styles.guestEmail}>{guest.email || t('no_email')}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Add bottom padding to account for fixed buttons */}
        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Fixed Status Buttons */}
      <View style={styles.fixedFooter}>
        <TouchableOpacity
          style={[styles.statusButton, styles.statusButtonPresent]}
          onPress={() => handleStatusUpdate('present')}
        >
          <Text style={styles.statusButtonText}>{t('present')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statusButton, styles.statusButtonAbsent]}
          onPress={() => handleStatusUpdate('absent')}
        >
          <Text style={styles.statusButtonText}>{t('absent')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statusButton, styles.statusButtonLate]}
          onPress={() => handleStatusUpdate('late')}
        >
          <Text style={styles.statusButtonText}>{t('late')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statusButton, styles.statusButtonExcused]}
          onPress={() => handleStatusUpdate('excused')}
        >
          <Text style={styles.statusButtonText}>{t('excused')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: theme.spacing.xxxl + theme.spacing.xl, // Space for fixed buttons
  },
  dateSection: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  sectionTitle: {
    ...commonStyles.sectionTitle,
    marginBottom: theme.spacing.sm,
  },
  pickerContainer: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  listSection: {
    padding: theme.spacing.lg,
  },
  groupCard: {
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    ...theme.shadows.sm,
  },
  groupHeader: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  groupHeaderSelected: {
    backgroundColor: theme.colors.primary,
  },
  groupHeaderText: {
    ...commonStyles.heading3,
    color: theme.colors.primary,
  },
  groupHeaderTextSelected: {
    color: theme.colors.surface,
  },
  participantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
    minHeight: theme.touchTarget.min,
  },
  participantRowSelected: {
    backgroundColor: theme.colors.primary,
  },
  participantRowHighlighted: {
    backgroundColor: theme.colors.primaryLight + '20', // 20% opacity
  },
  participantInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  participantName: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.medium,
    marginRight: theme.spacing.sm,
  },
  badge: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    marginRight: theme.spacing.xs,
  },
  badgeSecondary: {
    backgroundColor: theme.colors.info,
  },
  badgeText: {
    ...commonStyles.caption,
    color: theme.colors.surface,
    fontSize: theme.fontSize.xs,
  },
  statusText: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.semibold,
  },
  status_present: {
    color: theme.colors.success,
  },
  status_absent: {
    color: theme.colors.error,
  },
  status_late: {
    color: theme.colors.warning,
  },
  status_excused: {
    color: theme.colors.info,
  },
  emptyCard: {
    ...commonStyles.card,
  },
  emptyText: {
    ...commonStyles.bodyText,
    textAlign: 'center',
    color: theme.colors.textMuted,
  },
  guestSection: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.lg,
    ...theme.shadows.sm,
  },
  guestTitle: {
    ...commonStyles.heading3,
    marginBottom: theme.spacing.md,
  },
  input: {
    ...commonStyles.input,
    marginBottom: theme.spacing.md,
  },
  guestList: {
    marginTop: theme.spacing.md,
  },
  guestRow: {
    padding: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  guestName: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.medium,
  },
  guestEmail: {
    ...commonStyles.caption,
  },
  bottomPadding: {
    height: theme.spacing.xl,
  },
  fixedFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    padding: theme.spacing.sm,
    ...theme.shadows.lg,
  },
  statusButton: {
    flex: 1,
    padding: theme.spacing.md,
    marginHorizontal: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: theme.touchTarget.min,
  },
  statusButtonPresent: {
    backgroundColor: theme.colors.success,
  },
  statusButtonAbsent: {
    backgroundColor: theme.colors.error,
  },
  statusButtonLate: {
    backgroundColor: theme.colors.warning,
  },
  statusButtonExcused: {
    backgroundColor: theme.colors.info,
  },
  statusButtonText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
});

export default AttendanceScreen;
