/**
 * Health Form Screen
 *
 * Mirrors spa/fiche_sante.js functionality
 * Dynamic health form for participants with emergency contacts
 * For parents to fill out health information
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import {
  getParticipant,
  getGuardians,
  getOrganizationFormFormats,
  submitDynamicForm,
  getFormSubmission,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingState,
  ErrorState,
  DynamicFormRenderer,
  Checkbox,
  Button,
  Toast,
  useToast,
} from '../components';
import DateUtils from '../utils/DateUtils';

const HealthFormScreen = ({ route, navigation }) => {
  const { participantId } = route.params;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [participant, setParticipant] = useState(null);
  const [parents, setParents] = useState([]);
  const [formStructure, setFormStructure] = useState(null);
  const [formData, setFormData] = useState({});
  const [emergencyContacts, setEmergencyContacts] = useState([]);
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, [participantId]);

  const loadData = async () => {
    try {
      setError('');
      setLoading(true);

      // Load participant, parents, form formats, and existing submission in parallel
      const [participantData, guardiansResponse, formFormatsResponse, existingSubmission] = await Promise.all([
        getParticipant(participantId),
        getGuardians(participantId),
        getOrganizationFormFormats('participant'),
        getFormSubmission(participantId, 'fiche_sante').catch(() => ({ success: false })),
      ]);

      setParticipant(participantData);
      const parentsData = guardiansResponse?.data || guardiansResponse || [];
      setParents(parentsData);

      // Get health form structure from response
      const formFormats = formFormatsResponse.success ? formFormatsResponse.data : {};
      if (formFormats?.fiche_sante) {
        const formStructureData = formFormats.fiche_sante.form_structure || formFormats.fiche_sante;
        setFormStructure(formStructureData);
        
        // Initialize with existing data or defaults
        if (existingSubmission.success && existingSubmission.form_data) {
          setFormData(existingSubmission.form_data);
          // Set emergency contacts from existing submission
          if (existingSubmission.form_data.emergency_contacts) {
            setEmergencyContacts(existingSubmission.form_data.emergency_contacts);
          }
        } else {
          // Initialize with default values
          const initialData = {};
          if (formStructureData.fields) {
            formStructureData.fields.forEach((field) => {
              if (field.default_value !== undefined) {
                initialData[field.name] = field.default_value;
              } else if (field.type === 'checkbox') {
                initialData[field.name] = false;
              } else {
                initialData[field.name] = '';
              }
            });
          }
          setFormData(initialData);
          
          // Set default emergency contacts from parent data
          const defaultEmergency = (parentsData || [])
            .filter((p) => p.is_emergency_contact)
            .map((p) => p.id.toString());
          setEmergencyContacts(defaultEmergency);
        }
      }
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (fieldName, value) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
  };

  const toggleEmergencyContact = (parentId) => {
    setEmergencyContacts((prev) => {
      const idStr = parentId.toString();
      if (prev.includes(idStr)) {
        return prev.filter((id) => id !== idStr);
      } else {
        return [...prev, idStr];
      }
    });
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);

      // Prepare submission data
      const submissionData = {
        ...formData,
        emergency_contacts: emergencyContacts,
      };

      // Submit the form
      const result = await submitDynamicForm(
        'fiche_sante',
        participantId,
        submissionData
      );

      if (result.success) {
        toast.show(t('health_form_saved_successfully') || 'Health form saved successfully', 'success');
        // Navigate back after a short delay
        setTimeout(() => {
          navigation.goBack();
        }, 1500);
      } else {
        toast.show(result.message || t('error_saving_health_form'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_saving_health_form'), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (loading && !participant) {
    return <LoadingState message={t('loading_health_form') || 'Loading health form...'} />;
  }

  if (error && !loading) {
    return <ErrorState message={error} onRetry={loadData} />;
  }

  if (!participant) {
    return (
      <ErrorState
        message={t('participant_not_found') || 'Participant not found'}
        onRetry={() => navigation.goBack()}
      />
    );
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Participant Information */}
        <View style={styles.infoCard}>
          <Text style={styles.sectionTitle}>{t('general_information')}</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('full_name')}:</Text>
            <Text style={styles.infoValue}>
              {participant.first_name} {participant.last_name}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('date_of_birth')}:</Text>
            <Text style={styles.infoValue}>
              {DateUtils.formatDate(participant.birthdate)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('age')}:</Text>
            <Text style={styles.infoValue}>
              {DateUtils.calculateAge(participant.birthdate)} {t('years')}
            </Text>
          </View>
        </View>

        {/* Dynamic Form Fields */}
        {formStructure && (
          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>{t('health_information')}</Text>
            <DynamicFormRenderer
              formStructure={formStructure}
              formData={formData}
              onFieldChange={handleFieldChange}
              disabled={loading}
            />
          </View>
        )}

        {/* Emergency Contacts */}
        {parents.length > 0 && (
          <View style={styles.contactsCard}>
            <Text style={styles.sectionTitle}>{t('emergency_contacts')}</Text>
            <Text style={styles.helpText}>{t('select_emergency_contacts')}</Text>

            {parents.map((parent, index) => (
              <View key={parent.id} style={styles.contactItem}>
                <View style={styles.contactHeader}>
                  <Text style={styles.contactName}>
                    {t('contact')} {index + 1}
                  </Text>
                </View>
                <Text style={styles.contactDetail}>
                  {parent.prenom} {parent.nom}
                </Text>
                <Text style={styles.contactDetail}>
                  {t('phone')}:{' '}
                  {parent.telephone_cellulaire ||
                    parent.telephone_residence ||
                    parent.telephone_travail ||
                    t('no_phone')}
                </Text>
                <Checkbox
                  label={t('is_emergency_contact')}
                  checked={emergencyContacts.includes(parent.id.toString())}
                  onPress={() => toggleEmergencyContact(parent.id)}
                  style={styles.emergencyCheckbox}
                />
              </View>
            ))}
          </View>
        )}

        {/* Submit Button */}
        <Button
          title={t('save_health_form') || 'Save Health Form'}
          onPress={handleSubmit}
          loading={loading}
          style={styles.submitButton}
        />
      </ScrollView>

      <Toast
        visible={toast.toastState.visible}
        message={toast.toastState.message}
        type={toast.toastState.type}
        duration={toast.toastState.duration}
        onDismiss={toast.hide}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
  },
  infoCard: {
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  },
  formCard: {
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  },
  contactsCard: {
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.xs,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.text.secondary,
    minWidth: 120,
  },
  infoValue: {
    fontSize: 14,
    color: theme.colors.text.primary,
    flex: 1,
  },
  submitButton: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  helpText: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  checkbox: {
    marginVertical: theme.spacing.xs,
  },
  contactItem: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  contactHeader: {
    marginBottom: theme.spacing.xs,
  },
  contactName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  contactDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  emergencyCheckbox: {
    marginTop: theme.spacing.sm,
  },
});

export default HealthFormScreen;
