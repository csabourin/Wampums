/**
 * Reset Password Screen
 *
 * Mirrors spa/reset_password.js functionality
 * Two-step password reset: request link or reset with token
 */

import React, { useState, useEffect } from 'react';
import {
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
  Card,
  FormField,
  Toast,
  useToast,
} from '../components';
import API from '../api/api-core';
import { validatePassword } from '../utils/ValidationUtils';

const ResetPasswordScreen = ({ route, navigation }) => {
  const { token } = route.params || {};
  const [mode, setMode] = useState(token ? 'reset' : 'email');

  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (token) {
      setMode('reset');
    }
  }, [token]);

  const handleSendResetLink = async () => {
    if (!email) {
      toast.show(t('please_enter_email'), 'warning');
      return;
    }

    try {
      setLoading(true);

      const result = await API.public('/api/auth/request-reset', { email }, 'POST');

      if (result.success) {
        toast.show(t('reset_link_sent'), 'success');
        setEmail('');
      } else {
        toast.show(result.message || t('error_sending_reset_link'), 'error');
      }
    } catch (err) {
      toast.show(err.message || t('error_sending_reset_link'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast.show(t('please_fill_all_fields'), 'warning');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.show(t('passwords_do_not_match'), 'error');
      return;
    }

    // Client-side validation
    const validationError = validatePassword(newPassword);
    if (validationError) {
      toast.show(validationError, 'error');
      return;
    }

    try {
      setLoading(true);

      const result = await API.public('/api/auth/reset-password', { token, new_password: newPassword }, 'POST');

      if (result.success) {
        toast.show(t('password_reset_successful'), 'success');
        setTimeout(() => {
          navigation.navigate('Login');
        }, 2000);
      } else {
        // Handle validation errors from server
        if (result.errors && result.errors.length > 0) {
          const errorMessages = result.errors.map((err) => err.msg).join('. ');
          toast.show(errorMessages, 'error');
        } else {
          toast.show(result.message || t('error_resetting_password'), 'error');
        }
      }
    } catch (err) {
      toast.show(err.message || t('error_resetting_password'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const renderEmailStep = () => {
    return (
      <Card style={styles.formCard}>
        <Text style={styles.title}>{t('reset_password')}</Text>
        <Text style={styles.instructions}>{t('enter_email_for_reset_link')}</Text>

        <FormField
          label={t('email')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('enter_email')}
          required
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
        />

        <TouchableOpacity
          style={[
            commonStyles.button,
            styles.submitButton,
            loading && commonStyles.buttonDisabled,
          ]}
          onPress={handleSendResetLink}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={commonStyles.buttonText}>
            {loading ? t('sending') : t('send_reset_link')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backLink}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.7}
        >
          <Text style={styles.backLinkText}>{t('back_to_login')}</Text>
        </TouchableOpacity>
      </Card>
    );
  };

  const renderResetStep = () => {
    return (
      <Card style={styles.formCard}>
        <Text style={styles.title}>{t('reset_password')}</Text>
        <Text style={styles.instructions}>{t('enter_new_password')}</Text>

        <FormField
          label={t('new_password')}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder={t('enter_new_password')}
          required
          secureTextEntry
          textContentType="newPassword"
        />

        <Text style={styles.passwordHint}>{t('password_requirements')}</Text>

        <FormField
          label={t('confirm_password')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={t('confirm_password')}
          required
          secureTextEntry
          textContentType="newPassword"
        />

        <TouchableOpacity
          style={[
            commonStyles.button,
            styles.submitButton,
            loading && commonStyles.buttonDisabled,
          ]}
          onPress={handleResetPassword}
          disabled={loading}
          activeOpacity={0.7}
        >
          <Text style={commonStyles.buttonText}>
            {loading ? t('resetting') : t('reset_password')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backLink}
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.7}
        >
          <Text style={styles.backLinkText}>{t('back_to_login')}</Text>
        </TouchableOpacity>
      </Card>
    );
  };

  return (
    <KeyboardAvoidingView
      style={commonStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        {mode === 'email' ? renderEmailStep() : renderResetStep()}
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
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  instructions: {
    fontSize: theme.fontSize.base,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.lg,
    textAlign: 'center',
  },
  passwordHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.md,
    marginTop: -theme.spacing.sm,
  },
  submitButton: {
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

export default ResetPasswordScreen;
