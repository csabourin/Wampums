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
  fetchParticipant,
  fetchParents,
  getOrganizationFormFormats,
  submitDynamicForm,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Checkbox,
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

      // Load participant, parents, and form structure in parallel
      const [participantData, parentsData, formFormats] = await Promise.all([
        fetchParticipant(participantId),
        fetchParents(participantId),
        getOrganizationFormFormats(),
      ]);

      setParticipant(participantData);
      setParents(parentsData || []);

      // Get health form structure
      if (formFormats?.fiche_sante) {
        setFormStructure(formFormats.fiche_sante);
        // Initialize form data with default values
        initializeFormData(formFormats.fiche_sante);
      }

      // Set default emergency contacts
      const defaultEmergency = parentsData
        ?.filter((p) => p.is_emergency_contact)
        .map((p) => p.id.toString()) || [];
      setEmergencyContacts(defaultEmergency);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const initializeFormData = (structure) => {
    if (!structure?.fields) return;

    const initialData = {};
    structure.fields.forEach((field) => {
      if (field.default_value !== undefined) {
        initialData[field.name] = field.default_value;
      } else if (field.type === 'checkbox') {
        initialData[field.name] = false;
      } else {
        initialData[field.name] = '';
      }
    });
    setFormData(initialData);
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
        toast.show(t('health_form_saved_successfully'), 'success');
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

  const renderFormField = (field) => {
    const value = formData[field.name] || '';

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
        return (
          <FormField
            key={field.name}
            label={field.label}
            value={value}
            onChangeText={(val) => handleFieldChange(field.name, val)}
            placeholder={field.placeholder}
            keyboardType={
              field.type === 'email'
                ? 'email-address'
                : field.type === 'tel'
                ? 'phone-pad'
                : 'default'
            }
            required={field.required}
            helpText={field.help_text}
          />
        );

      case 'textarea':
        return (
          <FormField
            key={field.name}
            label={field.label}
            value={value}
            onChangeText={(val) => handleFieldChange(field.name, val)}
            placeholder={field.placeholder}
            multiline
            numberOfLines={4}
            required={field.required}
            helpText={field.help_text}
          />
        );

      case 'checkbox':
        return (
          <Checkbox
            key={field.name}
            label={field.label}
            checked={value === true || value === 'true'}
            onPress={() => handleFieldChange(field.name, !value)}
            style={styles.checkbox}
          />
        );

      case 'select':
        // For select fields, we would use the Select component
        // For now, render as text input
        return (
          <FormField
            key={field.name}
            label={field.label}
            value={value}
            onChangeText={(val) => handleFieldChange(field.name, val)}
            placeholder={field.placeholder}
            required={field.required}
            helpText={field.help_text}
          />
        );

      default:
        return null;
    }
  };

  if (loading && !participant) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  if (!participant) {
    return (
      <ErrorMessage
        message={t('participant_not_found')}
        onRetry={() => navigation.goBack()}
      />
    );
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Participant Information */}
        <Card style={styles.infoCard}>
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
        </Card>

        {/* Dynamic Form Fields */}
        {formStructure?.fields && (
          <Card style={styles.formCard}>
            <Text style={styles.sectionTitle}>{t('health_information')}</Text>
            {formStructure.fields.map((field) => renderFormField(field))}
          </Card>
        )}

        {/* Emergency Contacts */}
        {parents.length > 0 && (
          <Card style={styles.contactsCard}>
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
          </Card>
        )}

        {/* Submit Button */}
        <TouchableOpacity
          style={commonStyles.button}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={commonStyles.buttonText}>{t('save_health_form')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Toast Notifications */}
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
    marginBottom: theme.spacing.md,
  },
  formCard: {
    marginBottom: theme.spacing.md,
  },
  contactsCard: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.xs,
  },
  infoLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    minWidth: 120,
  },
  infoValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    flex: 1,
  },
  helpText: {
    fontSize: theme.fontSize.sm,
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
