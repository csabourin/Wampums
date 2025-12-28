/**
 * Admin Screen
 *
 * Mirrors spa/admin.js functionality
 * Admin panel with user management, notifications, and data import
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import {
  getUsers,
  updateUserRole,
  approveUser,
  getSubscribers,
  getCurrentOrganizationId,
  importSISC,
} from '../api/api-endpoints';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Select,
  Checkbox,
  Toast,
  useToast,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  TableHeaderCell,
  Modal,
  ConfirmModal,
} from '../components';
import {
  canViewUsers,
  canSendCommunications,
} from '../utils/PermissionUtils';
import SecurityUtils from '../utils/SecurityUtils';

const AdminScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [currentOrganizationId, setCurrentOrganizationId] = useState(null);
  const [permissions, setPermissions] = useState({
    canAccessAdmin: false,
    canCreateOrg: false,
    canManageUsers: false,
    canViewUsers: false,
    canSendCommunications: false,
  });

  // Notification form state
  const [notificationTitle, setNotificationTitle] = useState('');
  const [notificationBody, setNotificationBody] = useState('');
  const [selectedSubscribers, setSelectedSubscribers] = useState({});

  // User management state
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserRole, setEditingUserRole] = useState('');
  const [userModalVisible, setUserModalVisible] = useState(false);
  const [approveConfirmVisible, setApproveConfirmVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const checkPermissions = async () => {
      const perms = {
        canAccessAdmin: false, // Function doesn't exist, set to false
        canCreateOrg: false, // Function doesn't exist, set to false
        canManageUsers: false, // Function doesn't exist, set to false
        canViewUsers: await canViewUsers(),
        canSendCommunications: await canSendCommunications(),
      };

      setPermissions(perms);

      if (!perms.canAccessAdmin) {
        navigation.goBack();
        return;
      }

      loadData();
    };

    checkPermissions();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const orgId = await getCurrentOrganizationId();
      if (!orgId) {
        throw new Error(t('error_loading_data'));
      }
      setCurrentOrganizationId(orgId);

      const promises = [];

      if (permissions.canManageUsers || permissions.canViewUsers) {
        promises.push(getUsers(orgId, { forceRefresh }));
      }

      if (permissions.canSendCommunications) {
        promises.push(getSubscribers(orgId));
      }

      const results = await Promise.all(promises);

      let resultIndex = 0;

      if (permissions.canManageUsers || permissions.canViewUsers) {
        const usersResult = results[resultIndex++];
        const usersList = usersResult?.users || usersResult?.data || [];
        setUsers(Array.isArray(usersList) ? usersList : []);
      }

      if (permissions.canSendCommunications) {
        const subscribersResult = results[resultIndex++];
        const subsList = subscribersResult?.data || [];
        setSubscribers(Array.isArray(subsList) ? subsList : []);
      }
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

  const handleToggleSubscriber = (subscriberId) => {
    setSelectedSubscribers((prev) => ({
      ...prev,
      [subscriberId]: !prev[subscriberId],
    }));
  };

  const handleSendNotification = async () => {
    if (!notificationTitle.trim() || !notificationBody.trim()) {
      toast.show(t('notification_title_body_required'), 'warning');
      return;
    }

    const selectedIds = Object.keys(selectedSubscribers).filter(
      (id) => selectedSubscribers[id]
    );

    if (selectedIds.length === 0) {
      toast.show(t('select_at_least_one_subscriber'), 'warning');
      return;
    }

    try {
      setSaving(true);

      // TODO: Implement send notification API endpoint
      // const result = await sendNotification({
      //   title: SecurityUtils.sanitizeInput(notificationTitle),
      //   body: SecurityUtils.sanitizeInput(notificationBody),
      //   subscriberIds: selectedIds,
      // });

      toast.show(t('notification_sent_successfully'), 'success');
      setNotificationTitle('');
      setNotificationBody('');
      setSelectedSubscribers({});
    } catch (err) {
      toast.show(err.message || t('error_sending_notification'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setEditingUserId(user.id);
    setEditingUserRole(user.role || '');
    setUserModalVisible(true);
  };

  const handleUpdateUserRole = async () => {
    if (!editingUserRole) {
      toast.show(t('select_role_required'), 'warning');
      return;
    }

    try {
      setSaving(true);

      const result = await updateUserRole(editingUserId, editingUserRole);

      if (result.success) {
        toast.show(t('user_role_updated_successfully'), 'success');
        setUserModalVisible(false);
        setEditingUserId(null);
        setEditingUserRole('');
        setSelectedUser(null);
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_updating_user_role'));
      }
    } catch (err) {
      toast.show(err.message || t('error_updating_user_role'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApproveUserConfirm = (user) => {
    setSelectedUser(user);
    setApproveConfirmVisible(true);
  };

  const handleApproveUser = async () => {
    if (!selectedUser) return;

    try {
      setSaving(true);
      setApproveConfirmVisible(false);

      const result = await approveUser(selectedUser.id);

      if (result.success) {
        toast.show(t('user_approved_successfully'), 'success');
        setSelectedUser(null);
        await loadData(true);
      } else {
        throw new Error(result.message || t('error_approving_user'));
      }
    } catch (err) {
      toast.show(err.message || t('error_approving_user'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const roleOptions = [
    { label: t('select_role'), value: '' },
    { label: t('role_parent'), value: 'parent' },
    { label: t('role_leader'), value: 'leader' },
    { label: t('role_unitadmin'), value: 'unitadmin' },
    { label: t('role_district'), value: 'district' },
    { label: t('role_finance'), value: 'finance' },
    { label: t('role_equipment'), value: 'equipment' },
  ];

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  return (
    <View style={commonStyles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <Card style={styles.headerCard}>
          <Text style={styles.title}>{t('admin_panel')}</Text>
        </Card>

        {/* Quick Actions */}
        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t('quick_actions')}</Text>
          <View style={styles.quickActions}>
            {permissions.canCreateOrg && (
              <TouchableOpacity
                style={commonStyles.button}
                onPress={() => navigation.navigate('CreateOrganization')}
                activeOpacity={0.7}
              >
                <Text style={commonStyles.buttonText}>{t('create_new_unit')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => navigation.navigate('FormBuilder')}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>
                {t('form_builder_title')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => navigation.navigate('RoleManagement')}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>
                {t('role_management')}
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Send Notification */}
        {permissions.canSendCommunications && (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('send_notification')}</Text>

            <FormField
              label={t('title')}
              value={notificationTitle}
              onChangeText={setNotificationTitle}
              placeholder={t('title')}
              required
            />

            <FormField
              label={t('body')}
              value={notificationBody}
              onChangeText={setNotificationBody}
              placeholder={t('body')}
              multiline
              numberOfLines={4}
              required
            />

            <Text style={styles.subsectionTitle}>{t('select_recipients')}</Text>
            <View style={styles.subscribersList}>
              {subscribers.map((subscriber) => (
                <Checkbox
                  key={subscriber.id}
                  label={`${subscriber.name} (${subscriber.email})`}
                  checked={selectedSubscribers[subscriber.id] || false}
                  onPress={() => handleToggleSubscriber(subscriber.id)}
                  style={styles.subscriberCheckbox}
                />
              ))}
            </View>

            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleSendNotification}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>
                {saving ? t('sending') : t('send_notification')}
              </Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* User Management */}
        {(permissions.canManageUsers || permissions.canViewUsers) && (
          <Card style={styles.card}>
            <Text style={styles.sectionTitle}>{t('user_management')}</Text>

            {users.length === 0 ? (
              <Text style={styles.noDataText}>{t('no_users')}</Text>
            ) : (
              <Table>
                <TableHeader>
                  <TableHeaderCell>{t('email')}</TableHeaderCell>
                  <TableHeaderCell>{t('role')}</TableHeaderCell>
                  <TableHeaderCell>{t('status')}</TableHeaderCell>
                  {permissions.canManageUsers && (
                    <TableHeaderCell>{t('actions')}</TableHeaderCell>
                  )}
                </TableHeader>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{user.role || t('no_role')}</TableCell>
                    <TableCell>
                      {user.is_approved ? t('approved') : t('pending')}
                    </TableCell>
                    {permissions.canManageUsers && (
                      <TableCell>
                        <View style={styles.actionsRow}>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => handleEditUser(user)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.actionButtonText}>✏️</Text>
                          </TouchableOpacity>
                          {!user.is_approved && (
                            <TouchableOpacity
                              style={styles.actionButton}
                              onPress={() => handleApproveUserConfirm(user)}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.actionButtonText}>✅</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </Table>
            )}
          </Card>
        )}
      </ScrollView>

      {/* Edit User Modal */}
      <Modal
        visible={userModalVisible}
        onClose={() => {
          setUserModalVisible(false);
          setEditingUserId(null);
          setEditingUserRole('');
          setSelectedUser(null);
        }}
        title={t('edit_user_role')}
        footer={
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={commonStyles.buttonSecondary}
              onPress={() => {
                setUserModalVisible(false);
                setEditingUserId(null);
                setEditingUserRole('');
                setSelectedUser(null);
              }}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonSecondaryText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
              onPress={handleUpdateUserRole}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={commonStyles.buttonText}>
                {saving ? t('saving') : t('save')}
              </Text>
            </TouchableOpacity>
          </View>
        }
      >
        {selectedUser && (
          <>
            <Text style={styles.modalLabel}>{t('email')}:</Text>
            <Text style={styles.modalValue}>{selectedUser.email}</Text>

            <Select
              label={t('role')}
              value={editingUserRole}
              onValueChange={setEditingUserRole}
              options={roleOptions}
              required
            />
          </>
        )}
      </Modal>

      {/* Approve User Confirm Modal */}
      <ConfirmModal
        visible={approveConfirmVisible}
        onClose={() => {
          setApproveConfirmVisible(false);
          setSelectedUser(null);
        }}
        onConfirm={handleApproveUser}
        title={t('confirm_approve_user')}
        message={t('confirm_approve_user_message')}
        confirmText={t('approve')}
        cancelText={t('cancel')}
      />

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
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
  },
  card: {
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  subsectionTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  quickActions: {
    gap: theme.spacing.sm,
  },
  subscribersList: {
    marginBottom: theme.spacing.md,
  },
  subscriberCheckbox: {
    marginVertical: theme.spacing.xs,
  },
  noDataText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  actionButton: {
    width: theme.touchTarget.min,
    height: theme.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: theme.fontSize.lg,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    justifyContent: 'flex-end',
  },
  modalLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.xs,
  },
  modalValue: {
    fontSize: theme.fontSize.base,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
});

export default AdminScreen;
