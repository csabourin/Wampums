/**
 * Permission Slips Dashboard Screen
 *
 * Mirrors spa/permission_slip_dashboard.js functionality
 * Manage permission slips for activities
 * Create, send, and track permission slip signatures
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import {
  getPermissionSlips,
  savePermissionSlip,
  sendPermissionSlipEmails,
  sendPermissionSlipReminders,
  archivePermissionSlip,
  getResourceDashboard,
  getGroups,
  getParticipants,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  StatCard,
  Modal,
  FormField,
  Select,
  Checkbox,
  Toast,
  useToast,
  EmptyState,
} from '../components';
import DateUtils from '../utils/DateUtils';
import { canSendCommunications, canViewParticipants } from '../utils/PermissionUtils';

const PermissionSlipsScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activityDate, setActivityDate] = useState(
    DateUtils.formatDate(new Date(), 'en', 'YYYY-MM-DD')
  );
  const [permissionSlips, setPermissionSlips] = useState([]);
  const [dashboardSummary, setDashboardSummary] = useState({ permission_summary: [] });
  const [groups, setGroups] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [formData, setFormData] = useState({
    activity_title: '',
    activity_description: '',
    deadline_date: '',
    selected_audience: '',
    selected_participant_ids: [],
  });
  const toast = useToast();

  useEffect(() => {
    // Check permissions
    const checkPermissions = async () => {
      const hasSendComms = await canSendCommunications();
      const hasViewParticipants = await canViewParticipants();
      
      if (!hasSendComms && !hasViewParticipants) {
        navigation.goBack();
        return;
      }

      loadData();
    };

    checkPermissions();
  }, []);

  useEffect(() => {
    loadData();
  }, [activityDate]);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const params = { meeting_date: activityDate };
      const [slipResponse, summaryResponse, groupsResponse, participantsResponse] =
        await Promise.all([
          getPermissionSlips(params, { forceRefresh }),
          getResourceDashboard(params, { forceRefresh }),
          getGroups(),
          getParticipants(),
        ]);

      setPermissionSlips(
        slipResponse?.data?.permission_slips || slipResponse?.permission_slips || []
      );
      setDashboardSummary(summaryResponse?.data || summaryResponse || { permission_summary: [] });
      setGroups(groupsResponse?.data || groupsResponse?.groups || []);
      setParticipants(participantsResponse?.data || participantsResponse?.participants || []);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  };

  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const getFilteredParticipants = () => {
    const { selected_audience } = formData;

    if (!selected_audience) {
      return [];
    }

    let filtered = [...participants];

    // Filter based on audience selection
    if (selected_audience === 'all') {
      // All active participants
      filtered = filtered.filter((p) => p.status === 'active');
    } else if (selected_audience === 'first-year') {
      // First year participants
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      filtered = filtered.filter((p) => new Date(p.created_at) >= yearAgo);
    } else if (selected_audience === 'second-year') {
      // Second year participants
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      filtered = filtered.filter(
        (p) => new Date(p.created_at) < oneYearAgo && new Date(p.created_at) >= twoYearsAgo
      );
    } else if (selected_audience === 'age-11-plus') {
      // Age 11 and above
      filtered = filtered.filter((p) => DateUtils.calculateAge(p.birthdate) >= 11);
    } else if (selected_audience.startsWith('group-')) {
      // Specific group
      const groupId = parseInt(selected_audience.replace('group-', ''), 10);
      filtered = filtered.filter((p) => p.group_id === groupId);
    }

    return filtered;
  };

  const handleToggleParticipant = (participantId) => {
    const { selected_participant_ids } = formData;
    const isSelected = selected_participant_ids.includes(participantId);

    handleFieldChange(
      'selected_participant_ids',
      isSelected
        ? selected_participant_ids.filter((id) => id !== participantId)
        : [...selected_participant_ids, participantId]
    );
  };

  const handleSelectAll = () => {
    const filteredParticipants = getFilteredParticipants();
    handleFieldChange(
      'selected_participant_ids',
      filteredParticipants.map((p) => p.id)
    );
  };

  const handleDeselectAll = () => {
    handleFieldChange('selected_participant_ids', []);
  };

  const validateForm = () => {
    if (!formData.activity_title.trim()) {
      toast.show(t('activity_title_required'), 'warning');
      return false;
    }

    if (!formData.selected_audience) {
      toast.show(t('select_group_required'), 'warning');
      return false;
    }

    if (formData.selected_participant_ids.length === 0) {
      toast.show(t('select_at_least_one_participant'), 'warning');
      return false;
    }

    return true;
  };

  const handleCreatePermissionSlip = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);

      const result = await savePermissionSlip({
        activity_title: formData.activity_title,
        activity_description: formData.activity_description,
        deadline_date: formData.deadline_date || null,
        meeting_date: activityDate,
        participant_ids: formData.selected_participant_ids,
      });

      if (result.success) {
        toast.show(t('permission_slip_created_successfully'), 'success');
        setCreateModalVisible(false);
        resetForm();
        await loadData(true);
      } else {
        toast.show(result.message || t('error_creating_permission_slip'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_creating_permission_slip'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmails = async (activityTitle) => {
    try {
      setLoading(true);
      const result = await sendPermissionSlipEmails({
        activity_title: activityTitle,
        meeting_date: activityDate,
      });

      if (result.success) {
        toast.show(t('emails_sent_successfully'), 'success');
      } else {
        toast.show(result.message || t('error_sending_emails'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_sending_emails'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminders = async (activityTitle) => {
    try {
      setLoading(true);
      const result = await sendPermissionSlipReminders({
        activity_title: activityTitle,
        meeting_date: activityDate,
      });

      if (result.success) {
        toast.show(t('reminders_sent_successfully'), 'success');
      } else {
        toast.show(result.message || t('error_sending_reminders'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_sending_reminders'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async (slipId) => {
    try {
      setLoading(true);
      const result = await archivePermissionSlip(slipId);

      if (result.success) {
        toast.show(t('permission_slip_archived_successfully'), 'success');
        await loadData(true);
      } else {
        toast.show(result.message || t('error_archiving_permission_slip'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_archiving_permission_slip'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      activity_title: '',
      activity_description: '',
      deadline_date: '',
      selected_audience: '',
      selected_participant_ids: [],
    });
  };

  // Group permission slips by activity
  const groupSlipsByActivity = () => {
    const activitiesMap = new Map();

    permissionSlips.forEach((slip) => {
      const key = `${slip.activity_title || 'Sans titre'}_${slip.meeting_date}`;
      if (!activitiesMap.has(key)) {
        activitiesMap.set(key, {
          title: slip.activity_title || t('no_data_available'),
          date: slip.meeting_date,
          description: slip.activity_description,
          deadline: slip.deadline_date,
          slips: [],
        });
      }
      activitiesMap.get(key).slips.push(slip);
    });

    return Array.from(activitiesMap.values());
  };

  const renderActivity = ({ item: activity }) => {
    const signedCount = activity.slips.filter((s) => s.status === 'signed').length;
    const totalCount = activity.slips.length;

    return (
      <Card style={styles.activityCard}>
        <Text style={styles.activityTitle}>{activity.title}</Text>
        <Text style={styles.activityDate}>
          {t('activity_date_label')}: {DateUtils.formatDate(new Date(activity.date))}
        </Text>
        {activity.description && (
          <Text style={styles.activityDescription}>{activity.description}</Text>
        )}
        {activity.deadline && (
          <Text style={styles.deadline}>
            {t('deadline_date')}: {DateUtils.formatDate(new Date(activity.deadline))}
          </Text>
        )}

        <View style={styles.statsRow}>
          <Text style={styles.statsText}>
            {t('signed')}: {signedCount} / {totalCount}
          </Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionButton, styles.emailButton]}
            onPress={() => handleSendEmails(activity.title)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('send_emails')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.reminderButton]}
            onPress={() => handleSendReminders(activity.title)}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>{t('send_reminders')}</Text>
          </TouchableOpacity>
        </View>

        {/* List of individual slips */}
        {activity.slips.map((slip) => (
          <View key={slip.id} style={styles.slipRow}>
            <Text style={styles.slipParticipant}>{slip.participant_name}</Text>
            <View style={styles.slipStatus}>
              <Text
                style={[
                  styles.statusBadge,
                  slip.status === 'signed' ? styles.statusSigned : styles.statusPending,
                ]}
              >
                {slip.status}
              </Text>
              {slip.status !== 'archived' && (
                <TouchableOpacity
                  style={styles.archiveButton}
                  onPress={() => handleArchive(slip.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.archiveButtonText}>{t('archive')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </Card>
    );
  };

  const audienceOptions = [
    { label: `-- ${t('select_group_label')} --`, value: '' },
    { label: t('all_active_participants'), value: 'all' },
    { label: t('first_year_participants'), value: 'first-year' },
    { label: t('second_year_participants'), value: 'second-year' },
    { label: t('participants_age_11_plus'), value: 'age-11-plus' },
    ...groups.map((g) => ({ label: g.name, value: `group-${g.id}` })),
  ];

  const filteredParticipants = getFilteredParticipants();
  const selectedCount = formData.selected_participant_ids.length;

  const permissionSummary = dashboardSummary?.permission_summary || [];
  const signedCount = permissionSummary.find((s) => s.status === 'signed')?.count || 0;
  const pendingCount = permissionSummary.find((s) => s.status === 'pending')?.count || 0;

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  const activities = groupSlipsByActivity();

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Dashboard Summary */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('dashboard_summary_title')}</Text>
          <View style={styles.summaryRow}>
            <StatCard
              label={t('signed')}
              value={signedCount.toString()}
              style={styles.statCard}
            />
            <StatCard
              label={t('pending')}
              value={pendingCount.toString()}
              style={styles.statCard}
            />
          </View>
        </Card>

        {/* Activity Date Filter */}
        <FormField
          label={t('activity_date_label')}
          value={activityDate}
          onChangeText={setActivityDate}
          placeholder="YYYY-MM-DD"
          helpText={t('format_yyyy_mm_dd')}
        />

        {/* Activities List */}
        {activities.length === 0 ? (
          <EmptyState
            icon="📋"
            title={t('no_permission_slips')}
            message={t('no_permission_slips_for_date')}
            actionLabel={t('permission_slip_create')}
            onAction={() => setCreateModalVisible(true)}
          />
        ) : (
          <FlatList
            data={activities}
            renderItem={renderActivity}
            keyExtractor={(item, index) => `${item.title}_${index}`}
            scrollEnabled={false}
          />
        )}
      </ScrollView>

      {/* FAB - Create Permission Slip */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setCreateModalVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Create Permission Slip Modal */}
      <Modal
        visible={createModalVisible}
        onClose={() => {
          setCreateModalVisible(false);
          resetForm();
        }}
        title={t('permission_slip_create')}
        scrollable={true}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setCreateModalVisible(false);
                resetForm();
              }}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={commonStyles.button}
              onPress={handleCreatePermissionSlip}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('create')}</Text>
            </TouchableOpacity>
          </View>
        }
      >
        <FormField
          label={t('activity_title_label')}
          value={formData.activity_title}
          onChangeText={(val) => handleFieldChange('activity_title', val)}
          placeholder={t('activity_title_label')}
          required
        />

        <FormField
          label={t('activity_description_label')}
          value={formData.activity_description}
          onChangeText={(val) => handleFieldChange('activity_description', val)}
          placeholder={t('activity_description_label')}
          multiline
          numberOfLines={4}
        />

        <FormField
          label={t('deadline_date_label')}
          value={formData.deadline_date}
          onChangeText={(val) => handleFieldChange('deadline_date', val)}
          placeholder="YYYY-MM-DD"
          helpText={t('format_yyyy_mm_dd')}
        />

        <Select
          label={t('select_group_label')}
          value={formData.selected_audience}
          onValueChange={(val) => handleFieldChange('selected_audience', val)}
          options={audienceOptions}
          required
        />

        {formData.selected_audience && filteredParticipants.length > 0 && (
          <View style={styles.participantsSection}>
            <View style={styles.participantsHeader}>
              <Text style={styles.participantsLabel}>
                {t('select_participants_label')} ({selectedCount} {t('participants_selected')})
              </Text>
              <View style={styles.selectButtons}>
                <TouchableOpacity onPress={handleSelectAll} activeOpacity={0.7}>
                  <Text style={styles.selectButtonText}>{t('select_all_participants')}</Text>
                </TouchableOpacity>
                <Text style={styles.separator}> | </Text>
                <TouchableOpacity onPress={handleDeselectAll} activeOpacity={0.7}>
                  <Text style={styles.selectButtonText}>{t('deselect_all_participants')}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.participantsList}>
              {filteredParticipants.map((participant) => (
                <Checkbox
                  key={participant.id}
                  label={`${participant.first_name} ${participant.last_name}`}
                  checked={formData.selected_participant_ids.includes(participant.id)}
                  onPress={() => handleToggleParticipant(participant.id)}
                  style={styles.participantCheckbox}
                />
              ))}
            </View>
          </View>
        )}
      </Modal>

      {/* Toast Notifications */}
      <Toast
        visible={toast.toastState.visible}
        message={toast.toastState.message}
        type={toast.toastState.type}
        duration={toast.toastState.duration}
        onDismiss={toast.hide}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  statCard: {
    flex: 1,
  },
  activityCard: {
    marginBottom: theme.spacing.md,
  },
  activityTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  activityDate: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  activityDescription: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  deadline: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.warning,
    marginBottom: theme.spacing.sm,
  },
  statsRow: {
    marginVertical: theme.spacing.sm,
  },
  statsText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.text,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  actionButton: {
    flex: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emailButton: {
    backgroundColor: theme.colors.info,
  },
  reminderButton: {
    backgroundColor: theme.colors.warning,
  },
  actionButtonText: {
    color: theme.colors.selectedText,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  slipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  slipParticipant: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
    flex: 1,
  },
  slipStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    textTransform: 'capitalize',
  },
  statusSigned: {
    backgroundColor: theme.colors.success,
    color: theme.colors.selectedText,
  },
  statusPending: {
    backgroundColor: theme.colors.warning,
    color: theme.colors.selectedText,
  },
  archiveButton: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  archiveButtonText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.textMuted,
    textDecorationLine: 'underline',
  },
  fab: {
    position: 'absolute',
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.lg,
  },
  fabText: {
    fontSize: 32,
    color: theme.colors.selectedText,
    fontWeight: '300',
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
  participantsSection: {
    marginTop: theme.spacing.md,
  },
  participantsHeader: {
    marginBottom: theme.spacing.sm,
  },
  participantsLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  selectButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.info,
    textDecorationLine: 'underline',
  },
  separator: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  participantsList: {
    maxHeight: 300,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.sm,
  },
  participantCheckbox: {
    marginVertical: theme.spacing.xs,
  },
});

export default PermissionSlipsScreen;
