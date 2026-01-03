/**
 * Activity Detail Screen
 *
 * PLACEHOLDER - Minimal implementation to prevent crashes
 * TODO: Implement full activity CRUD functionality matching spa/activities.js
 *
 * This screen needs:
 * - Activity view/edit form
 * - Create new activity form
 * - Activity details (date, time, location, participants)
 * - Carpool integration
 * - Delete confirmation
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getActivity, createActivity, updateActivity, deleteActivity } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import theme, { commonStyles } from '../theme';
import { Button, LoadingState, ErrorState, Card } from '../components';
import { debugLog, debugError } from '../utils/DebugUtils';

const ActivityDetailScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const activityId = route.params?.id;
  const isNewActivity = activityId === 'new';

  const [loading, setLoading] = useSafeState(!isNewActivity);
  const [error, setError] = useSafeState(null);
  const [saving, setSaving] = useSafeState(false);
  const [notifyParticipants, setNotifyParticipants] = useSafeState(true);

  // Form state
  const [formData, setFormData] = useSafeState({
    name: '',
    description: '',
    date: '',
    time: '',
    location: '',
    meeting_time_going: '',
    meeting_location_going: '',
    meeting_time_return: '',
    meeting_location_return: '',
  });

  useEffect(() => {
    if (!isNewActivity) {
      loadActivity();
    }
  }, [activityId]);

  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const loadActivity = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getActivity(activityId);

      if (response.success && response.data) {
        const activity = response.data;
        setFormData({
          name: activity.name || '',
          description: activity.description || '',
          date: activity.date || '',
          time: activity.time || '',
          location: activity.location || '',
          meeting_time_going: activity.meeting_time_going || '',
          meeting_location_going: activity.meeting_location_going || '',
          meeting_time_return: activity.meeting_time_return || '',
          meeting_location_return: activity.meeting_location_return || '',
        });
      } else {
        throw new Error(response.message || t('error_loading_activity'));
      }
    } catch (err) {
      debugError('Error loading activity:', err);
      setError(err.message || t('error_loading_activity'));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    // Basic validation
    if (!formData.name.trim()) {
      Alert.alert(t('error'), t('activity_name_required'));
      return;
    }

    if (!formData.date.trim()) {
      Alert.alert(t('error'), t('activity_date_required'));
      return;
    }

    try {
      setSaving(true);

      // Prepare activity data with trimmed values
      const activityData = Object.keys(formData).reduce((acc, key) => {
        const value = formData[key];
        acc[key] = typeof value === 'string' ? value.trim() : value;
        // Convert empty strings to null for optional fields
        if (acc[key] === '' && key !== 'name' && key !== 'date') {
          acc[key] = null;
        }
        return acc;
      }, {});

      if (!isNewActivity) {
        activityData.notify_participants = notifyParticipants;
      }

      let response;
      if (isNewActivity) {
        response = await createActivity(activityData);
      } else {
        response = await updateActivity(activityId, activityData);
      }

      if (response.success) {
        Alert.alert(
          t('success'),
          isNewActivity ? t('activity_created') : t('activity_updated'),
          [
            {
              text: t('ok'),
              onPress: () => navigation.goBack(),
            },
          ]
        );
      } else {
        throw new Error(response.message || t('error_saving_activity'));
      }
    } catch (err) {
      debugError('Error saving activity:', err);
      Alert.alert(t('error'), err.message || t('error_saving_activity'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      t('confirm_delete'),
      t('confirm_delete_activity_message'),
      [
        {
          text: t('cancel'),
          style: 'cancel',
        },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              setSaving(true);
              const response = await deleteActivity(activityId);

              if (response.success) {
                Alert.alert(
                  t('success'),
                  t('activity_deleted'),
                  [
                    {
                      text: t('ok'),
                      onPress: () => navigation.goBack(),
                    },
                  ]
                );
              } else {
                throw new Error(response.message || t('error_deleting_activity'));
              }
            } catch (err) {
              debugError('Error deleting activity:', err);
              Alert.alert(t('error'), err.message || t('error_deleting_activity'));
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return <LoadingState message={t('loading_activity')} />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadActivity} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>
            {isNewActivity ? t('create_activity') : t('edit_activity')}
          </Text>

          <Text style={styles.label}>{t('activity_name')} *</Text>
          <TextInput
            style={styles.input}
            value={formData.name}
            onChangeText={(value) => handleFieldChange('name', value)}
            placeholder={t('enter_activity_name')}
          />

          <Text style={styles.label}>{t('description')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.description}
            onChangeText={(value) => handleFieldChange('description', value)}
            placeholder={t('enter_description')}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.label}>{t('date')} *</Text>
          <TextInput
            style={styles.input}
            value={formData.date}
            onChangeText={(value) => handleFieldChange('date', value)}
            placeholder="YYYY-MM-DD"
          />

          <Text style={styles.label}>{t('time')}</Text>
          <TextInput
            style={styles.input}
            value={formData.time}
            onChangeText={(value) => handleFieldChange('time', value)}
            placeholder="HH:MM"
          />

          <Text style={styles.label}>{t('location')}</Text>
          <TextInput
            style={styles.input}
            value={formData.location}
            onChangeText={(value) => handleFieldChange('location', value)}
            placeholder={t('enter_location')}
          />
        </Card>

        {/* Meeting Times Card */}
        <Card style={styles.formCard}>
          <Text style={styles.sectionTitle}>{t('Meeting Times')}</Text>

          <Text style={styles.subSectionTitle}>{t('Going to Activity')}</Text>
          <Text style={styles.label}>{t('meeting_time')}</Text>
          <TextInput
            style={styles.input}
            value={formData.meeting_time_going}
            onChangeText={(value) => handleFieldChange('meeting_time_going', value)}
            placeholder="HH:MM"
          />

          <Text style={styles.label}>{t('meeting_location')}</Text>
          <TextInput
            style={styles.input}
            value={formData.meeting_location_going}
            onChangeText={(value) => handleFieldChange('meeting_location_going', value)}
            placeholder={t('enter_location')}
          />

          <Text style={[styles.subSectionTitle, styles.subSectionSpacing]}>
            {t('Returning from Activity')}
          </Text>
          <Text style={styles.label}>{t('meeting_time')}</Text>
          <TextInput
            style={styles.input}
            value={formData.meeting_time_return}
            onChangeText={(value) => handleFieldChange('meeting_time_return', value)}
            placeholder="HH:MM"
          />

          <Text style={styles.label}>{t('meeting_location')}</Text>
          <TextInput
            style={styles.input}
            value={formData.meeting_location_return}
            onChangeText={(value) => handleFieldChange('meeting_location_return', value)}
            placeholder={t('enter_location')}
          />

          {!isNewActivity && (
            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>
                  {t('activity_notify_updates_label')}
                </Text>
                <Text style={styles.toggleHelp}>
                  {t('activity_notify_updates_help')}
                </Text>
              </View>
              <Switch
                value={notifyParticipants}
                onValueChange={setNotifyParticipants}
                trackColor={{ false: theme.colors.borderLight, true: theme.colors.primary }}
                thumbColor={theme.colors.surface}
              />
            </View>
          )}

          <View style={styles.buttonContainer}>
            <Button
              title={isNewActivity ? t('create') : t('save')}
              onPress={handleSave}
              disabled={saving}
              variant="primary"
              style={styles.saveButton}
            />

            {!isNewActivity && (
              <Button
                title={t('delete')}
                onPress={handleDelete}
                disabled={saving}
                variant="danger"
                style={styles.deleteButton}
              />
            )}
          </View>
        </Card>

        {/* Future features */}
        <Card style={styles.todoCard}>
          <Text style={styles.todoTitle}>🚧 {t('coming_soon')}</Text>
          <Text style={styles.todoText}>
            {t('additional_features_coming_soon')}:
          </Text>
          <Text style={styles.todoItem}>• {t('participant_assignment')}</Text>
          <Text style={styles.todoItem}>• {t('carpool_coordination')}</Text>
          <Text style={styles.todoItem}>• {t('attendance_tracking')}</Text>
        </Card>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.md,
  },
  formCard: {
    marginBottom: theme.spacing.md,
  },
  formTitle: {
    ...commonStyles.heading2,
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    ...commonStyles.heading3,
    marginBottom: theme.spacing.md,
  },
  subSectionTitle: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.bold,
    fontSize: 16,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    color: theme.colors.primary,
  },
  subSectionSpacing: {
    marginTop: theme.spacing.lg,
  },
  label: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.semibold,
    marginBottom: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  input: {
    ...commonStyles.input,
    marginBottom: theme.spacing.sm,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing.md,
  },
  toggleText: {
    flex: 1,
    marginRight: theme.spacing.md,
  },
  toggleLabel: {
    ...commonStyles.bodyText,
    fontWeight: theme.fontWeight.semibold,
  },
  toggleHelp: {
    ...commonStyles.bodyText,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
  buttonContainer: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  saveButton: {
    marginBottom: theme.spacing.sm,
  },
  deleteButton: {
    marginBottom: theme.spacing.sm,
  },
  todoCard: {
    backgroundColor: theme.colors.warning + '10',
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.warning,
  },
  todoTitle: {
    ...commonStyles.heading3,
    marginBottom: theme.spacing.sm,
  },
  todoText: {
    ...commonStyles.bodyText,
    marginBottom: theme.spacing.sm,
  },
  todoItem: {
    ...commonStyles.bodyText,
    marginLeft: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
});

export default ActivityDetailScreen;