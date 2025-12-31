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

import React, { useState, useEffect } from 'react';
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
  getActivities,
  getMyChildrenAssignments,
  getPermissionSlips,
  getParticipantStatement,
  linkUserParticipants,
} from '../api/api-endpoints';
import StorageUtils from '../utils/StorageUtils';
import { translate as t } from '../i18n';
import DateUtils from '../utils/DateUtils';
import NumberUtils from '../utils/NumberUtils';
import FormatUtils from '../utils/FormatUtils';
import { Card, LoadingSpinner, ErrorMessage, Button } from '../components';
import CONFIG from '../config';
import { debugLog, debugError } from '../utils/DebugUtils';

const ParentDashboardScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [children, setChildren] = useState([]);
  const [upcomingActivities, setUpcomingActivities] = useState([]);
  const [carpoolAssignments, setCarpoolAssignments] = useState([]);
  const [unsignedPermissionSlips, setUnsignedPermissionSlips] = useState([]);
  const [financialSummary, setFinancialSummary] = useState({
    totalOutstanding: 0,
    participantCount: 0,
  });

  // Link participants dialog state
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [participantsToLink, setParticipantsToLink] = useState([]);
  const [selectedParticipants, setSelectedParticipants] = useState([]);

  // Configure header with settings button
  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: t('dashboard_title'),
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

      // Get guardian participants
      const guardianParticipants = await StorageUtils.getItem(
        CONFIG.STORAGE_KEYS.GUARDIAN_PARTICIPANTS
      );

      // Load children data
      const participantsResponse = await getParticipants();
      let myChildren = [];
      if (participantsResponse.success) {
        // Filter to only this guardian's children
        myChildren = participantsResponse.data.filter((p) =>
          guardianParticipants?.includes(p.id)
        );
        setChildren(myChildren);
      }

      // Load upcoming activities
      const activitiesResponse = await getActivities();
      if (activitiesResponse.success) {
        // Filter to future activities and sort by date
        const upcoming = activitiesResponse.data
          .filter((a) => DateUtils.isFuture(a.date))
          .sort((a, b) => new Date(a.date) - new Date(b.date))
          .slice(0, 5); // Show next 5 activities
        setUpcomingActivities(upcoming);
      }

      // Load carpool assignments for my children
      try {
        const carpoolResponse = await getMyChildrenAssignments();
        if (carpoolResponse.success) {
          setCarpoolAssignments(carpoolResponse.data || []);
        }
      } catch (err) {
        debugError('Error loading carpool assignments:', err);
        // Non-critical, continue
      }

      // Load permission slips for all children
      if (myChildren.length > 0) {
        try {
          const permissionSlipPromises = myChildren.map((child) =>
            getPermissionSlips({ participant_id: child.id }).catch((err) => {
              debugError(`Error loading permission slips for child ${child.id}:`, err);
              return { success: false, data: [] };
            })
          );

          const permissionSlipResponses = await Promise.all(permissionSlipPromises);

          // Collect all unsigned permission slips
          const allUnsigned = [];
          permissionSlipResponses.forEach((response) => {
            if (response.success && response.data) {
              const unsigned = response.data.filter((slip) => !slip.signed);
              allUnsigned.push(...unsigned);
            }
          });

          setUnsignedPermissionSlips(allUnsigned);
          debugLog('Loaded permission slips:', allUnsigned.length, 'unsigned');
        } catch (err) {
          debugError('Error loading permission slips:', err);
          // Non-critical, continue
        }

        // Load financial summary for all children
        try {
          const statementPromises = myChildren.map((child) =>
            getParticipantStatement(child.id).catch((err) => {
              debugError(`Error loading statement for child ${child.id}:`, err);
              return { success: false, data: null };
            })
          );

          const statementResponses = await Promise.all(statementPromises);

          // Calculate total outstanding
          let totalOutstanding = 0;
          statementResponses.forEach((response) => {
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
          debugError('Error loading financial summary:', err);
          // Non-critical, continue
        }
      }
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
      Alert.alert(t('error'), t('Please select at least one participant'));
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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('Parent Dashboard')}</Text>
      </View>

      {/* My Children Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('My Children')}</Text>
          <TouchableOpacity
            style={styles.registerButton}
            onPress={() => navigation.navigate('RegistrationForm')}
          >
            <Text style={styles.registerButtonText}>+ {t('Register Child')}</Text>
          </TouchableOpacity>
        </View>
        {children.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('no_participants')}</Text>
            <TouchableOpacity
              style={styles.registerChildButton}
              onPress={() => navigation.navigate('RegistrationForm')}
            >
              <Text style={styles.registerChildButtonText}>{t('Register Your First Child')}</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          children.map((child) => (
            <Card
              key={child.id}
              onPress={() => navigation.navigate('ParticipantDetail', { id: child.id })}
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
            </Card>
          ))
        )}
      </View>

      {/* Financial Summary Section */}
      {financialSummary.totalOutstanding > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💰 {t('Outstanding Balance')}</Text>
          <Card
            onPress={() => navigation.navigate('ParentFinance')}
            style={styles.financialCard}
          >
            <View style={styles.financialContent}>
              <Text style={styles.financialAmount}>
                {FormatUtils.formatCurrency(financialSummary.totalOutstanding, 'CAD')}
              </Text>
              <Text style={styles.financialLabel}>{t('Amount Due')}</Text>
              <TouchableOpacity
                style={styles.viewDetailsButton}
                onPress={() => navigation.navigate('ParentFinance')}
              >
                <Text style={styles.viewDetailsText}>{t('View Details')} →</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </View>
      )}

      {/* Permission Slips Section */}
      {unsignedPermissionSlips.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            📄 {t('Permission Slips')} ({unsignedPermissionSlips.length} {t('unsigned')})
          </Text>
          {unsignedPermissionSlips.slice(0, 3).map((slip) => (
            <Card
              key={slip.id}
              onPress={() => navigation.navigate('PermissionSlipSign', { id: slip.id })}
              style={styles.permissionSlipCard}
            >
              <View style={styles.permissionSlipHeader}>
                <Text style={styles.permissionSlipTitle}>
                  {slip.title || slip.activity_name || t('Permission Slip')}
                </Text>
                <View style={styles.urgentBadge}>
                  <Text style={styles.urgentBadgeText}>⚠️ {t('Action Required')}</Text>
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
              <Text style={styles.signNowText}>{t('Tap to sign')} →</Text>
            </Card>
          ))}
          {unsignedPermissionSlips.length > 3 && (
            <TouchableOpacity
              style={styles.viewAllButton}
              onPress={() => navigation.navigate('PermissionSlips')}
            >
              <Text style={styles.viewAllText}>
                {t('View All')} ({unsignedPermissionSlips.length})
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Upcoming Activities Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('Upcoming Activities')}</Text>
        {upcomingActivities.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>{t('No upcoming activities')}</Text>
          </Card>
        ) : (
          upcomingActivities.map((activity) => (
            <Card
              key={activity.id}
              onPress={() => navigation.navigate('ActivityDetail', { id: activity.id })}
            >
              <Text style={styles.activityName}>{activity.name}</Text>
              <Text style={styles.activityDate}>
                📅 {DateUtils.formatDate(activity.date)}
              </Text>
              {activity.location && (
                <Text style={styles.activityDetail}>📍 {activity.location}</Text>
              )}
            </Card>
          ))
        )}
      </View>

      {/* Carpool Assignments Section */}
      {carpoolAssignments.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('Carpool Assignments')}</Text>
          {carpoolAssignments.map((assignment, index) => (
            <Card key={index}>
              <Text style={styles.carpoolActivity}>{assignment.activityName}</Text>
              <Text style={styles.carpoolDetail}>
                🚗 {t('Driver')}: {assignment.driverName}
              </Text>
              <Text style={styles.carpoolDetail}>
                👥 {t('Spots')}: {assignment.occupiedSpots}/
                {assignment.totalSpots}
              </Text>
            </Card>
          ))}
        </View>
      )}

      {/* Important Forms Section */}
      {children.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📋 {t('Important Forms')}</Text>
          <Text style={styles.formsDescription}>
            {t('Complete these forms for your children')}
          </Text>

          <TouchableOpacity
            style={styles.formCard}
            onPress={() => navigation.navigate('HealthForm')}
          >
            <View style={styles.formCardContent}>
              <View>
                <Text style={styles.formCardTitle}>🏥 {t('Health Form')}</Text>
                <Text style={styles.formCardDescription}>
                  {t('Medical information and allergies')}
                </Text>
              </View>
              <Text style={styles.formCardArrow}>→</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.formCard}
            onPress={() => navigation.navigate('RiskAcceptance')}
          >
            <View style={styles.formCardContent}>
              <View>
                <Text style={styles.formCardTitle}>⚠️ {t('Risk Acceptance')}</Text>
                <Text style={styles.formCardDescription}>
                  {t('Activity risk acknowledgment')}
                </Text>
              </View>
              <Text style={styles.formCardArrow}>→</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.formCard}
            onPress={() => navigation.navigate('ParticipantDocuments')}
          >
            <View style={styles.formCardContent}>
              <View>
                <Text style={styles.formCardTitle}>📄 {t('Documents')}</Text>
                <Text style={styles.formCardDescription}>
                  {t('View and manage participant documents')}
                </Text>
              </View>
              <Text style={styles.formCardArrow}>→</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('Quick Actions')}</Text>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('Finance')}
        >
          <Text style={styles.actionButtonText}>💰 {t('View Fees')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('PermissionSlips')}
        >
          <Text style={styles.actionButtonText}>
            📄 {t('Permission Slips')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('HealthForm')}
        >
          <Text style={styles.actionButtonText}>
            🏥 {t('Health Form')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('RiskAcceptance')}
        >
          <Text style={styles.actionButtonText}>
            ⚠️ {t('Risk Acceptance Form')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('ParticipantDocuments')}
        >
          <Text style={styles.actionButtonText}>
            📋 {t('View Documents')}
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
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#007AFF',
    padding: 20,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
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
  registerChildButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
  },
  registerChildButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  carpoolActivity: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
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
});

export default ParentDashboardScreen;
