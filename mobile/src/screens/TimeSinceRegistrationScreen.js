/**
 * Time Since Registration Screen
 *
 * Shows time elapsed since participant registration
 * Mirrors spa time-since-registration functionality
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import { LoadingSpinner, Card, EmptyState } from '../components';
import { getParticipants } from '../api/api-endpoints';
import { debugLog, debugError } from '../utils/DebugUtils';

const TimeSinceRegistrationScreen = ({ navigation }) => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [participants, setParticipants] = useSafeState([]);
  const [error, setError] = useSafeState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getParticipants({ forceRefresh: true });
      if (response?.data) {
        // Calculate time since registration for each participant
        const participantsWithTime = response.data.map((p) => {
          const registrationDate = p.created_at || p.registration_date;
          if (!registrationDate) {
            return { ...p, daysSinceRegistration: null, monthsSinceRegistration: null };
          }

          const regDate = new Date(registrationDate);
          const now = new Date();
          const diffTime = Math.abs(now - regDate);
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          const diffMonths = Math.floor(diffDays / 30);

          return {
            ...p,
            registrationDate: regDate,
            daysSinceRegistration: diffDays,
            monthsSinceRegistration: diffMonths,
          };
        });

        // Sort by days since registration (newest first)
        participantsWithTime.sort((a, b) => {
          if (a.daysSinceRegistration === null) return 1;
          if (b.daysSinceRegistration === null) return -1;
          return a.daysSinceRegistration - b.daysSinceRegistration;
        });

        setParticipants(participantsWithTime);
      }
    } catch (err) {
      debugError('Error loading participants:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const formatTimeSince = (days, months) => {
    if (days === null || days === undefined) return t('unknown');

    if (days === 0) return t('today');
    if (days === 1) return t('yesterday');
    if (days < 30) return `${days} ${t('days')}`;
    if (months === 1) return `1 ${t('month')}`;
    if (months < 12) return `${months} ${t('months')}`;

    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;

    if (remainingMonths === 0) {
      return years === 1 ? `1 ${t('year')}` : `${years} ${t('years')}`;
    } else {
      return `${years} ${t('year')}${years > 1 ? 's' : ''}, ${remainingMonths} ${t('month')}${remainingMonths > 1 ? 's' : ''}`;
    }
  };

  const getTimeBadgeColor = (days) => {
    if (days === null) return theme.colors.textMuted;
    if (days < 30) return theme.colors.success; // New (< 1 month)
    if (days < 180) return theme.colors.primary; // Recent (< 6 months)
    if (days < 365) return theme.colors.warning; // Established (< 1 year)
    return theme.colors.error; // Long-time (> 1 year)
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return (
      <View style={commonStyles.container}>
        <EmptyState
          message={error}
          icon="⚠️"
          actionLabel={t('retry')}
          onAction={loadData}
        />
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
          <Text style={styles.title}>{t('time_since_registration_report_title')}</Text>
          <Text style={styles.subtitle}>{t('time_since_registration_report_desc')}</Text>
          <Text style={styles.count}>
            {participants.length} {t('participants')}
          </Text>
        </Card>

        {/* Participants List */}
        {participants.length === 0 ? (
          <EmptyState message={t('no_participants')} icon="👤" />
        ) : (
          participants.map((participant, index) => (
            <Card key={participant.id || index} style={styles.participantCard}>
              <View style={styles.participantHeader}>
                <View style={styles.participantInfo}>
                  <Text style={styles.participantName}>
                    {participant.first_name} {participant.last_name}
                  </Text>
                  {participant.group_name && (
                    <Text style={styles.groupName}>{participant.group_name}</Text>
                  )}
                </View>

                <View
                  style={[
                    styles.timeBadge,
                    {
                      backgroundColor: getTimeBadgeColor(participant.daysSinceRegistration),
                    },
                  ]}
                >
                  <Text style={styles.timeBadgeText}>
                    {formatTimeSince(
                      participant.daysSinceRegistration,
                      participant.monthsSinceRegistration
                    )}
                  </Text>
                </View>
              </View>

              {participant.registrationDate && (
                <View style={styles.dateRow}>
                  <Text style={styles.dateLabel}>{t('registered_on')}:</Text>
                  <Text style={styles.dateValue}>
                    {participant.registrationDate.toLocaleDateString()}
                  </Text>
                </View>
              )}

              {participant.daysSinceRegistration !== null && (
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{participant.daysSinceRegistration}</Text>
                    <Text style={styles.statLabel}>{t('days')}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{participant.monthsSinceRegistration}</Text>
                    <Text style={styles.statLabel}>{t('months')}</Text>
                  </View>
                  {participant.monthsSinceRegistration >= 12 && (
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>
                        {Math.floor(participant.monthsSinceRegistration / 12)}
                      </Text>
                      <Text style={styles.statLabel}>{t('years')}</Text>
                    </View>
                  )}
                </View>
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
  },
  headerCard: {
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  count: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  participantCard: {
    marginBottom: theme.spacing.md,
  },
  participantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  groupName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  timeBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
    marginLeft: theme.spacing.sm,
  },
  timeBadgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.white,
  },
  dateRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.sm,
  },
  dateLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginRight: theme.spacing.xs,
  },
  dateValue: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.semibold,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderLight,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  statLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
});

export default TimeSinceRegistrationScreen;