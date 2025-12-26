/**
 * MeetingPreparationScreen
 *
 * Mirrors spa/preparation_reunions.js for leaders.
 * Allows creating and updating meeting preparation details.
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
  getReunionDates,
  getReunionPreparation,
  saveReunionPreparation,
  getAnimateurs,
  getMeetingActivities,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import SecurityUtils from '../utils/SecurityUtils';
import { Button, Card, ErrorMessage, LoadingSpinner } from '../components';
import theme, { commonStyles } from '../theme';
import { debugError } from '../utils/DebugUtils';

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

  return {
    date: preparation.date || '',
    animateur_responsable: preparation.animateur_responsable || '',
    youth_of_honor: preparation.youth_of_honor || [],
    endroit: preparation.endroit || '',
    notes: preparation.notes || '',
    activities: preparation.activities || [],
  };
};

const MeetingPreparationScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [availableDates, setAvailableDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [customDate, setCustomDate] = useState('');
  const [animateurs, setAnimateurs] = useState([]);
  const [activityTemplates, setActivityTemplates] = useState([]);
  const [formData, setFormData] = useState({
    date: '',
    animateur_responsable: '',
    youth_of_honor: '',
    endroit: '',
    notes: '',
  });
  const [activities, setActivities] = useState([EMPTY_ACTIVITY]);
  const [saving, setSaving] = useState(false);

  const honorList = useMemo(() => {
    return formData.youth_of_honor
      ? formData.youth_of_honor.split(',').map((name) => name.trim()).filter(Boolean)
      : [];
  }, [formData.youth_of_honor]);

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
          youth_of_honor: normalized.youth_of_honor.join(', '),
          endroit: normalized.endroit,
          notes: normalized.notes,
        });
        setActivities(
          normalized.activities.length > 0 ? normalized.activities : [EMPTY_ACTIVITY]
        );
      } else {
        setFormData((prev) => ({ ...prev, date }));
        setActivities([EMPTY_ACTIVITY]);
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

      setAnimateurs(
        animateursResponse.success
          ? animateursResponse.animateurs || animateursResponse.data || []
          : []
      );
      setActivityTemplates(activitiesResponse.success ? activitiesResponse.data || [] : []);

      await loadPreparation(initialDate);
    } catch (err) {
      debugError('Error loading meeting data:', err);
      setError(err.message || t('error_loading_preparation_reunions'));
    } finally {
      setLoading(false);
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

  const handleSave = async () => {
    setSaving(true);
    try {
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.dateChips}>
            {availableDates.map((date) => (
              <TouchableOpacity
                key={date}
                onPress={() => setSelectedDate(date)}
                style={[
                  styles.dateChip,
                  selectedDate === date && styles.dateChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.dateChipText,
                    selectedDate === date && styles.dateChipTextActive,
                  ]}
                >
                  {DateUtils.formatDate(date)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <View style={styles.customDateRow}>
          <TextInput
            style={styles.input}
            placeholder={t('date')}
            value={customDate}
            onChangeText={setCustomDate}
          />
          <Button title={t('update')} onPress={handleDateSubmit} />
        </View>
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.animateurRow}>
              {animateurs.map((animateur) => (
                <TouchableOpacity
                  key={animateur.id}
                  style={[
                    styles.animateurChip,
                    formData.animateur_responsable === animateur.full_name &&
                      styles.animateurChipActive,
                  ]}
                  onPress={() =>
                    setFormData((prev) => ({
                      ...prev,
                      animateur_responsable: animateur.full_name,
                    }))
                  }
                >
                  <Text
                    style={[
                      styles.animateurChipText,
                      formData.animateur_responsable === animateur.full_name &&
                        styles.animateurChipTextActive,
                    ]}
                  >
                    {animateur.full_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <TextInput
            style={styles.input}
            placeholder={t('meeting_location_placeholder')}
            value={formData.endroit}
            onChangeText={(value) => setFormData((prev) => ({ ...prev, endroit: value }))}
          />
          <TextInput
            style={styles.input}
            placeholder={t('youth_of_honor')}
            value={formData.youth_of_honor}
            onChangeText={(value) =>
              setFormData((prev) => ({ ...prev, youth_of_honor: value }))
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
        <Text style={styles.sectionTitle}>{t('activite_responsable_materiel')}</Text>
        {activities.map((activity, index) => (
          <Card key={`activity-${index}`} style={styles.activityCard}>
            <Text style={styles.activityTitle}>
              {t('activity')} #{index + 1}
            </Text>
            <View style={styles.activityRow}>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.templateRow}>
                {activityTemplates.map((template) => (
                  <TouchableOpacity
                    key={`template-${template.id}-${index}`}
                    style={styles.templateChip}
                    onPress={() => updateActivity(index, 'activity', template.activity)}
                  >
                    <Text style={styles.templateChipText}>{template.activity}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <TextInput
              style={styles.input}
              placeholder={t('animateur_responsable')}
              value={activity.responsable}
              onChangeText={(value) => updateActivity(index, 'responsable', value)}
            />
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
          </Card>
        ))}
        <Button title={t('Add')} onPress={addActivity} variant="secondary" />
      </View>

      <View style={styles.saveSection}>
        <Button title={t('save')} onPress={handleSave} loading={saving} />
      </View>
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
  activityCard: {
    marginBottom: theme.spacing.md,
  },
  activityTitle: {
    ...commonStyles.heading3,
    marginBottom: theme.spacing.sm,
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
  saveSection: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
});

export default MeetingPreparationScreen;
