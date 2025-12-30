/**
 * Badge Form Screen
 *
 * Mirrors spa/badge_form.js functionality
 * Submit badge progress for a specific participant
 * View existing badge progress with stars
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Image,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  getBadgeProgress,
  saveBadgeProgress,
  getParticipant,
  getBadgeSystemSettings,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Select,
  Checkbox,
  Toast,
  useToast,
} from '../components';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';

const BadgeFormScreen = ({ route, navigation }) => {
  const { participantId } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [participant, setParticipant] = useState(null);
  const [badgeProgress, setBadgeProgress] = useState([]);
  const [badgeSettings, setBadgeSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [participantSection, setParticipantSection] = useState('general');
  const [formData, setFormData] = useState({
    badge_template_id: '',
    objectif: '',
    description: '',
    fierte: false,
    raison: '',
    date_obtention: DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD'),
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, [participantId]);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      if (!participantId) {
        throw new Error(t('participant_id_required') || 'Participant ID is required');
      }

      const [settingsResponse, participantResponse, progressResponse] = await Promise.all([
        getBadgeSystemSettings({ forceRefresh }),
        getParticipant(participantId),
        getBadgeProgress(participantId, { forceRefresh }),
      ]);

      const settings = settingsResponse?.data || null;
      setBadgeSettings(settings);
      setTemplates(settings?.templates || []);

      // IMPORTANT: The API returns participant data in response.data (not response.participant)
      // See routes/participants.js line 1016: success(res, { ...participantData, ...hasFlags })
      const p = participantResponse?.data || participantResponse;
      if (!p || !p.id) {
        throw new Error(t('participant_not_found'));
      }

      setParticipant(p);
      setParticipantSection(p.group_section || p.section || 'general');

      const progress = Array.isArray(progressResponse)
        ? progressResponse
        : progressResponse?.data || [];
      setBadgeProgress(progress);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const getTemplatesForSection = useMemo(() => {
    const section = participantSection || 'general';
    return (templates || []).filter(
      (template) => template.section === section || template.section === 'general'
    );
  }, [templates, participantSection]);

  const getTemplateById = (templateId) => {
    const normalizedId = Number.isFinite(Number(templateId)) ? Number(templateId) : templateId;
    return (templates || []).find((template) => template.id === normalizedId);
  };

  const getTemplateLabel = (template) => {
    if (!template) return t('badge_unknown_label');
    return t(template.translation_key) || template.name || t('badge_unknown_label');
  };

  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validateForm = () => {
    if (!formData.badge_template_id) {
      toast.show(t('select_badge_required'), 'warning');
      return false;
    }

    if (!formData.objectif.trim()) {
      toast.show(t('objectif_required'), 'warning');
      return false;
    }

    if (!formData.description.trim()) {
      toast.show(t('description_required'), 'warning');
      return false;
    }

    if (!formData.raison.trim()) {
      toast.show(t('raison_required'), 'warning');
      return false;
    }

    if (!formData.date_obtention) {
      toast.show(t('date_obtention_required'), 'warning');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSaving(true);

      const payload = {
        participant_id: participantId,
        badge_template_id: parseInt(formData.badge_template_id, 10),
        objectif: SecurityUtils.sanitizeInput(formData.objectif),
        description: SecurityUtils.sanitizeInput(formData.description),
        fierte: formData.fierte,
        raison: SecurityUtils.sanitizeInput(formData.raison),
        date_obtention: SecurityUtils.sanitizeInput(formData.date_obtention),
      };

      const result = await saveBadgeProgress(payload);

      if (result.success) {
        toast.show(t('badge_progress_saved'), 'success');
        // Reset form
        setFormData({
          badge_template_id: '',
          objectif: '',
          description: '',
          fierte: false,
          raison: '',
          date_obtention: DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD'),
        });
        // Reload data
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_saving_badge_progress'));
      }
    } catch (err) {
      toast.show(err.message || t('error_saving_badge_progress'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const countLevels = (entries, template) => {
    if (!entries || entries.length === 0) return 0;

    const levelLimit = template?.level_count || template?.levels?.length || 3;
    const uniqueLevels = new Set(entries.map((e) => e.etoiles || 0));

    return Math.min(uniqueLevels.size, levelLimit);
  };

  const renderBadgeCard = (template) => {
    const entries = badgeProgress.filter((b) => b.badge_template_id === template.id);
    const approvedEntries = entries.filter((b) => b.status === 'approved');
    const pendingEntries = entries.filter((b) => b.status === 'pending');
    const approvedLevels = countLevels(approvedEntries, template);
    const pendingLevels = countLevels(pendingEntries, template);
    const levelCount = template.level_count || template.levels?.length || 3;

    // Render stars
    const stars = Array.from({ length: levelCount }, (_, index) => {
      const starIndex = index + 1;
      let starStyle = styles.starLocked;
      let starIcon = '☆';

      if (starIndex <= approvedLevels) {
        starStyle = styles.starApproved;
        starIcon = '★';
      } else if (starIndex <= approvedLevels + pendingLevels) {
        starStyle = styles.starPending;
        starIcon = '⭐';
      }

      return (
        <Text key={`star-${index}`} style={[styles.starIcon, starStyle]}>
          {starIcon}
        </Text>
      );
    });

    return (
      <Card key={template.id} style={styles.badgeCard}>
        <Text style={styles.badgeCardName}>{getTemplateLabel(template)}</Text>
        <View style={styles.badgeStars}>{stars}</View>

        {approvedEntries.length > 0 && (
          <View style={styles.badgeDetails}>
            <Text style={styles.badgeDetailLabel}>{t('latest_approved')}:</Text>
            <Text style={styles.badgeDetailText}>
              {approvedEntries[approvedEntries.length - 1].objectif}
            </Text>
            <Text style={styles.badgeDetailDate}>
              {DateUtils.formatDate(new Date(approvedEntries[approvedEntries.length - 1].date_obtention))}
            </Text>
          </View>
        )}

        {pendingEntries.length > 0 && (
          <View style={styles.badgePendingNotice}>
            <Text style={styles.badgePendingText}>
              {pendingEntries.length} {t('badge_pending_entries')}
            </Text>
          </View>
        )}
      </Card>
    );
  };

  const templateOptions = useMemo(() => {
    return [
      { label: '...', value: '' },
      ...getTemplatesForSection.map((template) => ({
        label: getTemplateLabel(template),
        value: String(template.id),
      })),
    ];
  }, [getTemplatesForSection]);

  const hasTemplates = getTemplatesForSection.length > 0;

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  if (!participant) {
    return (
      <View style={commonStyles.container}>
        <Card>
          <Text style={styles.errorText}>{t('participant_not_found')}</Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.title}>{t('badge_progress_form')}</Text>
          <Text style={styles.participantName}>
            {participant.first_name} {participant.last_name}
          </Text>
          <Text style={styles.section}>
            {t('section')}: {participantSection}
          </Text>
        </Card>

        {/* Badge Progress Form */}
          <Card style={styles.formCard}>
            <Text style={styles.sectionTitle}>{t('submit_new_badge_progress')}</Text>

            <FormField label={t('badge_select_badge') || t('badge')} required />
            <Picker
              selectedValue={formData.badge_template_id}
              onValueChange={(val) => handleFieldChange('badge_template_id', val)}
              enabled={hasTemplates}
              style={styles.picker}
            >
              {templateOptions.map((option) => (
                <Picker.Item key={option.value} label={option.label} value={option.value} />
              ))}
            </Picker>

            {!hasTemplates && (
              <Text style={styles.warningText}>
                {t('no_badge_templates_for_section') || t('no_badges')}
              </Text>
            )}

            <FormField
              label={t('objectif_proie')}
              value={formData.objectif}
              onChangeText={(val) => handleFieldChange('objectif', val)}
              placeholder={t('objectif_proie')}
              multiline
              numberOfLines={3}
              required
            />

            <FormField
              label={t('description')}
              value={formData.description}
              onChangeText={(val) => handleFieldChange('description', val)}
              placeholder={t('description')}
              multiline
              numberOfLines={3}
              required
            />

            <Checkbox
              label={t('fierte')}
              checked={formData.fierte}
              onPress={() => handleFieldChange('fierte', !formData.fierte)}
            />

            <FormField
              label={t('raison')}
              value={formData.raison}
              onChangeText={(val) => handleFieldChange('raison', val)}
              placeholder={t('raison')}
              multiline
              numberOfLines={3}
              required
            />

            <FormField
              label={t('date_obtention')}
              value={formData.date_obtention}
              onChangeText={(val) => handleFieldChange('date_obtention', val)}
              placeholder="YYYY-MM-DD"
              helpText={t('format_yyyy_mm_dd')}
              required
            />

            <TouchableOpacity
              style={[
                commonStyles.button,
                (!hasTemplates || saving) && commonStyles.buttonDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!hasTemplates || saving}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>
                {saving ? t('saving') : t('save_badge_progress')}
              </Text>
            </TouchableOpacity>
          </Card>

          {/* Existing Badge Progress */}
        <Card style={styles.progressCard}>
          <Text style={styles.sectionTitle}>{t('existing_badge_progress')}</Text>

          {hasTemplates ? (
            <View style={styles.badgeGrid}>
              {getTemplatesForSection.map((template) => renderBadgeCard(template))}
            </View>
          ) : (
            <Text style={styles.noBadgesText}>
              {t('no_badge_templates_for_section') || t('no_badges')}
            </Text>
          )}
        </Card>
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
  headerCard: {
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.sm,
  },
  participantName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  section: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  formCard: {
    marginBottom: theme.spacing.md,
  },
  progressCard: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  warningText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.warning,
    marginBottom: theme.spacing.md,
    fontStyle: 'italic',
  },
  badgeGrid: {
    gap: theme.spacing.md,
  },
  badgeCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  badgeCardName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  badgeStars: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  starIcon: {
    fontSize: theme.fontSize.xl,
  },
  starApproved: {
    color: theme.colors.success,
  },
  starPending: {
    color: theme.colors.warning,
  },
  starLocked: {
    color: theme.colors.border,
  },
  badgeDetails: {
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  badgeDetailLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  badgeDetailText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  badgeDetailDate: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
  },
  badgePendingNotice: {
    marginTop: theme.spacing.sm,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.warningLight || '#fff9e6',
    borderRadius: theme.borderRadius.sm,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  badgePendingText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.semibold,
  },
  noBadgesText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: theme.spacing.md,
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.error,
    textAlign: 'center',
  },
});

export default BadgeFormScreen;
