/**
 * MedicationDistributionScreen
 *
 * Medication distribution interface for managing and tracking medication administration
 * Mirrors the web interface for "Distribution des médicaments" (Medication Distribution)
 *
 * Features:
 * - View upcoming medication alerts
 * - See participants ready for medication
 * - One-click medication administration with witness modal
 * - View upcoming distributions
 * - Toggle options for grouping and planning
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Switch,
  Modal,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

// API and utilities
import {
  getMedicationDistributions,
  getParticipantMedications,
  markMedicationDistributionAsGiven,
  getMedicationRequirements,
  getParticipants,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { debugLog, debugError } from '../utils/DebugUtils';

// Components
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import theme, { commonStyles } from '../theme';

/**
 * MedicationDistributionScreen Component
 */
const MedicationDistributionScreen = () => {
  const navigation = useNavigation();

  // State
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [processing, setProcessing] = useSafeState(false);

  // Data
  const [upcomingAlerts, setUpcomingAlerts] = useSafeState([]);
  const [participantsReady, setParticipantsReady] = useSafeState([]);
  const [upcomingDistributions, setUpcomingDistributions] = useSafeState([]);
  const [participants, setParticipants] = useSafeState([]);

  // Toggle options
  const [groupParticipantsBySameTime, setGroupParticipantsBySameTime] = useSafeState(false);
  const [goToPlanning, setGoToPlanning] = useSafeState(false);

  // Modal state
  const [showConfirmModal, setShowConfirmModal] = useSafeState(false);
  const [selectedDistribution, setSelectedDistribution] = useSafeState(null);
  const [witnessName, setWitnessName] = useSafeState('');
  const [optionalNotes, setOptionalNotes] = useSafeState('');

  /**
   * Load all distribution data
   */
  const loadData = async () => {
    try {
      setError('');

      const [
        distributionsResponse,
        participantMedicationsResponse,
        requirementsResponse,
        participantsResponse,
      ] = await Promise.all([
        getMedicationDistributions({ upcoming_only: true }),
        getParticipantMedications(),
        getMedicationRequirements(),
        getParticipants(),
      ]);

      debugLog('Distributions response:', distributionsResponse);
      debugLog('Participant medications response:', participantMedicationsResponse);

      // Process distributions
      if (distributionsResponse.success) {
        const distributions = distributionsResponse.data?.distributions || [];

        // Get current time
        const now = new Date();
        const nowTime = now.getTime();
        const upcoming90Min = nowTime + (90 * 60 * 1000); // 90 minutes from now

        // Filter alerts within next 90 minutes
        const alerts = distributions.filter((dist) => {
          if (dist.status === 'given') return false;

          const scheduledTime = new Date(dist.scheduled_for).getTime();
          return scheduledTime <= upcoming90Min && scheduledTime >= nowTime;
        });

        // Filter distributions ready now (past scheduled time but not given)
        const ready = distributions.filter((dist) => {
          if (dist.status === 'given') return false;

          const scheduledTime = new Date(dist.scheduled_for).getTime();
          return scheduledTime <= nowTime;
        });

        // Filter future distributions
        const future = distributions.filter((dist) => {
          if (dist.status === 'given') return false;

          const scheduledTime = new Date(dist.scheduled_for).getTime();
          return scheduledTime > upcoming90Min;
        });

        setUpcomingAlerts(alerts);
        setParticipantsReady(ready);
        setUpcomingDistributions(future);
      }

      // Store participants for display
      if (participantsResponse.success) {
        setParticipants(participantsResponse.data || []);
      }
    } catch (err) {
      debugError('Error loading medication distribution data:', err);
      setError(t('error_loading_data') || 'Error loading data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('medication_distribution_title') || 'Medication Distribution',
    });
    loadData();
  }, [navigation]);

  /**
   * Handle pull-to-refresh
   */
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  /**
   * Get participant name by ID
   */
  const getParticipantName = (participantId) => {
    const participant = participants.find(p => p.id === participantId);
    if (participant) {
      return `${participant.first_name} ${participant.last_name}`;
    }
    return t('unknown_participant') || 'Unknown';
  };

  /**
   * Format scheduled time for display
   */
  const formatScheduledTime = (scheduledFor) => {
    const date = new Date(scheduledFor);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  /**
   * Format day label (Aujourd'hui, Demain, etc.)
   */
  const formatDayLabel = (scheduledFor) => {
    const date = new Date(scheduledFor);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const isToday = date.toDateString() === today.toDateString();
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    if (isToday) return t('today');
    if (isTomorrow) return t('tomorrow');

    return DateUtils.formatDate(scheduledFor, 'fr');
  };

  /**
   * Open confirmation modal for medication administration
   */
  const openConfirmModal = (distribution) => {
    setSelectedDistribution(distribution);
    setWitnessName(''); // Could pre-fill with current user name
    setOptionalNotes('');
    setShowConfirmModal(true);
  };

  /**
   * Confirm medication administration
   */
  const handleConfirmAdministration = async () => {
    if (!selectedDistribution) return;

    setProcessing(true);
    try {
      const response = await markMedicationDistributionAsGiven(selectedDistribution.id, {
        status: 'given',
        administered_at: new Date().toISOString(),
        witness_name: SecurityUtils.sanitizeInput(witnessName),
        notes: SecurityUtils.sanitizeInput(optionalNotes),
      });

      if (!response.success) {
        throw new Error(response.message || t('error_marking_given'));
      }

      // Close modal and reload data
      setShowConfirmModal(false);
      setSelectedDistribution(null);
      setWitnessName('');
      setOptionalNotes('');

      await loadData();
    } catch (err) {
      debugError('Error marking medication as given:', err);
      setError(err.message || t('error_marking_given'));
    } finally {
      setProcessing(false);
    }
  };

  /**
   * Navigate to planning screen
   */
  const navigateToPlanning = () => {
    navigation.navigate('MedicationPlanning');
  };

  /**
   * Render upcoming alerts section
   */
  const renderUpcomingAlerts = () => {
    if (upcomingAlerts.length === 0) {
      return (
        <Card style={styles.alertCard}>
          <Text style={styles.emptyText}>
            {t('no_upcoming_alerts')}
          </Text>
        </Card>
      );
    }

    return (
      <View>
        {upcomingAlerts.map((alert) => (
          <Card key={alert.id} style={styles.alertCard}>
            <View style={styles.alertHeader}>
              <Text style={styles.alertTime}>{formatScheduledTime(alert.scheduled_for)}</Text>
              <Text style={styles.alertDay}>{formatDayLabel(alert.scheduled_for)}</Text>
            </View>
            <Text style={styles.alertParticipant}>
              {getParticipantName(alert.participant_id)}
            </Text>
            <Text style={styles.alertMedication}>
              {alert.medication_name || t('unknown_medication')}
            </Text>
            {alert.dose_amount && (
              <Text style={styles.alertDose}>
                {alert.dose_amount} {alert.dose_unit || ''}
              </Text>
            )}
          </Card>
        ))}
      </View>
    );
  };

  /**
   * Render participants ready for medication
   */
  const renderParticipantsReady = () => {
    if (participantsReady.length === 0) {
      return (
        <Card style={styles.readyCard}>
          <Text style={styles.emptyText}>
            {t('no_participants_ready')}
          </Text>
        </Card>
      );
    }

    // Group by participant
    const groupedByParticipant = {};
    participantsReady.forEach((dist) => {
      const participantId = dist.participant_id;
      if (!groupedByParticipant[participantId]) {
        groupedByParticipant[participantId] = [];
      }
      groupedByParticipant[participantId].push(dist);
    });

    return (
      <View>
        {Object.entries(groupedByParticipant).map(([participantId, distributions]) => {
          const participantName = getParticipantName(Number(participantId));

          return (
            <Card key={participantId} style={styles.readyCard}>
              <View style={styles.readyHeader}>
                <Text style={styles.readyParticipant}>{participantName}</Text>
                <Text style={styles.readyCount}>
                  {distributions.length} {t('medications')}
                </Text>
              </View>

              {distributions.map((dist) => (
                <TouchableOpacity
                  key={dist.id}
                  style={styles.medicationItem}
                  onPress={() => openConfirmModal(dist)}
                  activeOpacity={0.7}
                >
                  <View style={styles.medicationInfo}>
                    <Text style={styles.medicationName}>
                      {dist.medication_name || t('unknown_medication')}
                    </Text>
                    {dist.dose_amount && (
                      <Text style={styles.medicationDose}>
                        {dist.dose_amount}{dist.dose_unit ? ` ${dist.dose_unit}` : ''} - {dist.route || t('oral')}
                      </Text>
                    )}
                    <View style={styles.medicationTimeRow}>
                      <Text style={styles.medicationTimeLabel}>
                        ⏰ {t('administration_time')}:
                      </Text>
                      <Text style={styles.medicationTime}>
                        {formatScheduledTime(dist.scheduled_for)} ({t('medication_frequency_breakfast')})
                      </Text>
                    </View>
                  </View>

                  <View style={styles.giveNowButton}>
                    <Text style={styles.giveNowText}>
                      {t('give_now')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </Card>
          );
        })}
      </View>
    );
  };

  /**
   * Render upcoming distributions table
   */
  const renderUpcomingDistributions = () => {
    if (upcomingDistributions.length === 0) {
      return (
        <Card style={styles.upcomingCard}>
          <Text style={styles.emptyText}>
            {t('no_upcoming_distributions')}
          </Text>
        </Card>
      );
    }

    return (
      <View style={styles.tableContainer}>
        {/* Table Header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>{t('date')}</Text>
          <Text style={[styles.tableHeaderText, styles.timeColumn]}>{t('time')}</Text>
          <Text style={[styles.tableHeaderText, styles.participantColumn]}>
            {t('participants')}
          </Text>
          <Text style={[styles.tableHeaderText, styles.medicationColumn]}>
            {t('medications')}
          </Text>
          <Text style={[styles.tableHeaderText, styles.doseColumn]}>
            {t('default_dose')}
          </Text>
          <Text style={[styles.tableHeaderText, styles.frequencyColumn]}>
            {t('frequency')}
          </Text>
        </View>

        {/* Table Rows */}
        {upcomingDistributions.map((dist) => (
          <View key={dist.id} style={styles.tableRow}>
            <Text style={[styles.tableCell, styles.dateColumn]}>
              {formatDayLabel(dist.scheduled_for)}
            </Text>
            <Text style={[styles.tableCell, styles.timeColumn]}>
              {formatScheduledTime(dist.scheduled_for)}
            </Text>
            <Text style={[styles.tableCell, styles.participantColumn]}>
              {getParticipantName(dist.participant_id)}
            </Text>
            <Text style={[styles.tableCell, styles.medicationColumn]}>
              {dist.medication_name || '-'}
            </Text>
            <Text style={[styles.tableCell, styles.doseColumn]}>
              {dist.dose_amount ? `${dist.dose_amount} ${dist.dose_unit || ''}` : '-'}
            </Text>
            <Text style={[styles.tableCell, styles.frequencyColumn]}>
              {dist.frequency_text || '-'}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  /**
   * Render confirmation modal
   */
  const renderConfirmModal = () => {
    if (!selectedDistribution) return null;

    const participantName = getParticipantName(selectedDistribution.participant_id);

    return (
      <Modal
        visible={showConfirmModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {t('medication_give_confirmation')}
            </Text>

            {/* Participant */}
            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>{participantName}</Text>
            </View>

            {/* Medication */}
            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabelBold}>
                {t('medications')}:
              </Text>
              <Text style={styles.modalFieldValue}>
                {selectedDistribution.medication_name}
              </Text>
            </View>

            {/* Dosage */}
            {selectedDistribution.dose_amount && (
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabelBold}>
                  {t('dosage_instructions')}:
                </Text>
                <Text style={styles.modalFieldValue}>
                  {selectedDistribution.dose_amount}{selectedDistribution.dose_unit || ''}
                </Text>
              </View>
            )}

            {/* Route */}
            {selectedDistribution.route && (
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabelBold}>
                  {t('route_of_administration')}:
                </Text>
                <Text style={styles.modalFieldValue}>
                  {selectedDistribution.route}
                </Text>
              </View>
            )}

            {/* Time */}
            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabelBold}>
                {t('time')}:
              </Text>
              <Text style={styles.modalFieldValue}>
                {formatScheduledTime(selectedDistribution.scheduled_for)}
              </Text>
            </View>

            {/* Witness */}
            <View style={styles.modalInputField}>
              <Text style={styles.modalInputLabel}>
                {t('medication_witness_label')}
              </Text>
              <TextInput
                style={styles.modalInput}
                value={witnessName}
                onChangeText={setWitnessName}
                placeholder=""
                autoFocus
              />
            </View>

            {/* Optional Notes */}
            <View style={styles.modalInputField}>
              <Text style={styles.modalInputLabel}>
                {t('medication_optional_notes')}
              </Text>
              <TextInput
                style={[styles.modalInput, styles.modalInputMultiline]}
                value={optionalNotes}
                onChangeText={setOptionalNotes}
                placeholder=""
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setShowConfirmModal(false)}
                disabled={processing}
              >
                <Text style={styles.modalButtonTextCancel}>
                  {t('cancel')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonConfirm]}
                onPress={handleConfirmAdministration}
                disabled={processing}
              >
                <Text style={styles.modalButtonTextConfirm}>
                  {processing
                    ? t('loading')
                    : t('medication_confirm_given')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >


        {/* Subtitle */}
        <View style={styles.subtitleContainer}>
          <Text style={styles.subtitle}>
            {t('medication_distribution_subtitle')}
          </Text>
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <ErrorMessage message={error} onRetry={loadData} />
          </View>
        )}

        {/* Toggle Options */}
        <Card style={styles.toggleCard}>
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              {t('group_participants_same_time')}
            </Text>
            <Switch
              value={groupParticipantsBySameTime}
              onValueChange={setGroupParticipantsBySameTime}
              trackColor={{ false: theme.colors.borderLight, true: theme.colors.primary }}
              thumbColor={theme.colors.surface}
            />
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              {t('medication_switch_to_planning')}
            </Text>
            <Switch
              value={goToPlanning}
              onValueChange={(value) => {
                setGoToPlanning(value);
                if (value) {
                  navigateToPlanning();
                }
              }}
              trackColor={{ false: theme.colors.borderLight, true: theme.colors.primary }}
              thumbColor={theme.colors.surface}
            />
          </View>
        </Card>

        {/* Upcoming Alerts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('upcoming_medication_alerts')}
          </Text>
          {renderUpcomingAlerts()}
        </View>

        {/* Participants Ready */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('participants_ready_for_medications')}
          </Text>
          <Text style={styles.sectionSubtitle}>
            {t('tap_participant_to_distribute')}
          </Text>
          {renderParticipantsReady()}
        </View>

        {/* Upcoming Distributions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('upcoming_distributions')}
          </Text>
          {renderUpcomingDistributions()}
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>

      {/* Confirmation Modal */}
      {renderConfirmModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  backButton: {
    marginBottom: theme.spacing.sm,
  },
  backButtonText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.medium,
  },
  title: {
    ...commonStyles.heading1,
    color: theme.colors.text,
  },
  subtitleContainer: {
    padding: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    fontStyle: 'italic',
  },
  errorContainer: {
    padding: theme.spacing.lg,
  },
  toggleCard: {
    margin: theme.spacing.lg,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  toggleLabel: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    marginRight: theme.spacing.md,
  },
  section: {
    padding: theme.spacing.lg,
  },
  sectionTitle: {
    ...commonStyles.heading2,
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  sectionSubtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.md,
    fontStyle: 'italic',
  },
  alertCard: {
    marginBottom: theme.spacing.md,
    backgroundColor: theme.colors.warningLight || '#fff9e6',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.xs,
  },
  alertTime: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  alertDay: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
  },
  alertParticipant: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  alertMedication: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  alertDose: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  readyCard: {
    marginBottom: theme.spacing.md,
  },
  readyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  readyParticipant: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  readyCount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  medicationItem: {
    marginBottom: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  medicationInfo: {
    marginBottom: theme.spacing.sm,
  },
  medicationName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  medicationDose: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  medicationTimeRow: {
    flexDirection: 'row',
    marginTop: theme.spacing.xs,
  },
  medicationTimeLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    fontWeight: theme.fontWeight.medium,
  },
  medicationTime: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    fontWeight: theme.fontWeight.medium,
    marginLeft: theme.spacing.xs,
  },
  giveNowButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  giveNowText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  tableContainer: {
    marginTop: theme.spacing.md,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: theme.colors.secondary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
  },
  tableHeaderText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  tableCell: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.text,
  },
  dateColumn: {
    flex: 2,
  },
  timeColumn: {
    flex: 1,
  },
  participantColumn: {
    flex: 2,
  },
  medicationColumn: {
    flex: 2,
  },
  doseColumn: {
    flex: 1.5,
  },
  frequencyColumn: {
    flex: 1,
  },
  upcomingCard: {
    marginTop: theme.spacing.md,
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
    fontStyle: 'italic',
    textAlign: 'center',
    padding: theme.spacing.md,
  },
  bottomSpacing: {
    height: theme.spacing.xl,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    width: '100%',
    maxWidth: 500,
    ...theme.shadows.lg,
  },
  modalTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.lg,
  },
  modalField: {
    marginBottom: theme.spacing.sm,
  },
  modalFieldLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  modalFieldLabelBold: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.semibold,
  },
  modalFieldValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    marginTop: theme.spacing.xs,
  },
  modalInputField: {
    marginTop: theme.spacing.md,
  },
  modalInputLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  modalInput: {
    ...commonStyles.input,
    marginBottom: 0,
  },
  modalInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  modalButton: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  modalButtonCancel: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  modalButtonConfirm: {
    backgroundColor: theme.colors.primary,
  },
  modalButtonTextCancel: {
    color: theme.colors.text,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  modalButtonTextConfirm: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
});

export default MedicationDistributionScreen;