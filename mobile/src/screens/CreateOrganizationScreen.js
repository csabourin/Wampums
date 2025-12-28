/**
 * Create Organization Screen
 *
 * Mirrors spa/create_organization.js functionality
 * Create a new organization/unit (district admin feature)
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  LoadingSpinner,
  ErrorMessage,
  Card,
  FormField,
  Toast,
  useToast,
} from '../components';
import { canCreateOrganization, hasRole } from '../utils/PermissionUtils';
import { CONFIG } from '../config';
import { API } from '../api/api-core';
import StorageUtils from '../utils/StorageUtils';

const CreateOrganizationScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    address: '',
    city: '',
    province: '',
    postal_code: '',
    phone: '',
    email: '',
    registration_password: '',
    account_creation_password: '',
  });

  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      // Check if user has permission to create organizations
      if (!canCreateOrganization() && !hasRole('district')) {
        Alert.alert(
          t('access_denied'),
          t('no_permission_to_create_organizations'),
          [
            {
              text: t('OK'),
              onPress: () => navigation.navigate('Dashboard'),
            },
          ]
        );
        return;
      }

      setLoading(false);
    } catch (err) {
      setError(err.message || t('error_loading_data'));
      setLoading(false);
    }
  };

  const handleCreateOrganization = async () => {
    // Validate required fields
    if (
      !formData.name ||
      !formData.registration_password ||
      !formData.account_creation_password
    ) {
      toast.show(t('fill_required_fields'), 'warning');
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(`${API.baseURL}/organizations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await StorageUtils.getToken()}`,
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        toast.show(t('unit_created_successfully'), 'success');
        setTimeout(() => {
          navigation.navigate('Admin');
        }, 2000);
      } else {
        toast.show(result.message || t('error_creating_unit'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_creating_unit'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message={t('loading')} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={checkPermissions} />;
  }

  return (
    <KeyboardAvoidingView
      style={commonStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Card style={styles.formCard}>
          <Text style={styles.title}>{t('create_new_unit')}</Text>

          <FormField
            label={t('organization_name')}
            value={formData.name}
            onChangeText={(value) => setFormData({ ...formData, name: value })}
            placeholder={t('enter_organization_name')}
            required
          />

          <FormField
            label={t('address')}
            value={formData.address}
            onChangeText={(value) => setFormData({ ...formData, address: value })}
            placeholder={t('enter_address')}
          />

          <FormField
            label={t('city')}
            value={formData.city}
            onChangeText={(value) => setFormData({ ...formData, city: value })}
            placeholder={t('enter_city')}
          />

          <FormField
            label={t('province')}
            value={formData.province}
            onChangeText={(value) => setFormData({ ...formData, province: value })}
            placeholder={t('enter_province')}
          />

          <FormField
            label={t('postal_code')}
            value={formData.postal_code}
            onChangeText={(value) => setFormData({ ...formData, postal_code: value })}
            placeholder={t('enter_postal_code')}
          />

          <FormField
            label={t('phone')}
            value={formData.phone}
            onChangeText={(value) => setFormData({ ...formData, phone: value })}
            placeholder={t('enter_phone')}
            keyboardType="phone-pad"
          />

          <FormField
            label={t('email')}
            value={formData.email}
            onChangeText={(value) => setFormData({ ...formData, email: value })}
            placeholder={t('enter_email')}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <FormField
            label={t('registration_password')}
            value={formData.registration_password}
            onChangeText={(value) =>
              setFormData({ ...formData, registration_password: value })
            }
            placeholder={t('password_for_users_to_join')}
            required
            secureTextEntry
            textContentType="password"
          />

          <FormField
            label={t('account_creation_password')}
            value={formData.account_creation_password}
            onChangeText={(value) =>
              setFormData({ ...formData, account_creation_password: value })
            }
            placeholder={t('password_for_new_accounts')}
            required
            secureTextEntry
            textContentType="password"
          />

          <TouchableOpacity
            style={[
              commonStyles.button,
              styles.createButton,
              submitting && commonStyles.buttonDisabled,
            ]}
            onPress={handleCreateOrganization}
            disabled={submitting}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>
              {submitting ? t('creating') : t('create_unit')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.backLink}
            onPress={() => navigation.navigate('Admin')}
            activeOpacity={0.7}
          >
            <Text style={styles.backLinkText}>{t('back_to_admin')}</Text>
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
  createButton: {
    marginTop: theme.spacing.md,
  },
  backLink: {
    marginTop: theme.spacing.md,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  backLinkText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.primary,
    textDecorationLine: 'underline',
  },
});

export default CreateOrganizationScreen;
