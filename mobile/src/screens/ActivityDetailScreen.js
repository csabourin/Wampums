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

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
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

  const [loading, setLoading] = useState(!isNewActivity);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');

  useEffect(() => {
    if (!isNewActivity) {
      loadActivity();
    }
  }, [activityId]);

  const loadActivity = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getActivity(activityId);

      if (response.success && response.data) {
        const activity = response.data;
        setName(activity.name || '');
        setDescription(activity.description || '');
        setDate(activity.date || '');
        setTime(activity.time || '');
        setLocation(activity.location || '');
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
    if (!name.trim()) {
      Alert.alert(t('error'), t('activity_name_required'));
      return;
    }

    if (!date.trim()) {
      Alert.alert(t('error'), t('activity_date_required'));
      return;
    }

    try {
      setSaving(true);

      const activityData = {
        name: name.trim(),
        description: description.trim(),
        date: date.trim(),
        time: time.trim(),
        location: location.trim(),
      };

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
            value={name}
            onChangeText={setName}
            placeholder={t('enter_activity_name')}
          />

          <Text style={styles.label}>{t('description')}</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('enter_description')}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.label}>{t('date')} *</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
          />

          <Text style={styles.label}>{t('time')}</Text>
          <TextInput
            style={styles.input}
            value={time}
            onChangeText={setTime}
            placeholder="HH:MM"
          />

          <Text style={styles.label}>{t('location')}</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder={t('enter_location')}
          />

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

        {/* TODO: Add additional sections:
          - Meeting times (going/return)
          - Participant list
          - Carpool management
          - Attendance link
        */}
        <Card style={styles.todoCard}>
          <Text style={styles.todoTitle}>🚧 {t('coming_soon')}</Text>
          <Text style={styles.todoText}>
            {t('additional_features_coming_soon')}:
          </Text>
          <Text style={styles.todoItem}>• {t('meeting_times')}</Text>
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
