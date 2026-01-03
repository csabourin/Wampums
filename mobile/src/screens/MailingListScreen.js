/**
 * Mailing List Screen
 *
 * Mirrors spa/mailing_list.js functionality
 * Send announcements and view mailing lists by role
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Clipboard,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  Card,
  EmptyState,
  FormField,
  Checkbox,
  Modal,
  Toast,
  useToast,
} from '../components';
import { canSendCommunications } from '../utils/PermissionUtils';
import API from '../api/api-core';
import { debugError } from '../utils/DebugUtils';

const ROLES = [
  { key: 'parent', label: () => t('parents') },
  { key: 'leader', label: () => t('leader') },
  { key: 'unitadmin', label: () => t('unitadmin') || t('admin') },
  { key: 'district', label: () => t('district') || t('admin') },
  { key: 'finance', label: () => t('finance') },
  { key: 'equipment', label: () => t('equipment') || t('inventory') },
  { key: 'administration', label: () => t('administration') || t('reports') },
];

const MailingListScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mailingList, setMailingList] = useState({});
  const [announcements, setAnnouncements] = useState([]);
  const [groups, setGroups] = useState([]);
  const [templates, setTemplates] = useState([]);

  const [showComposerModal, setShowComposerModal] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState(new Set(['parent', 'leader']));
  const [selectedGroups, setSelectedGroups] = useState(new Set());

  const [formData, setFormData] = useState({
    subject: '',
    message: '',
    scheduled_at: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    checkPermissionsAndLoad();
  }, []);

  const checkPermissionsAndLoad = async () => {
    try {
      if (!canSendCommunications()) {
        Alert.alert(
          t('access_denied'),
          t('no_permission_to_send_communications'),
          [
            {
              text: t('OK'),
              onPress: () => navigation.goBack(),
            },
          ]
        );
        return;
      }

      await loadData();
    } catch (err) {
      debugError('Error checking permissions:', err);
      setLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const [mailingResponse, groupsResponse, announcementsResponse] = await Promise.all([
        API.get('mailing-list'),
        API.get('v1/groups'),
        API.get('v1/announcements'),
      ]);

      if (mailingResponse.success || mailingResponse.emails_by_role) {
        setMailingList(mailingResponse);
      }

      if (groupsResponse.success || groupsResponse.data || groupsResponse.groups) {
        setGroups(groupsResponse.data?.groups || groupsResponse.groups || groupsResponse.data || []);
      }

      if (announcementsResponse.success || announcementsResponse.data) {
        setAnnouncements(announcementsResponse.data || []);
        setTemplates(announcementsResponse.templates || []);
      }
    } catch (err) {
      debugError('Error loading data:', err);
      toast.show(t('error_loading_data'), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  const handleToggleRole = (roleKey) => {
    const newSelectedRoles = new Set(selectedRoles);
    if (newSelectedRoles.has(roleKey)) {
      newSelectedRoles.delete(roleKey);
    } else {
      newSelectedRoles.add(roleKey);
    }
    setSelectedRoles(newSelectedRoles);
  };

  const handleToggleGroup = (groupId) => {
    const newSelectedGroups = new Set(selectedGroups);
    if (newSelectedGroups.has(groupId)) {
      newSelectedGroups.delete(groupId);
    } else {
      newSelectedGroups.add(groupId);
    }
    setSelectedGroups(newSelectedGroups);
  };

  const handleSendAnnouncement = async (saveAsDraft = false) => {
    if (!formData.subject || !formData.message) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    if (selectedRoles.size === 0) {
      toast.show(t('select_at_least_one_role'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        subject: formData.subject.trim(),
        message: formData.message.trim(),
        recipient_roles: Array.from(selectedRoles),
        recipient_group_ids: Array.from(selectedGroups).map((id) => parseInt(id, 10)),
        scheduled_at: formData.scheduled_at || null,
        save_as_draft: saveAsDraft,
        send_now: !saveAsDraft,
      };

      const result = await API.post('v1/announcements', payload);

      if (result.success) {
        toast.show(
          saveAsDraft ? t('announcement_saved') : t('announcement_sent'),
          'success'
        );
        setShowComposerModal(false);
        setFormData({
          subject: '',
          message: '',
          scheduled_at: '',
        });
        setSelectedRoles(new Set(['parent', 'leader']));
        setSelectedGroups(new Set());
        await loadData();
      } else {
        toast.show(result.message || t('error_sending_announcement'), 'error');
      }
    } catch (err) {
      debugError('Error sending announcement:', err);
      toast.show(err.message || t('error_sending_announcement'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const copyRoleEmails = async (role) => {
    const emailsByRole = mailingList?.emails_by_role || {};
    const emails = emailsByRole[role] || [];

    let emailString;
    if (role === 'parent') {
      const uniqueParentEmails = [
        ...new Set(emails.map((entry) => entry.email).filter(Boolean)),
      ];
      emailString = uniqueParentEmails.join(', ');
    } else {
      const uniqueRoleEmails = [...new Set(emails.filter(Boolean))];
      emailString = uniqueRoleEmails.join(', ');
    }

    if (!emailString) {
      toast.show(t('no_data_available'), 'warning');
      return;
    }

    Clipboard.setString(emailString);
    toast.show(
      `${t('emails_copied_to_clipboard_for')} ${t(role)}`,
      'success'
    );
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('en-CA');
    } catch {
      return '-';
    }
  };

  const getDeliverySummary = (logs) => {
    const summary = {
      email: { sent: 0, failed: 0 },
      push: { sent: 0, failed: 0 },
    };

    logs?.forEach((log) => {
      if (log.channel === 'email') {
        if (log.status === 'sent') summary.email.sent += 1;
        if (log.status === 'failed') summary.email.failed += 1;
      }
      if (log.channel === 'push') {
        if (log.status === 'sent') summary.push.sent += 1;
        if (log.status === 'failed') summary.push.failed += 1;
      }
    });

    return summary;
  };

  const renderMailingList = () => {
    const emailsByRole = mailingList?.emails_by_role || {};

    if (!Object.keys(emailsByRole).length) {
      return (
        <EmptyState
          icon="📧"
          message={t('no_data_available')}
          description={t('no_mailing_list_data')}
        />
      );
    }

    return Object.entries(emailsByRole).map(([role, emails]) => {
      if (role === 'parent') {
        // Group parent emails by family
        const families = {};
        emails.forEach((parent) => {
          const key = parent.participants || t('unknown_child');
          if (!families[key]) {
            families[key] = new Set();
          }
          if (parent.email) {
            families[key].add(parent.email);
          }
        });

        return (
          <Card key={role} style={styles.roleCard}>
            <View style={styles.roleHeader}>
              <Text style={styles.roleTitle}>{t('parents')}</Text>
              <TouchableOpacity
                style={styles.copyButton}
                onPress={() => copyRoleEmails(role)}
                activeOpacity={0.7}
              >
                <Text style={styles.copyButtonText}>📋 {t('copy_emails')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.emailsList}>
              {Object.entries(families).map(([family, emailSet]) => (
                <View key={family} style={styles.familyRow}>
                  <Text style={styles.familyLabel}>{family}:</Text>
                  <Text style={styles.emailText}>
                    {Array.from(emailSet).join(', ')}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        );
      }

      // Other roles
      return (
        <Card key={role} style={styles.roleCard}>
          <View style={styles.roleHeader}>
            <Text style={styles.roleTitle}>{t(role)}</Text>
            <TouchableOpacity
              style={styles.copyButton}
              onPress={() => copyRoleEmails(role)}
              activeOpacity={0.7}
            >
              <Text style={styles.copyButtonText}>📋 {t('copy_emails')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.emailsList}>
            {emails.map((email, index) => (
              <Text key={index} style={styles.emailText}>
                {typeof email === 'string' ? email : email.email || '---'}
              </Text>
            ))}
          </View>
        </Card>
      );
    });
  };

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.kicker}>{t('communications')}</Text>
          <Text style={styles.title}>{t('mailing_list')}</Text>
          <Text style={styles.subtitle}>{t('announcement_roles_help')}</Text>
        </Card>

        {/* Compose Button */}
        <TouchableOpacity
          style={[commonStyles.button, styles.composeButton]}
          onPress={() => setShowComposerModal(true)}
          activeOpacity={0.7}
        >
          <Text style={commonStyles.buttonText}>{t('compose_announcement')}</Text>
        </TouchableOpacity>

        {/* Announcement History */}
        <Card>
          <Text style={styles.sectionTitle}>{t('announcement_history')}</Text>

          {announcements.length === 0 ? (
            <EmptyState
              icon="📢"
              message={t('no_announcements')}
              description={t('no_announcements_yet')}
            />
          ) : (
            <View style={styles.announcementsList}>
              {announcements.map((announcement) => {
                const deliverySummary = getDeliverySummary(announcement.logs);

                return (
                  <View key={announcement.id} style={styles.announcementCard}>
                    <View style={styles.announcementHeader}>
                      <Text style={styles.announcementSubject}>
                        {announcement.subject}
                      </Text>
                      <Text style={styles.announcementStatus}>
                        {t(announcement.status) || announcement.status}
                      </Text>
                    </View>

                    <View style={styles.announcementDetails}>
                      <Text style={styles.announcementDetail}>
                        {t('recipient_roles')}:{' '}
                        {announcement.recipient_roles
                          ?.map((role) => t(role) || role)
                          .join(', ') || t('no_data_available')}
                      </Text>
                      {announcement.scheduled_at && (
                        <Text style={styles.announcementDetail}>
                          {t('scheduled_for')}: {formatDateTime(announcement.scheduled_at)}
                        </Text>
                      )}
                      {announcement.sent_at && (
                        <Text style={styles.announcementDetail}>
                          {t('sent_at')}: {formatDateTime(announcement.sent_at)}
                        </Text>
                      )}
                    </View>

                    <View style={styles.deliveryStatus}>
                      <Text style={styles.deliveryStatusTitle}>
                        {t('delivery_status_summary')}:
                      </Text>
                      <View style={styles.statusBadges}>
                        <View style={[styles.badge, styles.badgeSuccess]}>
                          <Text style={styles.badgeText}>
                            {t('emails')}: {deliverySummary.email.sent}
                          </Text>
                        </View>
                        {deliverySummary.email.failed > 0 && (
                          <View style={[styles.badge, styles.badgeWarning]}>
                            <Text style={styles.badgeText}>
                              {t('failed')}: {deliverySummary.email.failed}
                            </Text>
                          </View>
                        )}
                        <View style={[styles.badge, styles.badgeInfo]}>
                          <Text style={styles.badgeText}>
                            {t('push_notifications')}: {deliverySummary.push.sent}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* Mailing Lists by Role */}
        <Text style={styles.sectionTitle}>{t('mailing_lists_by_role')}</Text>
        {renderMailingList()}
      </ScrollView>

      {/* Announcement Composer Modal */}
      <Modal
        visible={showComposerModal}
        onClose={() => setShowComposerModal(false)}
        title={t('compose_announcement')}
      >
        <ScrollView style={styles.modalContent}>
          <FormField
            label={t('announcement_subject')}
            value={formData.subject}
            onChangeText={(value) => setFormData({ ...formData, subject: value })}
            placeholder={t('announcement_subject')}
            required
          />

          <FormField
            label={t('announcement_message')}
            value={formData.message}
            onChangeText={(value) => setFormData({ ...formData, message: value })}
            placeholder={t('announcement_message')}
            multiline
            numberOfLines={5}
            required
          />

          <View style={styles.rolesSection}>
            <Text style={styles.rolesSectionTitle}>{t('recipient_roles')}</Text>
            {ROLES.map((role) => (
              <Checkbox
                key={role.key}
                checked={selectedRoles.has(role.key)}
                onPress={() => handleToggleRole(role.key)}
                label={role.label()}
              />
            ))}
          </View>

          {groups.length > 0 && (
            <View style={styles.groupsSection}>
              <Text style={styles.rolesSectionTitle}>{t('select_groups')}</Text>
              {groups.map((group) => (
                <Checkbox
                  key={group.id}
                  checked={selectedGroups.has(group.id)}
                  onPress={() => handleToggleGroup(group.id)}
                  label={group.name}
                />
              ))}
            </View>
          )}

          <FormField
            label={t('schedule_send_time')}
            value={formData.scheduled_at}
            onChangeText={(value) => setFormData({ ...formData, scheduled_at: value })}
            placeholder="YYYY-MM-DD HH:MM"
          />

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[commonStyles.button, submitting && commonStyles.buttonDisabled]}
              onPress={() => handleSendAnnouncement(false)}
              disabled={submitting}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>
                {submitting ? t('sending') : t('send_now')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[commonStyles.button, styles.draftButton, submitting && commonStyles.buttonDisabled]}
              onPress={() => handleSendAnnouncement(true)}
              disabled={submitting}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('save_draft')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[commonStyles.button, styles.cancelButton]}
              onPress={() => setShowComposerModal(false)}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
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
  composeButton: {
    marginBottom: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  announcementsList: {
    gap: theme.spacing.md,
  },
  announcementCard: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.primary,
    paddingLeft: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  announcementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  announcementSubject: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    flex: 1,
  },
  announcementStatus: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.primary,
  },
  announcementDetails: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  announcementDetail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  deliveryStatus: {
    marginTop: theme.spacing.sm,
  },
  deliveryStatusTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  statusBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
  },
  badgeSuccess: {
    backgroundColor: '#D4EDDA',
  },
  badgeWarning: {
    backgroundColor: '#FFF3CD',
  },
  badgeInfo: {
    backgroundColor: '#D1ECF1',
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  roleCard: {
    marginBottom: theme.spacing.md,
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  roleTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
  },
  copyButton: {
    padding: theme.spacing.sm,
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  copyButtonText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
  },
  emailsList: {
    gap: theme.spacing.sm,
  },
  familyRow: {
    marginBottom: theme.spacing.sm,
  },
  familyLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  emailText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  modalContent: {
    maxHeight: '80%',
  },
  rolesSection: {
    marginVertical: theme.spacing.md,
  },
  groupsSection: {
    marginVertical: theme.spacing.md,
  },
  rolesSectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  modalActions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.lg,
  },
  draftButton: {
    backgroundColor: theme.colors.secondary,
  },
  cancelButton: {
    backgroundColor: theme.colors.textMuted,
  },
});

export default MailingListScreen;
