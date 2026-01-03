/**
 * Register Screen
 *
 * Mirrors spa/register.js functionality
 * User registration with organization access password
 */

import Reactfrom 'react';
import { useSafeState } from '../hooks/useSafeState';
import {
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { translate as t } from '../i18n';
import theme, { commonStyles } from '../theme';
import {
  Card,
  FormField,
  Select,
  Toast,
  useToast,
} from '../components';
import API from '../api/api-core';
import { validateEmail, validatePassword, validateRequired } from '../utils/ValidationUtils';

const RegisterScreen = ({ navigation }) => {
  const [formData, setFormData] = useSafeState({
    full_name: '',
    email: '',
    password: '',
    confirm_password: '',
    account_creation_password: '',
    user_type: 'parent',
  });

  const [loading, setLoading] = useSafeState(false);
  const toast = useToast();

  const handleRegister = async () => {
    // Validate required fields
    if (!validateRequired(formData.full_name)) {
      toast.show(t('full_name') + ' ' + t('is_required'), 'warning');
      return;
    }

    if (!validateRequired(formData.email)) {
      toast.show(t('email_required'), 'warning');
      return;
    }

    // Validate email format
    if (!validateEmail(formData.email)) {
      toast.show(t('invalid_email'), 'warning');
      return;
    }

    if (!validateRequired(formData.password)) {
      toast.show(t('password_required'), 'warning');
      return;
    }

    // Validate password strength
    const passwordError = validatePassword(formData.password);
    if (passwordError) {
      toast.show(passwordError, 'warning');
      return;
    }

    if (!validateRequired(formData.confirm_password)) {
      toast.show(t('confirm_password') + ' ' + t('is_required'), 'warning');
      return;
    }

    // Check password match
    if (formData.password !== formData.confirm_password) {
      toast.show(t('passwords_do_not_match'), 'error');
      return;
    }

    if (!validateRequired(formData.account_creation_password)) {
      toast.show(t('account_creation_password') + ' ' + t('is_required'), 'warning');
      return;
    }

    try {
      setLoading(true);

      const payload = {
        full_name: formData.full_name.trim(),
        email: formData.email.toLowerCase().trim(),
        password: formData.password,
        confirm_password: formData.confirm_password,
        account_creation_password: formData.account_creation_password,
        user_type: formData.user_type,
      };

      // Use /public/register endpoint (mirrors spa/api/api-endpoints.js)
      const result = await API.public('/public/register', payload, 'POST');

      if (result.success) {
        toast.show(result.message || t('registration_successful_parent'), 'success');
        setTimeout(() => {
          navigation.navigate('Login');
        }, 3000);
      } else {
        toast.show(result.message || t('error_creating_account'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_creating_account'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={commonStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <Card style={styles.formCard}>
          <Text style={styles.title}>{t('register')}</Text>

          <FormField
            label={t('full_name')}
            value={formData.full_name}
            onChangeText={(value) => setFormData({ ...formData, full_name: value })}
            placeholder={t('enter_full_name')}
            required
            autoCapitalize="words"
            textContentType="name"
          />

          <FormField
            label={t('email')}
            value={formData.email}
            onChangeText={(value) => setFormData({ ...formData, email: value })}
            placeholder={t('enter_email')}
            required
            keyboardType="email-address"
            autoCapitalize="none"
            textContentType="emailAddress"
          />

          <FormField
            label={t('password')}
            value={formData.password}
            onChangeText={(value) => setFormData({ ...formData, password: value })}
            placeholder={t('enter_password')}
            required
            secureTextEntry
            textContentType="newPassword"
          />

          <FormField
            label={t('confirm_password')}
            value={formData.confirm_password}
            onChangeText={(value) =>
              setFormData({ ...formData, confirm_password: value })
            }
            placeholder={t('confirm_password')}
            required
            secureTextEntry
            textContentType="newPassword"
          />

          <FormField
            label={t('account_creation_password')}
            value={formData.account_creation_password}
            onChangeText={(value) =>
              setFormData({ ...formData, account_creation_password: value })
            }
            placeholder={t('organization_access_password')}
            required
            secureTextEntry
            textContentType="password"
          />

          <Picker
            label={t('user_type')}
            value={formData.user_type}
            onValueChange={(value) => setFormData({ ...formData, user_type: value })}
            items={[
              { label: t('parent'), value: 'parent' },
              { label: t('leader'), value: 'leader' },
              { label: t('finance'), value: 'finance' },
              { label: t('equipment') || t('inventory'), value: 'equipment' },
              { label: t('administration'), value: 'administration' },
            ]}
            required
          />

          <TouchableOpacity
            style={[
              commonStyles.button,
              styles.registerButton,
              loading && commonStyles.buttonDisabled,
            ]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={commonStyles.buttonText}>
              {loading ? t('registering') : t('register')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.loginLink}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.7}
          >
            <Text style={styles.loginLinkText}>{t('already_have_account')}</Text>
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
  registerButton: {
    marginTop: theme.spacing.md,
  },
  loginLink: {
    marginTop: theme.spacing.md,
    alignItems: 'center',
    minHeight: theme.touchTarget.min,
    justifyContent: 'center',
  },
  loginLinkText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.primary,
    textDecorationLine: 'underline',
  },
});

export default RegisterScreen;