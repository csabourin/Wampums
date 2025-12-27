/**
 * MedicationDistributionScreen
 *
 * Medication distribution interface for managing and tracking medication administration
 * Mirrors the web interface for "Distribution des médicaments" (Medication Distribution)
 *
 * Features:
 * - View upcoming medication alerts
 * - See participants ready for medication
 * - Record medication administration with witness tracking
 * - View upcoming distributions
 * - Toggle options for grouping and planning
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Switch,
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);

  // Data
  const [upcomingAlerts, setUpcomingAlerts] = useState([]);
  const [participantsReady, setParticipantsReady] = useState([]);
  const [upcomingDistributions, setUpcomingDistributions] = useState([]);
  const [participants, setParticipants] = useState([]);

  // Toggle options
  const [groupParticipantsBySameTime, setGroupParticipantsBySameTime] = useState(false);
  const [goToPlanning, setGoToPlanning] = useState(false);

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
    loadData();
  }, []);

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

    if (isToday) return t('today') || 'Aujourd\'hui';
    if (isTomorrow) return t('tomorrow') || 'Demain';

    return DateUtils.formatDate(scheduledFor, 'fr'); // Use locale from user settings
  };

  /**
   * Handle marking medication as given
   */
  const handleMarkAsGiven = (distribution) => {
    Alert.alert(
      t('confirm_distribution') || 'Confirmer la distribution',
      t('confirm_give_medication') || 'Marquer ce médicament comme donné ?',
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('confirm') || 'Confirmer',
          onPress: async () => {
            setProcessing(true);
            try {
              const response = await markMedicationDistributionAsGiven(distribution.id, {
                status: 'given',
                administered_at: new Date().toISOString(),
                witness_name: '', // Can be extended to collect witness name
              });

              if (!response.success) {
                throw new Error(response.message || t('error_marking_given'));
              }

              Alert.alert(
                t('success'),
                t('medication_marked_given') || 'Médicament marqué comme donné',
                [{ text: t('ok'), onPress: loadData }]
              );
            } catch (err) {
              debugError('Error marking medication as given:', err);
              Alert.alert(t('error'), err.message || t('error_marking_given'));
            } finally {
              setProcessing(false);
            }
          },
        },
      ]
    );
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
            {t('no_upcoming_alerts') || 'Aucune médication prévue dans les 90 prochaines minutes.'}
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
            {t('no_participants_ready') || 'Aucun participant prêt pour les médicaments.'}
          </Text>
        </Card>
      );
    }

    // Group by participant if needed
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
                  {distributions.length} {t('medications') || 'Médicaments'}
                </Text>
              </View>

              {distributions.map((dist) => (
                <View key={dist.id} style={styles.medicationItem}>
                  <View style={styles.medicationInfo}>
                    <Text style={styles.medicationName}>
                      {dist.medication_name || t('unknown_medication')}
                    </Text>
                    {dist.dose_amount && (
                      <Text style={styles.medicationDose}>
                        {dist.dose_amount}{dist.dose_unit ? ` ${dist.dose_unit}` : ''} - {dist.route || t('oral')}
                      </Text>
                    )}
                    {dist.scheduled_for && (
                      <Text style={styles.medicationTime}>
                        ⏰ {t('administration_time') || 'Heures d\'administration'}:{' '}
                        {formatScheduledTime(dist.scheduled_for)} ({formatDayLabel(dist.scheduled_for)})
                      </Text>
                    )}
                  </View>

                  <Button
                    title={t('give_now') || 'Donner maintenant'}
                    onPress={() => handleMarkAsGiven(dist)}
                    variant="success"
                    size="small"
                    disabled={processing}
                  />
                </View>
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
            {t('no_upcoming_distributions') || 'Aucune médication prévue dans les 90 prochaines minutes.'}
          </Text>
        </Card>
      );
    }

    return (
      <View style={styles.tableContainer}>
        {/* Table Header */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>{t('date') || 'Date'}</Text>
          <Text style={[styles.tableHeaderText, styles.timeColumn]}>{t('time') || 'time'}</Text>
          <Text style={[styles.tableHeaderText, styles.participantColumn]}>
            {t('participants') || 'Participants'}
          </Text>
          <Text style={[styles.tableHeaderText, styles.medicationColumn]}>
            {t('medications') || 'Médicaments'}
          </Text>
          <Text style={[styles.tableHeaderText, styles.doseColumn]}>
            {t('default_dose') || 'Dose par défaut'}
          </Text>
          <Text style={[styles.tableHeaderText, styles.frequencyColumn]}>
            {t('frequency') || 'Fréq.'}
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

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backButtonText}>← {t('back') || 'Retour'}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>
            {t('medication_distribution_title') || 'Distribution des médicaments'}
          </Text>
        </View>

        {/* Subtitle */}
        <View style={styles.subtitleContainer}>
          <Text style={styles.subtitle}>
            {t('medication_distribution_subtitle') ||
              'Saisissez les distributions, marquez les prises et surveillez les alertes.'}
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
              {t('group_participants_same_time') ||
                'Une seule alerte regroupe les participants au même horaire.'}
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
              {t('go_to_planning') || 'Aller à la planification'}
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
            {t('upcoming_medication_alerts') || 'Alertes de médication à venir'}
          </Text>
          {renderUpcomingAlerts()}
        </View>

        {/* Participants Ready */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('participants_ready_for_medications') ||
              'Participants prêts pour les médicaments'}
          </Text>
          <Text style={styles.sectionSubtitle}>
            {t('tap_participant_to_distribute') ||
              'Appuyez sur un participant pour voir et distribuer ses médicaments'}
          </Text>
          {renderParticipantsReady()}
        </View>

        {/* Upcoming Distributions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {t('upcoming_distributions') || 'Distributions à venir'}
          </Text>
          {renderUpcomingDistributions()}
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
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
  medicationTime: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.error,
    marginTop: theme.spacing.xs,
    fontWeight: theme.fontWeight.medium,
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
});

export default MedicationDistributionScreen;
