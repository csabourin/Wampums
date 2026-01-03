/**
 * Register Organization Screen
 *
 * Mirrors spa/register_organization.js functionality
 * Join an organization with a registration password
 */

import React, { useEffect } from 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  Card,
  FormField,
  Select,
  Checkbox,
  Toast,
  useToast,
} from '../components';
import { isParent } from '../utils/PermissionUtils';
import CONFIG from '../config';
import API from '../api/api-core';
import StorageUtils from '../utils/StorageUtils';
import { validateRequired } from '../utils/ValidationUtils';
import { debugError } from '../utils/DebugUtils';

const RegisterOrganizationScreen = ({ navigation }) => {
  const [loading, setLoading] = useSafeState(true);
  const [children, setChildren] = useSafeState([]);
  const [selectedChildren, setSelectedChildren] = useSafeState([]);

  const [formData, setFormData] = useSafeState({
    role: 'parent',
    registration_password: '',
  });

  const [submitting, setSubmitting] = useSafeState(false);
  const toast = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load user's children if they are a parent
      if (isParent()) {
        const userId = await StorageUtils.getItem(CONFIG.STORAGE_KEYS.USER_ID);

        // Use centralized API helper
        const result = await API.get(`/v1/users/${userId}/children`);

        if (result.success && result.data) {
          setChildren(result.data.children || result.data || []);
        }
      }
    } catch (err) {
      debugError('Error loading children:', err);
      // Don't show error toast during initial load, just log it
    } finally {
      setLoading(false);
    }
  };

  const handleToggleChild = (childId) => {
    setSelectedChildren((prev) =>
      prev.includes(childId)
        ? prev.filter((id) => id !== childId)
        : [...prev, childId]
    );
  };

  const handleRegister = async () => {
    // Validate registration password
    if (!validateRequired(formData.registration_password)) {
      toast.show(t('registration_password') + ' ' + t('is_required'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        role: formData.role,
        registration_password: formData.registration_password.trim(),
        link_children: selectedChildren,
      };

      // Use centralized API helper (mirrors spa/api/api-endpoints.js)
      const result = await API.post('/register-for-organization', payload);

      if (result.success) {
        toast.show(
          result.message || t('successfully_registered_for_organization'),
          'success'
        );
        setTimeout(() => {
          navigation.navigate('MainTabs');
        }, 2000);
      } else {
        toast.show(result.message || t('error_registering_for_organization'), 'error');
      }
    } catch (err) {
      debugError('Error registering for organization:', err);
      toast.show(err.message || t('error_registering_for_organization'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  return (
    <KeyboardAvoidingView
      style={commonStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Card style={styles.formCard}>
          <Text style={styles.title}>{t('register_for_organization')}</Text>

          <Select
            label={t('select_role')}
            value={formData.role}
            onValueChange={(value) => setFormData({ ...formData, role: value })}
            options={[
              { label: t('parent'), value: 'parent' },
              { label: t('leader'), value: 'leader' },
              { label: t('finance'), value: 'finance' },
              { label: t('equipment') || t('inventory'), value: 'equipment' },
              { label: t('administration'), value: 'administration' },
            ]}
            required
          />

          <FormField
            label={t('registration_password')}
            value={formData.registration_password}
            onChangeText={(value) =>
              setFormData({ ...formData, registration_password: value })
            }
            placeholder={t('enter_organization_password')}
            required
            secureTextEntry
            textContentType="password"
          />

          {/* Link Children Section */}
          {children.length > 0 && (
            <View style={styles.childrenSection}>
              <Text style={styles.childrenTitle}>{t('link_children_to_organization')}</Text>
              {children.map((child) => (
                <Checkbox
                  key={child.id}
                  checked={selectedChildren.includes(child.id)}
                  onPress={() => handleToggleChild(child.id)}
                  label={`${child.first_name} ${child.last_name}`}
                />
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[
              commonStyles.button,
              styles.registerButton,
              submitting && commonStyles.buttonDisabled,
            ]}
            onPress={handleRegister}
            disabled={submitting}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>
              {submitting ? t('registering') : t('register')}
            </Text>
          </TouchableOpacity>
        </Card>
      </ScrollView>

      {/* Toast Notifications */}
      <Toast
        visible={toast.toastState.visible}
        message={toast.toastState.message}
        type={toast.toastState.type}
        duration={toast.toastState.duration}
        onDismiss={toast.hide}
      />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    padding: theme.spacing.md,
    flexGrow: 1,
    justifyContent: 'center',
  },
  formCard: {
    marginBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.xxl,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.primary,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  childrenSection: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.md,
  },
  childrenTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.bold,
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  registerButton: {
    marginTop: theme.spacing.md,
  },
});

export default RegisterOrganizationScreen;