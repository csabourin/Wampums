/**
 * Registration Form Screen
 *
 * Mirrors spa/formulaire_inscription.js functionality
 * Allows parents to register new participants with guardian information
 *
 * Features:
 * - Participant basic info (first name, last name, birthdate)
 * - Multiple guardian forms
 * - Inscription date
 * - Links participant to user automatically
 * - Links participant to organization
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';

// API and utilities
import {
  createParticipant,
  updateParticipant,
  getParticipant,
  saveGuardian,
  linkGuardianToParticipant,
  linkUserParticipants,
  saveFormSubmission,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import StorageUtils from '../utils/StorageUtils';
import SecurityUtils from '../utils/SecurityUtils';
import DateUtils from '../utils/DateUtils';
import { debugLog, debugError } from '../utils/DebugUtils';

// Components
import { Card, LoadingSpinner, Button } from '../components';

/**
 * GuardianFormSection Component
 * Renders a single guardian form with all required fields
 */
const GuardianFormSection = ({ guardian, index, onChange, onRemove, canRemove }) => {
  const [showRelationshipHelp, setShowRelationshipHelp] = useState(false);

  const updateField = (field, value) => {
    onChange(index, { ...guardian, [field]: value });
  };

  return (
    <Card style={styles.guardianCard}>
      <View style={styles.guardianHeader}>
        <Text style={styles.guardianTitle}>
          {t('guardian')} #{index + 1}
        </Text>
        {canRemove && (
          <TouchableOpacity onPress={() => onRemove(index)} style={styles.removeButton}>
            <Text style={styles.removeButtonText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>
          {t('first_name')} <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={guardian.prenom || ''}
          onChangeText={(text) => updateField('prenom', text)}
          placeholder={t('first_name')}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>
          {t('last_name')} <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={guardian.nom || ''}
          onChangeText={(text) => updateField('nom', text)}
          placeholder={t('last_name')}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>
          {t('relationship')} <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={guardian.lien || ''}
          onChangeText={(text) => updateField('lien', text)}
          placeholder={t('e.g., Mother, Father, Grandmother')}
          autoCapitalize="words"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>
          {t('email')} <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={guardian.courriel || ''}
          onChangeText={(text) => updateField('courriel', text)}
          placeholder={t('email')}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>{t('home_phone')}</Text>
        <TextInput
          style={styles.input}
          value={guardian.telephone_residence || ''}
          onChangeText={(text) => updateField('telephone_residence', text)}
          placeholder={t('home_phone')}
          keyboardType="phone-pad"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>{t('work_phone')}</Text>
        <TextInput
          style={styles.input}
          value={guardian.telephone_travail || ''}
          onChangeText={(text) => updateField('telephone_travail', text)}
          placeholder={t('work_phone')}
          keyboardType="phone-pad"
        />
      </View>

      <View style={styles.formGroup}>
        <Text style={styles.label}>{t('cell_phone')}</Text>
        <TextInput
          style={styles.input}
          value={guardian.telephone_cellulaire || ''}
          onChangeText={(text) => updateField('telephone_cellulaire', text)}
          placeholder={t('cell_phone')}
          keyboardType="phone-pad"
        />
      </View>

      <View style={styles.checkboxGroup}>
        <TouchableOpacity
          style={styles.checkbox}
          onPress={() => updateField('is_primary', !guardian.is_primary)}
        >
          <View style={[styles.checkboxBox, guardian.is_primary && styles.checkboxChecked]}>
            {guardian.is_primary && <Text style={styles.checkboxCheck}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>{t('primary_contact')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.checkbox}
          onPress={() => updateField('is_emergency_contact', !guardian.is_emergency_contact)}
        >
          <View style={[styles.checkboxBox, guardian.is_emergency_contact && styles.checkboxChecked]}>
            {guardian.is_emergency_contact && <Text style={styles.checkboxCheck}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>{t('emergency_contact')}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
};

/**
 * RegistrationFormScreen Component
 */
const RegistrationFormScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { participantId } = route.params || {};
  const isEditing = !!participantId;

  // State
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Participant data
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [inscriptionDate, setInscriptionDate] = useState(
    DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD')
  );

  // Guardians data
  const [guardians, setGuardians] = useState([
    {
      prenom: '',
      nom: '',
      lien: '',
      courriel: '',
      telephone_residence: '',
      telephone_travail: '',
      telephone_cellulaire: '',
      is_primary: true,
      is_emergency_contact: true,
    },
  ]);

  // Date picker state
  const [showBirthdatePicker, setShowBirthdatePicker] = useState(false);
  const [showInscriptionDatePicker, setShowInscriptionDatePicker] = useState(false);

  // Configure header
  useEffect(() => {
    navigation.setOptions({
      title: isEditing ? t('edit_participant') : t('add_participant'),
    });
  }, [navigation, isEditing]);

  // Load participant data if editing
  useEffect(() => {
    if (isEditing) {
      loadParticipantData();
    }
  }, [participantId]);

  /**
   * Load participant and guardian data
   */
  const loadParticipantData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getParticipant(participantId);

      if (response.success && response.data) {
        const participant = response.data;
        setFirstName(participant.first_name || participant.firstName || '');
        setLastName(participant.last_name || participant.lastName || '');
        setBirthdate(participant.date_naissance || participant.birthdate || '');
        setInscriptionDate(participant.inscription_date || inscriptionDate);

        // Load guardians if available
        if (participant.guardians && participant.guardians.length > 0) {
          setGuardians(participant.guardians);
        }
      } else {
        throw new Error(response.message || t('error_loading_data'));
      }
    } catch (err) {
      debugError('Error loading participant:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Add a new guardian form
   */
  const addGuardian = () => {
    setGuardians([
      ...guardians,
      {
        prenom: '',
        nom: '',
        lien: '',
        courriel: '',
        telephone_residence: '',
        telephone_travail: '',
        telephone_cellulaire: '',
        is_primary: false,
        is_emergency_contact: false,
      },
    ]);
  };

  /**
   * Remove a guardian form
   */
  const removeGuardian = (index) => {
    if (guardians.length > 1) {
      const newGuardians = guardians.filter((_, i) => i !== index);
      setGuardians(newGuardians);
    }
  };

  /**
   * Update a guardian's data
   */
  const updateGuardian = (index, updatedGuardian) => {
    const newGuardians = [...guardians];
    newGuardians[index] = updatedGuardian;
    setGuardians(newGuardians);
  };

  /**
   * Validate form data
   */
  const validateForm = () => {
    // Validate participant fields
    if (!firstName.trim()) {
      Alert.alert(t('error'), t('first_name_required'));
      return false;
    }

    if (!lastName.trim()) {
      Alert.alert(t('error'), t('last_name_required'));
      return false;
    }

    if (!birthdate) {
      Alert.alert(t('error'), t('birthdate_required'));
      return false;
    }

    // Validate at least one guardian
    if (guardians.length === 0) {
      Alert.alert(t('error'), t('at_least_one_guardian_required'));
      return false;
    }

    // Validate each guardian
    for (let i = 0; i < guardians.length; i++) {
      const guardian = guardians[i];

      if (!guardian.prenom?.trim()) {
        Alert.alert(t('error'), `${t('guardian')} #${i + 1}: ${t('first_name_required')}`);
        return false;
      }

      if (!guardian.nom?.trim()) {
        Alert.alert(t('error'), `${t('guardian')} #${i + 1}: ${t('last_name_required')}`);
        return false;
      }

      if (!guardian.lien?.trim()) {
        Alert.alert(t('error'), `${t('guardian')} #${i + 1}: ${t('relationship_required')}`);
        return false;
      }

      if (!guardian.courriel?.trim()) {
        Alert.alert(t('error'), `${t('guardian')} #${i + 1}: ${t('email_required')}`);
        return false;
      }

      // Validate email format
      if (!SecurityUtils.isValidEmail(guardian.courriel)) {
        Alert.alert(t('error'), `${t('guardian')} #${i + 1}: ${t('invalid_email')}`);
        return false;
      }
    }

    return true;
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      debugLog('Starting participant registration', {
        firstName,
        lastName,
        birthdate,
        guardiansCount: guardians.length,
      });

      // Step 1: Save participant core data
      const participantData = {
        first_name: SecurityUtils.sanitizeInput(firstName),
        last_name: SecurityUtils.sanitizeInput(lastName),
        date_naissance: birthdate,
      };

      let savedParticipantId;

      if (isEditing) {
        const updateResponse = await updateParticipant(participantId, participantData);
        if (!updateResponse.success) {
          throw new Error(updateResponse.message || t('error_saving_participant'));
        }
        savedParticipantId = participantId;
        debugLog('Participant updated:', savedParticipantId);
      } else {
        const createResponse = await createParticipant(participantData);
        if (!createResponse.success) {
          throw new Error(createResponse.message || t('error_saving_participant'));
        }
        savedParticipantId = createResponse.participant_id || createResponse.data?.id;
        debugLog('Participant created:', savedParticipantId);
      }

      // Step 2: Link participant to current user (for parent-driven registration)
      if (!isEditing) {
        try {
          const linkResponse = await linkUserParticipants({
            participant_ids: [savedParticipantId],
          });
          debugLog('Participant linked to user:', linkResponse);
        } catch (linkError) {
          debugError('Error linking participant to user:', linkError);
          // Non-critical, continue
        }
      }

      // Step 3: Save guardians and link to participant
      for (const guardian of guardians) {
        try {
          const guardianData = {
            participant_id: savedParticipantId,
            nom: SecurityUtils.sanitizeInput(guardian.nom),
            prenom: SecurityUtils.sanitizeInput(guardian.prenom),
            lien: SecurityUtils.sanitizeInput(guardian.lien),
            courriel: SecurityUtils.sanitizeInput(guardian.courriel),
            telephone_residence: SecurityUtils.sanitizeInput(guardian.telephone_residence || ''),
            telephone_travail: SecurityUtils.sanitizeInput(guardian.telephone_travail || ''),
            telephone_cellulaire: SecurityUtils.sanitizeInput(guardian.telephone_cellulaire || ''),
            is_primary: guardian.is_primary || false,
            is_emergency_contact: guardian.is_emergency_contact || false,
          };

          const guardianResponse = await saveGuardian(guardianData);
          if (!guardianResponse.success) {
            throw new Error(guardianResponse.message || t('error_saving_guardian'));
          }

          const guardianId = guardianResponse.parent_id || guardianResponse.data?.id;
          debugLog('Guardian saved:', guardianId);

          // Link guardian to participant
          await linkGuardianToParticipant(savedParticipantId, guardianId);
          debugLog('Guardian linked to participant');
        } catch (guardianError) {
          debugError('Error saving guardian:', guardianError);
          throw guardianError;
        }
      }

      // Step 4: Save form submission data (for custom fields if needed later)
      try {
        const formSubmissionData = {
          first_name: firstName,
          last_name: lastName,
          date_naissance: birthdate,
          inscription_date: inscriptionDate,
        };

        await saveFormSubmission('participant_registration', savedParticipantId, formSubmissionData);
        debugLog('Form submission saved');
      } catch (submissionError) {
        debugError('Error saving form submission:', submissionError);
        // Non-critical, continue
      }

      // Success!
      Alert.alert(
        t('success'),
        t('registration_saved_successfully'),
        [
          {
            text: t('OK'),
            onPress: () => {
              // Navigate back to parent dashboard
              navigation.navigate('ParentDashboard');
            },
          },
        ]
      );
    } catch (err) {
      debugError('Error during registration:', err);
      setError(err.message || t('error_saving_data'));
      Alert.alert(t('error'), err.message || t('error_saving_data'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Handle birthdate change
   */
  const handleBirthdateChange = (event, selectedDate) => {
    setShowBirthdatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setBirthdate(DateUtils.formatDate(selectedDate, 'en', 'YYYY-MM-DD'));
    }
  };

  /**
   * Handle inscription date change
   */
  const handleInscriptionDateChange = (event, selectedDate) => {
    setShowInscriptionDatePicker(Platform.OS === 'ios');
    if (selectedDate) {
      setInscriptionDate(DateUtils.formatDate(selectedDate, 'en', 'YYYY-MM-DD'));
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.sectionTitle}>{t('participant_information')}</Text>

        <Card style={styles.card}>
          <View style={styles.formGroup}>
            <Text style={styles.label}>
              {t('first_name')} <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder={t('first_name')}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              {t('last_name')} <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder={t('last_name')}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>
              {t('birthdate')} <Text style={styles.required}>*</Text>
            </Text>
            <TouchableOpacity
              style={styles.dateInput}
              onPress={() => setShowBirthdatePicker(true)}
            >
              <Text style={birthdate ? styles.dateText : styles.datePlaceholder}>
                {birthdate ? DateUtils.formatDate(birthdate) : t('select_date')}
              </Text>
            </TouchableOpacity>
            {showBirthdatePicker && (
              <DateTimePicker
                value={birthdate ? new Date(birthdate) : new Date()}
                mode="date"
                display="default"
                onChange={handleBirthdateChange}
                maximumDate={new Date()}
              />
            )}
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>{t('inscription_date')}</Text>
            <TouchableOpacity
              style={styles.dateInput}
              onPress={() => setShowInscriptionDatePicker(true)}
            >
              <Text style={styles.dateText}>
                {DateUtils.formatDate(inscriptionDate)}
              </Text>
            </TouchableOpacity>
            {showInscriptionDatePicker && (
              <DateTimePicker
                value={inscriptionDate ? new Date(inscriptionDate) : new Date()}
                mode="date"
                display="default"
                onChange={handleInscriptionDateChange}
              />
            )}
          </View>
        </Card>

        <Text style={styles.sectionTitle}>{t('guardian_information')}</Text>

        {guardians.map((guardian, index) => (
          <GuardianFormSection
            key={index}
            guardian={guardian}
            index={index}
            onChange={updateGuardian}
            onRemove={removeGuardian}
            canRemove={guardians.length > 1}
          />
        ))}

        <TouchableOpacity style={styles.addGuardianButton} onPress={addGuardian}>
          <Text style={styles.addGuardianText}>+ {t('add_guardian')}</Text>
        </TouchableOpacity>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.buttonContainer}>
          <Button
            title={t('cancel')}
            onPress={() => navigation.goBack()}
            variant="secondary"
            style={styles.cancelButton}
          />
          <Button
            title={saving ? t('saving') : t('save')}
            onPress={handleSubmit}
            disabled={saving}
            style={styles.submitButton}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginVertical: 12,
    color: '#333',
  },
  card: {
    marginBottom: 16,
  },
  guardianCard: {
    marginBottom: 16,
  },
  guardianHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  guardianTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  removeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ff3b30',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  formGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
    color: '#333',
  },
  required: {
    color: '#ff3b30',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  dateInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
  },
  dateText: {
    fontSize: 16,
    color: '#333',
  },
  datePlaceholder: {
    fontSize: 16,
    color: '#999',
  },
  checkboxGroup: {
    marginTop: 8,
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#007AFF',
  },
  checkboxCheck: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  checkboxLabel: {
    fontSize: 14,
    color: '#333',
  },
  addGuardianButton: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  addGuardianText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
  },
  submitButton: {
    flex: 1,
  },
});

export default RegistrationFormScreen;
