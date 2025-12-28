/**
 * Form Permissions Screen
 *
 * Mirrors spa/form_permissions.js functionality
 * Manage which roles can view, submit, edit, and approve different form types
 * Set display contexts for forms
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
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
} from '../components';
import { isAdmin, isDistrictAdmin } from '../utils/PermissionUtils';
import { CONFIG } from '../config';
import { API } from '../api/api-core';
import StorageUtils from '../utils/StorageUtils';

const FormPermissionsScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [formTypes, setFormTypes] = useState([]);
  const [roles, setRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // Check permission
    if (!isAdmin()) {
      navigation.goBack();
      return;
    }

    loadData();
  }, []);

  const loadData = async (forceRefresh = false) => {
    try {
      setError('');

      const response = await fetch(`${API.baseURL}/form-permissions`, {
        headers: {
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
      });

      if (!response.ok) {
        throw new Error(t('failed_to_load_form_permissions'));
      }

      const result = await response.json();

      if (result.success) {
        const perms = result.data || [];
        setPermissions(perms);

        // Extract unique form types and roles
        const formTypesSet = new Set();
        const rolesSet = new Set();

        perms.forEach((perm) => {
          formTypesSet.add(perm.form_type);
          rolesSet.add(perm.role_name);
        });

        setFormTypes(Array.from(formTypesSet).sort());
        setRoles(
          Array.from(rolesSet).sort((a, b) => {
            const order = [
              'district',
              'unitadmin',
              'leader',
              'parent',
              'finance',
              'equipment',
              'administration',
              'demoadmin',
              'demoparent',
            ];
            return order.indexOf(a) - order.indexOf(b);
          })
        );
      } else {
        throw new Error(result.message || t('failed_to_load_form_permissions'));
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

  const updatePermission = async (formFormatId, roleId, permissionData) => {
    try {
      setSaving(true);

      const response = await fetch(`${API.baseURL}/form-permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
        body: JSON.stringify({
          form_format_id: formFormatId,
          role_id: roleId,
          ...permissionData,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t('failed_to_update_permissions'));
      }

      toast.show(t('permissions_updated'), 'success');
      return true;
    } catch (err) {
      toast.show(err.message || t('error_updating_permissions'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateDisplayContext = async (formFormatId, displayContext) => {
    try {
      setSaving(true);

      const response = await fetch(`${API.baseURL}/form-display-context`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
        body: JSON.stringify({
          form_format_id: formFormatId,
          display_context: displayContext,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t('failed_to_update_display_context'));
      }

      toast.show(t('display_context_updated'), 'success');
      return true;
    } catch (err) {
      toast.show(err.message || t('error_updating_display_context'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handlePermissionChange = async (formFormatId, roleId, permissionKey, value) => {
    // Find the permission object
    const perm = permissions.find(
      (p) => p.form_format_id === formFormatId && p.role_id === roleId
    );

    if (!perm) return;

    // Prepare the updated permissions
    const updatedPermissions = {
      can_view: perm.can_view,
      can_submit: perm.can_submit,
      can_edit: perm.can_edit,
      can_approve: perm.can_approve,
      [permissionKey]: value,
    };

    // Update locally
    setPermissions((prev) =>
      prev.map((p) =>
        p.form_format_id === formFormatId && p.role_id === roleId
          ? { ...p, [permissionKey]: value }
          : p
      )
    );

    // Update server
    await updatePermission(formFormatId, roleId, updatedPermissions);
  };

  const handleDisplayContextChange = async (formFormatId, context, value) => {
    // Find the permission object to get current display context
    const perm = permissions.find((p) => p.form_format_id === formFormatId);

    if (!perm) return;

    const currentContext = perm.display_context || [];
    const updatedContext = value
      ? [...currentContext, context]
      : currentContext.filter((c) => c !== context);

    // Update locally
    setPermissions((prev) =>
      prev.map((p) =>
        p.form_format_id === formFormatId ? { ...p, display_context: updatedContext } : p
      )
    );

    // Update server
    await updateDisplayContext(formFormatId, updatedContext);
  };

  const renderFormSection = (formType) => {
    const formPerms = permissions.filter((p) => p.form_type === formType);

    if (formPerms.length === 0) return null;

    const formDisplayName = formPerms[0]?.display_name || formType;
    const formFormatId = formPerms[0]?.form_format_id;
    const displayContext = formPerms[0]?.display_context || [];

    const displayContexts = [
      'participant',
      'organization',
      'admin_panel',
      'public',
      'form_builder',
    ];

    return (
      <Card key={formType} style={styles.formSection}>
        <Text style={styles.formSectionTitle}>{t(formType) || formDisplayName}</Text>

        {/* Display Contexts */}
        <View style={styles.displayContextSection}>
          <Text style={styles.displayContextTitle}>{t('display_contexts')}</Text>
          <Text style={styles.displayContextDescription}>
            {t('display_contexts_description')}
          </Text>

          <View style={styles.contextCheckboxes}>
            {displayContexts.map((ctx) => (
              <Checkbox
                key={ctx}
                label={t(`context_${ctx}`)}
                checked={displayContext.includes(ctx)}
                onPress={() =>
                  handleDisplayContextChange(formFormatId, ctx, !displayContext.includes(ctx))
                }
                style={styles.contextCheckbox}
              />
            ))}
          </View>
        </View>

        {/* Role Permissions Table */}
        <View style={styles.permissionsTableSection}>
          <Text style={styles.permissionsSubtitle}>{t('role_permissions')}</Text>

          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.headerCell, styles.roleCellHeader]}>{t('role')}</Text>
            <Text style={styles.headerCell}>{t('can_view')}</Text>
            <Text style={styles.headerCell}>{t('can_submit')}</Text>
            <Text style={styles.headerCell}>{t('can_edit')}</Text>
            <Text style={styles.headerCell}>{t('can_approve')}</Text>
          </View>

          {/* Table Rows */}
          {roles.map((roleName) => {
            const perm = formPerms.find((p) => p.role_name === roleName);
            if (!perm) return null;

            return (
              <View key={roleName} style={styles.tableRow}>
                <Text style={[styles.tableCell, styles.roleCell]}>
                  {t(roleName) || perm.role_display_name}
                </Text>
                <View style={styles.tableCell}>
                  <Checkbox
                    checked={perm.can_view}
                    onPress={() =>
                      handlePermissionChange(
                        perm.form_format_id,
                        perm.role_id,
                        'can_view',
                        !perm.can_view
                      )
                    }
                  />
                </View>
                <View style={styles.tableCell}>
                  <Checkbox
                    checked={perm.can_submit}
                    onPress={() =>
                      handlePermissionChange(
                        perm.form_format_id,
                        perm.role_id,
                        'can_submit',
                        !perm.can_submit
                      )
                    }
                  />
                </View>
                <View style={styles.tableCell}>
                  <Checkbox
                    checked={perm.can_edit}
                    onPress={() =>
                      handlePermissionChange(
                        perm.form_format_id,
                        perm.role_id,
                        'can_edit',
                        !perm.can_edit
                      )
                    }
                  />
                </View>
                <View style={styles.tableCell}>
                  <Checkbox
                    checked={perm.can_approve}
                    onPress={() =>
                      handlePermissionChange(
                        perm.form_format_id,
                        perm.role_id,
                        'can_approve',
                        !perm.can_approve
                      )
                    }
                  />
                </View>
              </View>
            );
          })}
        </View>
      </Card>
    );
  };

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
          <Text style={styles.title}>{t('form_permissions_management')}</Text>
          <Text style={styles.subtitle}>{t('form_permissions_description')}</Text>
        </Card>

        {/* Form Sections */}
        {formTypes.map((formType) => renderFormSection(formType))}
      </ScrollView>

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
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    lineHeight: theme.fontSize.sm * theme.lineHeight.relaxed,
  },
  formSection: {
    marginBottom: theme.spacing.md,
  },
  formSectionTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.md,
  },
  displayContextSection: {
    marginBottom: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  displayContextTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  displayContextDescription: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
  },
  contextCheckboxes: {
    gap: theme.spacing.sm,
  },
  contextCheckbox: {
    marginVertical: theme.spacing.xs,
  },
  permissionsTableSection: {
    marginTop: theme.spacing.md,
  },
  permissionsSubtitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: theme.colors.secondary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.borderRadius.sm,
    marginBottom: theme.spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerCell: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.text,
    textAlign: 'center',
  },
  roleCellHeader: {
    flex: 2,
    textAlign: 'left',
  },
  tableCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleCell: {
    flex: 2,
    alignItems: 'flex-start',
    fontSize: theme.fontSize.sm,
    color: theme.colors.text,
  },
});

export default FormPermissionsScreen;
