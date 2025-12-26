/**
 * MedicationScreen
 *
 * Mirrors spa/medication_management.js for leaders.
 * Supports medication planning and dispensing with alerts.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import {
  getMedicationRequirements,
  getParticipantMedications,
  getMedicationDistributions,
  getParticipants,
  getFicheMedications,
  saveMedicationRequirement,
  recordMedicationDistribution,
  markMedicationDistributionAsGiven,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import theme, { commonStyles } from '../theme';
import { debugError } from '../utils/DebugUtils';

const TABS = {
  PLANNING: 'planning',
  DISPENSING: 'dispensing',
};

const MedicationScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState(TABS.PLANNING);
  const [requirements, setRequirements] = useState([]);
  const [participantMedications, setParticipantMedications] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [editingRequirement, setEditingRequirement] = useState(null);
  const [requirementForm, setRequirementForm] = useState({
    medication_name: '',
    dosage_instructions: '',
    frequency_text: '',
    route: '',
    general_notes: '',
    start_date: '',
    end_date: '',
    participant_id: '',
  });
  const [distributionForm, setDistributionForm] = useState({
    medication_requirement_id: '',
    scheduled_for: '',
    activity_name: '',
    dose_amount: '',
    dose_unit: '',
    dose_notes: '',
  });
  const [witnessNames, setWitnessNames] = useState({});
  const [saving, setSaving] = useState(false);

  const requirementOptions = useMemo(() => {
    return requirements.map((requirement) => ({
      id: requirement.id,
      label: requirement.medication_name,
    }));
  }, [requirements]);

  /**
   * Load medication data for planning and dispensing.
   */
  const loadMedicationData = async () => {
    try {
      setError('');
      const [
        requirementsResponse,
        assignmentsResponse,
        distributionsResponse,
        participantsResponse,
        suggestionsResponse,
      ] = await Promise.all([
        getMedicationRequirements(),
        getParticipantMedications(),
        getMedicationDistributions({ upcoming_only: true }),
        getParticipants(),
        getFicheMedications(),
      ]);

      setRequirements(
        requirementsResponse.success ? requirementsResponse.data?.requirements || [] : []
      );
      setParticipantMedications(
        assignmentsResponse.success
          ? assignmentsResponse.data?.participant_medications || []
          : []
      );
      setDistributions(
        distributionsResponse.success ? distributionsResponse.data?.distributions || [] : []
      );
      setParticipants(
        participantsResponse.success ? participantsResponse.data || [] : []
      );
      setSuggestions(
        suggestionsResponse.success ? suggestionsResponse.data?.medications || [] : []
      );
    } catch (err) {
      debugError('Error loading medication data:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMedicationData();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMedicationData();
    setRefreshing(false);
  };

  const handleSelectRequirement = (requirement) => {
    setEditingRequirement(requirement);
    setRequirementForm({
      medication_name: requirement.medication_name || '',
      dosage_instructions: requirement.dosage_instructions || '',
      frequency_text: requirement.frequency_text || '',
      route: requirement.route || '',
      general_notes: requirement.general_notes || '',
      start_date: requirement.start_date || '',
      end_date: requirement.end_date || '',
      participant_id: participantMedications.find(
        (assignment) => assignment.medication_requirement_id === requirement.id
      )?.participant_id || '',
    });
  };

  const handleSaveRequirement = async () => {
    setSaving(true);
    try {
      const payload = {
        id: editingRequirement?.id,
        medication_name: SecurityUtils.sanitizeInput(requirementForm.medication_name),
        dosage_instructions: SecurityUtils.sanitizeInput(requirementForm.dosage_instructions),
        frequency_text: SecurityUtils.sanitizeInput(requirementForm.frequency_text),
        route: SecurityUtils.sanitizeInput(requirementForm.route),
        general_notes: SecurityUtils.sanitizeInput(requirementForm.general_notes),
        start_date: SecurityUtils.sanitizeInput(requirementForm.start_date),
        end_date: SecurityUtils.sanitizeInput(requirementForm.end_date),
        participant_ids: [Number(requirementForm.participant_id)],
      };

      const response = await saveMedicationRequirement(payload);
      if (!response.success) {
        throw new Error(response.message || t('error_loading_data'));
      }

      setEditingRequirement(null);
      setRequirementForm({
        medication_name: '',
        dosage_instructions: '',
        frequency_text: '',
        route: '',
        general_notes: '',
        start_date: '',
        end_date: '',
        participant_id: '',
      });
      await loadMedicationData();
    } catch (err) {
      debugError('Error saving medication requirement:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setSaving(false);
    }
  };

  const handleScheduleDistribution = async () => {
    setSaving(true);
    try {
      const assignment = participantMedications.find(
        (item) =>
          item.medication_requirement_id ===
          Number(distributionForm.medication_requirement_id)
      );

      if (!assignment?.participant_id) {
        throw new Error(t('medication_distribution_fields_missing'));
      }

      const payload = {
        medication_requirement_id: Number(distributionForm.medication_requirement_id),
        participant_ids: [
          Number(assignment.participant_id),
        ],
        scheduled_for: SecurityUtils.sanitizeInput(distributionForm.scheduled_for),
        activity_name: SecurityUtils.sanitizeInput(distributionForm.activity_name),
        dose_amount: SecurityUtils.sanitizeNumber(distributionForm.dose_amount, true),
        dose_unit: SecurityUtils.sanitizeInput(distributionForm.dose_unit),
        dose_notes: SecurityUtils.sanitizeInput(distributionForm.dose_notes),
      };

      const response = await recordMedicationDistribution(payload);
      if (!response.success) {
        throw new Error(response.message || t('medication_distribution_fields_missing'));
      }

      setDistributionForm({
        medication_requirement_id: '',
        scheduled_for: '',
        activity_name: '',
        dose_amount: '',
        dose_unit: '',
        dose_notes: '',
      });
      await loadMedicationData();
    } catch (err) {
      debugError('Error scheduling distribution:', err);
      setError(err.message || t('medication_distribution_fields_missing'));
    } finally {
      setSaving(false);
    }
  };

  const handleMarkGiven = async (distributionId) => {
    setSaving(true);
    try {
      const response = await markMedicationDistributionAsGiven(distributionId, {
        status: 'given',
        administered_at: new Date().toISOString(),
        witness_name: SecurityUtils.sanitizeInput(witnessNames[distributionId] || ''),
      });

      if (!response.success) {
        throw new Error(response.message || t('medication_mark_given'));
      }

      await loadMedicationData();
    } catch (err) {
      debugError('Error marking medication given:', err);
      setError(err.message || t('medication_mark_given'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadMedicationData} />;
  }

  return (
    <ScrollView
      style={commonStyles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('medication_management_title')}</Text>
        <Text style={styles.subtitle}>{t('medication_management_description')}</Text>
      </View>

      <View style={styles.tabRow}>
        <Button
          title={t('medication_planning_tab')}
          variant={activeTab === TABS.PLANNING ? 'primary' : 'secondary'}
          onPress={() => setActiveTab(TABS.PLANNING)}
          style={styles.tabButton}
        />
        <Button
          title={t('medication_dispensing_tab')}
          variant={activeTab === TABS.DISPENSING ? 'primary' : 'secondary'}
          onPress={() => setActiveTab(TABS.DISPENSING)}
          style={styles.tabButton}
        />
      </View>

      {activeTab === TABS.PLANNING ? (
        <View style={styles.section}>
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('medication_requirement_form_title')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('medication_name_label')}
              value={requirementForm.medication_name}
              onChangeText={(value) =>
                setRequirementForm((prev) => ({ ...prev, medication_name: value }))
              }
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.suggestionRow}>
                {suggestions.map((name) => (
                  <TouchableOpacity
                    key={`suggestion-${name}`}
                    style={styles.suggestionChip}
                    onPress={() =>
                      setRequirementForm((prev) => ({ ...prev, medication_name: name }))
                    }
                  >
                    <Text style={styles.suggestionText}>{name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder={t('medication_dosage_label')}
              value={requirementForm.dosage_instructions}
              onChangeText={(value) =>
                setRequirementForm((prev) => ({ ...prev, dosage_instructions: value }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder={t('medication_frequency')}
              value={requirementForm.frequency_text}
              onChangeText={(value) =>
                setRequirementForm((prev) => ({ ...prev, frequency_text: value }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder={t('medication_route_label')}
              value={requirementForm.route}
              onChangeText={(value) =>
                setRequirementForm((prev) => ({ ...prev, route: value }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder={t('medication_start_date_label')}
              value={requirementForm.start_date}
              onChangeText={(value) =>
                setRequirementForm((prev) => ({ ...prev, start_date: value }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder={t('medication_end_date_label')}
              value={requirementForm.end_date}
              onChangeText={(value) =>
                setRequirementForm((prev) => ({ ...prev, end_date: value }))
              }
            />
            <Text style={styles.sectionTitle}>{t('select_participant')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.participantRow}>
                {participants.map((participant) => (
                  <TouchableOpacity
                    key={`participant-${participant.id}`}
                    style={[
                      styles.participantChip,
                      Number(requirementForm.participant_id) === participant.id &&
                        styles.participantChipActive,
                    ]}
                    onPress={() =>
                      setRequirementForm((prev) => ({
                        ...prev,
                        participant_id: String(participant.id),
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.participantText,
                        Number(requirementForm.participant_id) === participant.id &&
                          styles.participantTextActive,
                      ]}
                    >
                      {participant.firstName || participant.first_name}{' '}
                      {participant.lastName || participant.last_name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder={t('medication_general_notes_label')}
              value={requirementForm.general_notes}
              onChangeText={(value) =>
                setRequirementForm((prev) => ({ ...prev, general_notes: value }))
              }
              multiline
            />
            <Button title={t('medication_save_requirement')} onPress={handleSaveRequirement} />
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('medication_existing_requirements_title')}</Text>
            {requirements.length === 0 ? (
              <Text style={styles.emptyText}>{t('medication_requirements_empty')}</Text>
            ) : (
              requirements.map((requirement) => (
                <TouchableOpacity
                  key={`requirement-${requirement.id}`}
                  onPress={() => handleSelectRequirement(requirement)}
                  style={styles.requirementRow}
                >
                  <Text style={styles.requirementName}>{requirement.medication_name}</Text>
                  <Text style={styles.captionText}>
                    {requirement.frequency_text || t('medication_frequency')}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </Card>
        </View>
      ) : (
        <View style={styles.section}>
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('medication_schedule_section_title')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('medication_schedule_date')}
              value={distributionForm.scheduled_for}
              onChangeText={(value) =>
                setDistributionForm((prev) => ({ ...prev, scheduled_for: value }))
              }
            />
            <Text style={styles.sectionTitle}>{t('medication')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.requirementRow}>
                {requirementOptions.map((requirement) => (
                  <TouchableOpacity
                    key={`dist-${requirement.id}`}
                    style={[
                      styles.participantChip,
                      Number(distributionForm.medication_requirement_id) === requirement.id &&
                        styles.participantChipActive,
                    ]}
                    onPress={() =>
                      setDistributionForm((prev) => ({
                        ...prev,
                        medication_requirement_id: String(requirement.id),
                      }))
                    }
                  >
                    <Text
                      style={[
                        styles.participantText,
                        Number(distributionForm.medication_requirement_id) === requirement.id &&
                          styles.participantTextActive,
                      ]}
                    >
                      {requirement.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder={t('medication_schedule_activity')}
              value={distributionForm.activity_name}
              onChangeText={(value) =>
                setDistributionForm((prev) => ({ ...prev, activity_name: value }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder={t('medication_default_dose')}
              value={distributionForm.dose_amount}
              onChangeText={(value) =>
                setDistributionForm((prev) => ({ ...prev, dose_amount: value }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder={t('medication_default_frequency')}
              value={distributionForm.dose_unit}
              onChangeText={(value) =>
                setDistributionForm((prev) => ({ ...prev, dose_unit: value }))
              }
            />
            <TextInput
              style={styles.input}
              placeholder={t('medication_schedule_notes')}
              value={distributionForm.dose_notes}
              onChangeText={(value) =>
                setDistributionForm((prev) => ({ ...prev, dose_notes: value }))
              }
            />
            <Button title={t('medication_schedule_button')} onPress={handleScheduleDistribution} />
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('medication_alerts_heading')}</Text>
            {distributions.length === 0 ? (
              <Text style={styles.emptyText}>{t('medication_alerts_empty')}</Text>
            ) : (
              distributions.map((distribution) => (
                <View key={`dist-${distribution.id}`} style={styles.alertRow}>
                  <Text style={styles.requirementName}>
                    {DateUtils.formatDateTime(distribution.scheduled_for)}
                  </Text>
                  <Text style={styles.captionText}>
                    {t('medication_default_dose')}: {distribution.dose_amount || '-'}{' '}
                    {distribution.dose_unit || ''}
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t('medication_witness_label')}
                    value={witnessNames[distribution.id] || ''}
                    onChangeText={(value) =>
                      setWitnessNames((prev) => ({ ...prev, [distribution.id]: value }))
                    }
                  />
                  <Button
                    title={t('medication_mark_given')}
                    onPress={() => handleMarkGiven(distribution.id)}
                    disabled={saving}
                  />
                </View>
              ))
            )}
          </Card>
        </View>
      )}
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
  tabRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  tabButton: {
    flex: 1,
  },
  section: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    ...commonStyles.sectionTitle,
    marginBottom: theme.spacing.sm,
  },
  input: {
    ...commonStyles.input,
    marginBottom: theme.spacing.sm,
  },
  multilineInput: {
    minHeight: theme.spacing.xxl,
  },
  suggestionRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  suggestionChip: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.secondary,
  },
  suggestionText: {
    ...commonStyles.caption,
  },
  participantRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  participantChip: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  participantChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  participantText: {
    ...commonStyles.caption,
  },
  participantTextActive: {
    color: theme.colors.surface,
  },
  requirementRow: {
    marginBottom: theme.spacing.sm,
  },
  requirementName: {
    ...commonStyles.heading3,
  },
  captionText: {
    ...commonStyles.caption,
  },
  emptyText: {
    ...commonStyles.bodyText,
    textAlign: 'center',
  },
  alertRow: {
    marginBottom: theme.spacing.lg,
  },
});

export default MedicationScreen;
