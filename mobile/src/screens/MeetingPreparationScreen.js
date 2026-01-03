/**
 * MeetingPreparationScreen
 *
 * Mirrors spa/preparation_reunions.js for leaders.
 * Allows creating and updating meeting preparation details.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Alert,
  Share,
  Switch,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  getReunionDates,
  getReunionPreparation,
  saveReunionPreparation,
  getAnimateurs,
  getMeetingActivities,
  saveReminder,
  getReminder,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { ActivityManager } from '../utils/ActivityManager';
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import ActivityDescriptionModal from '../components/ActivityDescriptionModal';
import theme, { commonStyles } from '../theme';
import { debugError, debugLog } from '../utils/DebugUtils';

const EMPTY_ACTIVITY = {
  time: '',
  duration: '',
  activity: '',
  responsable: '',
  materiel: '',
};

/**
 * Normalize meeting preparation payload.
 * @param {object} preparation - Meeting preparation data.
 * @returns {object} Normalized data.
 */
const normalizePreparation = (preparation) => {
  if (!preparation) {
    return null;
  }

  // Parse activities if it's a JSON string
  let activities = preparation.activities || [];
  if (typeof activities === 'string') {
    try {
      activities = JSON.parse(activities);
    } catch (err) {
      debugError('Error parsing activities JSON:', err);
      activities = [];
    }
  }

  // Parse youth_of_honor if it's a string
  let youthOfHonor = preparation.youth_of_honor || [];
  if (typeof youthOfHonor === 'string') {
    youthOfHonor = youthOfHonor.split(',').map(s => s.trim()).filter(Boolean);
  }

  return {
    date: preparation.date || '',
    animateur_responsable: preparation.animateur_responsable || '',
    youth_of_honor: youthOfHonor,
    endroit: preparation.endroit || '',
    notes: preparation.notes || '',
    activities: activities,
  };
};

const MeetingPreparationScreen = () => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [availableDates, setAvailableDates] = useSafeState([]);
  const [selectedDate, setSelectedDate] = useSafeState('');
  const [customDate, setCustomDate] = useSafeState('');
  const [animateurs, setAnimateurs] = useSafeState([]);
  const [activityTemplates, setActivityTemplates] = useSafeState([]);
  const [formData, setFormData] = useSafeState({
    date: '',
    animateur_responsable: '',
    youth_of_honor: [],
    endroit: '',
    notes: '',
  });
  const [activities, setActivities] = useSafeState([EMPTY_ACTIVITY]);
  const [saving, setSaving] = useSafeState(false);
  const [reminderData, setReminderData] = useSafeState({
    text: '',
    date: '',
    recurring: false,
  });
  const [savingReminder, setSavingReminder] = useSafeState(false);
  const [quickEditMode, setQuickEditMode] = useSafeState(false);
  const [expandedActivityIndex, setExpandedActivityIndex] = useSafeState(null);
  const [descriptionModal, setDescriptionModal] = useSafeState({
    visible: false,
    title: '',
    description: '',
  });

  // Managers
  const activityManagerRef = useRef(null);

  const honorList = useMemo(() => {
    return Array.isArray(formData.youth_of_honor) ? formData.youth_of_honor : [];
  }, [formData.youth_of_honor]);

  // Initialize activity manager
  useEffect(() => {
    if (animateurs.length > 0 && activityTemplates.length > 0) {
      activityManagerRef.current = new ActivityManager(
        animateurs,
        activityTemplates
      );
    }
  }, [animateurs, activityTemplates]);

  /**
   * Load preparation data for a meeting date.
   * @param {string} date - Meeting date.
   */
  const loadPreparation = async (date) => {
    try {
      const response = await getReunionPreparation(date);
      if (response.success && response.preparation) {
        const normalized = normalizePreparation(response.preparation);
        setFormData({
          date: normalized.date,
          animateur_responsable: normalized.animateur_responsable,
          youth_of_honor: normalized.youth_of_honor,
          endroit: normalized.endroit,
          notes: normalized.notes,
        });
        setActivities(
          normalized.activities.length > 0 ? normalized.activities : [EMPTY_ACTIVITY]
        );
      } else {
        // No existing meeting data - initialize with template activities
        const defaultActivities = activityManagerRef.current
          ? activityManagerRef.current.initializePlaceholderActivities()
          : [EMPTY_ACTIVITY];
        
        setFormData((prev) => ({ ...prev, date }));
        setActivities(defaultActivities.length > 0 ? defaultActivities : [EMPTY_ACTIVITY]);
      }
    } catch (err) {
      debugError('Error loading meeting preparation:', err);
      setError(err.message || t('error_loading_preparation_reunions'));
    }
  };

  /**
   * Load initial meeting preparation data and metadata.
   */
  const loadMeetingData = async () => {
    try {
      setError('');
      const [datesResponse, animateursResponse, activitiesResponse] = await Promise.all([
        getReunionDates(),
        getAnimateurs(),
        getMeetingActivities(),
      ]);

      const dates = datesResponse.success
        ? datesResponse.dates || datesResponse.data || []
        : [];
      const today = DateUtils.formatDate(new Date());
      const uniqueDates = Array.from(new Set([today, ...dates]));
      setAvailableDates(uniqueDates);
      const initialDate = selectedDate || uniqueDates[0];
      setSelectedDate(initialDate);

      // Deduplicate animateurs by ID to avoid duplicate key errors
      const animateursList = animateursResponse.success
        ? animateursResponse.animateurs || animateursResponse.data || []
        : [];
      const uniqueAnimateurs = Array.from(
        new Map(animateursList.map((a) => [a.id, a])).values()
      );
      setAnimateurs(uniqueAnimateurs);
      // Deduplicate activity templates by ID
      const templates = activitiesResponse.success ? activitiesResponse.data || [] : [];
      const uniqueTemplates = Array.from(
        new Map(templates.map((t) => [t.id, t])).values()
      );
      setActivityTemplates(uniqueTemplates);

      await loadPreparation(initialDate);

      // Load existing reminder
      try {
        const reminderResponse = await getReminder();
        if (reminderResponse.success && reminderResponse.reminder) {
          setReminderData({
            text: reminderResponse.reminder.text || '',
            date: reminderResponse.reminder.date || '',
            recurring: reminderResponse.reminder.recurring || false,
          });
        }
      } catch (err) {
        debugError('Error loading reminder:', err);
      }
    } catch (err) {
      debugError('Error loading meeting data:', err);
      setError(err.message || t('error_loading_preparation_reunions'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle saving a reminder
   */
  const handleSaveReminder = async () => {
    if (!reminderData.date) {
      setError(t('error') + ': ' + t('reminder_date') + ' ' + t('required'));
      return;
    }

    setSavingReminder(true);
    try {
      const payload = {
        text: SecurityUtils.sanitizeInput(reminderData.text),
        date: SecurityUtils.sanitizeInput(reminderData.date),
        recurring: reminderData.recurring,
      };

      const response = await saveReminder(payload);
      if (!response.success) {
        throw new Error(response.message || t('error_saving_reminder'));
      }

      Alert.alert(t('success'), t('reminder_saved_successfully'));
    } catch (err) {
      debugError('Error saving reminder:', err);
      setError(err.message || t('error_saving_reminder'));
    } finally {
      setSavingReminder(false);
    }
  };

  useEffect(() => {
    loadMeetingData();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      loadPreparation(selectedDate);
    }
  }, [selectedDate]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMeetingData();
    setRefreshing(false);
  };

  /**
   * Update activity entry in state.
   * @param {number} index - Activity index.
   * @param {string} key - Field name.
   * @param {string} value - Field value.
   */
  const updateActivity = (index, key, value) => {
    setActivities((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const addActivity = () => {
    setActivities((prev) => [...prev, EMPTY_ACTIVITY]);
  };

  const removeActivity = (index) => {
    setActivities((prev) => prev.filter((_, idx) => idx !== index));
  };

  /**
   * Create new meeting
   */
  const createNewMeeting = () => {
    Alert.alert(
      t('new_meeting'),
      t('create_new_meeting_confirm') || t('new_meeting'),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('create'),
          onPress: () => {
            const newDate = DateUtils.formatDate(new Date());
            
            // Initialize with template activities
            const defaultActivities = activityManagerRef.current
              ? activityManagerRef.current.initializePlaceholderActivities()
              : [EMPTY_ACTIVITY];
            
            setSelectedDate(newDate);
            setFormData({
              date: newDate,
              animateur_responsable: '',
              youth_of_honor: [],
              endroit: formData.endroit || '',
              notes: '',
            });
            setActivities(defaultActivities.length > 0 ? defaultActivities : [EMPTY_ACTIVITY]);
            setCustomDate('');
          },
        },
      ]
    );
  };

  /**
   * Export/share meeting
   */
  const handleExport = async () => {
    try {
      const text = `
MEETING PREPARATION
Date: ${formData.date}
Location: ${formData.endroit}
Leader: ${formData.animateur_responsable}
Honors: ${honorList.join(', ')}

ACTIVITIES:
${activities
  .map(
    (a, i) => `
${i + 1}. ${a.activity}
   Time: ${a.time} | Duration: ${a.duration}
   Responsible: ${a.responsable}
   Materials: ${a.materiel}
`
  )
  .join('')}

NOTES:
${formData.notes}
      `.trim();

      await Share.share({
        message: text,
        title: `Meeting Preparation - ${formData.date}`,
      });
    } catch (err) {
      debugError('Error exporting meeting:', err);
    }
  };

  /**
   * Show activity description
   */
  const showActivityDescription = (activityName) => {
    const manager = activityManagerRef.current;
    if (!manager) return;

    const description = manager.getActivityDescription(activityName);
    if (description) {
      setDescriptionModal({
        visible: true,
        title: activityName,
        description,
      });
    }
  };

  const handleSave = async () => {
    // Validation
    if (!formData.date) {
      setError(t('error') + ': ' + t('date') + ' ' + t('required'));
      return;
    }
    if (!formData.animateur_responsable) {
      setError(t('error') + ': ' + t('animateur_responsable') + ' ' + t('required'));
      return;
    }
    if (!formData.endroit) {
      setError(t('error') + ': ' + t('meeting_location') + ' ' + t('required'));
      return;
    }

    setSaving(true);
    try {
      // Filter empty activities
      const validActivities = activities.filter(
        (a) => a.time || a.duration || a.activity
      );
      const payload = {
        date: SecurityUtils.sanitizeInput(formData.date),
        animateur_responsable: SecurityUtils.sanitizeInput(formData.animateur_responsable),
        youth_of_honor: honorList.map((name) => SecurityUtils.sanitizeInput(name)),
        endroit: SecurityUtils.sanitizeInput(formData.endroit),
        notes: SecurityUtils.sanitizeInput(formData.notes),
        activities: activities.map((activity) => ({
          time: SecurityUtils.sanitizeInput(activity.time),
          duration: SecurityUtils.sanitizeInput(activity.duration),
          activity: SecurityUtils.sanitizeInput(activity.activity),
          responsable: SecurityUtils.sanitizeInput(activity.responsable),
          materiel: SecurityUtils.sanitizeInput(activity.materiel),
        })),
      };

      const response = await saveReunionPreparation(payload);
      if (!response.success) {
        throw new Error(response.message || t('error_saving_reunion_preparation'));
      }

      debugLog('Meeting preparation saved:', payload);
      Alert.alert(t('success'), t('reunion_preparation_saved'));
      setSelectedDate(payload.date);
      await loadMeetingData();
    } catch (err) {
      debugError('Error saving meeting preparation:', err);
      setError(err.message || t('error_saving_reunion_preparation'));
    } finally {
      setSaving(false);
    }
  };

  const handleDateSubmit = () => {
    const sanitized = SecurityUtils.sanitizeInput(customDate);
    if (!sanitized) {
      setError(t('error_loading_meeting_data'));
      return;
    }

    setSelectedDate(sanitized);
    setCustomDate('');
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadMeetingData} />;
  }

  return (
    <ScrollView
      style={commonStyles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('preparation_reunions')}</Text>
        <Text style={styles.subtitle}>{t('meeting')}</Text>
      </View>

      <View style={styles.dateSection}>
        <Text style={styles.sectionTitle}>{t('select_date')}</Text>
        <View style={{ marginBottom: 16 }}>
          <Picker
            selectedValue={selectedDate}
            onValueChange={(date) => setSelectedDate(date)}
            style={[commonStyles.input]}
          >
            <Picker.Item label={t('select_date')} value="" />
            {availableDates.map((date) => (
              <Picker.Item
                key={date}
                label={DateUtils.formatDate(date)}
                value={date}
              />
            ))}
          </Picker>
        </View>
        <View style={styles.customDateRow}>
          <TextInput
            style={styles.input}
            placeholder={t('date')}
            value={customDate}
            onChangeText={setCustomDate}
          />
          <Button title={t('update')} onPress={handleDateSubmit} />
        </View>

        <Button
          title={t('new_meeting')}
          onPress={createNewMeeting}
          variant="secondary"
          style={styles.newMeetingBtn}
        />
      </View>

      <View style={styles.formSection}>
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('meeting')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('date')}
            value={formData.date}
            onChangeText={(value) => setFormData((prev) => ({ ...prev, date: value }))}
          />
          <TextInput
            style={styles.input}
            placeholder={t('animateur_responsable')}
            value={formData.animateur_responsable}
            onChangeText={(value) =>
              setFormData((prev) => ({ ...prev, animateur_responsable: value }))
            }
          />
          <View style={{ marginBottom: 16 }}>
            <Picker
              selectedValue={formData.animateur_responsable}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, animateur_responsable: value }))
              }
              style={[commonStyles.input]}
            >
              <Picker.Item label={t('select')} value="" />
              {animateurs.map((animateur) => (
                <Picker.Item
                  key={animateur.id}
                  label={animateur.full_name || animateur.name || ''}
                  value={animateur.id}
                />
              ))}
            </Picker>
          </View>
          <TextInput
            style={styles.input}
            placeholder={t('meeting_location_placeholder')}
            value={formData.endroit}
            onChangeText={(value) => setFormData((prev) => ({ ...prev, endroit: value }))}
          />
          <TextInput
            style={styles.input}
            placeholder={t('youth_of_honor')}
            value={Array.isArray(formData.youth_of_honor) ? formData.youth_of_honor.join(', ') : formData.youth_of_honor}
            onChangeText={(value) =>
              setFormData((prev) => ({
                ...prev,
                youth_of_honor: value.split(',').map(name => name.trim()).filter(Boolean)
              }))
            }
          />
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder={t('notes')}
            multiline
            value={formData.notes}
            onChangeText={(value) => setFormData((prev) => ({ ...prev, notes: value }))}
          />
        </Card>
      </View>

      <View style={styles.activitiesSection}>
        <View style={styles.activitiesSectionHeader}>
          <Text style={styles.sectionTitle}>{t('activite_responsable_materiel')}</Text>
          <TouchableOpacity
            onPress={() => setQuickEditMode(!quickEditMode)}
            style={styles.quickEditToggle}
          >
            <Text style={styles.quickEditLabel}>
              {t('quick_edit')}: {quickEditMode ? t('on') : t('off')}
            </Text>
          </TouchableOpacity>
        </View>
        {activities.map((activity, index) => (
          <Card
            key={`activity-${index}`}
            style={[
              styles.activityCard,
              expandedActivityIndex === index && styles.activityCardExpanded,
            ]}
          >
            <TouchableOpacity
              onPress={() =>
                setExpandedActivityIndex(
                  expandedActivityIndex === index ? null : index
                )
              }
              style={styles.activityHeader}
            >
              <Text style={styles.activityTitle}>
                {t('activity')} #{index + 1}: {activity.activity || t('empty')}
              </Text>
              <Text style={styles.expandIcon}>
                {expandedActivityIndex === index ? '▼' : '▶'}
              </Text>
            </TouchableOpacity>

            {(expandedActivityIndex === index || !quickEditMode) && (
              <View>
                <View>
                  <TextInput
                    style={[styles.input, styles.halfInput]}
                    placeholder={t('meeting_time')}
                    value={activity.time}
                    onChangeText={(value) => updateActivity(index, 'time', value)}
                  />
                  <TextInput
                    style={[styles.input, styles.halfInput]}
                    placeholder={t('heure_et_duree')}
                    value={activity.duration}
                    onChangeText={(value) => updateActivity(index, 'duration', value)}
                  />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder={t('activity')}
                  value={activity.activity}
                  onChangeText={(value) => updateActivity(index, 'activity', value)}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.templatesScroll}
                >
                  <View style={styles.templateRow}>
                    {activityTemplates.map((template, templateIndex) => (
                      <TouchableOpacity
                        key={`template-${index}-${templateIndex}`}
                        style={styles.templateChip}
                        onPress={() =>
                          updateActivity(index, 'activity', template.activity)
                        }
                        onLongPress={() =>
                          showActivityDescription(template.activity)
                        }
                      >
                        <Text style={styles.templateChipText}>
                          {template.activity}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <Text style={styles.inputLabel}>
                  {t('animateur_responsable')}
                </Text>
                <Picker
                  selectedValue={activity.responsable}
                  onValueChange={(value) =>
                    updateActivity(index, 'responsable', value)
                  }
                  style={[commonStyles.input]}
                >
                  <Picker.Item label={t('select')} value="" />
                  {animateurs.map((animateur) => (
                    <Picker.Item
                      key={animateur.id}
                      label={animateur.full_name || animateur.name || ''}
                      value={animateur.id}
                    />
                  ))}
                </Picker>
                <TextInput
                  style={styles.input}
                  placeholder={t('materiel')}
                  value={activity.materiel}
                  onChangeText={(value) => updateActivity(index, 'materiel', value)}
                />
                <Button
                  title={t('delete')}
                  variant="danger"
                  onPress={() => removeActivity(index)}
                  disabled={activities.length === 1}
                />
              </View>
            )}
          </Card>
        ))}
        <Button title={t('Add')} onPress={addActivity} variant="secondary" style={styles.addActivityBtn} />
      </View>

      <View style={styles.reminderSection}>
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('set_reminder')}</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder={t('reminder_text')}
            multiline
            value={reminderData.text}
            onChangeText={(value) =>
              setReminderData((prev) => ({ ...prev, text: value }))
            }
          />
          <TextInput
            style={styles.input}
            placeholder={t('reminder_date')}
            value={reminderData.date}
            onChangeText={(value) =>
              setReminderData((prev) => ({ ...prev, date: value }))
            }
          />
          <View style={styles.recurringToggle}>
            <Text style={styles.inputLabel}>{t('recurring_reminder')}</Text>
            <Switch
              value={reminderData.recurring}
              onValueChange={(value) =>
                setReminderData((prev) => ({
                  ...prev,
                  recurring: value,
                }))
              }
            />
          </View>
          <Button
            title={t('save_reminder')}
            onPress={handleSaveReminder}
            loading={savingReminder}
            variant="secondary"
          />
        </Card>
      </View>

      <View style={styles.actionButtons}>
        <Button
          title={t('export')}
          onPress={handleExport}
          variant="secondary"
          style={{ flex: 1, marginRight: 8 }}
        />
        <Button
          title={t('save')}
          onPress={handleSave}
          loading={saving}
          style={{ flex: 1 }}
        />
      </View>

      {/* Activity Description Modal */}
      <ActivityDescriptionModal
        visible={descriptionModal.visible}
        onClose={() =>
          setDescriptionModal({ ...descriptionModal, visible: false })
        }
        title={descriptionModal.title}
        description={descriptionModal.description}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  header: {
    padding: theme.spacing.lg,
  },
  errorBanner: {
    backgroundColor: theme.colors.error,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.surface,
    flex: 1,
    ...commonStyles.body,
  },
  errorClose: {
    color: theme.colors.surface,
    fontSize: 18,
    fontWeight: 'bold',
  },
  title: {
    ...commonStyles.heading2,
  },
  subtitle: {
    ...commonStyles.caption,
  },
  sectionTitle: {
    ...commonStyles.sectionTitle,
    marginBottom: theme.spacing.sm,
  },
  dateSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  dateChips: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  dateChip: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dateChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  dateChipText: {
    ...commonStyles.caption,
  },
  dateChipTextActive: {
    color: theme.colors.surface,
  },
  customDateRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  input: {
    ...commonStyles.input,
    marginBottom: theme.spacing.sm,
  },
  multilineInput: {
    minHeight: theme.spacing.xxl,
  },
  formSection: {
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  animateurRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  animateurChip: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  animateurChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  animateurChipText: {
    ...commonStyles.caption,
  },
  animateurChipTextActive: {
    color: theme.colors.surface,
  },
  activitiesSection: {
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  activitiesSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  quickEditToggle: {
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  quickEditLabel: {
    ...commonStyles.caption,
    fontSize: 12,
  },
  activityCard: {
    marginBottom: theme.spacing.md,
  },
  activityCardExpanded: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
  },
  activityTitle: {
    ...commonStyles.heading3,
  },
  expandIcon: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  activityRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  halfInput: {
    flex: 1,
  },
  templateRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  templateChip: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.secondary,
  },
  templateChipText: {
    ...commonStyles.caption,
  },
  reminderSection: {
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  checkboxText: {
    color: theme.colors.surface,
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkboxLabel: {
    ...commonStyles.body,
  },
  reminderSection: {
    paddingHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  recurringToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  templatesScroll: {
    marginBottom: theme.spacing.md,
  },
  inputLabel: {
    ...commonStyles.label,
    marginBottom: theme.spacing.xs,
  },
  newMeetingBtn: {
    marginTop: theme.spacing.md,
  },
  addActivityBtn: {
    marginTop: theme.spacing.md,
  },
});

export default MeetingPreparationScreen;