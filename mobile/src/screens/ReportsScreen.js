/**
 * Reports Screen
 *
 * Mirrors spa/reports.js functionality
 * Dashboard for accessing various reports (health, attendance, finance, etc.)
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingState,
  Card,
  EmptyState,
} from '../components';
import { canViewReports } from '../utils/PermissionUtils';
import { debugError } from '../utils/DebugUtils';

const ReportsScreen = ({ navigation }) => {
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      if (!canViewReports()) {
        Alert.alert(
          t('access_denied'),
          t('no_permission_to_view_reports'),
          [
            {
              text: t('OK'),
              onPress: () => navigation.goBack(),
            },
          ]
        );
        return;
      }

      setLoading(false);
    } catch (err) {
      debugError('Error checking permissions:', err);
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await checkPermissions();
    setRefreshing(false);
  };

  const handleReportPress = (reportType, reportTitle) => {
    // Special case: time-since-registration navigates to dedicated screen
    if (reportType === 'time-since-registration') {
      navigation.navigate('TimeSinceRegistration');
      return;
    }

    // Navigate to ReportViewer screen for all other reports
    navigation.navigate('ReportViewer', {
      reportType,
      reportTitle,
    });
  };

  const renderReportButton = (icon, title, description, reportType) => {
    return (
      <TouchableOpacity
        key={reportType}
        style={styles.reportButton}
        onPress={() => handleReportPress(reportType, title)}
        activeOpacity={0.7}
      >
        <View style={styles.reportButtonIcon}>
          <Text style={styles.reportButtonIconText}>{icon}</Text>
        </View>
        <View style={styles.reportButtonContent}>
          <Text style={styles.reportButtonTitle}>{title}</Text>
          <Text style={styles.reportButtonDescription}>{description}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && !refreshing) {
    return <LoadingState message={t('loading')} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.kicker}>{t('reports')}</Text>
          <Text style={styles.title}>{t('reports_title')}</Text>
          <Text style={styles.subtitle}>{t('reports_intro')}</Text>
        </Card>

        {/* Health & Medical Section */}
        <View style={styles.categorySection}>
          <Text style={styles.categoryTitle}>{t('health_medical_category')}</Text>
          <View style={styles.reportsGrid}>
            {renderReportButton(
              '🏥',
              t('health_report_title'),
              t('health_report_desc'),
              'health'
            )}
            {renderReportButton(
              '⚠️',
              t('allergies_report_title'),
              t('allergies_report_desc'),
              'allergies'
            )}
            {renderReportButton(
              '💊',
              t('medication_report_title'),
              t('medication_report_desc'),
              'medication'
            )}
            {renderReportButton(
              '💉',
              t('vaccine_report_title'),
              t('vaccine_report_desc'),
              'vaccines'
            )}
          </View>
        </View>

        {/* Permissions & Documents Section */}
        <View style={styles.categorySection}>
          <Text style={styles.categoryTitle}>{t('permissions_documents_category')}</Text>
          <View style={styles.reportsGrid}>
            {renderReportButton(
              '🚶',
              t('leave_alone_report_title'),
              t('leave_alone_report_desc'),
              'leave-alone'
            )}
            {renderReportButton(
              '📸',
              t('media_authorization_report_title'),
              t('media_authorization_report_desc'),
              'media-authorization'
            )}
            {renderReportButton(
              '📋',
              t('missing_documents_report_title'),
              t('missing_documents_report_desc'),
              'missing-documents'
            )}
          </View>
        </View>

        {/* Attendance & Participation Section */}
        <View style={styles.categorySection}>
          <Text style={styles.categoryTitle}>{t('attendance_participation_category')}</Text>
          <View style={styles.reportsGrid}>
            {renderReportButton(
              '✓',
              t('attendance_report_title'),
              t('attendance_report_desc'),
              'attendance'
            )}
            {renderReportButton(
              '🎂',
              t('participant_age_report_title'),
              t('participant_age_report_desc'),
              'participant-age'
            )}
            {renderReportButton(
              '📅',
              t('time_since_registration_report_title'),
              t('time_since_registration_report_desc'),
              'time-since-registration'
            )}
          </View>
        </View>

        {/* Progression & Recognition Section */}
        <View style={styles.categorySection}>
          <Text style={styles.categoryTitle}>{t('progression_recognition_category')}</Text>
          <View style={styles.reportsGrid}>
            {renderReportButton(
              '📊',
              t('participant_progress_report_title'),
              t('participant_progress_report_desc'),
              'participant-progress'
            )}
            {renderReportButton(
              '🏆',
              t('honors_report_title'),
              t('honors_report_desc'),
              'honors'
            )}
            {renderReportButton(
              '⭐',
              t('points_report_title'),
              t('points_report_desc'),
              'points'
            )}
          </View>
        </View>

        {/* Financial Section */}
        <View style={styles.categorySection}>
          <Text style={styles.categoryTitle}>{t('financial_category')}</Text>
          <View style={styles.reportsGrid}>
            {renderReportButton(
              '💰',
              t('financial_report_title'),
              t('financial_report_desc'),
              'financial'
            )}
          </View>
        </View>

        {/* Advanced Reports Section */}
        <View style={styles.categorySection}>
          <Text style={styles.categoryTitle}>{t('advanced_reports_category')}</Text>
          <View style={styles.reportsGrid}>
            {renderReportButton(
              '📋',
              t('missing_fields_report_title'),
              t('missing_fields_report_desc'),
              'missing-fields'
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
  },
  headerCard: {
    marginBottom: theme.spacing.lg,
    alignItems: 'center',
  },
  kicker: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
    textTransform: 'uppercase',
    marginBottom: theme.spacing.xs,
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
  },
  categorySection: {
    marginBottom: theme.spacing.lg,
  },
  categoryTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  reportsGrid: {
    gap: theme.spacing.sm,
  },
  reportButton: {
    flexDirection: 'row',
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderLight,
    marginBottom: theme.spacing.sm,
    minHeight: theme.touchTarget.min * 2,
    ...theme.shadows.sm,
  },
  reportButtonIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.primaryLight || theme.colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  reportButtonIconText: {
    fontSize: theme.fontSize.xl,
  },
  reportButtonContent: {
    flex: 1,
    justifyContent: 'center',
  },
  reportButtonTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  reportButtonDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    lineHeight: theme.lineHeight.relaxed * theme.fontSize.sm,
  },
});

export default ReportsScreen;