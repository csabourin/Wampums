/**
 * Risk Acceptance Screen
 *
 * Mirrors spa/acceptation_risque.js functionality
 * Risk acceptance form for Scout activities
 * Includes COVID-19 declarations and signature
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import {
  getParticipant,
  getFormSubmission,
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

const RiskAcceptanceScreen = ({ route, navigation }) => {
  const { participantId } = route.params;
  const [loading, setLoading] = useSafeState(true);
  const [error, setError] = useSafeState('');
  const [participant, setParticipant] = useSafeState(null);
  const [formData, setFormData] = useSafeState({
    groupe_district: '',
    accepte_risques: false,
    participation_volontaire: false,
    declaration_sante: false,
    declaration_voyage: false,
    accepte_covid19: false,
    nom_parent_tuteur: '',
    date_signature: DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD'),
  });
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, [participantId]);

  const loadData = async () => {
    try {
      setError('');

      const [participantResponse, riskResponse] = await Promise.all([
        getParticipant(participantId),
        getFormSubmission(participantId, 'acceptation_risque').catch(() => ({ success: false })),
      ]);

      // Handle participant data
      const participantData = participantResponse?.data || participantResponse;
      setParticipant(participantData);

      // Populate form with existing data if available
      if (riskResponse.success && riskResponse.form_data) {
        const acceptationData = riskResponse.form_data;
        setFormData({
          groupe_district: acceptationData.groupe_district || '',
          accepte_risques: acceptationData.accepte_risques || false,
          participation_volontaire: acceptationData.participation_volontaire || false,
          declaration_sante: acceptationData.declaration_sante || false,
          declaration_voyage: acceptationData.declaration_voyage || false,
          accepte_covid19: acceptationData.accepte_covid19 || false,
          nom_parent_tuteur: acceptationData.nom_parent_tuteur || '',
          date_signature:
            acceptationData.date_signature ||
            DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD'),
        });
      }
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validateForm = () => {
    if (!formData.groupe_district.trim()) {
      toast.show(t('groupe_district_required'), 'warning');
      return false;
    }

    if (!formData.accepte_risques) {
      toast.show(t('must_accept_risks'), 'warning');
      return false;
    }

    if (
      !formData.participation_volontaire ||
      !formData.declaration_sante ||
      !formData.declaration_voyage ||
      !formData.accepte_covid19
    ) {
      toast.show(t('must_accept_all_declarations'), 'warning');
      return false;
    }

    if (!formData.nom_parent_tuteur.trim()) {
      toast.show(t('parent_name_required'), 'warning');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);

      const result = await submitDynamicForm(
        'acceptation_risque',
        participantId,
        formData
      );

      if (result.success) {
        toast.show(t('risk_acceptance_saved_successfully'), 'success');
        // Navigate back after a short delay
        setTimeout(() => {
          navigation.goBack();
        }, 1500);
      } else {
        toast.show(result.message || t('error_saving_risk_acceptance'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_saving_risk_acceptance'), 'error');
    } finally {
      setLoading(false);
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

  const risksList = [
    'risque_blessures_chutes',
    'risque_blessures_objets',
    'risque_blessures_contact',
    'risque_hypothermie',
    'risque_brulures',
    'risque_allergies',
    'risque_animaux_plantes',
    'risque_vol_perte_objets',
    'risque_defaillance_equipements',
    'risque_comportements_negligents',
    'risque_deces',
  ];

  return (
    <View style={commonStyles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {/* Participant Information */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('participant_information')}</Text>
          <Text style={styles.infoText}>
            {t('participant_name')}: {participant.first_name} {participant.last_name}
          </Text>
          <Text style={styles.infoText}>
            {t('age')}: {DateUtils.calculateAge(participant.birthdate)} {t('years')}
          </Text>
        </Card>

        <FormField
          label={t('groupe_district')}
          value={formData.groupe_district}
          onChangeText={(val) => handleFieldChange('groupe_district', val)}
          placeholder={t('enter_groupe_district')}
          required
        />

        {/* Inherent Risks */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('inherent_risks')}</Text>
          <Text style={styles.paragraph}>{t('paragraph_risk_acceptance')}</Text>

          <View style={styles.risksList}>
            {risksList.map((risk) => (
              <View key={risk} style={styles.riskItem}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.riskText}>{t(risk)}</Text>
              </View>
            ))}
          </View>

          <Checkbox
            label={t('i_accept_activity_risks')}
            checked={formData.accepte_risques}
            onPress={() =>
              handleFieldChange('accepte_risques', !formData.accepte_risques)
            }
            style={styles.checkbox}
          />
        </Card>

        {/* COVID-19 and Other Diseases */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('covid19_and_diseases')}</Text>
          <Text style={styles.paragraph}>{t('text_covid19')}</Text>

          <Checkbox
            label={t('voluntary_participation')}
            checked={formData.participation_volontaire}
            onPress={() =>
              handleFieldChange(
                'participation_volontaire',
                !formData.participation_volontaire
              )
            }
            style={styles.checkbox}
          />

          <Checkbox
            label={t('health_declaration')}
            checked={formData.declaration_sante}
            onPress={() =>
              handleFieldChange('declaration_sante', !formData.declaration_sante)
            }
            style={styles.checkbox}
          />

          <Checkbox
            label={t('travel_declaration')}
            checked={formData.declaration_voyage}
            onPress={() =>
              handleFieldChange('declaration_voyage', !formData.declaration_voyage)
            }
            style={styles.checkbox}
          />

          <Checkbox
            label={t('i_accept_covid19_risks')}
            checked={formData.accepte_covid19}
            onPress={() =>
              handleFieldChange('accepte_covid19', !formData.accepte_covid19)
            }
            style={styles.checkbox}
          />
        </Card>

        {/* Signature */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('signature')}</Text>
          <Text style={styles.paragraph}>{t('parent_guardian_confirmation')}</Text>

          <FormField
            label={t('parent_guardian_name')}
            value={formData.nom_parent_tuteur}
            onChangeText={(val) => handleFieldChange('nom_parent_tuteur', val)}
            placeholder={t('enter_full_name')}
            required
          />

          <FormField
            label={t('signature_date')}
            value={formData.date_signature}
            onChangeText={(val) => handleFieldChange('date_signature', val)}
            placeholder="YYYY-MM-DD"
            required
            helpText={t('format_yyyy_mm_dd')}
          />

          {/* TODO: Add signature canvas component
           * For digital signature, integrate react-native-signature-canvas
           * or similar library in future enhancement
           */}
          <View style={styles.signatureNote}>
            <Text style={styles.noteText}>
              {t('signature_note')}: {t('type_full_name_as_signature')}
            </Text>
          </View>
        </Card>

        {/* Submit Button */}
        <TouchableOpacity
          style={commonStyles.button}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={commonStyles.buttonText}>{t('submit_risk_acceptance')}</Text>
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
  card: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  infoText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  paragraph: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.fontSize.base * theme.lineHeight.relaxed,
    marginBottom: theme.spacing.md,
  },
  risksList: {
    marginBottom: theme.spacing.md,
  },
  riskItem: {
    flexDirection: 'row',
    marginBottom: theme.spacing.xs,
  },
  bullet: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginRight: theme.spacing.sm,
  },
  riskText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.fontSize.base * theme.lineHeight.normal,
  },
  checkbox: {
    marginVertical: theme.spacing.sm,
  },
  signatureNote: {
    backgroundColor: theme.colors.secondary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.info,
    marginTop: theme.spacing.md,
  },
  noteText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    lineHeight: theme.fontSize.sm * theme.lineHeight.normal,
  },
});

export default RiskAcceptanceScreen;