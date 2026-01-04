/**
 * Parent Dashboard Screen
 *
 * Mirrors spa/parent_dashboard.js functionality
 * Shows parent-specific content:
 * - My children (participants)
 * - Upcoming activities
 * - Outstanding fees
 * - Permission slips
 * - Carpool assignments
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
  Modal,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  getParticipants,
  getParentDashboard,
  getActivities,
  getPermissionSlips,
  getParticipantStatement,
  linkUserParticipants,
} from '../api/api-endpoints';
import StorageUtils from '../utils/StorageUtils';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import FormatUtils from '../utils/FormatUtils';
import { Card, LoadingSpinner, ErrorMessage } from '../components';
import CONFIG from '../config';
import { debugLog, debugError } from '../utils/DebugUtils';

/**
 * Normalize children data from the parent dashboard API into the dashboard-friendly shape.
 * @param {Array<Object>} childrenData - Children payload from the parent dashboard API.
 * @returns {Array<Object>} Normalized children with consistent keys.
 */
const normalizeDashboardChildren = (childrenData = []) =>
  (Array.isArray(childrenData) ? childrenData : [])
    .map((child) => ({
      id: child.id,
      firstName: child.first_name || child.firstName,
      lastName: child.last_name || child.lastName,
      birthdate: child.date_naissance || child.birthdate,
      group: child.group_name || child.group,
    }))
    .filter((child) => child.id);

/**
 * Format time values that may already be in display format.
 * @param {string|Date} timeValue - Time value to format.
 * @returns {string} User-friendly time string.
 */
const formatOptionalTime = (timeValue) => {
  if (!timeValue) {
    return '';
  }

  const formatted = DateUtils.formatTime(timeValue);
  return formatted || String(timeValue);
};

/**
 * Normalize permission slip response payloads into an array.
 * @param {Object} response - API response payload.
 * @returns {Array<Object>} Normalized permission slip entries.
 */
const normalizePermissionSlips = (response) => {
  const payload = response?.data || response;

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.permission_slips)) {
    return payload.permission_slips;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
};

const ParentDashboardScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useSafeState(true);
  const [refreshing, setRefreshing] = useSafeState(false);
  const [error, setError] = useSafeState('');
  const [children, setChildren] = useSafeState([]);
  const [upcomingActivities, setUpcomingActivities] = useSafeState([]);
  const [unsignedPermissionSlips, setUnsignedPermissionSlips] = useSafeState([]);
  const [financialSummary, setFinancialSummary] = useSafeState({
    totalOutstanding: 0,
    participantCount: 0,
  });

  // Link participants dialog state
  const [showLinkDialog, setShowLinkDialog] = useSafeState(false);
  const [participantsToLink, setParticipantsToLink] = useSafeState([]);
  const [selectedParticipants, setSelectedParticipants] = useSafeState([]);

  // Participant selection for forms
  const [showParticipantSelector, setShowParticipantSelector] = useSafeState(false);
  const [selectedFormDestination, setSelectedFormDestination] = useSafeState(null);

  // Configure header with settings button
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('parent_dashboard'),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={{ paddingRight: 16 }}
          accessibilityLabel={t('settings')}
        >
          <Text style={{ fontSize: 24 }}>⚙️</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setError('');
      let myChildren = [];

      // Phase 1: Load children data (sequential, depends on each other)
      try {
        const parentDashboardResponse = await getParentDashboard();
        if (parentDashboardResponse?.success) {
          const childrenData =
            parentDashboardResponse.data?.children ||
            parentDashboardResponse.data?.data?.children ||
            [];
          const normalizedChildren = normalizeDashboardChildren(childrenData);
          myChildren = normalizedChildren;
          setChildren(normalizedChildren);
        }
      } catch (err) {
        debugError('Error loading parent dashboard children:', err);

        // Fallback: try loading from participants endpoint
        try {
          const guardianParticipants = await StorageUtils.getItem(
            CONFIG.STORAGE_KEYS.GUARDIAN_PARTICIPANTS
          );

          const participantsResponse = await getParticipants();
          if (participantsResponse.success) {
            const participantData = Array.isArray(participantsResponse.data)
              ? participantsResponse.data
              : [];
            const filteredParticipants =
              Array.isArray(guardianParticipants) && guardianParticipants.length > 0
                ? participantData.filter((p) => guardianParticipants.includes(p.id))
                : participantData;
            const normalizedChildren = normalizeDashboardChildren(filteredParticipants);
            myChildren = normalizedChildren;
            setChildren(normalizedChildren);
          }
        } catch (fallbackErr) {
          debugError('Error loading participants fallback:', fallbackErr);
        }
      }

      // Phase 2: Load all independent data in parallel
      const [
        activitiesResponse,
        permissionSlipsResults,
        financialResults
      ] = await Promise.all([
        // Load upcoming activities
        getActivities().catch((err) => {
          debugError('Error loading activities:', err);
          return { success: false, data: [] };
        }),

        // Load permission slips for all children in parallel
        myChildren.length > 0
          ? Promise.all(
              myChildren.map((child) =>
                getPermissionSlips({ participant_id: child.id }).catch((err) => {
                  debugError(`Error loading permission slips for child ${child.id}:`, err);
                  return { success: false, data: [] };
                })
              )
            )
          : Promise.resolve([]),

        // Load financial statements for all children in parallel
        myChildren.length > 0
          ? Promise.all(
              myChildren.map((child) =>
                getParticipantStatement(child.id).catch((err) => {
                  debugError(`Error loading statement for child ${child.id}:`, err);
                  return { success: false, data: null };
                })
              )
            )
          : Promise.resolve([])
      ]);

      // Process activities
      if (activitiesResponse.success) {
        const upcoming = activitiesResponse.data
          .filter((a) => DateUtils.isFuture(a.activity_date))
          .sort((a, b) => new Date(a.activity_date) - new Date(b.activity_date))
          .slice(0, CONFIG.UI.PARENT_DASHBOARD_MAX_UPCOMING_ACTIVITIES);
        setUpcomingActivities(upcoming);
      }

      // Process permission slips
      const allUnsigned = [];
      permissionSlipsResults.forEach((response) => {
        if (response.success) {
          const slips = normalizePermissionSlips(response);
          const unsigned = slips.filter((slip) => !slip.signed);
          allUnsigned.push(...unsigned);
        }
      });
      setUnsignedPermissionSlips(allUnsigned);
      debugLog('Loaded permission slips:', allUnsigned.length, 'unsigned');

      // Process financial summary
      let totalOutstanding = 0;
      financialResults.forEach((response) => {
        if (response.success && response.data) {
          const statement = response.data;
          const totals = statement.totals || {};
          totalOutstanding += Number(totals.total_outstanding) || 0;
        }
      });
      setFinancialSummary({
        totalOutstanding,
        participantCount: myChildren.length,
      });
      debugLog('Financial summary:', { totalOutstanding, participantCount: myChildren.length });

    } catch (err) {
      debugError('Error in loadDashboardData:', err);
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  /**
   * Check if there are guardian participants to link
   * This happens when a new parent account is created and existing participants need to be linked
   */
  const checkAndShowLinkParticipantsDialog = async () => {
    try {
      // Check for guardian participants in storage (set during registration)
      const guardianParticipantsToLink = await StorageUtils.getItem('GUARDIAN_PARTICIPANTS_TO_LINK');

      if (guardianParticipantsToLink && Array.isArray(guardianParticipantsToLink) && guardianParticipantsToLink.length > 0) {
        debugLog('Found participants to link:', guardianParticipantsToLink);
        setParticipantsToLink(guardianParticipantsToLink);
        setSelectedParticipants(guardianParticipantsToLink.map(p => p.participant_id));
        setShowLinkDialog(true);

        // Clear from storage after showing
        await StorageUtils.removeItem('GUARDIAN_PARTICIPANTS_TO_LINK');
      }
    } catch (error) {
      debugError('Error checking for participants to link:', error);
    }
  };

  /**
   * Handle linking selected participants to current user
   */
  const handleLinkParticipants = async () => {
    if (selectedParticipants.length === 0) {
      Alert.alert(t('error'), t('select_at_least_one_participant'));
      return;
    }

    try {
      const response = await linkUserParticipants({ participant_ids: selectedParticipants });

      if (response.success) {
        Alert.alert(
          t('success'),
          t('participants_linked_successfully'),
          [
            {
              text: t('OK'),
              onPress: async () => {
                setShowLinkDialog(false);
                // Refresh dashboard data to show newly linked participants
                await loadDashboardData();
              },
            },
          ]
        );
      } else {
        Alert.alert(t('error'), response.message || t('error_linking_participants'));
      }
    } catch (error) {
      debugError('Error linking participants:', error);
      Alert.alert(t('error'), t('error_linking_participants'));
    }
  };

  /**
   * Toggle participant selection in link dialog
   */
  const toggleParticipantSelection = (participantId) => {
    setSelectedParticipants(prev => {
      if (prev.includes(participantId)) {
        return prev.filter(id => id !== participantId);
      } else {
        return [...prev, participantId];
      }
    });
  };

  /**
   * Handle navigation to forms that require a participant ID
   * @param {string} screenName - Name of the screen to navigate to
   */
  const handleFormNavigation = (screenName) => {
    if (children.length === 0) {
      Alert.alert(t('error'), t('no_participants_registered'));
      return;
    }

    if (children.length === 1) {
      // Only one child, navigate directly
      navigation.navigate(screenName, { participantId: children[0].id });
    } else {
      // Multiple children, show selector
      setSelectedFormDestination(screenName);
      setShowParticipantSelector(true);
    }
  };

  /**
   * Navigate to selected form with chosen participant
   */
  const handleParticipantSelection = (participantId) => {
    if (selectedFormDestination) {
      navigation.navigate(selectedFormDestination, { participantId });
      setShowParticipantSelector(false);
      setSelectedFormDestination(null);
    }
  };

  // Check for participants to link after initial load
  useEffect(() => {
    if (!loading) {
      checkAndShowLinkParticipantsDialog();
    }
  }, [loading]);

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={loadDashboardData} />;
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >

      {/* My Children Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('my_children')}</Text>
          <TouchableOpacity
            style={styles.registerButton}
            onPress={() => navigation.navigate('RegistrationForm')}
          >
            <Text style={styles.registerButtonText}>+ {t('register_child')}</Text>
          </TouchableOpacity>
        </View>
        {children.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('no_participants')}</Text>
          </Card>
        ) : (
          children.map((child) => (
            <Card key={child.id}>
              <TouchableOpacity
                onPress={() => navigation.navigate('ParticipantDetail', { id: child.id })}
                style={styles.childInfoContainer}
              >
                <Text style={styles.childName}>
                  {child.firstName} {child.lastName}
                </Text>
                <Text style={styles.childDetail}>
                  {t('age')}: {DateUtils.calculateAge(child.birthdate)}{' '}
                  {t('years')}
                </Text>
                {child.group && (
                  <Text style={styles.childDetail}>
                    {t('group')}: {child.group}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.progressButton}
                onPress={() =>
                  navigation.navigate('ReportViewer', {
                    reportType: 'participant-progress',
                    participantId: child.id,
                  })
                }
              >
                <Text style={styles.progressButtonText}>
                  📊 {t('view_progress_report')}
                </Text>
              </TouchableOpacity>
            </Card>
          ))
        )}
      </View>

      {/* Financial Summary Section */}
      {financialSummary.totalOutstanding > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💰 {t('outstanding_balance')}</Text>
          <Card
            onPress={() => navigation.navigate('ParentFinance')}
            style={styles.financialCard}
          >
            <View style={styles.financialContent}>
              <Text style={styles.financialAmount}>
                {FormatUtils.formatCurrency(financialSummary.totalOutstanding, 'CAD')}
              </Text>
              <Text style={styles.financialLabel}>{t('amount_due')}</Text>
              <TouchableOpacity
                style={styles.viewDetailsButton}
                onPress={() => navigation.navigate('ParentFinance')}
              >
                <Text style={styles.viewDetailsText}>{t('view_details')} →</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>
      )}

      {/* Permission Slips Section */}
      {unsignedPermissionSlips.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            📄 {t('permission_slip_title')} ({unsignedPermissionSlips.length} {t('unsigned')})
          </Text>
          {unsignedPermissionSlips.slice(0, 3).map((slip) => (
            <Card
              key={slip.id}
              onPress={() => navigation.navigate('PermissionSlipSign', { id: slip.id })}
              style={styles.permissionSlipCard}
            >
              <View style={styles.permissionSlipHeader}>
                <Text style={styles.permissionSlipTitle}>
                  {slip.title || slip.activity_name || t('permission_slip_title')}
                </Text>
                <View style={styles.urgentBadge}>
                  <Text style={styles.urgentBadgeText}>⚠️ {t('action_required')}</Text>
                </View>
              </View>
              {slip.participant_name && (
                <Text style={styles.permissionSlipDetail}>
                  👤 {slip.participant_name}
                </Text>
              )}
              {slip.activity_date && (
                <Text style={styles.permissionSlipDetail}>
                  📅 {DateUtils.formatDate(slip.activity_date)}
                </Text>
              )}
              <Text style={styles.signNowText}>{t('tap_to_sign')} →</Text>
            </Card>
          ))}
          {unsignedPermissionSlips.length > 3 && (
            <TouchableOpacity
              style={styles.viewAllButton}
              onPress={() => navigation.navigate('PermissionSlips')}
            >
              <Text style={styles.viewAllText}>
                {t('view_all')} ({unsignedPermissionSlips.length})
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Upcoming Activities Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('upcoming_activities')}</Text>
        {upcomingActivities.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('no_upcoming_activities')}</Text>
          </Card>
        ) : (
          upcomingActivities.map((activity) => (
            <Card key={activity.id}>
              <Text style={styles.activityName}>{activity.name}</Text>
              <Text style={styles.activityDate}>
                📅 {DateUtils.formatDate(activity.activity_date)}
              </Text>
              {activity.meeting_location_going && (
                <Text style={styles.activityDetail}>
                  📍 {t('meeting_location')}: {activity.meeting_location_going}
                </Text>
              )}
              {activity.meeting_time_going && (
                <Text style={styles.activityDetail}>
                  🕒 {t('meeting_time')}: {formatOptionalTime(activity.meeting_time_going)}
                </Text>
              )}
              {activity.meeting_location_return && (
                <Text style={styles.activityDetail}>
                  ↩️ {t('returning')}: {activity.meeting_location_return}
                </Text>
              )}
              {activity.meeting_time_return && (
                <Text style={styles.activityDetail}>
                  ⏰ {t('meeting_time')} ({t('returning')}):{' '}
                  {formatOptionalTime(activity.meeting_time_return)}
                </Text>
              )}
              <TouchableOpacity
                style={styles.carpoolLink}
                onPress={() => navigation.navigate('Carpool', { activityId: activity.id })}
              >
                <Text style={styles.carpoolLinkTitle}>🚗 {t('view_carpools')}</Text>
                <Text style={styles.carpoolLinkSubtitle}>
                  {t('carpool_view_and_assign')}
                </Text>
              </TouchableOpacity>
            </Card>
          ))
        )}
      </View>

      {/* Important Forms Section */}
      {children.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 {t('important_forms')}</Text>
          <Text style={styles.formsDescription}>
            {t('complete_forms_description')}
          </Text>

          <TouchableOpacity
            style={styles.formCard}
            onPress={() => handleFormNavigation('HealthForm')}
          >
            <View style={styles.formCardContent}>
              <View>
                <Text style={styles.formCardTitle}>🏥 {t('fiche_sante')}</Text>
                <Text style={styles.formCardDescription}>
                  {t('health_form_description')}
                </Text>
              </View>
              <Text style={styles.formCardArrow}>→</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.formCard}
            onPress={() => handleFormNavigation('RiskAcceptance')}
          >
            <View style={styles.formCardContent}>
              <View>
                <Text style={styles.formCardTitle}>⚠️ {t('acceptation_risque')}</Text>
                <Text style={styles.formCardDescription}>
                  {t('risk_acceptance_description')}
                </Text>
              </View>
              <Text style={styles.formCardArrow}>→</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.formCard}
            onPress={() => handleFormNavigation('ParticipantDocuments')}
          >
            <View style={styles.formCardContent}>
              <View>
                <Text style={styles.formCardTitle}>📄 {t('documents')}</Text>
                <Text style={styles.formCardDescription}>
                  {t('documents_description')}
                </Text>
              </View>
              <Text style={styles.formCardArrow}>→</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('quick_actions')}</Text>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Finance')}
        >
          <Text style={styles.actionButtonText}>💰 {t('view_fees')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('PermissionSlips')}
        >
          <Text style={styles.actionButtonText}>
            📄 {t('permission_slip_title')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('BadgeDashboard')}
        >
          <Text style={styles.actionButtonText}>
            🏅 {t('badge_progress')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleFormNavigation('HealthForm')}
        >
          <Text style={styles.actionButtonText}>
            🏥 {t('fiche_sante')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleFormNavigation('RiskAcceptance')}
        >
          <Text style={styles.actionButtonText}>
            ⚠️ {t('risk_acceptance_form')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleFormNavigation('ParticipantDocuments')}
        >
          <Text style={styles.actionButtonText}>
            📋 {t('view_documents')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>

      {/* Link Participants Dialog */}
      <Modal
        visible={showLinkDialog}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLinkDialog(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('link_existing_participants')}</Text>
            <Text style={styles.modalDescription}>
              {t('existing_participants_found')}
            </Text>

            <ScrollView style={styles.modalScrollView}>
              {participantsToLink.map((participant) => (
                <TouchableOpacity
                  key={participant.participant_id}
                  style={styles.participantCheckboxRow}
                  onPress={() => toggleParticipantSelection(participant.participant_id)}
                >
                  <View style={styles.checkbox}>
                    {selectedParticipants.includes(participant.participant_id) && (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.participantName}>
                    {participant.first_name} {participant.last_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowLinkDialog(false)}
              >
                <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.linkButton]}
                onPress={handleLinkParticipants}
              >
                <Text style={styles.linkButtonText}>
                  {t('link_selected_participants')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Participant Selector for Forms */}
      <Modal
        visible={showParticipantSelector}
        transparent
        animationType="slide"
        onRequestClose={() => setShowParticipantSelector(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('select_participant')}</Text>
            <Text style={styles.modalDescription}>
              {t('select_child_for_form')}
            </Text>

            <ScrollView style={styles.modalScrollView}>
              {children.map((child) => (
                <TouchableOpacity
                  key={child.id}
                  style={styles.participantSelectionRow}
                  onPress={() => handleParticipantSelection(child.id)}
                >
                  <View>
                    <Text style={styles.participantName}>
                      {child.firstName} {child.lastName}
                    </Text>
                    <Text style={styles.participantDetail}>
                      {t('age')}: {DateUtils.calculateAge(child.birthdate)} {t('years')}
                      {child.group && ` • ${t('group')}: ${child.group}`}
                    </Text>
                  </View>
                  <Text style={styles.formCardArrow}>→</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.modalButton, styles.cancelButton, { marginTop: 12 }]}
              onPress={() => {
                setShowParticipantSelector(false);
                setSelectedFormDestination(null);
              }}
            >
              <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f7f4',
  },
  section: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  registerButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  registerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    padding: 20,
  },
  childName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  childDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  childInfoContainer: {
    marginBottom: 12,
  },
  progressButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  progressButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  activityName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  activityDate: {
    fontSize: 14,
    color: '#333',
    marginTop: 4,
  },
  activityDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  activityCarpoolSection: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E6E6E6',
  },
  activityCarpoolTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  carpoolLink: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    backgroundColor: '#fff',
  },
  carpoolLinkTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  carpoolLinkSubtitle: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  carpoolAssignment: {
    marginBottom: 8,
  },
  carpoolDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  actionButton: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
    justifyContent: 'center',
  },
  actionButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  // Financial Summary Styles
  financialCard: {
    backgroundColor: '#FFF9E6',
    borderLeftWidth: 4,
    borderLeftColor: '#FFB800',
  },
  financialContent: {
    alignItems: 'center',
    padding: 8,
  },
  financialAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#D97706',
    marginBottom: 4,
  },
  financialLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  viewDetailsButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
  viewDetailsText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // Permission Slip Styles
  permissionSlipCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF6B6B',
    backgroundColor: '#FFF5F5',
  },
  permissionSlipHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  permissionSlipTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  urgentBadge: {
    backgroundColor: '#FF6B6B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  urgentBadgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  permissionSlipDetail: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  signNowText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
    marginTop: 12,
  },
  viewAllButton: {
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
    marginTop: 8,
  },
  viewAllText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
  },
  // Forms Section Styles
  formsDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  formCard: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
  },
  formCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  formCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  formCardDescription: {
    fontSize: 13,
    color: '#666',
  },
  formCardArrow: {
    fontSize: 20,
    color: '#007AFF',
  },
  // Link Participants Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  modalDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  modalScrollView: {
    maxHeight: 300,
    marginBottom: 20,
  },
  participantCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 4,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  participantName: {
    fontSize: 16,
    color: '#333',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  linkButton: {
    backgroundColor: '#007AFF',
  },
  linkButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  participantSelectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    minHeight: CONFIG.UI.TOUCH_TARGET_SIZE,
  },
  participantDetail: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
});

export default ParentDashboardScreen;