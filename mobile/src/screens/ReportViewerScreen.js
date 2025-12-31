/**
 * Report Viewer Screen
 *
 * Displays individual reports with data fetched from the backend
 * Mirrors spa/reports.js report rendering functionality
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import { LoadingSpinner, Card, EmptyState } from '../components';
import {
  getHealthReport,
  getAllergiesReport,
  getMedicationReport,
  getVaccineReport,
  getLeaveAloneReport,
  getMediaAuthorizationReport,
  getMissingDocumentsReport,
  getAttendanceReport,
  getParticipantAgeReport,
  getHonorsReport,
  getPointsReport,
  getFinanceReport,
  getParticipantProgressReport,
  getFormTypes,
  getFormStructure,
  getFormSubmissions,
} from '../api/api-endpoints';
import { debugLog, debugError } from '../utils/DebugUtils';

const ReportViewerScreen = ({ route, navigation }) => {
  const { reportType, reportTitle } = route.params;
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadReport();
  }, [reportType]);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);

      let data;
      switch (reportType) {
        case 'health':
          data = await getHealthReport();
          break;
        case 'allergies':
          data = await getAllergiesReport();
          break;
        case 'medication':
          data = await getMedicationReport();
          break;
        case 'vaccines':
          data = await getVaccineReport();
          break;
        case 'leave-alone':
          data = await getLeaveAloneReport();
          break;
        case 'media-authorization':
          data = await getMediaAuthorizationReport();
          break;
        case 'missing-documents':
          data = await getMissingDocumentsReport();
          break;
        case 'attendance':
          data = await getAttendanceReport();
          break;
        case 'participant-age':
          data = await getParticipantAgeReport();
          break;
        case 'honors':
          data = await getHonorsReport();
          break;
        case 'points':
          data = await getPointsReport();
          break;
        case 'financial':
          data = await getFinanceReport();
          break;
        case 'participant-progress':
          data = await getParticipantProgressReport();
          break;
        default:
          throw new Error(`Unknown report type: ${reportType}`);
      }

      debugLog('Report data loaded:', data);
      setReportData(data);
    } catch (err) {
      debugError('Error loading report:', err);
      setError(err.message || t('error_loading_report'));
    } finally {
      setLoading(false);
    }
  };

  const renderHealthReport = (data) => {
    if (!data?.data || !Array.isArray(data.data)) {
      return <EmptyState message={t('no_data_available')} />;
    }

    // Filter out participants with all empty fields
    const filteredParticipants = data.data.filter((participant) => {
      return !(
        !participant.epipen &&
        !participant.allergies &&
        !participant.health_issues &&
        !participant.injuries &&
        !participant.swimming_level &&
        !participant.leave_alone &&
        !participant.media_consent
      );
    });

    // Sort by last name
    const sortedParticipants = filteredParticipants.sort((a, b) =>
      a.last_name.localeCompare(b.last_name)
    );

    return (
      <View>
        {sortedParticipants.map((participant, index) => {
          const hasEpipen =
            participant.epipen === '1' ||
            participant.epipen === 'true' ||
            participant.epipen === true;
          const canLeaveAlone =
            participant.leave_alone === '1' ||
            participant.leave_alone === 'true' ||
            participant.leave_alone === true;
          const hasMediaConsent =
            participant.media_consent === '1' ||
            participant.media_consent === 'true' ||
            participant.media_consent === true;

          return (
            <Card key={index} style={styles.reportCard}>
              <Text style={styles.participantName}>
                {participant.first_name} {participant.last_name}
              </Text>

              <View style={styles.infoRow}>
                {canLeaveAlone && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>✓ {t('leave_alone')}</Text>
                  </View>
                )}
                {!hasMediaConsent && (
                  <View style={[styles.badge, styles.badgeWarning]}>
                    <Text style={styles.badgeText}>🚫 {t('no_media_consent')}</Text>
                  </View>
                )}
              </View>

              {participant.health_issues && (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{t('health_issues')}:</Text>
                  <Text style={styles.infoValue}>{participant.health_issues}</Text>
                </View>
              )}

              {participant.allergies && (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{t('allergies')}:</Text>
                  <Text style={styles.infoValue}>
                    {participant.allergies}
                    {hasEpipen && ' ⚠️ EPIPEN'}
                  </Text>
                </View>
              )}

              {participant.injuries && (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{t('injuries')}:</Text>
                  <Text style={styles.infoValue}>{participant.injuries}</Text>
                </View>
              )}

              {participant.swimming_level === 'ne_sait_pas_nager' && (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{t('swimming_level')}:</Text>
                  <Text style={styles.infoValue}>{t('doit_porter_vfi')}</Text>
                </View>
              )}

              {participant.swimming_level === 'eau_peu_profonde' && (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{t('swimming_level')}:</Text>
                  <Text style={styles.infoValue}>{t('eau_peu_profonde')}</Text>
                </View>
              )}
            </Card>
          );
        })}
      </View>
    );
  };

  const renderSimpleListReport = (data, columns) => {
    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      return <EmptyState message={t('no_data_available')} />;
    }

    return (
      <View>
        {data.data.map((item, index) => (
          <Card key={index} style={styles.reportCard}>
            <Text style={styles.participantName}>
              {item.first_name} {item.last_name}
            </Text>
            {item.group_name && (
              <Text style={styles.groupName}>{item.group_name}</Text>
            )}
            {columns.map((col, colIndex) => {
              const value = item[col.field];
              if (!value && value !== false) return null;

              let displayValue = value;
              if (col.type === 'boolean') {
                displayValue = (value === 'on' || value === 'true' || value === true)
                  ? t('yes')
                  : t('no');
              }

              return (
                <View key={colIndex} style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{col.label}:</Text>
                  <Text style={styles.infoValue}>{displayValue}</Text>
                </View>
              );
            })}
          </Card>
        ))}
      </View>
    );
  };

  const renderParticipantAgeReport = (data) => {
    if (!data?.participants || !Array.isArray(data.participants) || data.participants.length === 0) {
      return <EmptyState message={t('no_data_available')} />;
    }

    return (
      <View>
        {data.participants.map((item, index) => (
          <Card key={index} style={styles.reportCard}>
            <Text style={styles.participantName}>
              {item.first_name} {item.last_name}
            </Text>
            <View style={styles.infoSection}>
              <Text style={styles.infoLabel}>{t('birthdate')}:</Text>
              <Text style={styles.infoValue}>
                {item.date_naissance
                  ? new Date(item.date_naissance).toLocaleDateString()
                  : t('unknown')}
              </Text>
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.infoLabel}>{t('age')}:</Text>
              <Text style={styles.infoValue}>
                {item.age !== null ? item.age : t('unknown')}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    );
  };

  const renderPointsReport = (data) => {
    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      return <EmptyState message={t('no_data_available')} />;
    }

    // Group by group_name
    const grouped = {};
    data.data.forEach((participant) => {
      const groupName = participant.group_name || t('no_group');
      if (!grouped[groupName]) {
        grouped[groupName] = [];
      }
      grouped[groupName].push(participant);
    });

    return (
      <View>
        {Object.entries(grouped).map(([groupName, participants]) => (
          <View key={groupName} style={styles.groupSection}>
            <Text style={styles.groupHeader}>{groupName}</Text>
            {participants.map((participant, index) => (
              <Card key={index} style={styles.reportCard}>
                <Text style={styles.participantName}>
                  {participant.first_name} {participant.last_name}
                </Text>
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('points')}</Text>
                    <Text style={styles.statValue}>{participant.total_points || 0}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('honors_count')}</Text>
                    <Text style={styles.statValue}>{participant.honors_count || 0}</Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ))}
      </View>
    );
  };

  const renderHonorsReport = (data) => {
    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      return <EmptyState message={t('no_data_available')} />;
    }

    return (
      <View>
        {data.data.map((item, index) => (
          <Card key={index} style={styles.reportCard}>
            <Text style={styles.participantName}>{item.honor_name}</Text>
            {item.category && (
              <Text style={styles.groupName}>{item.category}</Text>
            )}
            <View style={styles.infoSection}>
              <Text style={styles.infoLabel}>{t('count')}:</Text>
              <Text style={styles.infoValue}>{item.count}</Text>
            </View>
            <View style={styles.infoSection}>
              <Text style={styles.infoLabel}>{t('recipients')}:</Text>
              <Text style={styles.infoValue}>
                {Array.isArray(item.recipients)
                  ? item.recipients.join(', ')
                  : item.recipients}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    );
  };

  const renderFinancialReport = (data) => {
    if (!data?.data) {
      return <EmptyState message={t('no_data_available')} />;
    }

    const { totals = {}, definitions = [], participants = [] } = data.data;

    const formatCurrency = (amount) => {
      return new Intl.NumberFormat('en-CA', {
        style: 'currency',
        currency: 'CAD',
      }).format(Number(amount) || 0);
    };

    return (
      <View>
        {/* Totals Summary */}
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>{t('financial_summary')}</Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{t('total_billed')}</Text>
              <Text style={styles.statValue}>
                {formatCurrency(totals.total_billed)}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{t('total_paid')}</Text>
              <Text style={styles.statValue}>
                {formatCurrency(totals.total_paid)}
              </Text>
            </View>
          </View>
          <View style={styles.outstandingSection}>
            <Text style={styles.statLabel}>{t('outstanding_balance')}</Text>
            <Text style={[styles.statValue, styles.outstandingValue]}>
              {formatCurrency(totals.total_outstanding)}
            </Text>
          </View>
        </Card>

        {/* By Year */}
        {definitions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('by_year')}</Text>
            {definitions.map((row, index) => (
              <Card key={index} style={styles.reportCard}>
                <Text style={styles.periodLabel}>
                  {row.year_start} → {row.year_end}
                </Text>
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('billed')}</Text>
                    <Text style={styles.statValue}>
                      {formatCurrency(row.total_billed)}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('paid')}</Text>
                    <Text style={styles.statValue}>
                      {formatCurrency(row.total_paid)}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('outstanding')}</Text>
                    <Text style={[styles.statValue, styles.outstandingValue]}>
                      {formatCurrency(row.total_outstanding)}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* By Participant */}
        {participants.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('by_participant')}</Text>
            {participants.map((p, index) => (
              <Card key={index} style={styles.reportCard}>
                <Text style={styles.participantName}>
                  {p.first_name} {p.last_name}
                </Text>
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('billed')}</Text>
                    <Text style={styles.statValue}>
                      {formatCurrency(p.total_billed)}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('paid')}</Text>
                    <Text style={styles.statValue}>
                      {formatCurrency(p.total_paid)}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>{t('outstanding')}</Text>
                    <Text style={[styles.statValue, styles.outstandingValue]}>
                      {formatCurrency(p.total_outstanding)}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderReport = () => {
    if (!reportData) return null;

    switch (reportType) {
      case 'health':
        return renderHealthReport(reportData);

      case 'allergies':
        return renderSimpleListReport(reportData, [
          { field: 'allergies', label: t('allergies') },
          { field: 'epipen', label: t('epipen'), type: 'boolean' },
        ]);

      case 'medication':
        return renderSimpleListReport(reportData, [
          { field: 'medication', label: t('medication') },
        ]);

      case 'vaccines':
        return renderSimpleListReport(reportData, [
          { field: 'vaccines_up_to_date', label: t('vaccines_up_to_date'), type: 'boolean' },
        ]);

      case 'leave-alone':
        return renderSimpleListReport(reportData, [
          { field: 'can_leave_alone', label: t('can_leave_alone'), type: 'boolean' },
        ]);

      case 'media-authorization':
        return renderSimpleListReport(reportData, [
          { field: 'media_authorized', label: t('media_authorized'), type: 'boolean' },
        ]);

      case 'missing-documents':
        return renderSimpleListReport(reportData, [
          { field: 'missing_documents', label: t('missing_documents') },
        ]);

      case 'participant-age':
        return renderParticipantAgeReport(reportData);

      case 'points':
        return renderPointsReport(reportData);

      case 'honors':
        return renderHonorsReport(reportData);

      case 'financial':
        return renderFinancialReport(reportData);

      case 'attendance':
      case 'participant-progress':
        // These require more complex rendering - show placeholder for now
        return (
          <Card style={styles.reportCard}>
            <Text style={styles.infoValue}>
              {t('complex_report_coming_soon')}
            </Text>
          </Card>
        );

      default:
        return <EmptyState message={t('unknown_report_type')} />;
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading_report')} />;
  }

  if (error) {
    return (
      <View style={commonStyles.container}>
        <EmptyState
          message={error}
          icon="⚠️"
          actionLabel={t('retry')}
          onAction={loadReport}
        />
      </View>
    );
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {renderReport()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
  },
  reportCard: {
    marginBottom: theme.spacing.md,
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
    marginBottom: theme.spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  badge: {
    backgroundColor: theme.colors.success,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
  },
  badgeWarning: {
    backgroundColor: theme.colors.error,
  },
  badgeText: {
    color: theme.colors.white,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  infoSection: {
    marginBottom: theme.spacing.sm,
  },
  infoLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  infoValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    lineHeight: theme.lineHeight.relaxed * theme.fontSize.base,
  },
  groupSection: {
    marginBottom: theme.spacing.lg,
  },
  groupHeader: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: theme.spacing.sm,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  statValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  summaryCard: {
    backgroundColor: theme.colors.primaryLight || theme.colors.secondary,
    marginBottom: theme.spacing.lg,
  },
  summaryTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    textAlign: 'center',
  },
  outstandingSection: {
    alignItems: 'center',
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  outstandingValue: {
    color: theme.colors.error,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
  },
  periodLabel: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
});

export default ReportViewerScreen;
