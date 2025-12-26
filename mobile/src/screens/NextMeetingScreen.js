/**
 * NextMeetingScreen
 *
 * Mirrors spa/upcoming_meeting.js for leaders.
 * Displays the next scheduled meeting preparation details.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { getNextMeetingInfo } from '../api/api-endpoints';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import { Card, ErrorMessage, LoadingSpinner } from '../components';
import theme, { commonStyles } from '../theme';
import { debugError } from '../utils/DebugUtils';

const NextMeetingScreen = () => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [meeting, setMeeting] = useState(null);

  /**
   * Load the next meeting information.
   */
  const loadNextMeeting = async () => {
    try {
      setError('');
      const response = await getNextMeetingInfo();
      if (response.success) {
        setMeeting(response.meeting || null);
      } else {
        setMeeting(null);
      }
    } catch (err) {
      debugError('Error loading next meeting info:', err);
      setError(err.message || t('error_loading_upcoming_meeting'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNextMeeting();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNextMeeting();
    setRefreshing(false);
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadNextMeeting} />;
  }

  return (
    <ScrollView
      style={commonStyles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{t('next_meeting')}</Text>
        <Text style={styles.subtitle}>{t('upcoming_meeting')}</Text>
      </View>

      {meeting ? (
        <View style={styles.content}>
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('meeting_date_label')}</Text>
            <Text style={styles.valueText}>{DateUtils.formatDate(meeting.date)}</Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('meeting_location')}</Text>
            <Text style={styles.valueText}>{meeting.endroit || t('meeting_location')}</Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('animateur_responsable')}</Text>
            <Text style={styles.valueText}>
              {meeting.animateur_responsable || t('animateur_responsable')}
            </Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('youth_of_honor')}</Text>
            {meeting.youth_of_honor?.length ? (
              meeting.youth_of_honor.map((name, index) => (
                <Text key={`honor-${index}`} style={styles.valueText}>
                  • {name}
                </Text>
              ))
            ) : (
              <Text style={styles.valueText}>{t('no_honors_on_this_date')}</Text>
            )}
          </Card>

          {meeting.activities?.length ? (
            <Card style={styles.card}>
              <Text style={styles.sectionTitle}>{t('activities')}</Text>
              {meeting.activities.map((activity, index) => (
                <View key={`activity-${index}`} style={styles.activityRow}>
                  <Text style={styles.valueText}>
                    {activity.time} · {activity.activity || t('activity')}
                  </Text>
                  {activity.responsable ? (
                    <Text style={styles.captionText}>{activity.responsable}</Text>
                  ) : null}
                </View>
              ))}
            </Card>
          ) : null}

          {meeting.notes ? (
            <Card style={styles.card}>
              <Text style={styles.sectionTitle}>{t('notes')}</Text>
              <Text style={styles.valueText}>{meeting.notes}</Text>
            </Card>
          ) : null}
        </View>
      ) : (
        <Card style={styles.card}>
          <Text style={styles.emptyText}>{t('no_upcoming_meeting')}</Text>
        </Card>
      )}
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
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    ...commonStyles.sectionTitle,
    marginBottom: theme.spacing.sm,
  },
  valueText: {
    ...commonStyles.bodyText,
  },
  captionText: {
    ...commonStyles.caption,
  },
  activityRow: {
    marginBottom: theme.spacing.sm,
  },
  emptyText: {
    ...commonStyles.bodyText,
    textAlign: 'center',
  },
});

export default NextMeetingScreen;
