/**
 * Role Management Screen
 *
 * Mirrors spa/role_management.js functionality
 * View roles and their permissions, assign roles to users
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
  TextInput,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  Checkbox,
  Toast,
  useToast,
  EmptyState,
  Modal,
} from '../components';
import { hasPermission, isDistrictAdmin } from '../utils/PermissionUtils';
import CONFIG from '../config';
import StorageUtils from '../utils/StorageUtils';

const RoleManagementScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('roles'); // 'roles' or 'users'
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [rolePermissions, setRolePermissions] = useState({});
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userRoles, setUserRoles] = useState([]);
  const [selectedUserRoleIds, setSelectedUserRoleIds] = useState([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // Check permission
    if (!hasPermission('roles.view')) {
      navigation.goBack();
      return;
    }

    loadData();
  }, []);

  useEffect(() => {
    if (activeTab === 'users' && users.length === 0) {
      fetchUsers();
    }
  }, [activeTab]);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');
      await fetchRoles();
    } catch (err) {
      setError(err.message || t('error_loading_data'));
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(true);
    if (activeTab === 'users') {
      await fetchUsers();
    }
    setRefreshing(false);
  };

  const fetchRoles = async () => {
    const response = await fetch(`${CONFIG.API.BASE_URL}/roles`, {
      headers: {
        Authorization: `Bearer ${await StorageUtils.getJWT()}`,
        'X-Organization-Id': await StorageUtils.getOrganizationId(),
      },
    });

    if (!response.ok) {
      throw new Error(t('failed_to_fetch_roles'));
    }

    const result = await response.json();
    setRoles(result.data || []);
  };

  const fetchUsers = async () => {
    const response = await fetch(`${CONFIG.API.BASE_URL}/users`, {
      headers: {
        Authorization: `Bearer ${await StorageUtils.getJWT()}`,
        'X-Organization-Id': await StorageUtils.getOrganizationId(),
      },
    });

    if (!response.ok) {
      throw new Error(t('failed_to_fetch_users'));
    }

    const result = await response.json();
    setUsers(result.users || result.data || []);
  };

  const fetchRolePermissions = async (roleId) => {
    if (rolePermissions[roleId]) {
      return rolePermissions[roleId];
    }

    const response = await fetch(`${CONFIG.API.BASE_URL}/roles/${roleId}/permissions`, {
      headers: {
        Authorization: `Bearer ${await StorageUtils.getJWT()}`,
        'X-Organization-Id': await StorageUtils.getOrganizationId(),
      },
    });

    if (!response.ok) {
      throw new Error(t('failed_to_fetch_role_permissions'));
    }

    const result = await response.json();
    const permissions = result.data || [];

    setRolePermissions((prev) => ({
      ...prev,
      [roleId]: permissions,
    }));

    return permissions;
  };

  const handleToggleRolePermissions = async (roleId) => {
    if (selectedRoleId === roleId) {
      setSelectedRoleId(null);
    } else {
      setSelectedRoleId(roleId);
      try {
        await fetchRolePermissions(roleId);
      } catch (err) {
        toast.show(err.message || t('error_loading_permissions'), 'error');
      }
    }
  };

  const handleSelectUser = async (user) => {
    setSelectedUserId(user.id);

    try {
      const response = await fetch(`${CONFIG.API.BASE_URL}/users/${user.id}/roles`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getJWT()}`,
          'X-Organization-Id': await StorageUtils.getOrganizationId(),
        },
      });

      if (!response.ok) {
        throw new Error(t('failed_to_fetch_user_roles'));
      }

      const result = await response.json();
      const roles = result.data || [];
      setUserRoles(roles);
      setSelectedUserRoleIds(roles.map((r) => r.id));
    } catch (err) {
      toast.show(err.message || t('error_loading_user_roles'), 'error');
    }
  };

  const handleToggleUserRole = (roleId) => {
    setSelectedUserRoleIds((prev) => {
      if (prev.includes(roleId)) {
        return prev.filter((id) => id !== roleId);
      } else {
        return [...prev, roleId];
      }
    });
  };

  const handleSaveUserRoles = async () => {
    if (!selectedUserId) return;

    try {
      setSaving(true);

      const response = await fetch(`${CONFIG.API.BASE_URL}/users/${selectedUserId}/roles`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await StorageUtils.getJWT()}`,
          'X-Organization-Id': await StorageUtils.getOrganizationId(),
        },
        body: JSON.stringify({ roleIds: selectedUserRoleIds }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t('failed_to_update_user_roles'));
      }

      toast.show(t('user_roles_updated_successfully'), 'success');
      await fetchUsers(); // Refresh user list
    } catch (err) {
      toast.show(err.message || t('error_updating_user_roles'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = users.filter((user) => {
    if (!userSearchQuery) return true;
    const query = userSearchQuery.toLowerCase();
    return (
      user.email?.toLowerCase().includes(query) ||
      user.full_name?.toLowerCase().includes(query)
    );
  });

  const renderRoleCard = ({ item: role }) => {
    const isExpanded = selectedRoleId === role.id;
    const permissions = rolePermissions[role.id] || [];

    return (
      <Card style={styles.roleCard}>
        <View style={styles.roleHeader}>
          <View style={styles.roleInfo}>
            <Text style={styles.roleName}>{role.display_name}</Text>
            <View style={[styles.roleBadge, styles[`roleBadge${role.role_name}`]]}>
              <Text style={styles.roleBadgeText}>{role.role_name}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => handleToggleRolePermissions(role.id)}
            activeOpacity={0.7}
          >
            <Text style={styles.toggleIcon}>{isExpanded ? '▼' : '▶'}</Text>
            <Text style={styles.toggleText}>{t('view_permissions')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.roleDescription}>
          {role.description || t('no_description_available')}
        </Text>

        {isExpanded && (
          <View style={styles.permissionsContainer}>
            <Text style={styles.permissionsTitle}>{t('permissions')}:</Text>
            {permissions.length === 0 ? (
              <Text style={styles.noPermissionsText}>{t('no_permissions')}</Text>
            ) : (
              permissions.map((perm, index) => (
                <View key={index} style={styles.permissionRow}>
                  <Text style={styles.permissionText}>
                    • {perm.permission_name || perm.name}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </Card>
    );
  };

  const renderUserItem = ({ item: user }) => {
    const roleNames = (user.roles || [])
      .map((r) => r.display_name || r.role_name)
      .join(', ');
    const isSelected = selectedUserId === user.id;

    return (
      <TouchableOpacity
        style={[styles.userItem, isSelected && styles.userItemSelected]}
        onPress={() => handleSelectUser(user)}
        activeOpacity={0.7}
      >
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user.full_name || user.email}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          {roleNames && <Text style={styles.userRolesSummary}>{roleNames}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  const canAssignRoles = hasPermission('users.assign_roles');

  if (loading && !refreshing) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error && !loading) {
    return <ErrorMessage message={error} onRetry={loadData} />;
  }

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <View style={commonStyles.container}>
      {/* Tab Navigation */}
      <View style={styles.tabNav}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'roles' && styles.tabButtonActive]}
          onPress={() => setActiveTab('roles')}
          activeOpacity={0.7}
        >
          <Text
            style={[styles.tabButtonText, activeTab === 'roles' && styles.tabButtonTextActive]}
          >
            {t('roles_and_permissions')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tabButton,
            activeTab === 'users' && styles.tabButtonActive,
            !canAssignRoles && styles.tabButtonDisabled,
          ]}
          onPress={() => canAssignRoles && setActiveTab('users')}
          disabled={!canAssignRoles}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.tabButtonText,
              activeTab === 'users' && styles.tabButtonTextActive,
              !canAssignRoles && styles.tabButtonTextDisabled,
            ]}
          >
            {t('assign_roles_to_users')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      {activeTab === 'roles' ? (
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Card style={styles.descriptionCard}>
            <Text style={styles.descriptionText}>
              {t('roles_tab_description') ||
                'View all available roles and their associated permissions.'}
            </Text>
          </Card>

          {roles.length === 0 ? (
            <EmptyState
              icon="👥"
              title={t('no_roles')}
              message={t('no_roles_available')}
            />
          ) : (
            <FlatList
              data={roles}
              renderItem={renderRoleCard}
              keyExtractor={(item) => `role-${item.id}`}
              scrollEnabled={false}
            />
          )}
        </ScrollView>
      ) : (
        <View style={styles.usersTabContainer}>
          {/* User List */}
          <View style={styles.userListPanel}>
            <View style={styles.userSearchContainer}>
              <TextInput
                style={styles.userSearchInput}
                placeholder={t('search_users')}
                value={userSearchQuery}
                onChangeText={setUserSearchQuery}
              />
            </View>

            <FlatList
              data={filteredUsers}
              renderItem={renderUserItem}
              keyExtractor={(item) => `user-${item.id}`}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              ListEmptyComponent={
                <EmptyState icon="👤" title={t('no_users_found')} message="" />
              }
            />
          </View>

          {/* User Assignment Panel */}
          <View style={styles.userAssignmentPanel}>
            {selectedUser ? (
              <ScrollView contentContainerStyle={styles.assignmentContainer}>
                <Text style={styles.assignmentTitle}>
                  {selectedUser.full_name || selectedUser.email}
                </Text>
                <Text style={styles.assignmentEmail}>{selectedUser.email}</Text>

                <Text style={styles.rolesListTitle}>{t('assign_roles')}:</Text>

                {roles.map((role) => (
                  <Checkbox
                    key={role.id}
                    label={role.display_name}
                    checked={selectedUserRoleIds.includes(role.id)}
                    onPress={() => handleToggleUserRole(role.id)}
                    style={styles.roleCheckbox}
                  />
                ))}

                <TouchableOpacity
                  style={[commonStyles.button, saving && commonStyles.buttonDisabled]}
                  onPress={handleSaveUserRoles}
                  disabled={saving}
                  activeOpacity={0.7}
                >
                  <Text style={commonStyles.buttonText}>
                    {saving ? t('saving') : t('save_changes')}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={styles.placeholderContainer}>
                <Text style={styles.placeholderIcon}>👤</Text>
                <Text style={styles.placeholderText}>
                  {t('select_user_to_manage_roles')}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

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
  tabNav: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  tabButton: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: theme.colors.primary,
  },
  tabButtonDisabled: {
    opacity: 0.5,
  },
  tabButtonText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
  },
  tabButtonTextActive: {
    color: theme.colors.primary,
    fontWeight: theme.fontWeight.semibold,
  },
  tabButtonTextDisabled: {
    color: theme.colors.textMuted,
  },
  scrollContainer: {
    padding: theme.spacing.md,
  },
  descriptionCard: {
    marginBottom: theme.spacing.md,
  },
  descriptionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    lineHeight: theme.fontSize.sm * theme.lineHeight.relaxed,
  },
  roleCard: {
    marginBottom: theme.spacing.md,
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  roleInfo: {
    flex: 1,
  },
  roleName: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.secondary,
  },
  roleBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    textTransform: 'uppercase',
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
  },
  toggleIcon: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
  },
  toggleText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
  },
  roleDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
  permissionsContainer: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  permissionsTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  noPermissionsText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  permissionRow: {
    paddingVertical: theme.spacing.xs,
  },
  permissionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
  usersTabContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  userListPanel: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  userSearchContainer: {
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  userSearchInput: {
    ...commonStyles.input,
    marginBottom: 0,
  },
  userItem: {
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  userItemSelected: {
    backgroundColor: theme.colors.selectedBackground,
  },
  userInfo: {
    gap: theme.spacing.xs,
  },
  userName: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
  },
  userEmail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
  },
  userRolesSummary: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.primary,
    fontStyle: 'italic',
  },
  userAssignmentPanel: {
    flex: 1,
  },
  assignmentContainer: {
    padding: theme.spacing.md,
  },
  assignmentTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  assignmentEmail: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.lg,
  },
  rolesListTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  roleCheckbox: {
    marginVertical: theme.spacing.xs,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  placeholderIcon: {
    fontSize: 64,
    marginBottom: theme.spacing.md,
  },
  placeholderText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
});

export default RoleManagementScreen;
