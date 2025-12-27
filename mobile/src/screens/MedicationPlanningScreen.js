/**
 * MedicationPlanningScreen
 *
 * Medication planning interface for managing medication requirements
 * Mirrors the web interface for "Besoins en médication" (Medication Needs)
 *
 * Features:
 * - Participant-first design with auto-fill from fiche santé
 * - Create and manage medication requirements
 * - Time-based scheduling with multiple administration times
 * - View all planned medications
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';

// API and utilities
import {
  getMedicationRequirements,
  getParticipants,
  getFicheMedications,
  saveMedicationRequirement,
  deleteMedicationRequirement,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { debugLog, debugError } from '../utils/DebugUtils';

// Components
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import theme, { commonStyles } from '../theme';

// Picker component (cross-platform)
const Picker = Platform.OS === 'ios'
  ? require('@react-native-picker/picker').Picker
  : require('@react-native-picker/picker').Picker;

/**
 * MedicationPlanningScreen Component
 */
const MedicationPlanningScreen = () => {
  const navigation = useNavigation();

  // State
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Data
  const [requirements, setRequirements] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [suggestions, setSuggestions] = useState([]);

  // Form state - participant FIRST
  const [selectedParticipantId, setSelectedParticipantId] = useState('');
  const [medicationName, setMedicationName] = useState('');
  const [dosageInstructions, setDosageInstructions] = useState('');
  const [frequency, setFrequency] = useState('custom');
  const [administrationTimes, setAdministrationTimes] = useState([
    new Date(2000, 0, 1, 8, 0), // 08:00 AM
    new Date(2000, 0, 1, 12, 0), // 12:00 PM
    new Date(2000, 0, 1, 20, 0), // 08:00 PM
  ]);
  const [showTimePicker, setShowTimePicker] = useState({ visible: false, index: 0 });
  const [route, setRoute] = useState('');
  const [defaultDose, setDefaultDose] = useState('');
  const [doseUnit, setDoseUnit] = useState('mg');
  const [generalNotes, setGeneralNotes] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startDateOptional, setStartDateOptional] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endDateOptional, setEndDateOptional] = useState('');

  /**
   * Load all medication planning data
   */
  const loadData = async () => {
    try {
      setError('');

      const [
        requirementsResponse,
        participantsResponse,
        suggestionsResponse,
      ] = await Promise.all([
        getMedicationRequirements(),
        getParticipants(),
        getFicheMedications(),
      ]);

      if (requirementsResponse.success) {
        setRequirements(requirementsResponse.data?.requirements || []);
      }

      if (participantsResponse.success) {
        setParticipants(participantsResponse.data || []);
      }

      if (suggestionsResponse.success) {
        setSuggestions(suggestionsResponse.data?.medications || []);
      }
    } catch (err) {
      debugError('Error loading medication planning data:', err);
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
   * Handle participant selection and auto-fill from fiche santé
   */
  const handleParticipantChange = async (participantId) => {
    setSelectedParticipantId(participantId);

    if (!participantId) {
      // Clear form if no participant selected
      setMedicationName('');
      return;
    }

    // Auto-fill medication from suggestions if available
    // Note: In a full implementation, we would fetch the participant's specific
    // fiche_sante data. For now, we'll suggest from the global list.
    if (suggestions.length > 0) {
      // Could filter suggestions by participant if we had that data
      // For now, just suggest the first medication
      debugLog('Participant selected:', participantId);
      debugLog('Available medication suggestions:', suggestions);
    }
  };

  /**
   * Handle pull-to-refresh
   */
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  /**
   * Handle time picker change
   */
  const onTimeChange = (event, selectedTime) => {
    if (Platform.OS === 'android') {
      setShowTimePicker({ visible: false, index: 0 });
    }

    if (selectedTime && showTimePicker.index !== null) {
      const newTimes = [...administrationTimes];
      newTimes[showTimePicker.index] = selectedTime;
      setAdministrationTimes(newTimes);
    }
  };

  /**
   * Add a new administration time
   */
  const addAdministrationTime = () => {
    if (administrationTimes.length < 5) {
      setAdministrationTimes([...administrationTimes, new Date(2000, 0, 1, 12, 0)]);
    }
  };

  /**
   * Remove an administration time
   */
  const removeAdministrationTime = (index) => {
    if (administrationTimes.length > 1) {
      setAdministrationTimes(administrationTimes.filter((_, i) => i !== index));
    }
  };

  /**
   * Format time for display
   */
  const formatTime = (date) => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  /**
   * Reset form to empty state
   */
  const resetForm = () => {
    setSelectedParticipantId('');
    setMedicationName('');
    setDosageInstructions('');
    setFrequency('custom');
    setAdministrationTimes([
      new Date(2000, 0, 1, 8, 0),
      new Date(2000, 0, 1, 12, 0),
      new Date(2000, 0, 1, 20, 0),
    ]);
    setRoute('');
    setDefaultDose('');
    setDoseUnit('mg');
    setGeneralNotes('');
    setStartDate('');
    setStartDateOptional('');
    setEndDate('');
    setEndDateOptional('');
  };

  /**
   * Validate form before submission
   */
  const validateForm = () => {
    if (!selectedParticipantId) {
      Alert.alert(t('error'), t('participant_required') || 'Please select a participant');
      return false;
    }

    if (!medicationName.trim()) {
      Alert.alert(t('error'), t('medication_name_required') || 'Medication name is required');
      return false;
    }

    return true;
  };

  /**
   * Save medication requirement
   */
  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    setError('');

    try {
      // Prepare administration times in HH:MM format
      const times = administrationTimes.map(formatTime);

      const payload = {
        medication_name: SecurityUtils.sanitizeInput(medicationName),
        dosage_instructions: SecurityUtils.sanitizeInput(dosageInstructions),
        frequency_text: SecurityUtils.sanitizeInput(frequency),
        administration_times: times,
        route: SecurityUtils.sanitizeInput(route),
        default_dose: SecurityUtils.sanitizeInput(defaultDose),
        dose_unit: SecurityUtils.sanitizeInput(doseUnit),
        general_notes: SecurityUtils.sanitizeInput(generalNotes),
        start_date: SecurityUtils.sanitizeInput(startDate),
        start_date_optional: SecurityUtils.sanitizeInput(startDateOptional),
        end_date: SecurityUtils.sanitizeInput(endDate),
        end_date_optional: SecurityUtils.sanitizeInput(endDateOptional),
        participant_ids: [Number(selectedParticipantId)],
      };

      debugLog('Saving medication requirement:', payload);

      const response = await saveMedicationRequirement(payload);

      if (!response.success) {
        throw new Error(response.message || t('error_saving_data'));
      }

      Alert.alert(
        t('success'),
        t('medication_saved_successfully') || 'Medication saved successfully',
        [{ text: t('ok'), onPress: () => {
          resetForm();
          loadData();
        }}]
      );
    } catch (err) {
      debugError('Error saving medication requirement:', err);
      Alert.alert(t('error'), err.message || t('error_saving_data'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Navigate to distribution screen
   */
  const navigateToDistribution = () => {
    navigation.navigate('MedicationDistribution');
  };

  /**
   * Render planned medications list
   */
  const renderPlannedMedications = () => {
    if (!requirements || requirements.length === 0) {
      return (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            {t('no_planned_medications') || 'Aucune médication planifiée'}
          </Text>
        </Card>
      );
    }

    return (
      <View>
        <Text style={styles.sectionTitle}>
          {t('planned_medications_title') || 'Médicaments planifiés'}
        </Text>
        {requirements.map((req) => {
          const participant = participants.find(p =>
            req.participant_ids?.includes(p.id)
          );

          return (
            <Card key={req.id} style={styles.medicationCard}>
              <View style={styles.medicationHeader}>
                <Text style={styles.medicationName}>{req.medication_name}</Text>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      t('delete'),
                      t('confirm_delete_medication') || 'Delete this medication?',
                      [
                        { text: t('cancel'), style: 'cancel' },
                        {
                          text: t('delete'),
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await deleteMedicationRequirement(req.id);
                              loadData();
                            } catch (err) {
                              debugError('Error deleting requirement:', err);
                            }
                          },
                        },
                      ]
                    );
                  }}
                >
                  <Text style={styles.deleteButton}>✕</Text>
                </TouchableOpacity>
              </View>

              {participant && (
                <Text style={styles.medicationDetail}>
                  {t('participant')}: {participant.first_name} {participant.last_name}
                </Text>
              )}

              {req.dosage_instructions && (
                <Text style={styles.medicationDetail}>
                  {t('dosage')}: {req.dosage_instructions}
                </Text>
              )}

              {req.frequency_text && (
                <Text style={styles.medicationDetail}>
                  {t('frequency')}: {req.frequency_text}
                </Text>
              )}

              {req.route && (
                <Text style={styles.medicationDetail}>
                  {t('route')}: {req.route}
                </Text>
              )}
            </Card>
          );
        })}
      </View>
    );
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <ScrollView
      style={commonStyles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {t('medication_planning_title') || 'Besoins en médication'}
        </Text>
        <Button
          title={t('view_distribution') || 'Voir la distribution'}
          onPress={navigateToDistribution}
          variant="secondary"
          size="small"
        />
      </View>

      {error && (
        <View style={styles.errorContainer}>
          <ErrorMessage message={error} onRetry={loadData} />
        </View>
      )}

      {/* Form */}
      <Card style={styles.formCard}>
        {/* Participant Selection - FIRST FIELD */}
        <Text style={styles.label}>
          {t('assign_participant') || 'Assigner des participants'} *
        </Text>
        <Text style={styles.helpText}>
          {t('one_participant_per_medication') || 'Choisissez un seul participant par médicament.'}
        </Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={selectedParticipantId}
            onValueChange={handleParticipantChange}
            style={styles.picker}
          >
            <Picker.Item label={t('select_participant') || 'Sélectionner un participant'} value="" />
            {participants.map((participant) => (
              <Picker.Item
                key={participant.id}
                label={`${participant.first_name} ${participant.last_name}`}
                value={participant.id.toString()}
              />
            ))}
          </Picker>
        </View>

        {/* Medication Name */}
        <Text style={styles.label}>{t('medication_name') || 'Nom du médicament'} *</Text>
        {suggestions.length > 0 && (
          <Text style={styles.helpText}>
            {t('medication_suggestions_label') || 'Suggestions tirées des fiches santé soumises'}
          </Text>
        )}
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={medicationName}
            onValueChange={setMedicationName}
            style={styles.picker}
            enabled={!!selectedParticipantId}
          >
            <Picker.Item label={t('medication_name_placeholder') || 'Entrez le nom du médicament'} value="" />
            {suggestions.map((name, index) => (
              <Picker.Item
                key={`suggestion-${index}`}
                label={name}
                value={name}
              />
            ))}
            <Picker.Item label={t('other') || 'Autre (saisir manuellement)'} value="__custom__" />
          </Picker>
        </View>

        {/* If "other" selected, show text input */}
        {medicationName === '__custom__' && (
          <TextInput
            style={styles.input}
            value={''}
            onChangeText={(text) => setMedicationName(text)}
            placeholder={t('medication_name_placeholder') || 'Entrez le nom du médicament'}
            autoFocus
          />
        )}

        {/* Dosage Instructions */}
        <Text style={styles.label}>
          {t('dosage_instructions') || 'Instructions de dosage'}
        </Text>
        <TextInput
          style={styles.input}
          value={dosageInstructions}
          onChangeText={setDosageInstructions}
          placeholder={t('dosage_placeholder') || 'Dose'}
        />

        {/* Frequency */}
        <Text style={styles.label}>{t('frequency') || 'Fréquence'}</Text>
        <View style={styles.pickerContainer}>
          <Picker
            selectedValue={frequency}
            onValueChange={setFrequency}
            style={styles.picker}
          >
            <Picker.Item label={t('custom_times') || 'Moments de la journée'} value="custom" />
            <Picker.Item label={t('daily') || 'Quotidien'} value="daily" />
            <Picker.Item label={t('twice_daily') || 'Deux fois par jour'} value="twice_daily" />
            <Picker.Item label={t('three_times_daily') || 'Trois fois par jour'} value="three_times_daily" />
            <Picker.Item label={t('as_needed') || 'Au besoin'} value="as_needed" />
          </Picker>
        </View>

        {/* Administration Times */}
        <Text style={styles.label}>
          {t('administration_times') || 'Choisir les moments habituels'}
        </Text>
        <Text style={styles.helpText}>
          {t('add_up_to_times') || 'Ajoutez jusqu\'à cinq heures pour couvrir la journée.'}
        </Text>

        {administrationTimes.map((time, index) => (
          <View key={index} style={styles.timeRow}>
            <TouchableOpacity
              style={styles.timeButton}
              onPress={() => setShowTimePicker({ visible: true, index })}
            >
              <Text style={styles.timeText}>{formatTime(time)}</Text>
            </TouchableOpacity>

            {administrationTimes.length > 1 && (
              <TouchableOpacity
                style={styles.removeTimeButton}
                onPress={() => removeAdministrationTime(index)}
              >
                <Text style={styles.removeTimeText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {administrationTimes.length < 5 && (
          <Button
            title={t('add_time') || '+ Ajouter une heure'}
            onPress={addAdministrationTime}
            variant="secondary"
            size="small"
          />
        )}

        {showTimePicker.visible && (
          <DateTimePicker
            value={administrationTimes[showTimePicker.index] || new Date()}
            mode="time"
            is24Hour={true}
            display="default"
            onChange={onTimeChange}
          />
        )}

        {/* Route of Administration */}
        <Text style={styles.label}>
          {t('route_of_administration') || 'Voie d\'administration'}
        </Text>
        <TextInput
          style={styles.input}
          value={route}
          onChangeText={setRoute}
          placeholder={t('route_placeholder') || 'Ex: Orale, Topique, Inhalée'}
        />

        {/* Default Dose */}
        <Text style={styles.label}>{t('default_dose') || 'Dose par défaut'}</Text>
        <View style={styles.doseRow}>
          <TextInput
            style={[styles.input, styles.doseInput]}
            value={defaultDose}
            onChangeText={setDefaultDose}
            placeholder="0"
            keyboardType="numeric"
          />
          <View style={[styles.pickerContainer, { flex: 1 }]}>
            <Picker
              selectedValue={doseUnit}
              onValueChange={setDoseUnit}
              style={styles.picker}
            >
              <Picker.Item label="mg" value="mg" />
              <Picker.Item label="ml" value="ml" />
              <Picker.Item label="comprimé(s)" value="tablet" />
              <Picker.Item label="goutte(s)" value="drops" />
              <Picker.Item label="autre" value="other" />
            </Picker>
          </View>
        </View>

        {/* General Notes */}
        <Text style={styles.label}>{t('general_notes') || 'Notes générales'}</Text>
        <TextInput
          style={[styles.input, styles.multilineInput]}
          value={generalNotes}
          onChangeText={setGeneralNotes}
          placeholder={t('notes_placeholder') || 'Notes additionnelles'}
          multiline
          numberOfLines={4}
        />

        {/* Start Date */}
        <Text style={styles.label}>{t('start_date') || 'Date de début'}</Text>
        <TextInput
          style={styles.input}
          value={startDate}
          onChangeText={setStartDate}
          placeholder="yyyy-mm-dd"
        />

        <Text style={styles.label}>
          {t('start_date_optional') || 'Quand ce médicament devrait commencer (optionnel)'}
        </Text>
        <TextInput
          style={styles.input}
          value={startDateOptional}
          onChangeText={setStartDateOptional}
          placeholder={t('optional_note') || 'Note optionnelle'}
        />

        {/* End Date */}
        <Text style={styles.label}>{t('end_date') || 'Date de fin'}</Text>
        <TextInput
          style={styles.input}
          value={endDate}
          onChangeText={setEndDate}
          placeholder="yyyy-mm-dd"
        />

        <Text style={styles.label}>
          {t('end_date_optional') || 'Quand ce médicament devrait se terminer (optionnel)'}
        </Text>
        <TextInput
          style={styles.input}
          value={endDateOptional}
          onChangeText={setEndDateOptional}
          placeholder={t('optional_note') || 'Note optionnelle'}
        />

        {/* Save Button */}
        <Button
          title={t('save') || 'Enregistrer'}
          onPress={handleSave}
          loading={saving}
          disabled={saving || !selectedParticipantId}
          style={styles.saveButton}
        />
      </Card>

      {/* Planned Medications */}
      <View style={styles.section}>
        {renderPlannedMedications()}
      </View>

      <View style={styles.bottomSpacing} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  header: {
    padding: theme.spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  title: {
    ...commonStyles.heading1,
    color: theme.colors.primary,
    flex: 1,
  },
  errorContainer: {
    padding: theme.spacing.lg,
  },
  formCard: {
    margin: theme.spacing.lg,
  },
  label: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  helpText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginBottom: theme.spacing.sm,
    fontStyle: 'italic',
  },
  input: {
    ...commonStyles.input,
    marginBottom: theme.spacing.sm,
  },
  multilineInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
  },
  picker: {
    height: 50,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  timeButton: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
  },
  timeText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.medium,
  },
  removeTimeButton: {
    backgroundColor: theme.colors.error,
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeTimeText: {
    color: theme.colors.surface,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
  },
  doseRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  doseInput: {
    flex: 1,
  },
  saveButton: {
    marginTop: theme.spacing.lg,
  },
  section: {
    padding: theme.spacing.lg,
  },
  sectionTitle: {
    ...commonStyles.heading2,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  medicationCard: {
    marginBottom: theme.spacing.md,
  },
  medicationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  medicationName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    flex: 1,
  },
  deleteButton: {
    fontSize: theme.fontSize.xl,
    color: theme.colors.error,
    padding: theme.spacing.xs,
  },
  medicationDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textLight,
    marginTop: theme.spacing.xs,
  },
  emptyCard: {
    padding: theme.spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textLight,
    fontStyle: 'italic',
  },
  bottomSpacing: {
    height: theme.spacing.xl,
  },
});

export default MedicationPlanningScreen;
