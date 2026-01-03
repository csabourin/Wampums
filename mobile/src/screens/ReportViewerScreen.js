/**
 * Report Viewer Screen
 *
 * Displays individual reports with data fetched from the backend
 * Mirrors spa/reports.js report rendering functionality
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Picker,
} from 'react-native';
import { Picker as RNPicker } from '@react-native-picker/picker';
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
  const { reportType, reportTitle, participantId } = route.params;
  const [loading, setLoading] = useSafeState(true);
  const [reportData, setReportData] = useSafeState(null);
  const [error, setError] = useSafeState(null);

  // State for participant progress report
  const [participantList, setParticipantList] = useSafeState([]);
  const [selectedParticipantId, setSelectedParticipantId] = useSafeState(participantId || null);

  // State for missing fields report
  const [formTypes, setFormTypes] = useSafeState([]);
  const [selectedFormType, setSelectedFormType] = useSafeState(null);

  useEffect(() => {
    loadReport();
  }, [reportType]);

  useEffect(() => {
    if (reportType === 'participant-progress' && selectedParticipantId) {
      loadParticipantProgress(selectedParticipantId);
    }
  }, [selectedParticipantId]);

  useEffect(() => {
    if (reportType === 'missing-fields' && selectedFormType) {
      loadMissingFieldsReport(selectedFormType);
    }
  }, [selectedFormType]);

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
          if (data?.data?.participants) {
            setParticipantList(data.data.participants);
            if (!selectedParticipantId && data.data.participants.length > 0) {
              setSelectedParticipantId(data.data.participants[0].id);
            }
          }
          break;
        case 'missing-fields':
          // Load form types first
          const formTypesResponse = await getFormTypes();
          if (formTypesResponse?.data) {
            setFormTypes(formTypesResponse.data);
            if (!selectedFormType && formTypesResponse.data.length > 0) {
              setSelectedFormType(formTypesResponse.data[0]);
            }
          }
          setReportData({ success: true, data: null }); // Will load data when form type selected
          setLoading(false);
          return;
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

  const loadParticipantProgress = async (participantId) => {
    try {
      setLoading(true);
      const data = await getParticipantProgressReport(participantId);
      setReportData(data);
    } catch (err) {
      debugError('Error loading participant progress:', err);
      setError(err.message || t('error_loading_report'));
    } finally {
      setLoading(false);
    }
  };

  const loadMissingFieldsReport = async (formType) => {
    try {
      setLoading(true);
      const [submissions, structure] = await Promise.all([
        getFormSubmissions(null, formType),
        getFormStructure(),
      ]);
      setReportData({ success: true, data: { submissions: submissions.data, structure: structure.data, formType } });
    } catch (err) {
      debugError('Error loading missing fields report:', err);
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

  const renderAttendanceReport = (data) => {
    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      return <EmptyState message={t('no_data_available')} />;
    }

    const attendanceData = data.data;

    // Status colors
    const statusColors = {
      P: '#FFFFFF',
      A: '#FF6B6B',
      M: '#4ECDC4',
      R: '#FFE66D',
    };

    // Normalize status
    const normalizeStatus = (status) => {
      switch (status) {
        case 'present': return 'P';
        case 'absent': return 'A';
        case 'excused':
        case 'motivated': return 'M';
        case 'late': return 'R';
        default: return '';
      }
    };

    // Get unique dates
    const uniqueDatesSet = new Set();
    attendanceData.forEach((item) => {
      const attendanceArray = item.attendance || [];
      if (Array.isArray(attendanceArray)) {
        attendanceArray.forEach((att) => {
          if (att.date) {
            const dateStr = att.date.split('T')[0];
            uniqueDatesSet.add(dateStr);
          }
        });
      }
    });
    const uniqueDates = Array.from(uniqueDatesSet).sort();

    if (uniqueDates.length === 0) {
      return <EmptyState message={t('no_attendance_dates')} />;
    }

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={true}>
        <View>
          {/* Header Row */}
          <View style={styles.attendanceRow}>
            <View style={[styles.attendanceCell, styles.attendanceHeaderCell, { width: 150 }]}>
              <Text style={styles.attendanceHeaderText}>{t('name')}</Text>
            </View>
            <View style={[styles.attendanceCell, styles.attendanceHeaderCell, { width: 100 }]}>
              <Text style={styles.attendanceHeaderText}>{t('group')}</Text>
            </View>
            {uniqueDates.map((date, index) => (
              <View key={index} style={[styles.attendanceCell, styles.attendanceHeaderCell, { width: 80 }]}>
                <Text style={styles.attendanceHeaderText}>{date.substring(5)}</Text>
              </View>
            ))}
          </View>

          {/* Data Rows */}
          {attendanceData.map((item, rowIndex) => {
            const attendanceMap = {};
            const attendanceArray = item.attendance || [];
            if (Array.isArray(attendanceArray)) {
              attendanceArray.forEach((att) => {
                if (att.date) {
                  const dateStr = att.date.split('T')[0];
                  attendanceMap[dateStr] = normalizeStatus(att.status);
                }
              });
            }

            return (
              <View key={rowIndex} style={styles.attendanceRow}>
                <View style={[styles.attendanceCell, { width: 150 }]}>
                  <Text style={styles.attendanceText}>
                    {item.first_name} {item.last_name}
                  </Text>
                </View>
                <View style={[styles.attendanceCell, { width: 100 }]}>
                  <Text style={styles.attendanceText}>{item.group_name || '-'}</Text>
                </View>
                {uniqueDates.map((date, colIndex) => {
                  const status = attendanceMap[date] || '';
                  const bgColor = statusColors[status] || '#FFFFFF';
                  return (
                    <View
                      key={colIndex}
                      style={[
                        styles.attendanceCell,
                        { width: 80, backgroundColor: bgColor },
                      ]}
                    >
                      <Text style={styles.attendanceStatusText}>{status}</Text>
                    </View>
                  );
                })}
              </View>
            );
          })}

          {/* Legend */}
          <View style={styles.legendContainer}>
            <Text style={styles.legendTitle}>{t('legend')}:</Text>
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: statusColors.P }]} />
                <Text style={styles.legendText}>P = {t('present')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: statusColors.A }]} />
                <Text style={styles.legendText}>A = {t('absent')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: statusColors.M }]} />
                <Text style={styles.legendText}>M = {t('excused')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: statusColors.R }]} />
                <Text style={styles.legendText}>R = {t('late')}</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    );
  };

  const renderParticipantProgressReport = (data) => {
    const progressData = data?.data?.progress;

    return (
      <View>
        {/* Participant Selector */}
        <Card style={styles.pickerCard}>
          <Text style={styles.pickerLabel}>{t('select_participant')}</Text>
          <RNPicker
            selectedValue={selectedParticipantId}
            onValueChange={(itemValue) => setSelectedParticipantId(itemValue)}
            style={styles.picker}
          >
            <RNPicker.Item label={t('select_participant_placeholder')} value={null} />
            {participantList.map((p) => (
              <RNPicker.Item
                key={p.id}
                label={`${p.first_name} ${p.last_name}${p.group_name ? ` · ${p.group_name}` : ''}`}
                value={p.id}
              />
            ))}
          </RNPicker>
        </Card>

        {progressData ? (
          <View>
            {/* Participant Info */}
            <Card style={styles.progressHeader}>
              <Text style={styles.progressGroupName}>
                {progressData.participant.group_name || t('no_group')}
              </Text>
              <Text style={styles.progressParticipantName}>
                {progressData.participant.first_name} {progressData.participant.last_name}
              </Text>
            </Card>

            {/* Summary Stats */}
            <Card style={styles.summaryCard}>
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>{t('total_points')}</Text>
                  <Text style={styles.statValue}>{progressData.totals.points || 0}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>{t('honors_count')}</Text>
                  <Text style={styles.statValue}>{progressData.totals.honors || 0}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>{t('badge_stars')}</Text>
                  <Text style={styles.statValue}>{progressData.totals.badges || 0}</Text>
                </View>
              </View>
            </Card>

            {/* Attendance Summary */}
            {progressData.totals.attendance && Object.keys(progressData.totals.attendance).length > 0 && (
              <Card style={styles.reportCard}>
                <Text style={styles.sectionTitle}>{t('attendance_overview')}</Text>
                <View style={styles.chipContainer}>
                  {Object.entries(progressData.totals.attendance).map(([status, count]) => (
                    <View key={status} style={styles.chip}>
                      <Text style={styles.chipText}>
                        {t(status) || status}: {count}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            {/* Timeline */}
            <Card style={styles.reportCard}>
              <Text style={styles.sectionTitle}>{t('timeline_title')}</Text>
              {(() => {
                const timelineEvents = [
                  ...(progressData.attendance || []).map((item) => ({
                    type: 'attendance',
                    date: item.date,
                    status: item.status,
                  })),
                  ...(progressData.honors || []).map((item) => ({
                    type: 'honor',
                    date: item.date,
                    reason: item.reason,
                  })),
                  ...(progressData.badges || []).map((item) => ({
                    type: 'badge',
                    date: item.date,
                    badgeName: item.badge_name || item.territoire_chasse,
                    level: item.etoiles,
                    section: item.badge_section,
                  })),
                ].sort((a, b) => new Date(b.date) - new Date(a.date));

                if (timelineEvents.length === 0) {
                  return <Text style={styles.infoValue}>{t('participant_progress_empty')}</Text>;
                }

                return timelineEvents.map((event, index) => {
                  let icon = '•';
                  let title = '';
                  let meta = '';

                  if (event.type === 'attendance') {
                    icon = '✓';
                    title = t(event.status) || t('attendance');
                    meta = t('attendance_status');
                  } else if (event.type === 'honor') {
                    icon = '🏆';
                    title = t('honor_awarded');
                    meta = event.reason || t('no_reason_provided');
                  } else {
                    icon = '⭐';
                    title = t('badge_star') || t('badge');
                    meta = `${event.badgeName || ''} · ${t('stars_count')} ${event.level || 0}${event.section ? ` · ${event.section}` : ''}`;
                  }

                  return (
                    <View key={index} style={styles.timelineItem}>
                      <View style={styles.timelineIconContainer}>
                        <Text style={styles.timelineIcon}>{icon}</Text>
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={styles.timelineDate}>
                          {new Date(event.date).toLocaleDateString()}
                        </Text>
                        <Text style={styles.timelineTitle}>{title}</Text>
                        <Text style={styles.timelineMeta}>{meta}</Text>
                      </View>
                    </View>
                  );
                });
              })()}
            </Card>
          </View>
        ) : (
          <EmptyState message={t('select_participant_prompt')} />
        )}
      </View>
    );
  };

  const renderMissingFieldsReport = (data) => {
    if (!data?.data) {
      return <EmptyState message={t('no_data_available')} />;
    }

    const { submissions, structure, formType } = data.data;

    const getMissingFields = (submissionData, formStructure) => {
      const missingFields = [];
      const formTypeStructure = formStructure[formType];

      if (!formTypeStructure?.form_structure?.fields) return [];

      formTypeStructure.form_structure.fields.forEach((field) => {
        if (field.required && !submissionData[field.name]) {
          if (field.dependsOn) {
            const dependencyField = submissionData[field.dependsOn.field];
            if (dependencyField === field.dependsOn.value) {
              missingFields.push(field.name);
            }
          } else {
            missingFields.push(field.name);
          }
        }
      });

      return missingFields;
    };

    return (
      <View>
        {/* Form Type Selector */}
        <Card style={styles.pickerCard}>
          <Text style={styles.pickerLabel}>{t('missing_fields_form_selector_label')}</Text>
          <RNPicker
            selectedValue={selectedFormType}
            onValueChange={(itemValue) => setSelectedFormType(itemValue)}
            style={styles.picker}
          >
            {formTypes.map((ft) => (
              <RNPicker.Item key={ft} label={ft} value={ft} />
            ))}
          </RNPicker>
          <Text style={styles.pickerHelp}>{t('missing_fields_form_selector_help')}</Text>
        </Card>

        {/* Missing Fields List */}
        {submissions && submissions.length > 0 ? (
          submissions.map((submission, index) => {
            const missingFields = getMissingFields(submission.submission_data, structure);

            if (missingFields.length === 0) return null;

            return (
              <Card key={index} style={styles.reportCard}>
                <Text style={styles.participantName}>
                  {submission.first_name} {submission.last_name}
                </Text>
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{t('missing_fields')}:</Text>
                  <Text style={styles.infoValue}>
                    {missingFields.map((f) => t(f) || f).join(', ')}
                  </Text>
                </View>
              </Card>
            );
          })
        ) : (
          <EmptyState message={t('no_missing_fields')} icon="✓" />
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
        return renderAttendanceReport(reportData);

      case 'participant-progress':
        return renderParticipantProgressReport(reportData);

      case 'missing-fields':
        return renderMissingFieldsReport(reportData);

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
  // Attendance Report Styles
  attendanceRow: {
    flexDirection: 'row',
  },
  attendanceCell: {
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 40,
  },
  attendanceHeaderCell: {
    backgroundColor: theme.colors.primaryLight || theme.colors.secondary,
  },
  attendanceHeaderText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    textAlign: 'center',
  },
  attendanceText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    textAlign: 'center',
  },
  attendanceStatusText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  legendContainer: {
    marginTop: theme.spacing.lg,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
  },
  legendTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  legendBox: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  legendText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  // Picker Styles
  pickerCard: {
    marginBottom: theme.spacing.md,
  },
  pickerLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  picker: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
  },
  pickerHelp: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.xs,
  },
  // Progress Report Styles
  progressHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  progressGroupName: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  progressParticipantName: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.sm,
  },
  chip: {
    backgroundColor: theme.colors.primaryLight || theme.colors.secondary,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.md,
  },
  chipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    fontWeight: theme.fontWeight.semibold,
  },
  // Timeline Styles
  timelineItem: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderLight,
  },
  timelineIconContainer: {
    width: 40,
    alignItems: 'center',
    marginRight: theme.spacing.sm,
  },
  timelineIcon: {
    fontSize: theme.fontSize.xl,
  },
  timelineContent: {
    flex: 1,
  },
  timelineDate: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  timelineTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  timelineMeta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    lineHeight: theme.lineHeight.relaxed * theme.fontSize.sm,
  },
});

export default ReportViewerScreen;